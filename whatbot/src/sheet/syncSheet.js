import { sheetsConfig } from "../config/index.js";
import { logger } from "../system/logger.js";
import { crawlSheet } from "../system/sheets.js";
import { readWorkbook } from "../system/excel.js";
import * as assignmentStore from "../employee/storage.js";
import { FAKE_TABS } from "./fakes/fakeEmployees.js";
import { parseRows } from "./parseSheet.js";

/**
 * Where the rows come from. The only thing that differs between sources — from
 * here down, nothing can tell a local workbook from Google Sheets.
 */
async function readSource() {
  switch (sheetsConfig.source) {
    case "sheets":
      return crawlSheet();
    case "excel":
      return readWorkbook(sheetsConfig.excelPath);
    case "fake":
      return FAKE_TABS;
  }
}

/**
 * Read every tab, check it, merge it all together, save it.
 *
 * Groups are one tab each, so if a row has no group column we use the tab name.
 * Nobody has to type "MILKMAN" on thirty rows.
 *
 * Answering a question only ever reads the saved copy — the spreadsheet is
 * never in the path of someone waiting for a reply.
 */
export async function syncSheet() {
  const tabs = await readSource();

  const all = [];
  const perTab = [];
  let rejectedTotal = 0;
  let mismatchedTotal = 0;

  for (const tab of tabs) {
    const { assignments, rejected, mismatched } = parseRows(
      tab.rows,
      tab.name,
    );

    if (rejected.length > 0) {
      logger.error(
        {
          tab: tab.name,
          total: rejected.length,
          examples: rejected.slice(0, 5),
        },
        "rows rejected — these are MISSING from every total",
      );
    }

    // Logged separately and every time, not sampled. These rows ARE in the
    // totals, at a figure the sheet disagrees with itself about — which is
    // harder to spot than a row that simply is not there.
    if (mismatched.length > 0) {
      logger.warn(
        { tab: tab.name, total: mismatched.length, rows: mismatched },
        "rows where payable does not match the monthly rate — using the stated payable",
      );
    }

    all.push(...assignments);
    rejectedTotal += rejected.length;
    mismatchedTotal += mismatched.length;
    perTab.push({
      name: tab.name,
      loaded: assignments.length,
      rejected: rejected.length,
    });
  }

  // NOT deduplicated by person and company. One person legitimately holds the
  // same role on the same company twice with different payable days — those are
  // two real payments, and collapsing them deletes somebody's wages. The
  // assignment id carries the row number for exactly this reason.
  const byId = new Map();
  for (const a of all) {
    if (byId.has(a.assignmentId)) {
      logger.warn(
        { assignmentId: a.assignmentId },
        "duplicate assignment id — check the sheet",
      );
    }
    byId.set(a.assignmentId, a);
  }
  const assignments = [...byId.values()];

  // One phone belongs to one person. The same person on two numbers means we
  // cannot tell which thread is theirs, so it gets reported rather than guessed.
  const phonesByPerson = new Map();
  for (const a of assignments) {
    if (!a.phone) continue;
    phonesByPerson.set(
      a.personId,
      (phonesByPerson.get(a.personId) ?? new Set()).add(a.phone),
    );
  }
  for (const [personId, phones] of phonesByPerson) {
    if (phones.size > 1) {
      logger.error(
        { personId, phones: phones.size },
        "one person has more than one phone number",
      );
    }
  }

  const people = new Set(assignments.map((a) => a.personId)).size;

  // never replace everything with nothing. zero rows almost always means a
  // broken sheet, not an empty company — and wiping the store takes the bot
  // offline for everybody.
  if (assignments.length === 0) {
    logger.error(
      { tabs: perTab },
      "sync produced zero assignments — keeping previous data",
    );
    return {
      loaded: 0,
      rejected: rejectedTotal,
      mismatched: mismatchedTotal,
      people: 0,
      tabs: perTab,
    };
  }

  await assignmentStore.replaceAll(assignments);
  logger.info(
    {
      loaded: assignments.length,
      people,
      rejected: rejectedTotal,
      mismatched: mismatchedTotal,
      tabs: perTab,
      source: sheetsConfig.source,
    },
    "sheet synced",
  );

  return {
    loaded: assignments.length,
    rejected: rejectedTotal,
    mismatched: mismatchedTotal,
    people,
    tabs: perTab,
  };
}
