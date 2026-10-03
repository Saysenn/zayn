// ***************************************************
// * A company's own detail, as the change log names it
// ***************************************************
//
// Set on tb_companies, logged once per deal on the company, so History and
// undo reach it. STATUS IS NOT HERE: closing is undone by reopening.
const { levelFieldLog } = require('./levelFieldLog.helper');

const {
  FIELD: COMPANY_LOGGED_FIELD,
  COLUMN_FOR_LOG: COMPANY_COLUMN_FOR_LOG,
  isField: isCompanyField,
} = levelFieldLog({
  tier: { column: 'tier', field: 'companyTier' },
  oldGroup: { column: 'old_group', field: 'companyOldGroup' },
  notes: { column: 'notes', field: 'companyNotes' },
  liquidationTotal: { column: 'liquidation_total', field: 'companyLiquidationTotal' },
});

// The API name for a logged one, which is what `update()` takes back.
const COMPANY_PROP_FOR_LOG = Object.freeze(Object.fromEntries(
  Object.entries(COMPANY_LOGGED_FIELD).map(([prop, { field }]) => [field, prop]),
));

// Stored text for comparing: NULL, '' and an unset value are one "nothing",
// and a numeric reads the same whether pg sent 500 or '500.00'.
function loggedText(column, value) {
  if (value == null || String(value).trim() === '') return null;
  if (column === COMPANY_LOGGED_FIELD.liquidationTotal.column) return String(Number(value));
  return String(value);
}

module.exports = {
  COMPANY_LOGGED_FIELD, COMPANY_COLUMN_FOR_LOG, COMPANY_PROP_FOR_LOG, isCompanyField, loggedText,
};
