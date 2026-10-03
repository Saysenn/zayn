/**
 * One spelling per value.
 *
 * The problem this solves is real but small, and the obvious fix is worse
 * than the problem. Measured against the boss's actual sheet, exactly six
 * values are typed more than one way:
 *
 *     company            "Relia PA"           / "Relia Pa"
 *     location           "Abu Dhabi"          / "Abu dhabi"
 *     location           "South East"         / "South east"
 *     location           (one more)
 *     accepting postals  "Handled Internally" / "Handled internally"
 *     phone              "Handled Internally" / "Handled internally"
 *
 * Everything else is already consistent: 67 names, 36 postcodes, 21 roles,
 * 18 sort codes, 13 banks, 5 groups and 3 currencies all have zero drift.
 *
 * SO WE DO NOT LOWERCASE. Lowercasing would fix those six and damage all
 * of the above — "LEE CROFT" becomes "lee croft", "ST1 3DA" becomes
 * "st1 3da", "LLOYDS" becomes "lloyds" — on documents people are paid
 * from. That trade is not worth making.
 *
 * Instead each value is folded to ONE canonical spelling, chosen by
 * popularity within the upload: whichever way the team writes it most
 * often wins, and every other casing of the same value is rewritten to
 * match. "Abu Dhabi" (13 rows) beats "Abu dhabi" (10). Nothing is
 * destroyed and nothing forks a filter into two near-identical entries.
 *
 * Two fields are genuinely codes rather than names and are forced upper:
 * group and currency. Those are matched on exactly, and "Euro"/"EURO"
 * being two currencies is a bug, not a spelling preference.
 */

// The sheet's own stand-in phrases, written a different way on nearly
// every block. These aren't data, they're the team saying "not
// applicable" — so they get one fixed spelling rather than a popularity
// contest, which would otherwise pick a different winner each month
// depending on which rows happened to be in the file.
const SENTINELS = [
  'Handled internally',
  'Will never be bank',
  'In person meet',
  'Ongoing',
  'Not applicable',
  // ===============================
  // * THE END DATE COLUMN'S OWN TWO, September 2026
  // ===============================
  // 31 of his 92 rows hold one of these instead of a date, and both were
  // being dropped in silence. They mean OPPOSITE things:
  //   Going concern     no end date, it keeps running
  //   Reviewed monthly  decided month by month, so it belongs in the review
  // See shared/endNote.helper.js, which is what acts on them.
  'Going concern',
  'Reviewed monthly',
];
const SENTINEL_BY_KEY = new Map(SENTINELS.map((s) => [s.toLowerCase(), s]));

// Fields folded by popularity. Names, companies, places, banks — anything
// a human reads and recognises by its shape.
const FOLDED_FIELDS = [
  'personName',
  'company',
  'roleLabel',
  'location',
  'doorNumber',
  'postcode',
  'acceptingPostals',
  'bankDetails',
  'accountNumber',
  'sortCode',
  'phone',
  'label',
  'shouldBePaid',
  'paid',
];

// Codes, not names. Forced upper, because these are compared exactly and
// two spellings genuinely means two values downstream.
const UPPER_FIELDS = ['groupName', 'currency'];

/** Trim, collapse runs of whitespace. Never changes case. */
function tidy(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/\s+/g, ' ').trim();
}

/**
 * Looks at every row first, then rewrites — which is why this is a pass
 * over the whole upload rather than a per-row transform. Popularity can't
 * be known from one row.
 *
 * @param {object[]} rows  parsed rows, mutated in place and returned
 * @returns {{ rows: object[], folded: {field: string, from: string, to: string, rows: number}[] }}
 *   `folded` is what changed, so the upload summary can say so out loud
 *   rather than silently editing the team's spelling.
 */
function canonicalize(rows) {
  const folded = [];

  for (const field of UPPER_FIELDS) {
    for (const row of rows) {
      const v = tidy(row[field]);
      if (typeof v === 'string' && v) row[field] = v.toUpperCase();
    }
  }

  for (const field of FOLDED_FIELDS) {
    // lowercase key -> { spelling -> count }
    const counts = new Map();
    for (const row of rows) {
      const v = tidy(row[field]);
      if (typeof v !== 'string' || !v) continue;
      row[field] = v; // whitespace tidy applies regardless of folding
      const key = v.toLowerCase();
      if (!counts.has(key)) counts.set(key, new Map());
      const bucket = counts.get(key);
      bucket.set(v, (bucket.get(v) ?? 0) + 1);
    }

    const winner = new Map();
    for (const [key, bucket] of counts) {
      // A sentinel always wins over whatever the sheet typed, so "Handled
      // Internally" and "Handled internally" both land on one form that
      // stays stable between uploads.
      const sentinel = SENTINEL_BY_KEY.get(key);
      if (sentinel) {
        winner.set(key, sentinel);
        continue;
      }
      // Most common spelling wins; ties broken alphabetically so the
      // result is the same every run rather than depending on row order.
      const best = [...bucket.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      winner.set(key, best);
      if (bucket.size > 1) {
        for (const [spelling, count] of bucket) {
          if (spelling !== best) folded.push({ field, from: spelling, to: best, rows: count });
        }
      }
    }

    for (const row of rows) {
      const v = row[field];
      if (typeof v !== 'string' || !v) continue;
      const canonical = winner.get(v.toLowerCase());
      if (canonical && canonical !== v) row[field] = canonical;
    }
  }

  return { rows, folded };
}

module.exports = { canonicalize, tidy, SENTINELS, FOLDED_FIELDS, UPPER_FIELDS };
