/**
 * ***************************************************
 * * Company tiers: what the file says vs what we hold.
 * ***************************************************
 *
 * ONE ROW PER COMPANY IN THE FILE, and EVERY company, not only the ones
 * that need a decision. The tab used to list four buckets and hide the
 * rest, so a name you wanted to correct was only reachable if the diff had
 * already decided it was a problem.
 *
 * Each row carries both halves the tab edits:
 *   LEFT   which company this IS, correctable against what the CRM holds
 *   RIGHT  its tier and its old group, both free text with suggestions
 *
 * NOT WRITTEN IMMEDIATELY, unlike the delete tab. A tier OVERWRITES a
 * value; deleting destroys a row. Only the second earns its own act.
 */

/** Match on a folded name, the same way tb_companies' unique index does. */
function fold(name) {
  return String(name ?? '').trim().toLowerCase();
}

/** Letters and digits only, so "Relia PA" and "Relia Pa." are one name. */
function squash(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * ===============================
 * * A NEW COMPANY IS THE DANGEROUS ONE
 * ===============================
 * Five of thirteen "new" names in his three files are near-misses of
 * companies we already hold: "Umbrella Co UK" against "Umbrella company uk
 * holdings", "Churchill Knight employment" against our own misspelling
 * "Churchill knight emplyment". Creating those silently is how one company
 * becomes two rows and a filter forks in half.
 *
 * So a name with no exact match but a plausible neighbour is FLAGGED with
 * the neighbour offered, never added. Some really are new and some really
 * are the same company: only a human can say which, and it is one click.
 */
const PREFIX = 6;

function nearMatches(name, existing) {
  const n = squash(name);
  if (n.length < 3) return [];
  return existing
    .filter((c) => {
      const e = squash(c.name);
      if (e === n) return false;
      return e.startsWith(n) || n.startsWith(e) || e.slice(0, PREFIX) === n.slice(0, PREFIX);
    })
    .map((c) => c.name);
}

/** The four states a row can be in. The tab groups its sections by these. */
const STATE = Object.freeze({
  FLAGGED: 'flagged',
  CHANGED: 'changed',
  NEW: 'new',
  UNCHANGED: 'unchanged',
});

/**
 * @param {Array} parsed     from parseCompanyTable
 * @param {Array} existing   tb_companies rows: { company_id, name, tier, old_group }
 * @param {object} [opts]
 * @param {string[]} [opts.ambiguous] company names the upload could not
 *   place, folded. Only ever non-empty on a multi-group file.
 */
function diffCompanies(parsed, existing, { ambiguous = [] } = {}) {
  const all = existing ?? [];
  const held = new Map(all.map((c) => [fold(c.name), c]));
  const unplaceable = new Set(ambiguous.map(fold));

  const rows = (parsed ?? []).map((entry) => {
    const key = fold(entry.company);
    // An exact fold first, then a punctuation or casing variant: "Relia PA"
    // and "Relia Pa." are the same company, not a new one.
    const current = held.get(key)
      ?? all.find((c) => squash(c.name) === squash(entry.company))
      ?? null;

    const row = {
      // What the FILE said, kept whatever the match is. The tab shows it as
      // the typed value so a correction is visibly a correction.
      company: entry.company,
      // Which CRM company this row will write to. Null means a new one.
      matchedName: current?.name ?? null,
      companyId: current?.company_id ?? null,
      tier: entry.tier,
      oldGroup: entry.oldGroup ?? '',
      currentTier: current?.tier ?? '',
      currentOldGroup: current?.old_group ?? '',
      // What the LEFT dropdown offers. Near-misses first: they are the
      // reason the picker exists.
      nameOptions: nearMatches(entry.company, all),
      // Both values when the file gave two, so neither is preselected.
      tierOptions: entry.conflict ?? null,
      reason: null,
      state: STATE.UNCHANGED,
    };

    // FLAGGED IS NOT A FAILURE, it is a question. Three causes, one bucket
    // and one way to resolve: the file gave this company two tiers, the
    // company sits in several groups so a single-group file cannot say
    // which it meant, or the name resembles one we already hold.
    if (entry.conflict) {
      return { ...row, state: STATE.FLAGGED, reason: 'two tiers in this file' };
    }
    if (unplaceable.has(key)) {
      return { ...row, state: STATE.FLAGGED, reason: 'this company is in more than one group' };
    }
    if (!current) {
      if (row.nameOptions.length > 0) {
        return { ...row, state: STATE.FLAGGED, reason: 'looks like a company we already have' };
      }
      return { ...row, state: STATE.NEW };
    }

    const sameTier = (current.tier ?? '') === entry.tier;
    // An ABSENT old group column is not an empty cell. A file without one
    // says nothing about the old group, so it can never clear a stored value
    // and can never count as a change. Same rule importColumns follows for
    // the deal columns.
    const mentionsOldGroup = String(entry.oldGroup ?? '') !== '';
    const sameOldGroup = !mentionsOldGroup || (current.old_group ?? '') === entry.oldGroup;
    return { ...row, state: sameTier && sameOldGroup ? STATE.UNCHANGED : STATE.CHANGED };
  });

  const of = (state) => rows.filter((r) => r.state === state);
  const changed = of(STATE.CHANGED);
  const added = of(STATE.NEW);
  const flagged = of(STATE.FLAGGED);

  // What the three pickers offer. Built here because this is where both
  // sides are in hand; the browser deriving them would be a second rule.
  const distinct = (values) => [...new Set(values.filter((v) => String(v ?? '').trim()))].sort();

  return {
    // EVERY company the file listed, in its own order. The tab renders this.
    rows,
    // The old group values this file mentions, so the tab can say which it
    // covers without the browser deriving it from the rows twice.
    oldGroups: distinct(rows.map((r) => r.oldGroup)),
    // EVERY company the CRM holds, so the left picker can correct a name to
    // any of them, not only to the near-misses this file happened to hit.
    companyNames: all.map((c) => c.name).sort(),
    // SUGGESTIONS, NEVER A WHITELIST. He writes `T2 for Reliapay` into this
    // column, so anything that rejected a value would reject his own sheet.
    tierSuggestions: distinct([...all.map((c) => c.tier), ...rows.map((r) => r.tier)]),
    oldGroupSuggestions: distinct([
      ...all.map((c) => c.old_group), ...rows.map((r) => r.oldGroup),
    ]),
    // Kept because callers and tests read them, and because the tab's
    // section headings are these four groupings.
    changed,
    added,
    flagged,
    unchanged: of(STATE.UNCHANGED),
    // What the tab counts. Unchanged rows are not offered: accepting a
    // value that already matches writes nothing and reads as work done.
    actionable: changed.length + added.length + flagged.length,
  };
}

module.exports = { diffCompanies, fold, STATE };
