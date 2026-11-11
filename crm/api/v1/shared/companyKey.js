/**
 * ***************************************************
 * * THE ONE COMPANY KEY (his call 2026-11-11)
 * ***************************************************
 * Two names are the same company only when their keys are equal. The key is
 * the name lower-cased with everything but a-z and 0-9 removed, so spaces,
 * dots, commas and dashes are typing, not letters:
 *   "Click Pay Solutions"  -> "clickpaysolutions"
 *   "Next-Gen Umbrella"    -> "nextgenumbrella"
 * Still letter by letter: "Reli PA" (relipa) and "Relia PA" (reliapa) stay two
 * companies, and so do "Payloc Ltd" and "Payloc Limited". Never fuzzy.
 *
 * The name itself is never changed or shown as the key. SQL uses the
 * company_match_key() function (migration 094), which is this same rule and
 * what tb_companies' unique index is built on.
 */

const companyKey = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The same key in SQL, on any column or parameter. */
const companyKeySql = (expr) => `company_match_key(${expr})`;

module.exports = { companyKey, companyKeySql };
