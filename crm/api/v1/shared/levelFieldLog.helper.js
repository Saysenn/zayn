// ***************************************************
// * A value set ABOVE the deal, as the change log names it
// ***************************************************
//
// A person's rate or a company's tier is logged once per deal it reaches,
// under a name no deal column has. The undo puts the LEVEL back, never the row.

/**
 * @param {Record<string, {column: string, field: string}>} spec keyed by the API name
 * @returns {{ FIELD, COLUMN_FOR_LOG, isField }} the spec, the same map keyed by what
 *   the LOG says, and the test for a logged name
 */
function levelFieldLog(spec) {
  const FIELD = Object.freeze(Object.fromEntries(
    Object.entries(spec).map(([name, entry]) => [name, Object.freeze({ ...entry })]),
  ));
  const COLUMN_FOR_LOG = Object.freeze(Object.fromEntries(
    Object.values(FIELD).map(({ column, field }) => [field, column]),
  ));
  const isField = (field) => Boolean(COLUMN_FOR_LOG[field]);
  return { FIELD, COLUMN_FOR_LOG, isField };
}

module.exports = { levelFieldLog };
