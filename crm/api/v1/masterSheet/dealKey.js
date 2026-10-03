/**
 * One identity for a row, however it got here.
 *
 * THE BUG THIS FIXES. Rows arrived through two paths that built keys in
 * two different namespaces:
 *
 *     hand-added    manual|nathan|m9x2k4a
 *     uploaded      milkman|souracore|mid|1|nathan
 *
 * Those can never collide, so hand-adding "Nathan on Souracore" and then
 * uploading a sheet that also contains it produced TWO rows for one
 * arrangement — and the upload's own delete step skips manual rows, so
 * nothing ever cleaned it up. Nathan appears twice on People, twice on
 * Companies, and twice in the payout. A wrong figure, not just clutter.
 *
 * Both paths now build the key here, so the same arrangement resolves to
 * the same row no matter who entered it.
 *
 * THE COMPARISON IS DELIBERATELY AGGRESSIVE. Trim, lowercase, and strip
 * every character that isn't a letter or a digit. Two humans typing the
 * same thing disagree about spacing, capitals and punctuation constantly,
 * and this is a match test, not a display value:
 *
 *     "Relia PA"    "Relia Pa"    "relia  pa"   ->  reliapa
 *     "A J Rayson"  "AJ Rayson"                 ->  ajrayson
 *     "SG, CKA, CKU, Umbrella co"               ->  sgckackuumbrellaco
 *
 * Verified against the boss's real sheet: 96 rows produce 96 distinct
 * keys under this rule, with no two genuinely different arrangements
 * colliding and no two company names merged that shouldn't be. If a
 * future sheet does collide, `dedupeIndex` keeps both rather than losing
 * one — see below.
 *
 * WHAT IS *NOT* IN THE KEY, and why:
 *   money, dates, days   the things most likely to be corrected. A key
 *                        that changed when someone fixed an amount would
 *                        orphan the row and its edit history.
 *   row position         the sheet reorders between months; see
 *                        migration 027, which took this out.
 */

/** Match form. Never stored as a display value, never shown to anyone. */
function fold(v) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * The five fields that decide whether two rows are the same arrangement.
 *
 * Seat is part of it because "Mid 1" and "Mid 2" on one company are two
 * different people being paid two different amounts, not one row typed
 * twice.
 */
function dealKey({ groupName, company, role, seat, personId }, dedupeIndex = 0) {
  const base = [
    fold(groupName),
    fold(company) || '-',
    fold(role),
    seat ?? '-',
    fold(personId),
  ].join('|');

  // The same person genuinely holds the same role on the same company
  // twice with different payable days — whatbot's own rule, and the thing
  // that makes collapsing duplicates dangerous. When it happens the second
  // row gets a suffix so BOTH survive and both stay visible, rather than
  // one silently overwriting the other.
  return dedupeIndex > 0 ? `${base}|${dedupeIndex + 1}` : base;
}

/**
 * "Is this already here?" — the same comparison, exposed for the check
 * that runs before a row is hand-added, so nobody types out a row that
 * already exists.
 */
function isSameDeal(a, b) {
  return dealKey(a) === dealKey(b);
}

module.exports = { dealKey, fold, isSameDeal };
