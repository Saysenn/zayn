// ***************************************************
// * A profile rate, as the change log names it
// ***************************************************
//
// Set on the PERSON, logged once per deal it reaches, under a name that can
// never be read as the deal's own rate. The undo puts the PROFILE back.
const { levelFieldLog } = require('./levelFieldLog.helper');

const {
  FIELD: PROFILE_RATE_FIELD,
  COLUMN_FOR_LOG: PROFILE_COLUMN_FOR_LOG,
  isField: isProfileRateField,
} = levelFieldLog({
  addonPercent: { column: 'addon_percent', field: 'personAddonPercent' },
  feePercent: { column: 'fee_percent', field: 'personFeePercent' },
});

module.exports = { PROFILE_RATE_FIELD, PROFILE_COLUMN_FOR_LOG, isProfileRateField };
