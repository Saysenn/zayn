const crypto = require('node:crypto');
const queue = require('../../repos/scheduledActions.repo');
const rowsRepo = require('../../repos/masterSheetRows.repo');
const { currentMonth } = require('../../shared/presetMonth.helper');
const { buildReport } = require('./report');
const logger = require('../../../configs/logger');

/**
 * ***************************************************
 * * MONTH START: applying what was parked
 * ***************************************************
 *
 * NOT ONE MODEL TOKEN. This replays a stored call and renders its sentence
 * from a template. Re-deciding in January what a sentence from October
 * meant would be a second chance to get it wrong, unattended — and nothing
 * the model produced could be diffed against last month's run.
 *
 * Everything it does is therefore reproducible, and the suite can assert on
 * it like any other code.
 *
 * ---- the order of the two month-start jobs ----
 *
 * The preset roll runs FIRST and this second. The roll moves `preset_on`,
 * which recomputes `payable_days` and `payable_amount`; a parked change to
 * an amount applied before that would be silently overwritten by it.
 */

// Three sign ins, per his rule, then it stops asking. Counted on the ROW
// rather than in localStorage, so switching browser does not reset it.
const MAX_ATTEMPTS = 3;

/**
 * ===============================
 * * DOES THE WORLD STILL MATCH WHAT HE AGREED TO?
 * ===============================
 * He approved a change to a row that looked a certain way. A row that no
 * longer looks that way is not the row he approved, so the change is not
 * applied to it — it is reported and left alone.
 *
 * This is why `expect` is a snapshot of the INPUTS, not just the field
 * being written: park "payable 3,000" in October, change `payable_days` in
 * November, and the figure is stale even though nobody touched `payable`.
 */
/**
 * `expect` is keyed by the WIRE name (`addonPercent`), not the column, for
 * one reason: `tb_mastersheet_changes.field` stores the wire name too, so
 * the same keys answer both "has this value moved" and "did he edit it
 * himself" without a translation table between them.
 */
function stale(row, expect = {}) {
  for (const [field, agreed] of Object.entries(expect)) {
    const column = rowsRepo.COLUMN_FOR[field] ?? field;
    const now = row?.[column];
    const same = agreed === null || agreed === undefined
      ? now === null || now === undefined
      : String(now) === String(agreed);
    if (!same) return { field, agreed, now };
  }
  return null;
}

/** 'add-on was 5 when you asked, and is 8 now' — the welcome page's words. */
function movement({ field, agreed, now }) {
  return `${field} was ${agreed ?? 'empty'} when you asked, and is ${now ?? 'empty'} now`;
}

/**
 * HE CHANGED IT HIMSELF SINCE. A deliberate later edit outranks a plan
 * parked weeks earlier, so the plan gives way rather than overwriting him.
 *
 * Read off the change log because that is the only record with a TIME on
 * it: `manually_overridden_fields` says a column was claimed but not when,
 * so it cannot answer "after this was parked".
 */
function editedSince(rowId, fields, since) {
  return rowsRepo.editedByHandSince({ rowId, fields, since });
}

/**
 * One parked action. Returns what to say about it; never throws.
 *
 * @returns {{status: string, outcome: string}}
 */
async function applyOne(entry, { tools, batchId }) {
  const tool = tools.find((t) => t.name === entry.tool);
  if (!tool) {
    return { status: 'failed', outcome: `${entry.tool} no longer exists, so it was not applied.` };
  }

  const [rowId] = entry.target_ids ?? [];
  const row = rowId ? await rowsRepo.findById(rowId) : null;

  if (rowId && !row) {
    return { status: 'skipped', outcome: 'That deal has been deleted since, so nothing was changed.' };
  }
  if (row && row.stopped_on) {
    return {
      status: 'skipped',
      outcome: `${row.person_name}'s deal was stopped on ${String(row.stopped_on).slice(0, 10)}, `
        + 'so it was left alone.',
    };
  }

  const moved = row ? stale(row, entry.expect) : null;
  if (moved) {
    return { status: 'skipped', outcome: `Left alone: ${movement(moved)}.` };
  }

  const touched = Object.keys(entry.expect ?? {});
  const edited = await editedSince(rowId, touched, entry.parked_at);
  if (edited) {
    return {
      status: 'skipped',
      outcome: `Left alone: you changed ${edited.field} by hand on `
        + `${String(edited.changed_at).slice(0, 10)}, after this was parked.`,
    };
  }

  // THE STORED CALL, as it was confirmed. `confirmed` is already true on it
  // — he agreed when he parked it, and there is nobody here to ask again.
  const result = await tool.handler({ ...entry.args, confirmed: true, batchId, via: 'scheduled' });
  const failed = typeof result?.summary === 'string' && /^(Could not|No deal|Nothing)/i.test(result.summary);
  if (failed) return { status: 'failed', outcome: result.summary };

  return { status: 'done', outcome: result?.summary ?? 'Applied.' };
}

/**
 * Everything due this month, once.
 *
 * Safe to call on every sign in: `claim` is a compare-and-swap, so a row
 * already done is invisible and two tabs cannot both take the same one.
 */
async function runDue({ tools, month = currentMonth(), now = new Date() } = {}) {
  const expired = await queue.expireBefore(month);
  const due = await queue.dueFor(month);
  const batchId = crypto.randomUUID();
  const applied = [];

  for (const parked of due) {
    // eslint-disable-next-line no-await-in-loop
    const claimed = await queue.claim(parked.id);
    // Somebody else has it, or it is already done. Both mean: not ours.
    if (!claimed) continue;

    let outcome;
    try {
      // eslint-disable-next-line no-await-in-loop
      outcome = await applyOne(claimed, { tools, batchId });
    } catch (err) {
      logger.error({ err, id: claimed.id }, 'diane: a parked action threw');
      // eslint-disable-next-line no-await-in-loop
      const released = await queue.release(claimed.id, MAX_ATTEMPTS);
      applied.push({ ...claimed, status: released?.status ?? 'failed', outcome: released?.outcome ?? err.message });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const saved = await queue.finish(claimed.id, { ...outcome, batchId });
    applied.push(saved ?? { ...claimed, ...outcome });
  }

  const run = {
    month,
    batchId: applied.some((a) => a.status === 'done') ? batchId : null,
    ran: applied.filter((a) => a.status === 'done'),
    skipped: applied.filter((a) => a.status === 'skipped'),
    failed: applied.filter((a) => a.status === 'failed'),
    expired,
    at: now,
  };

  // The welcome page's item, built from the change LOG rather than from
  // what these jobs claim they did. See report.js.
  return { ...run, report: await buildReport(run) };
}

module.exports = { runDue, applyOne, stale, editedSince, MAX_ATTEMPTS };
