const logger = require('../../configs/logger');
const snapshots = require('../repos/monthSnapshots.repo');
const { takeSnapshot } = require('./takeSnapshot');
const { businessTimezone } = require('../shared/presetMonth.helper');
const { SNAPSHOT_MONTHS, monthsToPrune } = require('../shared/snapshotWindow.helper');

const MINUTE_MS = 60 * 1000;

function monthBefore(month) {
  const [year, part] = String(month).split('-').map(Number);
  const date = new Date(Date.UTC(year, part - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function localParts(now = new Date(), timeZone = businessTimezone()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return Object.fromEntries(parts
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, value]));
}

function isLastDay(parts) {
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (!year || !month || !day) return false;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day === last;
}

/**
 * Save the business month while it is still the live month. On the first
 * day of a new month, a missed boundary is caught up once, but an existing
 * immutable record is never replaced.
 */
/**
 * ===============================
 * * TWELVE MONTHS, PRUNED AFTER THE WRITE
 * ===============================
 * Nothing pruned before this: `remove` existed on the repo and had no
 * caller, so snapshots accumulated forever.
 *
 * AFTER THE WRITE, NEVER BEFORE. Making room first would leave eleven
 * months and nothing to replace the twelfth if the snapshot then threw.
 * Taking September when twelve are held drops nothing, because thirteen is
 * the count that is one too many. Taking October next month makes thirteen
 * and drops October 2025. His worked example, 2026-09-09.
 *
 * An EXISTING snapshot prunes nothing either: the run wrote no month, so
 * the window did not move.
 *
 * A failed prune is logged and swallowed. The snapshot is the valuable
 * half and it is already saved; losing the whole tick over a stale row
 * would mean the month itself went unrecorded next time.
 */
async function pruneOld({ list = snapshots.list, remove = snapshots.remove } = {}) {
  const held = await list({ limit: SNAPSHOT_MONTHS + 12 });
  const stale = monthsToPrune(held.map((row) => row.month));
  const removed = [];
  for (const month of stale) {
    // eslint-disable-next-line no-await-in-loop
    await remove(month);
    removed.push(month);
  }
  return removed;
}

async function snapshotTick({
  now = new Date(),
  findMeta = snapshots.findMeta,
  snapshot = takeSnapshot,
  timeZone = businessTimezone(),
  prune = pruneOld,
} = {}) {
  const parts = localParts(now, timeZone);
  const month = `${parts.year}-${parts.month}`;
  const firstDay = Number(parts.day) === 1;
  if (!isLastDay(parts) && !firstDay) return null;

  const target = firstDay ? monthBefore(month) : month;
  const existing = await findMeta(target);
  if (existing) return { ...existing, existed: true, target };
  const saved = await snapshot(target);

  let pruned = [];
  try {
    pruned = await prune();
  } catch (err) {
    logger.error({ err, target }, 'diane: snapshot pruning failed, the month is still saved');
  }
  return { ...saved, target, pruned };
}

function startSnapshotScheduler({ tick = snapshotTick } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await tick();
      if (result) logger.info({ month: result.target, existed: result.existed }, 'month snapshot checked');
    } catch (err) {
      logger.error({ err }, 'automatic month snapshot failed');
    } finally {
      running = false;
    }
  };
  setImmediate(run);
  const timer = setInterval(run, MINUTE_MS);
  timer.unref();
  return timer;
}

module.exports = {
  MINUTE_MS,
  monthBefore,
  localParts,
  isLastDay,
  pruneOld,
  snapshotTick,
  startSnapshotScheduler,
};
