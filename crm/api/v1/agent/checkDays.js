/**
 * ***************************************************
 * * Did she state a payable day count no tool produced?
 * ***************************************************
 *
 * Live 2026-09-17. Told "set his payable days to 0" she read back "changing
 * Richard's payable days from 31 to 0". The row holds 30, there is exactly
 * ONE Richard on the sheet, and no tool that turn returned a 31 anywhere.
 *
 * The prompt REQUIRES the read-back to say what each column is changing
 * FROM and to, and nothing hands her the from. So she filled it in, and the
 * one number in the sentence that was not the admin's own was invented.
 *
 * `checkFigures` cannot see it: it ignores bare integers under 100 on
 * purpose, because at that size they are ordinarily counts, days or row
 * ids. Every payable day count in the system lives under that floor, which
 * is exactly why percentages needed `checkPercents`. This is its sibling.
 *
 * ===============================
 * * ONLY THE WORDS "PAYABLE DAYS", never a bare "days"
 * ===============================
 * The payment start formula is "appointment plus 90 DAYS" and she explains
 * it often. Matching any day count at all would flag that sentence every
 * time, and a guard that cries wolf is one people widen until it means
 * nothing. Narrow misses more and is worth it: same bias as checkFigures.
 *
 * REPORTS, never rewrites. A day count is either right or the turn is
 * wrong, and quietly editing one would be worse than either.
 */

// "payable days from 31", "payable days: 30", "payable days is 30".
// Non greedy and digit free in between, so it takes the FIRST number after
// the phrase and never reaches across a sentence.
const AFTER_PHRASE = /\bpayable\s+days?\b[^.;!?\d]{0,10}?(\d{1,3})\b/gi;

/**
 * ===============================
 * * A COUNT OF ROWS IS NOT A COUNT OF DAYS
 * ===============================
 * THE INCIDENT, 2026-09-23, on a three person bulk edit. She wrote "10
 * payable days on 2 deals": BEFORE_PHRASE took the 10 correctly, and then
 * AFTER_PHRASE read the SAME phrase forwards, skipped "on " and claimed
 * the 2 as a second day count. No tool produced a 2, so a correct answer
 * was flagged, retried, and she retracted it and apologised for a figure
 * she had every right to say.
 *
 * The giveaway is the noun. A number followed by deals, rows or people is
 * how many THINGS are changing, and the day count is what each one is
 * changing TO.
 *
 * SHARED with confirmReplay, which lost every replay to the same reading
 * of "(1 row)". See countNoun.js.
 */
const { FOLLOWED_BY_COUNT_NOUN: IS_A_COUNT } = require('./countNoun');

// "31 payable days".
const BEFORE_PHRASE = /\b(\d{1,3})\s+payable\s+days?\b/gi;

// The card's own cell, and the label DETAIL_FIELDS prints. Anything whose
// name says payable days holds one.
const isDaysKey = (k) => /payable[\s_-]?days/i.test(String(k ?? ''));

/** Every payable day count a piece of text states, as plain numbers. */
function daysIn(text) {
  const out = new Set();
  const said = String(text ?? '');
  for (const re of [AFTER_PHRASE, BEFORE_PHRASE]) {
    for (const m of said.matchAll(re)) {
      const n = Number(m[1]);
      if (!Number.isFinite(n)) continue;
      // What follows the number decides what it counts. See IS_A_COUNT.
      const after = said.slice((m.index ?? 0) + m[0].length);
      if (IS_A_COUNT.test(after)) continue;
      out.add(n);
    }
  }
  return out;
}

/**
 * Every payable day count the tools produced this turn: the rows, the cells
 * of any card drawn, and anything a tool wrote into its own text.
 *
 * THE CARDS COUNT. `find_and_show_details` answers with a card, and the day
 * count reaches the screen as a cell rather than as a row key. Reading only
 * the rows is how the value in front of the admin would still have counted
 * as unsupported.
 */
function daysFrom(result) {
  const out = new Set();
  if (!result || typeof result !== 'object') return out;

  const take = (value) => {
    const n = Number(value);
    if (Number.isFinite(n)) out.add(n);
  };

  for (const row of result.rows ?? []) {
    for (const [key, value] of Object.entries(row ?? {})) if (isDaysKey(key)) take(value);
  }
  for (const card of result.cards ?? []) {
    for (const group of card?.groups ?? []) {
      for (const cell of group?.cells ?? []) {
        if (isDaysKey(cell?.label) || isDaysKey(cell?.editField)) take(cell?.value);
      }
    }
  }
  for (const key of ['say', 'summary', 'reply']) {
    for (const n of daysIn(result[key])) out.add(n);
  }
  return out;
}

/**
 * ===============================
 * * A NUMBER THEY TYPED IS NOT A NUMBER SHE INVENTED
 * ===============================
 * "Set his payable days to 0" and the read-back says "to 0". That 0 is the
 * admin's own instruction, and flagging it fired the guard on every correct
 * confirmation. Only what she claims the SHEET holds is a claim.
 *
 * Every integer in their sentence, not only one in a payable days phrase:
 * "make it 0" carries the value without the words.
 */
function spokenIn(said) {
  const out = new Set();
  for (const m of String(said ?? '').matchAll(/\b\d{1,3}\b/g)) out.add(Number(m[0]));
  return out;
}

/**
 * @param {string} reply what she is about to say
 * @param {object[]} toolResults every tool result from this turn
 * @param {string} [said] the admin's own sentence this turn
 * @returns {{ ok: boolean, unsupported: number[], known: number[], had: boolean }}
 *   `had` is whether any tool produced a day count at all. With none there
 *   is nothing to check against, so it stays silent rather than guessing.
 */
function checkDays(reply, toolResults = [], said = '') {
  const known = new Set();
  for (const r of toolResults) for (const n of daysFrom(r)) known.add(n);
  if (known.size === 0) return { ok: true, unsupported: [], known: [], had: false };

  const theirs = spokenIn(said);
  const unsupported = [...daysIn(reply)].filter((n) => !known.has(n) && !theirs.has(n));
  return { ok: unsupported.length === 0, unsupported, known: [...known], had: true };
}

module.exports = { checkDays, daysIn, daysFrom, spokenIn };
