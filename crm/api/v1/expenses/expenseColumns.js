// ***************************************************
// * The columns an expenses sheet carries, written ONCE
// ***************************************************
//
// The export writes these headers and the import reads them back, so a
// file this CRM produced is a file it can take. One list, or the two drift
// and a round trip silently loses a column.
//
// NOTHING HERE IS SHARED WITH THE MASTER SHEET. Its own columns live in
// masterSheet/importColumns.js and the two must never meet: an expenses
// file and a deals file that parsed through one map would each accept the
// other's rows.

/** `header` is what the file says, `field` is what the API calls it. */
const COLUMNS = [
  { header: 'Date', field: 'spentOn', type: 'date', width: 12 },
  { header: 'Description', field: 'description', type: 'text', width: 38 },
  { header: 'Payee', field: 'payee', type: 'text', width: 20 },
  { header: 'Group', field: 'groupName', type: 'text', width: 16 },
  { header: 'Spent by', field: 'spentBy', type: 'text', width: 18 },
  { header: 'Currency', field: 'currency', type: 'text', width: 10 },
  { header: 'Raw amount', field: 'rawAmount', type: 'money', width: 14 },
  { header: 'AED per unit', field: 'exchangeRate', type: 'rate', width: 14 },
];

// ===============================
// * DERIVED, WRITTEN BUT NEVER READ
// ===============================
// The AED figure is a generated column. It goes in the file because a human
// reading the sheet needs it, and it is IGNORED on the way back in: taking
// it would let a typed cell disagree with the two numbers that make it.
const DERIVED = [
  { header: 'AED amount', field: 'aedAmount', type: 'money', width: 14 },
];

const HEADERS = [...COLUMNS, ...DERIVED].map((c) => c.header);

/** Header text to field, folded, so spacing and case cannot break a read. */
const fold = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const FIELD_FOR = new Map(COLUMNS.map((c) => [fold(c.header), c.field]));

// ===============================
// * WHAT THE EXPORT MODAL OFFERS
// ===============================
// Served, never typed out in the modal as well: a list in two places is a
// list that drifts the first time a column is added.

/** Columns you may untick. The first two are what a row IS. */
const REQUIRED_FIELDS = ['spentOn', 'description'];

const PICKABLE = [...COLUMNS, ...DERIVED].map((c) => ({
  field: c.field,
  label: c.header,
  required: REQUIRED_FIELDS.includes(c.field),
}));

// Its OWN palette, not the master sheet's `breakdowns/palette`: a colour
// list shared between two exports is a change to one showing up in the
// other.
//
// `strong` and `soft` are the swatch's own words, so the shared Swatches
// control can draw these without a second shape to translate. ARGB for
// exceljs, css for the dot.
const PALETTE = [
  {
    id: 'slate', label: 'Slate', fill: 'FFEFF3F1', ink: 'FF2F3E37', strong: '#2f3e37', soft: '#eff3f1',
  },
  {
    id: 'green', label: 'Green', fill: 'FFE3F0E7', ink: 'FF1F6B3B', strong: '#1f6b3b', soft: '#e3f0e7',
  },
  {
    id: 'sand', label: 'Sand', fill: 'FFF4EFE4', ink: 'FF7A5B22', strong: '#7a5b22', soft: '#f4efe4',
  },
  {
    id: 'plain', label: 'Plain', fill: null, ink: 'FF000000', strong: '#000000', soft: '#ffffff',
  },
];

const DEFAULT_PALETTE = PALETTE[0].id;

const paletteFor = (id) => PALETTE.find((p) => p.id === id) ?? PALETTE[0];

/** Untickable columns only, and never empty: a sheet of nothing is a bug. */
function columnsFrom(wanted) {
  if (!Array.isArray(wanted) || wanted.length === 0) return [...COLUMNS, ...DERIVED];
  const asked = new Set([...wanted, ...REQUIRED_FIELDS]);
  return [...COLUMNS, ...DERIVED].filter((c) => asked.has(c.field));
}

module.exports = {
  COLUMNS, DERIVED, HEADERS, FIELD_FOR, fold,
  PICKABLE, PALETTE, DEFAULT_PALETTE, paletteFor, columnsFrom, REQUIRED_FIELDS,
};
