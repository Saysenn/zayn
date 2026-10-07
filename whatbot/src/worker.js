/**
 * The worker. Holds the 5 WhatsApp connections and runs every queue.
 *
 *   npm run dev:worker      watch mode
 *   npm run start:worker    production
 *
 * RUN ONLY ONE. Two workers = two devices on one WhatsApp account, and
 * WhatsApp kicks one off.
 *
 * Queues: inbound-messages · payday-check (monthly)
 *         payday-send (one job per person, spread over a day)
 *         payday-crm-retry (5 min): payday outcomes the CRM never took,
 *           pushed again until it does. See payday/crmOutbox.js.
 *         master-sheet-pull (every few min): the roster, from the CRM.
 */

import { Queue, Worker } from "bullmq";
import {
  INBOUND_QUEUE,
  allGroups,
  env,
  features,
  paydayConfig,
  sheetsConfig,
  workerConcurrency,
} from "./config/index.js";
import { redis } from "./system/redis.js";
import { recordMessage } from "./system/crmClient.js";
import { sendText } from "./whatsapp/sendMessage.js";
import { sendDocument } from "./whatsapp/sendDocument.js";
import { startConnections, closeConnections } from "./whatsapp/connection.js";
import { receiveMessage } from "./whatsapp/receiveMessage.js";
import { buildAdminReplyApp } from "./http/adminReplyApp.js";
import { logger, installProcessErrorHandlers } from "./system/logger.js";
import { printBanner } from "./system/banner.js";
import { handleMessage, NO_REPLY } from "./conversation/handleMessage.js";
import { identify } from "./employee/access.js";
import { heardFromVoice } from "./conversation/fromVoice.js";
import { pullMasterSheet } from "./sheet/pullMasterSheet.js";
import { masterSheetConfig } from "./config/index.js";
import { PAYDAY_CRON, runScheduledPaydayCheck } from "./payday/schedule.js";
import { sendPaydayMessage } from "./payday/sendPaydayMessage.js";
import { PAYDAY_SEND_QUEUE } from "./payday/sendQueue.js";
import { retryUnsynced } from "./payday/crmOutbox.js";
import { currentPeriod } from "./config/index.js";

printBanner("worker", {
  mode: env.NODE_ENV,
  sheet: sheetsConfig.source,
  numbers: allGroups().length,
});

// without this a crash is a bare stack trace with no context
installProcessErrorHandlers("worker");

const PAYDAY_QUEUE = "payday-check";
const MASTER_SHEET_PULL_QUEUE = "master-sheet-pull";
const PAYDAY_RETRY_QUEUE = "payday-crm-retry";

/**
 * How often the outbox re-tries payday outcomes the CRM never took.
 *
 * Five minutes: an outcome is a person telling us their wages did not
 * arrive, so an hour of lag on that is too much, and a sweep that finds
 * nothing costs one Redis read.
 */
const PAYDAY_RETRY_EVERY_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// 1. Answering messages — the main job
// ---------------------------------------------------------------------------

/**
 * One job = one message. handleMessage does the work, this delivers it.
 *
 * One message in, one message out. No "Checking..." holding reply.
 * Throws are retried 3 times by BullMQ, so nothing is lost quietly.
 */
