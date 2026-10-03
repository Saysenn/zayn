import { JWT } from "google-auth-library";
import { sheetsConfig } from "../config/index.js";
import { logger } from "./logger.js";

/**
 * Reads Google Sheets over plain REST.
 *
 * Using google-auth-library just for the token signing, not the full
 * `googleapis` package — we call one endpoint, and that package ships clients
 * for about 400 APIs we'll never touch.
 */

const API = "https://sheets.googleapis.com/v4/spreadsheets";

async function accessToken() {
  const creds = JSON.parse(sheetsConfig.serviceAccountJson);

  const client = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Google returned no access token");
  return token;
}

async function get(path) {
  const res = await fetch(`${API}/${path}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (!res.ok)
    throw new Error(`Sheets read failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

/** every tab in the spreadsheet, in the order HR sees them */
export async function listTabs() {
  const body = await get(
    `${sheetsConfig.sheetId}?fields=sheets.properties.title`,
  );
  return (body.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t) => Boolean(t));
}

/**
 * Read every tab, skipping the ones listed in SHEET_SKIP_TABS.
 *
 * One request per tab instead of one batch request. Slower, but if HR breaks
 * one tab it doesn't take the other four down with it — and the error tells you
 * exactly which tab is the problem.
 */
export async function crawlSheet() {
  const all = await listTabs();
  const skip = new Set(sheetsConfig.skipTabs.map((t) => t.toLowerCase()));
  const wanted = all.filter((t) => !skip.has(t.toLowerCase()));

  logger.info(
    { found: all.length, reading: wanted.length },
    "crawling sheet tabs",
  );

  const tabs = [];
  for (const name of wanted) {
    try {
      const body = await get(
        `${sheetsConfig.sheetId}/values/${encodeURIComponent(`'${name}'!A1:ZZ5000`)}`,
      );
      tabs.push({ name, rows: body.values ?? [] });
    } catch (err) {
      logger.error({ err, tab: name }, "could not read tab — skipping it");
    }
  }

  return tabs;
}
