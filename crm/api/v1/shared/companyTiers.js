/**
 * What KIND of company this is, in the boss's own words.
 *
 * His side table beside each group's rows has a column headed "Status:".
 * The CRM cannot call it status: that word is already taken by
 * active/closed, the Close button, and two facts about one company sharing
 * a name is the confusion the payment-period rename just finished undoing.
 * So it is `tier`, everywhere, including on screen.
 *
 * ===============================
 * * SUGGESTIONS, NOT A WHITELIST
 * ===============================
 * This was a closed set of two, `Top co` and `Normal co`, and the PATCH
 * route rejected anything else with a 400. His three reference files
 * actually carry: Visa co, Top Co, T3, T2, Benched, TBC, Provider, In prep,
 * `T2 for Reliapay` and `T1 with capilano`.
 *
 * The upload's own writer never validated against the list, so a tier the
 * upload had just written could not be edited by hand: the CRM would 400 on
 * its own stored value. A closed set was the wrong shape for a column he
 * writes prose into, the same way the payment start column is prose.
 *
 * So these are what the picker OFFERS. The live values in use are served
 * alongside them (companies.repo's `tiersInUse`), so a kind he invents next
 * month appears in the list by itself.
 *
 * NULL is still a real value meaning nobody has said, and it is different
 * from any tier we could invent as a default.
 */
const COMPANY_TIERS = [
  'Top co',
  'Normal co',
  'T2',
  'T3',
  'TBC',
  'Benched',
  'In prep',
  'Provider',
  'Visa co',
];

module.exports = { COMPANY_TIERS };
