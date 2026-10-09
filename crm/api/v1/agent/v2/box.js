/**
 * ***************************************************
 * * THE BOX: one preview, one yes, one batch, one undo
 * ***************************************************
 * The plan of 2026-10-08/09. Every change v2 proposes lands here first:
 * each entry is previewed by its own v1 tool (nothing written), shown as ONE
 * card, and applied only on "yes", in order, as ONE batch in History.
 *
 *   SESSION ONLY   the box is the card in their conversation, closed after
 *                  30 minutes without a word (planSteps.PLAN_IDLE_MS).
 *   THEIR REPLY    yes / cancel / "skip 2" / "2 to 650" read in code
 *                  (planSteps.readReply); anything else is a correction, and
 *                  the model proposes again with the box in front of it.
 *   PARTIAL        each item reports done or not and why; the rest stand.
 *   UNDO SOME      the finished card keeps which changes each item wrote,
 *                  so "undo 2 and 5" puts back exactly those.
 */
const crypto = require('node:crypto');
const db = require('../../../configs/db');
const repo = require('../../repos/masterSheetRows.repo');
const { planCard, readReply, pendingPlan } = require('../engine/planSteps');
const { changeCalls } = require('./tools');

const SIZE_SUMMARY = 50;   // over this, the card leads with a summary
const SIZE_REFUSE = 500;   // over this, she asks them to narrow it

/** The box still waiting on them, from their conversation, or null. */
function pendingBox(history) {
  const plan = pendingPlan(history);
  return plan?.box ? plan : null;
}

const lineOf = (r) => (typeof r === 'string' ? { name: r } : { id: r.id, name: r.name ?? r.person ?? '', where: r.where, detail: r.detail });

/**
 * Preview every change entry through its v1 tool. Returns the box plan, or
 * the questions the tools asked instead (which go back to the model).
 */
async function preview(changes, { invoke, said }) {
  const steps = [];
  const asks = [];
  for (const entry of changes ?? []) {
    for (const call of changeCalls(entry)) {
      // eslint-disable-next-line no-await-in-loop
      const result = await invoke(call.name, call.args);
      if (result?.pending) {
        // A tool that handed over to another (one person's every deal goes
        // to the bulk tool) is applied as THAT call on the yes.
        const apply = result.redirect ?? { name: call.name, args: call.args };
        const lines = (result.lines ?? []).length
          ? result.lines.map(lineOf)
          : [{ name: entry.person ?? entry.company ?? 'change', detail: String(result.confirming ?? result.summary ?? '').split('\n')[0].slice(0, 200) }];
        steps.push({ n: steps.length + 1, action: entry.action === 'update' ? 'update' : entry.action, person: entry.person ?? entry.company, lines, apply });
      } else {
        asks.push(String(result?.reply ?? result?.summary ?? 'That change could not be read.').slice(0, 600));
      }
    }
  }
  const rows = steps.reduce((n, s) => n + s.lines.length, 0);
  if (rows > SIZE_REFUSE) {
    return { asks: [`That would change ${rows} rows at once. Narrow it down (a group, a company, a set of people) and ask again: nothing was changed.`] };
  }
  if (!steps.length) return { asks };
  const plan = {
    id: crypto.randomUUID(), box: true, status: 'preview', request: said, steps,
    ...(rows > SIZE_SUMMARY ? { readout: [`${rows} rows. The first ones are listed; say "show all" to see every one.`] } : {}),
  };
  return { plan, asks };
}

/** What is waiting, said in one line for her reply. */
function previewReply(plan, asks = []) {
  const n = plan.steps.length;
  const rows = plan.steps.reduce((k, s) => k + s.lines.length, 0);
  return `Here's what would change: ${n} ${n === 1 ? 'change' : 'changes'}${rows > n ? `, ${rows} rows` : ''}. Nothing is saved yet. Say yes, "skip 2", or cancel.`
    + (asks.length ? `\nNot included: ${asks.join(' ')}` : '');
}

/**
 * Apply every item that is not skipped, in order, then stamp ONE batch on
 * exactly the changes Diane wrote meanwhile. Each item keeps which change
 * ids it wrote, for "undo 2 and 5".
 */
