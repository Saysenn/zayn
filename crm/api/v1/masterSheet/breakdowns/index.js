const none = require('./none');
const simple = require('./simple');
const standard = require('./standard');
const withUsd = require('./withUsd');

/**
 * THE BREAKDOWN DESIGNS an admin can pick on the month tab.
 *
 * A DESIGN IS A LAYOUT OF ONE BLOCK, not a document. The workbook, its
 * tabs, its columns and which rows are in it are all decided elsewhere
 * (v1/templates/xlsx/ picks the document, the preset picks the rows). A
 * design only decides what the payment breakdown at the foot of each group
 * tab looks like.
 *
 * WHY THIS IS NOT A TOGGLE ANY MORE. It was one switch, "Include
 * breakdown", on or off. Two shapes of the same block cannot be expressed
 * that way without a second switch that only means anything when the first
 * is on, which is the kind of control nobody can predict from looking at
 * it. So off is a CHOICE IN THE LIST rather than a separate question, and
 * `breakdown=false` still resolves here to `none` so old links keep working.
 *
 * Adding one:
 *   1. a file here exporting { id, label, description, write }
 *   2. add it to DESIGNS below
 *   3. a preview in web/src/components/export/breakdowns/ under the same id
 * The modal reads this list, so nothing else needs touching.
 *
 * `write(ctx, breakdown, opts)` — `ctx` carries the sheet and the band-row
 * primitives from buildWorkbook.js. They are PASSED rather than imported:
 * they live in a 952 line file and are used throughout it, so hoisting them
 * to share with three small files would be a large edit to a load-bearing
 * document for no gain at the call site.
 *
 * `id` crosses the wire as ?breakdownDesign=. Never rename one in place: a
 * saved link would silently change the shape of a payout file.
 */
/**
 * ===============================
 * * THREE STAGES, AND THEY ARE ORDERED
 * ===============================
 * simple -> standard -> advance, each one saying more than the last, plus
 * `none` for a tab that ends at its rows. The list order IS the order the
 * picker draws, so it reads as a progression rather than four alternatives.
 *
 *   simple    method, location, one net figure
 *   standard  + the currency rows and every add on and fee named
 *   advance   + both pivots, USD, the rates and the UK/away cash split
 */
const DESIGNS = [none, simple, standard, withUsd];

const BY_ID = new Map(DESIGNS.map((d) => [d.id, d]));

/**
 * ===============================
 * * `with-usd-table` IS NOW A TOGGLE ON `with-usd`
 * ===============================
 * It was a fourth design that differed from the advance one by a single
 * option. A saved link still carries the id, so it resolves to the design
 * it was a variant of and turns the option on: an old URL keeps producing
 * the document it always produced.
 *
 * Anything else unknown falls through to the default rather than throwing.
 */
const ALIASES = new Map([['with-usd-table', { id: withUsd.id, percentagesTable: true }]]);

/**
 * STANDARD IS THE DEFAULT, his call 2026-09-12.
 *
 * It is the shape of his own month sheet, and it is the one an admin can
 * check line by line against the deal rows above it. The advance block
 * converts and splits, which is a reading rather than the record.
 */
const DEFAULT_ID = standard.id;
const NONE_ID = none.id;

/** Metadata only, never the write function. */
function listBreakdownDesigns() {
  return DESIGNS.map(({ id, label, description }) => ({ id, label, description }));
}

/**
 * Resolve an id, falling back rather than throwing.
 *
 * An unknown id is an old link or a typo. Producing the usual shape beats
 * refusing to export, the same reasoning templates/xlsx uses.
 */
function breakdownDesignFor(id) {
  const alias = ALIASES.get(id);
  return BY_ID.get(alias?.id ?? id) ?? BY_ID.get(DEFAULT_ID);
}

/**
 * Does this id force the percentages table on regardless of the toggle?
 *
 * Only the retired `with-usd-table` does. Read beside the toggle rather
 * than inside `breakdownDesignFor`, which returns a design and has nowhere
 * to put an option.
 */
function forcesPercentagesTable(id) {
  return Boolean(ALIASES.get(id)?.percentagesTable);
}

module.exports = {
  listBreakdownDesigns, breakdownDesignFor, forcesPercentagesTable, DEFAULT_ID, NONE_ID,
};
