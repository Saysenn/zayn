const masterSheet = require('./masterSheet');
const breakdown = require('./breakdown');
const monthlySheet = require('./monthlySheet');
const divisionSheet = require('./divisionSheet');
const payout = require('./payout');
const { buildDriverWorkbook } = require('../../masterSheet/driverSheet');

// THE DRIVERS SHEET: the month's money by who delivers it. See driverSheet.js.
const drivers = {
  id: 'drivers',
  label: 'Drivers',
  fileLabel: 'DRIVERS SHEET',
  description: 'The month\'s cash by who delivers it: a section per run, UK cash, Outside UK with USD, and people with several deals.',
  build: (rows, opts = {}) => buildDriverWorkbook(rows, opts),
};

/**
 * The xlsx templates an admin can pick in the Export modal.
 *
 * A TEMPLATE IS A LAYOUT, NOT A FILTER. Which rows go in is already
 * decided by the export's preset and the page's filters (see v1/export.js);
 * a template only decides what shape they come out in. Keeping those two
 * apart is what lets "cash only" and "one person" each render as either
 * shape without a template per combination.
 *
 * Every template here DELEGATES to the builder in v1/masterSheet/. None of
 * them re-implements a layout: two files producing nearly the same sheet
 * is the failure this registry exists to prevent, and the first time a
 * column changed only one of them would get it.
 *
 * Adding one:
 *   1. a file here exporting { id, label, description, build }
 *   2. add it to TEMPLATES below
 * The modal reads the list, so nothing else needs touching.
 *
 * `build(rows, opts)` — opts is the shape options the Export modal collects
 * (see layoutOptions in v1/export.js). Every template may ignore it, and
 * most do; none may treat it as a filter, which is the preset's job.
 *
 * `id` is what crosses the wire as ?template=. Never rename one in place —
 * a saved link would silently switch layout. Add the new id and retire the
 * old one deliberately.
 */
const TEMPLATES = [
  masterSheet, breakdown, monthlySheet, divisionSheet,
  payout.expensing, payout.cash, payout.bank, payout.bankDetails, drivers,
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

/** The default when nothing is asked for: the shape the boss's own payout
 *  files have always had. */
const DEFAULT_ID = masterSheet.id;

/** What the Export modal lists. Metadata only, never the build function. */
function listTemplates() {
  return TEMPLATES.map(({ id, label, description }) => ({ id, label, description }));
}

/**
 * Resolve an id to a template, falling back rather than throwing.
 *
 * An unknown id means an old link or a typo, and refusing to export is a
 * worse answer than exporting the usual shape.
 */
function templateFor(id) {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_ID);
}

/**
 * What a template calls itself in a downloaded filename.
 *
 * Falls back to the label rather than to nothing, so a template added
 * without a `fileLabel` still names its file after itself instead of
 * silently producing the unnamed one the group-only filename used to be.
 *
 * ===============================
 * * A FILTERED RUN IS A DIFFERENT DOCUMENT
 * ===============================
 * The master sheet narrowed to bank, to cash and to crypto are three
 * files. Without the method all three land as "MASTER SHEET - <date>" and
 * whichever downloaded last wins in the folder: the exact collision the
 * labels were added to stop, see shared/exportFileName.helper.
 *
 * THE METHOD IS UPPERCASED, NEVER LOOKED UP. A map from `bank` to a word
 * would be a fourth copy of METHOD_LABELS, and those spell it "Bank
 * Transfer", which is not what belongs in a filename.
 *
 * SKIPPED WHEN THE LABEL ALREADY SAYS IT. The Bank payout tab is called
 * BANK and must not come down as "BANK - BANK".
 */
function fileLabelOf(template, method = null) {
  const base = template.fileLabel ?? String(template.label).toUpperCase();
  const word = String(method ?? '').trim().toUpperCase();
  if (!word || base.includes(word)) return base;
  return `${base} - ${word}`;
}

module.exports = {
  listTemplates, templateFor, fileLabelOf, DEFAULT_ID,
};