async function apply(plan, { invoke }) {
  const before = Number((await db.query('SELECT coalesce(max(id), 0) AS id FROM tb_mastersheet_changes')).rows[0]?.id ?? 0);
  const steps = [];
  for (const step of plan.steps) {
    if (step.skipped) { steps.push(step); continue; }
    const mark = Number((await db.query('SELECT coalesce(max(id), 0) AS id FROM tb_mastersheet_changes')).rows[0]?.id ?? 0);
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await invoke(step.apply.name, { ...step.apply.args, confirmed: true });
    } catch (err) {
      result = { summary: `Not done: ${err.message}` };
    }
    // eslint-disable-next-line no-await-in-loop
    const wrote = (await db.query("SELECT id FROM tb_mastersheet_changes WHERE id > $1 AND changed_via = 'diane' ORDER BY id", [mark])).rows.map((r) => Number(r.id));
    const said = String(result?.reply ?? result?.summary ?? '');
    const ok = !result?.pending && !/^(?:NOTHING|Not done|No |Could not|Couldn'?t)/i.test(said) && (wrote.length > 0 || /\b(?:done|updated|stopped|added|resumed|saved|parked)\b/i.test(said));
    steps.push({ ...step, changeIds: wrote, result: { ok, why: ok ? '' : said.split('\n')[0].slice(0, 160) } });
  }
  const batchId = crypto.randomUUID();
  await db.query(
    "UPDATE tb_mastersheet_changes SET batch_id = $1 WHERE id > $2 AND changed_via = 'diane' AND reverted_at IS NULL",
    [batchId, before],
  );
  return { ...plan, status: 'done', batchId, steps };
}

function doneReply(plan) {
  const ran = plan.steps.filter((s) => !s.skipped);
  const good = ran.filter((s) => s.result?.ok);
  const bad = ran.filter((s) => !s.result?.ok);
  let reply = bad.length === 0
    ? (good.length === 1 ? 'Done.' : `Done, all ${good.length} changes.`)
    : `Done ${good.length} of ${ran.length}. Not done: ${bad.map((s) => `${s.n} (${s.result.why})`).join('; ')}.`;
  if (bad.length && good.length) reply += ' Say "retry" to try the failed ones again.';
  if (good.length) reply += ` "Undo that" puts it back, or "undo ${good[0].n}" for one.`;
  return reply;
}

/** The finished box to retry: only the items that failed, as a new preview. */
function retryPlan(done) {
  const failed = done.steps.filter((s) => !s.skipped && !s.result?.ok);
  if (!failed.length) return null;
  return { ...done, id: crypto.randomUUID(), status: 'preview', batchId: undefined, steps: failed.map((s, i) => ({ ...s, n: i + 1, result: undefined, changeIds: undefined })) };
}

/** The last finished box in their conversation, for "undo 2" and "retry". */
function lastDoneBox(history) {
  for (let i = (history?.length ?? 0) - 1; i >= 0; i -= 1) {
    const plan = history[i]?.list?.kind === 'plan' ? history[i].list.plan : null;
    if (plan?.box && plan.status === 'done') return plan;
  }
  return null;
}

/** Put back the changes the numbered items wrote, nothing else. */
async function undoItems(done, numbers) {
  const ids = done.steps.filter((s) => numbers.includes(s.n)).flatMap((s) => s.changeIds ?? []);
  if (!ids.length) return { reply: `Nothing to undo for ${numbers.join(' and ')}: those wrote no changes.` };
  const out = await repo.revertChangeBatch(ids, null, { via: 'diane', batchId: crypto.randomUUID() });
  const undone = out?.done?.length ?? ids.length;
  return { reply: `Undone ${numbers.length === 1 ? `item ${numbers[0]}` : `items ${numbers.join(', ')}`}: ${undone} ${undone === 1 ? 'change' : 'changes'} put back.`, ids };
}

module.exports = {
  pendingBox, preview, previewReply, apply, doneReply, retryPlan, lastDoneBox, undoItems, readReply, planCard,
};
