import ExcelJS from "exceljs";
import { sheetsConfig } from "../config/index.js";
import { logger } from "./logger.js";

/**
 * Reads a local .xlsx file — the master sheet as payroll actually keeps it.
 *
 * Same output as the Google Sheets reader, so `parseSheet` and everything after
 * it cannot tell which one produced the rows.
 *
 * Read-only, always. This file never writes back: the spreadsheet is somebody's
 * working document, and a bot editing it while they have it open is how you
 * lose a month of payroll.
 */

/**
 * One cell, as a string.
 *
 * Excel hands back six different shapes depending on how the cell was typed —
 * a formula is `{ formula, result }`, a styled cell is `{ richText: [...] }`, a
 * link is `{ text, hyperlink }`. Miss one and the value silently becomes
 * "[object Object]", which parses as a name and pays somebody nothing.
 */
export function cellToString(value) {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    // A Date holding no valid time. Excel produces these from the "TBC" rows:
    // somebody typed a placeholder into a date-formatted cell, and the file
    // hands us `Invalid Date` rather than their text. toISOString() throws
    // RangeError on it, which took down an entire payday run before a single
    // row was parsed, over one cell in one tab.
    //
    // Blank is the honest answer. The original text is already gone by the
    // time ExcelJS gives us this, so there is nothing to recover, and
    // everything downstream already treats an empty date as "not set" — the
    // same call the CRM's parseUpload.js safeDate() makes on these same rows.
    if (Number.isNaN(value.getTime())) {
      logger.warn("unreadable date cell in the workbook, read as blank");
      return "";
    }
    // dates only — a time component here would mean the cell is not a date at
    // all, and parseSheet wants YYYY-MM-DD
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("result" in value) return cellToString(value.result ?? "");
    if ("text" in value) return String(value.text);
    if ("error" in value) return ""; // #REF!, #DIV/0! — an error is not a value
    return "";
  }

  return String(value).trim();
}

/**
 * Every worksheet becomes a tab, in file order.
 *
 * Hidden sheets are skipped. They are almost always somebody's scratch working
 * — and a hidden tab that parses as people would quietly add them to totals.
 * Anything else unwanted goes in SHEET_SKIP_TABS.
 */
export async function readWorkbook(path) {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(path);
  } catch (err) {
    // A missing or locked file must not look like an empty company. syncSheet
    // keeps the previous data when a run yields nothing, and that only works if
    // this throws rather than returning [].
    throw new Error(
      `could not read the workbook at "${path}" — check EXCEL_PATH, and that the file is not open elsewhere: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const skip = new Set(sheetsConfig.skipTabs.map((t) => t.toLowerCase()));
  const tabs = [];

  workbook.eachSheet((worksheet) => {
    const name = worksheet.name.trim();

    if (worksheet.state === "hidden" || worksheet.state === "veryHidden") {
      logger.info({ tab: name }, "skipping hidden worksheet");
      return;
    }
    if (skip.has(name.toLowerCase())) {
      logger.info(
        { tab: name },
        "skipping worksheet listed in SHEET_SKIP_TABS",
      );
      return;
    }

    // columnCount rather than each row's own length: Excel rows are sparse, so
    // a row whose first cell is blank would otherwise come back shifted left
    // and every column after it would be read as the wrong field.
    const width = worksheet.columnCount;
    const rows = [];

    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const cells = [];
      for (let col = 1; col <= width; col++)
        cells.push(cellToString(row.getCell(col).value));
      rows.push(cells);
    });

    tabs.push({ name, rows });
  });

  logger.info(
    { path, tabs: tabs.map((t) => ({ name: t.name, rows: t.rows.length })) },
    "workbook read",
  );

  return tabs;
}
