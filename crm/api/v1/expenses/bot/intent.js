const { ask } = require('./ai');

// ***************************************************
// * A REPLY TO AN OPEN PREVIEW, READ AS ONE OF A FEW CHOICES
// ***************************************************
//
// His call 2026-10-07: "it should know whatever variety of confirmation it
// is, or cancellation, or modification". Code reads the common ones free
// (reply.js). Anything else reaches this: ONE small call (the light model,
// a strict choice) that sees only their message and a one line summary of
// the preview, never the expenses themselves. So "sige", "tamam", "theek
// hai", "send it off" or "hmm hold on" cost a fraction of a cent, and a
// confirmation can no longer be taken for a change (live: "I like them,
// save them" sent all 145 expenses to the reader and back as 6 pictures).

const INTENTS = ['confirm', 'cancel', 'change', 'save_ready', 'skip_copies', 'skip_saved', 'show', 'wait', 'question', 'other'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'sure'],
  properties: {
    intent: { type: 'string', enum: INTENTS },
    sure: { type: 'boolean' },
  },
};

const SYSTEM = [
  'An admin has a preview of expenses waiting for their answer. Classify their reply. Any language or slang.',
  'confirm: save it as shown (yes, ok, fine, proceed, send it, sige, oo, tama, yalla, tamam, theek hai, haan, go for it, I like them).',
  'cancel: drop the preview, save nothing (no, discard, forget it, don\'t save, not now, scrap it).',
  'change: they want something in it changed, or say what is wrong ("the taxi was 50", "edit 2", "wrong date on 3", "modify").',
  'save_ready: save only the ones that are ready and keep the rest. skip_copies: leave out the copies. skip_saved: leave out the ones already saved.',
  'show: see the preview again. wait: they need a moment (hold on, wait, one sec, brb).',
  'question: they ask something about spending or the preview. other: anything else.',
  'sure: false if it could be two of these (e.g. "ok but", "yes except").',
].join('\n');

/**
 * @param {string} said
 * @param {string} summary one line: "145 expenses, 4 missing a payee, 60 copies"
 * @returns {Promise<{ intent: string, sure: boolean } | null>}
 */
async function readIntent(said, summary, { client = null } = {}) {
  if (!String(said ?? '').trim()) return null;
  return ask({
    light: true, name: 'reply', system: SYSTEM, schema: SCHEMA, client,
    user: `Preview: ${summary}\nTheir reply: "${String(said).slice(0, 300)}"`,
  });
}

/** The one line it sees: counts only, never an expense. */
function summaryOf(pending) {
  const live = (pending?.items ?? []).filter((x) => !x.skipped);
  const missing = live.filter((x) => x.missing?.length).length;
  const copies = live.filter((x) => (x.doubts ?? []).some((d) => /^same as \d+/.test(d))).length;
  const saved = live.filter((x) => (x.doubts ?? []).some((d) => /^looks already saved|^same receipt as/.test(d))).length;
  return [`${live.length} expenses, not saved yet`, missing ? `${missing} missing something` : '', copies ? `${copies} copies` : '', saved ? `${saved} look already saved` : ''].filter(Boolean).join(', ');
}

module.exports = { readIntent, summaryOf, INTENTS };
