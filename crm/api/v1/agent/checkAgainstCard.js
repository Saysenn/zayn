const { fieldsAsked } = require('./fieldAsked');
const { fold } = require('./tools/resolvePerson');

/**
 * ***************************************************
 * * She answered about a row without looking at it
 * ***************************************************
 *
 * Live 2026-09-17, two turns in a row:
 *
 *   "and his role?"            -> "Richard's role is Mid 1."      it is Loss lead
 *   "and company he handles?"  -> "Richard handles Northstar Care." it is Workforce
 *
 * NO TOOL RAN on either turn, and no card was drawn. She answered a short
 * follow up out of her own head and invented both values. The lookup, run
 * against the same sentence, returns the right answer for both: the tool
 * was never the problem, not calling it was.
 *
 * ===============================
 * * NOTHING WAS WATCHING TEXT
 * ===============================
 * `checkFigures` only sees numbers over 100 or carrying a decimal, and
 * `checkClaims` requires a numeric value, so an invented ROLE or COMPANY
 * NAME is invisible to every guard here. It is the same fault as a wrong
 * total and it costs the same trust.
 *
 * ===============================
 * * THE CARD SHE ALREADY SHOWED IS THE EVIDENCE
 * ===============================
 * The client commits every card it draws to the conversation, values and
 * all, and the route hands that history back untouched. So when she
 * answers a field question with no tool call, the true value is already in
 * the room and can be compared against.
 *
 * `fieldsAsked` decides WHICH field was asked, the same function that
 * answers it when a tool does run, so there is one definition of what the
 * sentence is about rather than a second guess written here.
 *
 * REPORTS, never rewrites. Same as every other check in this folder.
 */

/** The most recent card the conversation drew, whoever it was about. */
function lastCard(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const card = history[i]?.card;
    if (card && Array.isArray(card.groups)) return card;
  }
  return null;
}

/**
 * @param {string} reply what she is about to say
 * @param {string} said the admin's own sentence this turn
 * @param {object[]} toolResults every tool result from this turn
 * @param {object[]} history the raw conversation, cards included
 * @returns {{ ok: boolean, label?: string, value?: string, who?: string }}
 */
function checkAgainstCard(reply, said, toolResults = [], history = []) {
  // A TOOL RAN, so the answer came from the sheet and the other guards own
  // it. This one is only about a turn that looked at nothing.
  if (toolResults.length > 0) return { ok: true };

  const card = lastCard(history);
  if (!card) return { ok: true };

  /**
   * THE CARD HAS TO BE ABOUT WHOEVER SHE IS TALKING ABOUT.
   *
   * A follow up can move to somebody else, and comparing a new person's
   * answer against the last person's card would flag a correct reply. Her
   * naming them is the cheapest honest test.
   */
  const who = String(card.name ?? '').trim();
  if (!who || !fold(reply).includes(fold(who))) return { ok: true };

  const fields = fieldsAsked(card, said);
  // ONE FIELD ONLY. Two is a broader question and the answer legitimately
  // reads as prose, which this cannot judge.
  if (fields.length !== 1) return { ok: true };

  const [field] = fields;
  const value = String(field.value ?? '').trim();
  // Nothing to check against: an empty cell has no wrong answer, and the
  // card's own words for one ("not set", "not held") are not values.
  if (!value || /^not /i.test(value)) return { ok: true };

  if (fold(reply).includes(fold(value))) return { ok: true };
  return {
    ok: false, label: field.label, value, who,
  };
}

module.exports = { checkAgainstCard, lastCard };
