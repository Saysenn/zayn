const { fold } = require('./resolvePerson');

/**
 * ***************************************************
 * * WHAT ACTUALLY TELLS ONE PERSON'S DEALS APART
 * ***************************************************
 *
 * A person holds several deals and she has to ask which. The question has
 * to name the field that DIFFERS, or it has no answerable form:
 *
 *   2026-09-18, closure: "Gloria holds 4 live deals: Workforce, Workforce,
 *     Workforce, Workforce. Ask which company they mean."
 *   2026-09-29, update:  "Zayn has 2 deals. Which company, or both?" with
 *     both deals on Workforce, in MILKMAN and in INDIGO.
 *
 * Four times now, and the same rule each time. A company is a company IN A
 * GROUP, so the company is often what a person's deals SHARE and the group
 * is what separates them. Asking on the shared field is a question whose
 * answer changes nothing, which is the dead end `resolvePerson` exists to
 * prevent one level up.
 *
 * ITS OWN FILE, like `resolvePerson`. `closure` and `masterSheet` both ask
 * this question, and a helper living in the 7,800 line tools module would
 * make it a dependency of everything that ever needs to ask.
 */

// GROUP FIRST: it is how they name a deal ("zayn milkman"), so where
// both differ the group is the answer they already have in mind. The
// FIRST field that actually varies is the one the question is about.
const FIELDS = [
  ['group_name', 'group'],
  ['company', 'company'],
  ['role_label', 'role'],
];

/**
 * @returns {string|null} 'company', 'group' or 'role', or null when the
 *   rows are alike on all three. Null is a real answer: the caller has to
 *   ask by deal rather than by a field, and pretending otherwise is how
 *   this bug keeps coming back.
 */
function whatSeparates(rows) {
  for (const [field, word] of FIELDS) {
    if (new Set((rows ?? []).map((r) => fold(r[field]))).size > 1) return word;
  }
  return null;
}

/**
 * The deals, said so that each one can be picked out: "Workforce in
 * MILKMAN; Workforce in INDIGO". Both halves always, never the one that
 * happens to differ, because a list saying only the group reads as a list
 * of groups.
 */
function dealsWhere(rows) {
  const each = (rows ?? []).map(
    (row) => [row.company, row.group_name].filter(Boolean).join(' in ') || `#${row.id}`,
  );
  return [...new Set(each)].join('; ');
}

module.exports = { whatSeparates, dealsWhere };
