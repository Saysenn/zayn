/**
 * ***************************************************
 * * "WHERE DID THAT COME FROM?": the deals behind her last figure
 * ***************************************************
 * Plan item 23, 2026-10-08. An answer that states money keeps the ids of
 * the deals her tools read for it, in history beside `claims`. Asked where
 * it came from, she lists those deals in code: no search, no model, and
 * the figures are today's, rated the same way every total is.
 *
 * Collected per request (AsyncLocalStorage), from every tool result that
 * carries deal rows, so it needs no change in the tools themselves.
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const repo = require('../repos/masterSheetRows.repo');
const { ratedRows } = require('../shared/ratedRows.helper');
const { money } = require('../shared/money.helper');

const store = new AsyncLocalStorage();
const LIMIT = 40;

/** Runs a turn, resolving to [its result, the deal ids it read]. */
async function collect(fn) {
  const ids = new Set();
  const result = await store.run(ids, fn);
  return [result, [...ids]];
}

/** A tool result: any deal rows in it are remembered for this turn. */
function note(result) {
  const ids = store.getStore();
  if (!ids || !Array.isArray(result?.rows)) return;
  for (const r of result.rows) {
    if (ids.size >= LIMIT) return;
    if (r && r.id != null && (r.personName || r.person_name)) ids.add(Number(r.id));
  }
}

const ASK = /\b(?:where (?:did|does|do) (?:that|this|it|those|these)(?: \w+)? come from|how did you (?:get|work out|calculate|come up with|arrive at) (?:that|this|it)|show (?:me )?(?:the |your )?workings?|what(?:'s| is| was) (?:that|this|it) made (?:up )?of|break (?:that|this|it) down)\b/i;

/** Their last line is "where did that come from?". */
const asked = (history) => ASK.test(String([...(history ?? [])].reverse().find((m) => m.role === 'user')?.content ?? ''));

/**
 * The answer, or null when there is nothing to explain (no earlier answer
 * with deals behind it), so the turn goes on as normal.
 */
async function explain(history) {
  const before = [...(history ?? [])].slice(0, -1).reverse().find((m) => m.role === 'assistant' && Array.isArray(m.evidence));
  if (!before) return null;
  if (before.evidence.length === 0) {
    return 'That one was not added up from any deals, so there is nothing behind it to show.';
  }
  const rows = (await Promise.all(before.evidence.map((id) => repo.findById(id).catch(() => null)))).filter(Boolean);
  if (!rows.length) return 'The deals behind that have since been removed, so I cannot show them now.';
  const rated = await ratedRows(rows);
  const lines = rated.map((r) => {
    const rates = [Number(r.addon_percent) ? `+${Number(r.addon_percent)}%` : '', Number(r.fee_percent) ? `-${Number(r.fee_percent)}% fee` : ''].filter(Boolean).join(', ');
    return `- ${r.person_name} · ${r.company ?? 'no company'} (${r.group_name}) · ${r.currency || 'GBP'} ${money(r.payable_amount)}${rates ? ` (${rates})` : ''}${r.stopped_on ? ' · stopped' : ''}`;
  });
  const totals = {};
  for (const r of rated.filter((x) => !x.stopped_on)) totals[r.currency || 'GBP'] = (totals[r.currency || 'GBP'] ?? 0) + (Number(r.payable_amount) || 0);
  const total = Object.entries(totals).map(([c, v]) => `${c} ${money(v)}`).join(' and ');
  return `It came from ${rows.length === 1 ? 'this deal' : `these ${rows.length} deals`}, as they stand now:\n${lines.join('\n')}${total ? `\n\nTogether: ${total}.` : ''}`;
}

module.exports = { collect, note, asked, explain };
