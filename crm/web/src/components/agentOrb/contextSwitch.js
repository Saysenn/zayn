/**
 * SAY THE CONTEXT, SHE SWITCHES. His call 2026-10-07 (docs/feature.md 11):
 * "expenses", "go to debts", "back to the master sheet", typed or spoken,
 * and the selector moves with no clicking.
 *
 * Read here, in code, before anything is sent: instant and free. Only a
 * SHORT message is a switch ("how much were expenses this month" is a
 * question, not a request to move), and a switch can carry a request after
 * it: "go to expenses, taxi 45 for MANBAT" switches, then sends the rest.
 *
 * A short phrase that starts like a switch but names nothing known ("take me
 * to the spending side") is returned as `maybe`, for the meaning check on
 * the server. Nothing else ever is.
 */

// What people call each context. Keys match DianeContext's CONTEXTS.
const NAMES = {
  'master-sheet': ['master sheet', 'mastersheet', 'master', 'the sheet', 'sheet', 'deals', 'payroll', 'main sheet'],
  expenses: ['expenses', 'expense', 'spending', 'spend', 'costs', 'receipts'],
  debts: ['debts', 'debt', 'loans', 'owed money'],
};

const VERB = /^(?:(?:ok(?:ay)?|now|so|alright|please|pls|diane|hey diane)[,\s]+)*(?:(?:can you |could you |let'?s |lets )?(?:go|switch|change|move|jump|head|swap|flip|open|show(?: me)?|take me|bring me|back|do|work on|look at|over)(?:\s+(?:back|over))?(?:\s+(?:to|into|on|onto|in))?\s+)?(?:the\s+)?/i;
const TAIL = /\s+(?:context|mode|tab|page|side|section|area|one|now|please|pls|thanks)$/i;
const SPLIT = /\s*(?:,|;|:|\.\s|\bthen\b|\band then\b|\band\b)\s*/i;

const clean = (s) => String(s ?? '').toLowerCase().replace(/[!?.]+$/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** One letter wrong, missing, extra, or two swapped. */
function close(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/** The context these words name, or null. */
function nameOf(words) {
  let w = clean(words).replace(VERB, '');
  for (let k = 0; k < 2; k += 1) w = w.replace(TAIL, '');
  w = w.trim();
  if (!w) return null;
  for (const [key, names] of Object.entries(NAMES)) {
    if (names.some((n) => n === w || close(n.replace(/\s/g, ''), w.replace(/\s/g, '')))) return key;
  }
  return null;
}

/**
 * @param {string} text what they said
 * @param {{ key: string, soon?: boolean }[]} contexts
 * @returns {null | { key: string, soon: boolean, rest: string } | { maybe: string, rest: string }}
 */
export function readSwitch(text, contexts) {
  // "okay, expenses": an opener before a comma is not the first part.
  const said = String(text ?? '').trim().replace(/^(?:ok(?:ay)?|now|so|alright|hey diane|diane)\s*[,.]\s*/i, '');
  if (!said || said.split(/\s+/).length > 16) return null;
  const parts = said.split(SPLIT);
  const head = parts[0];
  const rest = said.slice(said.toLowerCase().indexOf(head.toLowerCase()) + head.length).replace(/^\s*(?:,|;|:|\.|then|and then|and)\s*/i, '').trim();
  // SHORT: "take me to the spending side" is seven words, a question about
  // expenses is longer and has no switch verb to lean on.
  if (head.split(/\s+/).length > 7) return null;
  const key = nameOf(head);
  if (key) {
    const ctx = contexts.find((c) => c.key === key);
    if (!ctx) return null;
    return { key, soon: Boolean(ctx.soon), rest };
  }
  // STARTS LIKE A SWITCH, names nothing we know: the meaning check decides.
  if (/^(?:(?:ok(?:ay)?|now|so|alright)[,\s]+)?(?:(?:can you |could you |let'?s |lets )?(?:go|switch|change|move|jump|head|swap|open|take me|bring me))\b/i.test(clean(head))
    && head.split(/\s+/).length <= 7) {
    return { maybe: head, rest };
  }
  return null;
}

export { NAMES };
