import { pino } from "pino";
import { loggerConfig } from "../config/index.js";

/**
 * Every warn/error/fatal line also goes to the CRM's Logs page, without any
 * call site changing — a pino hook sees every log call in one place, same
 * spirit as crmClient.js's other best-effort calls.
 *
 * Imports crmClient.js lazily (not at module load) because crmClient.js
 * itself imports this logger — a static import here would be a cycle.
 *
 * Guards against one specific loop: crmClient.js's own network failure logs
 * "CRM call failed" (when the CRM is unreachable) via this same logger. If
 * that log were forwarded, the forward attempt would fail the same way and
 * log the same message again, forever. Skipped by name, not by silencing
 * warn/error generally.
 */
let recordLog;

function serializeDetail(detail) {
  if (!detail || typeof detail !== "object") return detail;
  const out = {};
  for (const [key, value] of Object.entries(detail)) {
    out[key] = value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
  }
  return out;
}

function messageAndDetailFrom(args) {
  const [first, second] = args;
  if (typeof first === "string") return { message: first, detail: undefined };
  if (first instanceof Error) {
    return { message: first.message, detail: { name: first.name, stack: first.stack } };
  }
  if (first && typeof first === "object") {
    return { message: typeof second === "string" ? second : "log", detail: serializeDetail(first) };
  }
  return { message: String(first ?? "log"), detail: undefined };
}

async function forwardToCrm(levelLabel, args) {
  const { message, detail } = messageAndDetailFrom(args);
  if (message === "CRM call failed") return; // see guard note above

  try {
    if (!recordLog) ({ recordLog } = await import("./crmClient.js"));
    await recordLog(levelLabel, message, detail);
  } catch {
    // best-effort — a broken forward must never affect real logging
  }
}

export const logger = pino({
  ...loggerConfig,
  hooks: {
    logMethod(args, method, level) {
      if (level >= 40) forwardToCrm(pino.levels.labels[level], args); // warn and above
      return method.apply(this, args);
    },
  },
});

/**
 * Catch errors that escaped everything else, log them properly, then exit.
 *
 * Without this, Node prints a raw stack trace and dies leaving no record you
 * can actually search for later.
 */
export function installProcessErrorHandlers(scope) {
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ scope, reason }, "unhandled promise rejection");
    process.exit(1);
  });

  process.on("uncaughtException", (err) => {
    logger.fatal({ scope, err }, "uncaught exception");
    process.exit(1);
  });
}
