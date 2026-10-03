import { env } from "./env.js";

/** where the employee data comes from, and how often we refresh it */
export const sheetsConfig = {
  source: env.DATA_SOURCE,
  serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
  sheetId: env.GOOGLE_SHEET_ID,
  skipTabs: env.SHEET_SKIP_TABS,
  excelPath: env.EXCEL_PATH,
  syncIntervalMinutes: env.SYNC_INTERVAL_MINUTES,
};
