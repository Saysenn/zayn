/**
 * Takes the dashes out of anything the model wrote. Ported from whatbot's
 * own `agent/noDashes.js` — same failure, same fix, different deployment
 * (root CLAUDE.md: never a shared import across whatbot/crm).
 *
 * The prompt already asks for plain sentences. It's mostly obeyed, and
 * "mostly" isn't a standard — one em dash ("Hi — tell me what to change")
 * is the tell that a machine wrote it.
 *
 * ===============================
 * * A DASH INSIDE DATA IS NOT PUNCTUATION
 * ===============================
 * This file said "MODEL PROSE ONLY, never run it over a code-built value",
 * and then `runAgent` ran it over the whole reply, which is full of values
 * she has quoted. So:
 *
 *   "sort code 30 - 97 - 90"  ->  "sort code 30, 97, 90"
 *   "Gloria - Workforce"      ->  "Gloria, Workforce"
 *
 * The first is a WRONG SORT CODE read back to somebody about to pay money,
 * and the sheet writes every one of them in that shape. The second turned
 * one company into two, which is how a six row group was read back as an
 * eight item list.
 *
 * So data is lifted out, the prose is cleaned, and the data goes back
 * exactly as it was. Two shapes, both from the real sheet:
 *   NUMBERS joined by dashes  sort codes, account numbers, date ranges
 *   Capitalised name - Name   "Pino - Workforce", "Gloria - Workforce"
 *
 * Keeping a dash that should have gone is a cosmetic fault. Corrupting a
 * sort code is not, so where the two conflict this errs to keeping it.
 */

const UNICODE_DASH = /\s*[—–]\s*/g;
const SPACED_HYPHEN = /\s+-+\s+/g;
const LEADING_DASH = /^[\s]*[—–-]+\s*/gm;

// A sort code, an account number, a date range: digits joined by dashes,
// spaced or not. This is the one that costs money to get wrong.
const NUMERIC = /\d+(?:\s*-\s*\d+)+/g;

// "Pino - Workforce". A capitalised word each side, which is a name rather
// than a clause: prose puts a lowercase word or a comma after a dash.
const NAMED = /\b[A-Z][\w']*(?:\s+[A-Z][\w']*)*\s+-\s+[A-Z][\w']*(?:\s+[A-Z][\w']*)*/g;

// Private Use Area, so it cannot collide with anything the model wrote.
const MARK = '';

function noDashes(text) {
  const kept = [];
  const hide = (s) => s.replace(NUMERIC, (m) => {
    kept.push(m);
    return `${MARK}${kept.length - 1}${MARK}`;
  }).replace(NAMED, (m) => {
    kept.push(m);
    return `${MARK}${kept.length - 1}${MARK}`;
  });

  const cleaned = hide(String(text ?? ''))
    .replace(LEADING_DASH, '')
    .replace(UNICODE_DASH, ', ')
    .replace(SPACED_HYPHEN, ', ')
    .replace(/,\s*,/g, ',')
    .trim();

  return cleaned.replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
    (_, i) => kept[Number(i)] ?? '',
  );
}

module.exports = { noDashes };
