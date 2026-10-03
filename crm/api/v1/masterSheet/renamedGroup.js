/**
 * ***************************************************
 * * A RENAMED GROUP LOOKS EXACTLY LIKE A NEW ONE
 * ***************************************************
 *
 * The group is part of a deal's identity (`dealKey`: group|company|role|
 * seat|person). So when the boss renames MILKMAN to MILKY in his sheet:
 *
 *   1. Every row gets a NEW sync key, so nothing matches. All 33 import as
 *      brand new rows.
 *   2. "Different deals" is scoped to the groups the FILE speaks for, and
 *      the file speaks for MILKY. The 33 stored MILKMAN rows are in a
 *      group the file never mentions, so they are not shown ANYWHERE, not
 *      even on the potentially-ended tab.
 *   3. The sheet now holds 66 rows and BOTH sets count toward the month.
 *
 * Verified against the live sheet: renamed keys matched nothing, and the
 * unmatched list came back empty. A silent doubling with nothing on screen.
 *
 * THIS DOES NOT DECIDE, IT ASKS. A rename and a genuinely new group are
 * indistinguishable from the data alone, and guessing either way is worse
 * than the question: guess "new" and you double the money, guess "rename"
 * and you rewrite a group nobody renamed. So it reports a SUSPICION with
 * the evidence, and a human answers it.
 */

const { fold } = require('../agent/tools/resolvePerson');

/**
 * How much of one group's roster appears under another name.
 *
 * Compared on person + company + role, which is the deal's identity with
 * the group taken OUT: that is precisely what survives a rename and what
 * distinguishes it from a new group of different people.
 */
const identity = (r) => [
  fold(r.personId ?? r.person_id ?? r.personName ?? r.person_name),
  fold(r.company),
  fold(r.roleLabel ?? r.role_label ?? r.role),
].join('|');

// How much overlap makes it a rename rather than a coincidence. A new
// client with the same handler on the same company at the same role is
// possible; two thirds of a roster matching is not.
const RENAME_OVERLAP = 0.6;

// Below this a "match" is noise: one row moving between two one-row groups
// is 100% overlap and means nothing.
const MIN_ROWS = 3;

/**
 * @param {object[]} fileRows parsed rows, carrying `groupName`
 * @param {object[]} storedRows every row currently on the sheet, carrying
 *   `group_name`. Only the ones in groups the file does NOT mention can be
 *   the old side of a rename.
 * @returns {Array<{from, to, matched, of, names}>} one per suspicion,
 *   strongest first. Empty when nothing looks renamed.
 */
function renamedGroups(fileRows = [], storedRows = []) {
  const fileGroups = new Set(
    fileRows.map((r) => String(r.groupName ?? '').toUpperCase()).filter((g) => g && g !== 'UNKNOWN'),
  );
  if (fileGroups.size === 0) return [];

  const storedGroups = new Set(storedRows.map((r) => String(r.group_name ?? '').toUpperCase()).filter(Boolean));

  // ONLY A GROUP THE FILE HAS NEVER HEARD OF can be the old name. A group
  // the file also mentions is being updated, not renamed.
  const candidates = [...storedGroups].filter((g) => !fileGroups.has(g));
  // And only a group the CRM has never heard of can be the new one.
  const arrivals = [...fileGroups].filter((g) => !storedGroups.has(g));
  if (candidates.length === 0 || arrivals.length === 0) return [];

  const found = [];

  for (const to of arrivals) {
    const incoming = fileRows.filter((r) => String(r.groupName ?? '').toUpperCase() === to);
    if (incoming.length < MIN_ROWS) continue;
    const wanted = new Set(incoming.map(identity));

    for (const from of candidates) {
      const old = storedRows.filter((r) => String(r.group_name ?? '').toUpperCase() === from);
      if (old.length < MIN_ROWS) continue;

      const matched = old.filter((r) => wanted.has(identity(r)));
      const share = matched.length / old.length;
      if (share < RENAME_OVERLAP) continue;

      found.push({
        from,
        to,
        matched: matched.length,
        of: old.length,
        // Enough to recognise it, not the whole roster.
        names: [...new Set(matched.map((r) => r.person_name).filter(Boolean))].slice(0, 5),
      });
    }
  }

  // Strongest first: the most rows moved is the likeliest rename.
  return found.sort((a, b) => b.matched - a.matched);
}

module.exports = { renamedGroups, RENAME_OVERLAP, MIN_ROWS };