const messageWorker = new Worker(
  INBOUND_QUEUE,
  async (job) => {
    const { from, to, text, voice, groupId, messageId, attachments, batchSeq } = job.data;
    logger.info({ messageId, groupId }, "processing message");

    // A voice note becomes a question HERE, not earlier: transcription is
    // billed, and BullMQ has already dropped this job if it is a redelivery.
    // Any earlier and we pay twice for one recording.
    let question = text;
    if (voice) {
      const heard = await heardFromVoice(voice);
      if (!heard.ok) {
        await sendText(from, to, heard.reply);
        return;
      }
      question = heard.text;
    }

    const reply = await handleMessage({
      phone: from,
      channelGroup: groupId,
      text: question,
      attachments: attachments ?? [],
      // the expense brain's dedupe key: a redelivery never saves twice
      messageId,
      batchSeq,
    });

    // they opted out. say nothing at all, not even "you've opted out".
    if (reply === NO_REPLY) return;

    // reply FROM the number they messaged, or it shows up as a different chat
    await sendText(from, to, reply.text);

    // The file goes SECOND. A document arriving before the sentence that
    // explains it is a file from a number you did not expect one from.
    if (reply.attachment) {
      // Backstop. The only tool that builds a file is not even loaded when
      // documents are off, but this is the last line before it lands on a
      // phone, so it checks rather than trusts.
      if (!features.documents) {
        logger.warn(
          { fileName: reply.attachment.fileName },
          "attachment dropped — documents are off",
        );
      } else {
        await sendDocument(from, to, reply.attachment);
      }
    }

    // Feeds the CRM chatbox's thread history. Strictly after the reply
    // above — this never gets a chance to delay or risk it. identify() is a
    // second lookup rather than a change to handleMessage's return shape,
    // which every existing caller and test already depends on.
    const ctx = await identify(from, groupId);
    if (ctx) await recordMessage(ctx.person.personId, groupId, question);
  },
  // `connection` looks optional but defaults to localhost: works in dev,
  // fails silently in production
  { connection: redis, concurrency: workerConcurrency },
);

// ---------------------------------------------------------------------------
// 2. Keeping the roster fresh
// ---------------------------------------------------------------------------

// The CRM's master sheet into Redis, so answering never waits on HTTP.
//
// THE ONLY ROSTER JOB, and one direction only. The CRM owns the deals: a
// human imports the messy sheet there and cleans it up there, and whatbot
// reads the result back. Nothing whatbot holds is ever pushed to it.
//
// concurrency 1: two pulls would write the same keys.
const masterSheetPullWorker = new Worker(
  MASTER_SHEET_PULL_QUEUE,
  () => pullMasterSheet(),
  { connection: redis, concurrency: 1 },
);

// ---------------------------------------------------------------------------
// 3. The payday check — the only thing that messages people first
// ---------------------------------------------------------------------------

// Works out who is due and queues them. Sends nothing itself.
// Fires weekly and drops all but the last Friday, because cron cannot say
// "last Friday". See payday/schedule.js.
const paydayWorker = new Worker(
  PAYDAY_QUEUE,
  async () => runScheduledPaydayCheck(),
  {
    connection: redis,
    concurrency: 1,
  },
);

/**
 * The actual sends. One job per person, each with its own delay.
 *
 * concurrency 1 IS THE FEATURE. Raise it and the spacing goes, and the
 * spacing is what stops these accounts being banned. Do not optimise.
 *
 * The delay alone only spaces sends while the worker stays up. Come back
 * from an outage — laptop off, internet down — and every job whose delay
 * elapsed while nobody was watching is due at once; concurrency 1 would
 * still fire them back to back, a burst with no gap. `limiter` re-enforces
 * the gap by wall clock regardless of backlog, so a catch-up after an
 * outage paces out exactly like a normal run.
 */
const paydaySendWorker = new Worker(
  PAYDAY_SEND_QUEUE,
  async (job) => sendPaydayMessage(job.data),
  {
    connection: redis,
    concurrency: 1,
    limiter: { max: 1, duration: paydayConfig.sendGapMinutes * 60_000 },
  },
);

/**
 * The outbox. Pushes payday outcomes the CRM never took.
 *
 * Deliberately its own queue rather than a third job inside the sheet sync:
 * that one is switched off entirely when the master-sheet loop is on
 * (`autorun`), and an outcome must not stop being delivered because the
 * roster started coming from somewhere else. Runs whatever else is enabled.
 *
 * Does nothing at all when no CRM is configured — see crmOutbox.js.
 */
const paydayRetryWorker = new Worker(
  PAYDAY_RETRY_QUEUE,
  () => retryUnsynced(currentPeriod()),
  { connection: redis, concurrency: 1 },
);

// ---------------------------------------------------------------------------
// 4. When jobs fail
// ---------------------------------------------------------------------------

// out of retries = silently gone. this line is how you find out.
for (const [name, w] of [
  ["message", messageWorker],
  ["payday", paydayWorker],
  ["payday-send", paydaySendWorker],
  ["master-sheet-pull", masterSheetPullWorker],
  ["payday-crm-retry", paydayRetryWorker],
]) {
  w.on("failed", (job, err) =>
    logger.error({ worker: name, jobId: job?.id, err }, "job failed"),
  );
}

