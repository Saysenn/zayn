// ***************************************************
// * A group name is not always a legal tab name
// ***************************************************

/**
 * EXCEL REFUSES SEVEN CHARACTERS IN A SHEET NAME, and exceljs throws rather
 * than cleaning them up. A group called `TAKEOFF / OLD` did not produce an
 * odd tab: it took the WHOLE export down with a 500 and a reference code,
 * and nothing on screen said which group did it.
 *
 * Group names come straight from his sheet, uppercased and otherwise
 * untouched (`normalizeGroupName`), so the CRM has never had a say in what
 * is in one. `RECLAIMS`, `ALL BOOKS` and `JARVIS` are all fine; one slash
 * or question mark is not.
 *
 * ===============================
 * * THE TAB NAME IS LOAD BEARING, SO CHANGING IT HAS A COST
 * ===============================
 * On a per group export the tab IS the group: there is no Group column, and
 * `parseImport` reads the worksheet name to know which group a row belongs
 * to. Renaming a tab would therefore re-import those rows under a DIFFERENT
 * group, and the group is part of a deal's identity, so every row would
 * come back as a duplicate.
 *
 * So this reports whether it had to change anything. When it did, the
 * caller puts the Group column back on that tab, and a Group column always
 * beats the worksheet name on the way in. The round trip survives.
 */

// Excel's own list. `:` and `\` and `/` and `?` and `*` and `[` and `]`.
const ILLEGAL = /[\\/?*[\]:]/g;
const MAX = 31;

// A name that is only punctuation, or empty, still has to be something.
const FALLBACK = 'GROUP';

/**
 * @param {string} groupName the group exactly as stored
 * @param {Set<string>} taken names already used in this workbook, mutated
 * @returns {{name: string, changed: boolean}} `changed` means the tab no
 *   longer says what the group is, so the Group column has to carry it
 */
function sheetNameFor(groupName, taken = new Set()) {
  const original = String(groupName ?? '').trim();
  // A space keeps two words two words: `BOOKS[2026]` reading as `BOOKS2026`
  // is a different name to a human as well as to a parser.
  let name = original.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim();
  if (!name) name = FALLBACK;
  if (name.length > MAX) name = name.slice(0, MAX).trim();

  // TWO GROUPS CAN COLLIDE AFTER TRUNCATION, and exceljs throws on a
  // duplicate tab exactly as it does on an illegal one. Numbered rather
  // than dropped: a missing tab is a missing payout.
  let unique = name;
  for (let n = 2; taken.has(unique.toLowerCase()); n += 1) {
    const suffix = ` ${n}`;
    unique = `${name.slice(0, MAX - suffix.length).trim()}${suffix}`;
  }
  taken.add(unique.toLowerCase());

  return { name: unique, changed: unique !== original };
}

module.exports = { sheetNameFor, ILLEGAL, MAX };
