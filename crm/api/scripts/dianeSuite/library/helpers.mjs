// Small pieces every library file uses. See data.mjs for who is who.

/** A reply that names every one of these, in any order. */
export const all = (...words) => new RegExp(words.map((w) => `(?=[\\s\\S]*${w})`).join(''), 'i');

/**
 * What is ON SCREEN names them: a drawn list or card, or her reply. "Kiran
 * Vale has 3 deals" with the three on the list beside it is a right answer.
 */
export const shows = (...words) => (rows) => {
  const text = JSON.stringify(rows);
  const missing = words.filter((w) => !new RegExp(w, 'i').test(text));
  return missing.length ? `not shown: ${missing.join(', ')}` : null;
};

/** A reply that names none of these. */
export const none = (...words) => new RegExp(words.join('|'), 'i');

/** A db check: every live deal of `person` passes `ok(row)`. */
export const everyDeal = (dealsOf, person, ok, said) => async (db) => {
  const rows = await dealsOf(db, person);
  return rows.length && rows.every(ok) ? null : `${said}: ${JSON.stringify(rows.map((r) => [r.company, r.override_paid, r.override_should_be_paid, r.payment_outcome]))}`;
};

/** Variants of one question: the same expectation under several wordings. */
export const wordings = (id, name, says, expect, extra = {}) => says.map((say, i) => ({
  id: `${id}-${String.fromCharCode(97 + i)}`,
  name: `${name}: "${say}"`,
  turns: [{ say, expect }],
  ...extra,
}));
