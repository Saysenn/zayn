/**
 * IS THIS MONEY LEAVING THE COUNTRY?
 *
 * The business sits in the UAE, so cash handed over in Abu Dhabi is local
 * and everything else is money going out. The boss reads "away" as "going
 * to the UK", because that is where it goes, which is why the export's
 * summary calls the two halves UK and other.
 *
 * ONE DEFINITION, because three places need the same answer and they must
 * not each decide it: the export's summary block, the export warnings, and
 * a filter later.
 *
 * THE LIST IS THE LOCAL ONE, NOT THE AWAY ONE, and that direction is
 * deliberate. Locations arrive as free text from the sheet, so the set of
 * away places is open ended and unknowable, while the set of local ones is
 * small and known. Listing the away side would mean a new UK town silently
 * counting as local, which understates what has to be sent.
 *
 * BUT AN UNKNOWN LOCATION IS STILL NOT SAFE TO ASSUME. A new "Dubai" would
 * be classed away by the rule above and be wrong. So `unclassified()` names
 * them and the export warns rather than the figure quietly absorbing them.
 * The rule is only trusted for locations somebody has actually seen.
 *
 * Folded case-insensitively: the same place is spelled several ways in the
 * live data ("Abu Dhabi" on 19 rows, "Abu dhabi" on 2), and canonical.js
 * folds on upload but the stored rows already carry both.
 */

// The fallback when settings have not been read, and the seed for the
// column's own default. Not the source of truth: tb_settings is.
const DEFAULT_LOCAL_LOCATIONS = ['Abu Dhabi'];

function fold(v) {
  return String(v ?? '').trim().toLowerCase();
}

function localSet(localLocations = DEFAULT_LOCAL_LOCATIONS) {
  return new Set((localLocations ?? []).map(fold).filter(Boolean));
}

/** True when the location is somewhere the business is, so nothing is sent. */
function isLocal(location, localLocations) {
  return localSet(localLocations).has(fold(location));
}

/** True when the money has to travel. A blank location is NOT assumed away. */
function isAway(location, localLocations) {
  const l = fold(location);
  if (!l) return false;
  return !localSet(localLocations).has(l);
}

/**
 * Locations in these rows that nobody has classified.
 *
 * Everything not on the local list is treated as away, so this cannot be
 * derived from the rule itself. It is the list of away locations the admin
 * has never confirmed, which is what the warning is actually about: a new
 * place appeared and the export guessed.
 *
 * @param {object[]} rows deals
 * @param {string[]} localLocations from tb_settings
 * @param {string[]} knownAway locations already confirmed as away
 */
function unclassified(rows, localLocations, knownAway = []) {
  const local = localSet(localLocations);
  const known = new Set(knownAway.map(fold));
  const out = new Map();
  for (const r of rows) {
    const raw = String(r.location ?? '').trim();
    if (!raw) continue;
    const key = fold(raw);
    if (local.has(key) || known.has(key)) continue;
    if (!out.has(key)) out.set(key, raw);
  }
  return [...out.values()];
}

module.exports = { isAway, isLocal, unclassified, DEFAULT_LOCAL_LOCATIONS };
