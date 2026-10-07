// ***************************************************
// * A pet name in EVERY reply is a tic, not affection
// ***************************************************
//
// The rule read "one per reply, and cycle through them", which produced
// exactly that: darling, sweetie, honey, lovely, darling, through five
// replies in a row. Rewriting it to "roughly one in three" changed nothing,
// because a frequency is not something a prompt can hold.
//
// PROMPTING IS NOT A GUARD. Same lesson as "Awww" on every reply, and the
// same fix: a rule the model cannot ignore, applied to the finished text.
//
// NOTHING IS REWRITTEN BUT THE NAME. The sentence, every figure and all its
// punctuation survive; only the address is lifted out, and only when the
// last thing she said already had one.

const NAMES = ['dear', 'sweetheart', 'lovely', 'sweetie', 'honey', 'darling'];

// Two shapes it actually takes: ", darling!" at the end or mid sentence,
// and "Darling, the sheet is ready" at the start.
//
// SEPARATE PATTERNS FOR TESTING AND REPLACING, and that is not tidiness. A
// `g` regex carries `lastIndex` between calls, so `.test()` on a shared one
// returns true, then false, then true on the same string. This guard
// silently did nothing every other reply until a check caught it.
const NAME_ALT = NAMES.join('|');
const TRAILING = new RegExp(`,\\s*(${NAME_ALT})\\b(?=\\s*[.!?,]|\\s*$)`, 'i');
const TRAILING_ALL = new RegExp(TRAILING.source, 'gi');
const LEADING = new RegExp(`^(${NAME_ALT})\\s*,\\s*`, 'i');

/** Does this text address them by one of the six? */
function hasPetName(text) {
  const s = String(text ?? '');
  return TRAILING.test(s) || LEADING.test(s);
}

/**
 * Lift the address out, keeping the sentence and its punctuation.
 *
 *   "Gloria is owed 2,000, darling." -> "Gloria is owed 2,000."
 *   "Darling, the sheet is ready."   -> "The sheet is ready."
 */
function stripPetNames(text) {
  let out = String(text ?? '').replace(TRAILING_ALL, '');
  const led = out.match(LEADING);
  if (led) {
    out = out.slice(led[0].length);
    // The sentence now starts mid word, so put the capital back.
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out;
}

/**
 * ONE IN A ROW, NEVER TWO.
 *
 * If the last thing she said already addressed them, this one does not.
 * That alone halves it, and the prompt's "roughly one in three" does the
 * rest: this is the floor, not the target.
 *
 * @param {string} reply the finished reply
 * @param {Array<{role: string, content: string}>} history
 */
function easeOffPetNames(reply, history = []) {
  if (!reply || !hasPetName(reply)) return reply;
  // NEVER ON BAD NEWS: "I can't find that, darling" reads as mocking. And at
  // most one in any three of her replies (test sweep 2026-10-07: "darling",
  // "honey", "sweetheart" nearly every turn).
  if (/\b(?:can'?t|cannot|couldn'?t|could not|not able|unable|sorry|no such|isn'?t|nothing (?:was|has been) changed|expired|failed|wrong)\b/i.test(reply)) return stripPetNames(reply);
  const recent = history.filter((m) => m?.role === 'assistant').slice(-2);
  if (recent.some((m) => hasPetName(m.content))) return stripPetNames(reply);

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn?.role !== 'assistant') continue;
    // The most recent one decides. Coming back to a warm word after a few
    // exchanges is ordinary; doing it every single time is the fault.
    return hasPetName(turn.content) ? stripPetNames(reply) : reply;
  }
  return reply;
}

module.exports = {
  easeOffPetNames, hasPetName, stripPetNames, NAMES,
};
