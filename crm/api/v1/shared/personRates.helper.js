// ***************************************************
// * The PERSON's two rates, carried on a deal row
// ***************************************************
//
// They STACK with the deal's own (shared/rates.helper.js), so any row a
// reader is going to rate has to carry both levels. Without them every
// reader silently applies half the rate and nothing says so.
//
// FOUR READERS, ONE DEFINITION. It was written out by hand in the master
// sheet and the review queue and MISSING from the two detail pages, so a
// person's 5% showed on the Master Sheet and not on their own page.
// Reported 2026-09-24, the same fault the review queue had on 2026-09-21.
//
// A SUBSELECT, NOT A JOIN: this is spliced into queries that name no alias
// and into CTEs that already join tb_people for something else.

/**
 * @param {string} [table] the mastersheet table or its alias, no dot.
 * @returns {string} two SELECT columns, comma separated, no trailing comma.
 */
function personRatesSql(table = 'tb_mastersheet') {
  return `COALESCE((SELECT p.addon_percent FROM tb_people p
             WHERE p.person_id = ${table}.person_id), 0)::float AS person_addon_percent,
          COALESCE((SELECT p.fee_percent FROM tb_people p
             WHERE p.person_id = ${table}.person_id), 0)::float AS person_fee_percent`;
}

module.exports = { personRatesSql };