// ---------------------------------------------------------------------------
// 5. Schedules
// ---------------------------------------------------------------------------

// BullMQ's scheduler, not a cron package: already here, and keying by name
// means a restart cannot pile up duplicates.
//
// ONE ROSTER SOURCE: the CRM. whatbot pulls and never pushes, and there is
// no local-xlsx path in production any more. Two sources writing the same
// Redis keys meant whichever ran last silently won, and the flag that
// picked between them was one more thing to get wrong.
//
// syncSheet() still exists for the offline entry points (chat.js,
// payday.js, smoke.js, evals) — those legitimately want to load a file
// without a CRM. It is simply no longer scheduled.
const pullQueue = new Queue(MASTER_SHEET_PULL_QUEUE, { connection: redis });
await pullQueue.upsertJobScheduler(
  "master-sheet-pull",
  { every: masterSheetConfig.pullIntervalMinutes * 60_000 },
  { name: "pull" },
);

logger.info(
  { pullEveryMinutes: masterSheetConfig.pullIntervalMinutes },
  "master sheet: pulling from the CRM, which is the only roster source",
);

// Two switches, both off by default: PAYDAY_SCHEDULE and PAYDAY_DRY_RUN.
// Fires Fridays 16:00 UTC, keeps only the last of the month, then spreads
// the sends over ~24 hours.
if (paydayConfig.enabled) {
  const paydayQueue = new Queue(PAYDAY_QUEUE, { connection: redis });
  await paydayQueue.upsertJobScheduler(
    "payday-check",
    { pattern: PAYDAY_CRON },
    { name: "payday" },
  );
  logger.info(
    {
      schedule: paydayConfig.schedule,
      cron: PAYDAY_CRON,
      dryRun: paydayConfig.dryRun,
    },
    "payday check scheduled",
  );
}

/**
 * The outbox sweep, scheduled unconditionally.
 *
 * NOT behind paydayConfig.enabled: that flag governs whether we send checks
 * on a schedule, and outcomes exist from manual runs too
 * (`npm run payday -- --send`). Gating the retry on it would mean a manually
 * sent check whose reply arrived during a CRM outage never reaches the CRM
 * at all, which is precisely the failure this exists to close.
 */
const paydayRetryQueue = new Queue(PAYDAY_RETRY_QUEUE, { connection: redis });
await paydayRetryQueue.upsertJobScheduler(
  "payday-crm-retry",
  { every: PAYDAY_RETRY_EVERY_MS },
  { name: "retry" },
);

// ---------------------------------------------------------------------------
// 6. Starting up and shutting down
// ---------------------------------------------------------------------------

// Roster BEFORE connecting, or the first message hits an empty store.
// Logged rather than thrown: a CRM that is briefly down should delay the
// first correct answer, not stop the bot from starting, and the scheduled
// pull will fill the store within the interval.
await pullMasterSheet().catch((err) =>
  logger.error({ err }, "initial master-sheet pull failed"),
);

// Open the 5 connections. First run prints a QR per number — scan from that
// group's phone (WhatsApp > Settings > Linked devices). After that it is
// silent, and the session lives in auth_info/<group>/.
await startConnections(receiveMessage);

// The CRM chatbox's only way in — needs the sockets just opened above,
// which is the entire reason this listens here and not in server.js.
const adminReplyServer = buildAdminReplyApp().listen(env.WORKER_PORT, () => {
  logger.info({ port: env.WORKER_PORT }, "admin-reply webhook listening");
});

logger.info(
  { source: sheetsConfig.source, groups: allGroups() },
  "worker process started",
);

// Shutdown: finish in-flight jobs, then close the sockets.
// closeConnections does NOT log out — that would unlink the device and cost
// you 5 QR scans. The 10s timer kills a worker that will not finish.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down worker");
    void Promise.all([
      messageWorker.close(),
      paydayWorker.close(),
      paydaySendWorker.close(),
      masterSheetPullWorker.close(),
      new Promise((resolve) => adminReplyServer.close(resolve)),
    ])
      .then(() => closeConnections())
      .then(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
