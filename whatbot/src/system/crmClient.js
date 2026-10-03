import { crmConfig } from "../config/index.js";
import { logger } from "./logger.js";

/**
 * Calls into the CRM's own API — never a direct Postgres connection, per
 * system/claude.md's "Sync is API-mediated" rule.
 *
 * Every call is best-effort. The CRM being unreachable, or not configured at
 * all (CRM_API_URL/CRM_AGENT_API_KEY unset — both optional), must never break
 * a reply to someone waiting on WhatsApp.
 */
/**
 * Is there a CRM to talk to at all?
 *
 * Both settings are optional, and unset is a legitimate way to run whatbot —
 * WhatsApp answering works with no CRM anywhere. The retry outbox needs to
 * tell that apart from "configured but unreachable": one is a deployment
 * with no CRM, where retrying forever is noise, and the other is an outage,
 * where retrying is the entire point.
 */
export const crmConfigured = () =>
  Boolean(crmConfig.apiUrl && crmConfig.apiKey);

async function request(method, path, body) {
  if (!crmConfigured()) return null;

  try {
    const res = await fetch(`${crmConfig.apiUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": crmConfig.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.error({ path, status: res.status }, "CRM call failed");
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.error({ err, path }, "CRM call failed");
    return null;
  }
}

const get = (path) => request("GET", path);
const post = (path, body) => request("POST", path, body);
const patch = (path, body) => request("PATCH", path, body);

/**
 * The CRM's own master sheet, the admin-polished final version.
 *
 * READ ONLY. The CRM owns the deals: a human imports the messy sheet there
 * and cleans it up there, and whatbot reads the result back. The push that
 * used to sit here went with that decision.
 *
 * Keeps request()'s best-effort contract: null on any failure, never a
 * throw. pullMasterSheet.js treats null as "keep what we already have",
 * because a reachable-but-broken CRM must never look like an empty payroll.
 */
export const fetchMasterSheet = () => get("/api/v1/agent/master-sheet");

/** Raises a concern in the CRM's flagged queue — same categories escalate.js uses. */
export const createConcern = (personId, groupName, category, message) =>
  post("/api/v1/agent/concerns", {
    personId,
    groupName,
    category,
    // a record, not a transcript — same cap escalate.js applies to the audit log
    message: message.slice(0, 500),
  });

/** Feeds the CRM chatbox's thread history. Called after we've already
 * replied — never on the path that answers someone. */
export const recordMessage = (personId, groupName, body) =>
  post("/api/v1/agent/messages", { personId, groupName, body: body.slice(0, 4000) });

/**
 * Records a payday check outcome against the person's deals in the CRM.
 *
 * One call per deal the person holds in this group — a single yes/no reply
 * confirms every company they're paid through there, and the outcome is
 * tracked per deal, not per person. `assignmentId` is whatbot's own
 * derived ID (employee/types.js), the same value the CRM stores as
 * sync_key.
 *
 * This is now the ONLY thing whatbot writes to a deal, and the CRM can
 * switch it off from its Settings page — in which case the call returns
 * 200 with `accepted: false` rather than failing, so there is nothing to
 * retry and nothing to alert on.
 *
 * `period` is no longer sent: the CRM holds one month at a time and keeps
 * no history, so there was nothing for it to key against.
 */
/**
 * Forwards a warn/error log line to the CRM's Logs page — see system/logger.js,
 * which calls this from a pino hook rather than any call site changing.
 * The CRM decides whether to actually keep it (dev mode must be on); this
 * always sends, so whatbot never needs to know the CRM's current setting.
 */
export const recordLog = (level, message, detail) =>
  post("/api/v1/agent/logs", { level, message: message.slice(0, 500), detail });

export const recordPaymentStatus = (person, groupName, period, outcome, note) =>
  Promise.all(
    person.assignments
      .filter((a) => a.group === groupName)
      .map((a) =>
        patch("/api/v1/agent/payment-status", {
          syncKey: a.assignmentId,
          outcome,
          note,
        }),
      ),
  );
