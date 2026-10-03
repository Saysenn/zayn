const { types } = require('pg');

/**
 * ===============================
 * * A `date` COLUMN COMES BACK AS THE DAY IT IS: 'YYYY-MM-DD'
 * ===============================
 *
 * pg's default turns a `date` into a JS Date at LOCAL midnight. The money
 * code reads days in UTC (`toISOString`, `getUTC*`), so on any host east of
 * UTC the day moved back: on a Dubai machine, or in the UK during BST, a
 * deal preset for 1 October read as 30 September and owed nothing for
 * October. West of UTC it worked by luck.
 *
 * A calendar day has no zone. Kept as text it is the same day on every
 * host, and every reader already has a string branch.
 *
 * Required by configs/db.js and by every script that opens its own Client,
 * so the parser is registered before any query runs.
 */
const DATE_OID = 1082;
const DATE_ARRAY_OID = 1182;

types.setTypeParser(DATE_OID, (value) => value);
types.setTypeParser(DATE_ARRAY_OID, (value) => (value == null
  ? value
  : String(value).replace(/^\{|\}$/g, '').split(',').filter(Boolean).map((v) => v.replace(/"/g, ''))));

module.exports = { DATE_OID };
