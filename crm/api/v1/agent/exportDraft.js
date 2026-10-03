const { PRESETS } = require('../masterSheet/exportQuery');
const { listTemplates, fileLabelOf, templateFor } = require('../templates/xlsx');
const { listBreakdownDesigns, DEFAULT_ID: DEFAULT_BREAKDOWN } = require('../masterSheet/breakdowns');
const { listPaletteColors } = require('../masterSheet/breakdowns/palette');
const { exportFileName, exportScope } = require('../shared/exportFileName.helper');
const { monthValue } = require('../masterSheet/exportQuery');
const { currentMonth } = require('../masterSheet/rollToMonth');
const { listExportColumns } = require('../masterSheet/buildWorkbook');
const { listPayoutColumns } = require('../masterSheet/buildPayoutSheet');

// ***************************************************
// * The words she was given, as an export DRAFT
// ***************************************************
//
// Pure, and deliberately so: no database, no model, no request. It turns a
// resolved set of choices into the query string `/export/xlsx` already
// takes, so what she hands over and what the modal hands over are the same
// link built the same way.
//
// SHE PRODUCES THE LINK, NEVER THE FILE. See docs/plans/diane-export.md:
// the route's entire input is the query string, so there is nothing to
// store, expire or clean up, and the link regenerates against live data.

// The one place a template id is paired with the preset that filters for
// it. A template says what the document LOOKS like; a preset says which
// rows reach it, and picking the wrong partner is how a bank run comes out
// holding cash rows.
const PRESET_FOR_TEMPLATE = {
  cash: 'cash',
  bank: 'bank',
  'bank-details': 'bank-details',
  expensing: 'expensing',
  breakdown: 'breakdown',
};

/**
 * CRYPTO IS NOT A TEMPLATE, it is the bank shape filtered to the method.
 *
 * Same decision the card work already made. Adding a near-duplicate
 * template would mean two documents to keep in step for one difference
 * that a filter already expresses.
 */
const METHOD_ONLY = { crypto: 'crypto' };

const TEMPLATE_IDS = new Set(listTemplates().map((t) => t.id));
const DESIGN_IDS = new Set(listBreakdownDesigns().map((d) => d.id));
const COLOR_IDS = new Set(listPaletteColors().map((c) => c.id));

/** An unknown id falls back rather than throwing, as every route does. */
function pick(value, allowed, fallback) {
  const id = value ? String(value).trim() : '';
  return allowed.has(id) ? id : fallback;
}

/**
 * The choices, normalised. Everything absent takes the same default the
 * modal opens on, which is why `defaultId` is served rather than typed.
 */
// The presets that filter BY PAYMENT METHOD. Named, because an explicit
// method has to know which ones it contradicts.
const METHOD_PRESETS = new Set(['cash', 'bank']);

/**
 * TWO METHOD FILTERS CANCEL EACH OTHER OUT, and that was a real bug.
 *
 * "The crypto sheet" is the BANK SHAPE filtered to coin, per the card work.
 * But the bank TEMPLATE derives the bank PRESET, which filters to
 * `payment_method = 'bank'`, so bank plus crypto matched nothing at all and
 * the panel refused with "nothing matches" on a perfectly good request.
 *
 * An explicit method is the narrower, more deliberate fact, so it wins and
 * the preset steps back to the one that filters nothing. The template still
 * decides the columns and still names the file.
 */
function presetFor(template, named, method) {
  if (PRESETS[named]) return named;
  const derived = PRESET_FOR_TEMPLATE[template] ?? 'expensing';
  if (method && METHOD_PRESETS.has(derived)) return 'expensing';
  return derived;
}

/**
 * ***************************************************
 * * UNTICKING IS HIDING, and that was the whole bug
 * ***************************************************
 *
 * The draft carried an INCLUDE list, so "uncheck door number" meant naming
 * the other twenty three columns. She could not: she had never fetched the
 * list and had no way to read what the panel was showing. So she said she
 * had unchecked them, called no tool at all, and nothing moved on screen.
 *
 * HIDDEN is what a human actually expresses, and it is stable across a
 * template change in a way an include list is not: hiding the door number
 * still means hiding the door number on a different document.
 *
 * The query still carries `columns`, an include list, because that is what
 * the route has always taken. This resolves one into the other in the one
 * place that knows both.
 */
function columnsFor(template, hidden = []) {
  if (!hidden.length) return [];
  const all = (listPayoutColumns(template) ?? listExportColumns());
  const drop = new Set(hidden.map((k) => String(k).trim()));
  // A REQUIRED COLUMN CANNOT BE HIDDEN. A bank run with no names is a file
  // nobody can act on, and silently honouring it would be worse than
  // refusing: the panel shows those locked for the same reason.
  const kept = all.filter((c) => c.required || !drop.has(c.key));
  return kept.length === all.length ? [] : kept.map((c) => c.key);
}

/** The keys a template has, for anything checking what can be hidden. */
function columnKeysFor(template) {
  return (listPayoutColumns(template) ?? listExportColumns()).map((c) => c.key);
}

/**
 * WHAT A DOCUMENT CARRIES BY DEFAULT, which is not everything.
 *
 * The panel opened with all twenty four columns ticked on a bank sheet,
 * which is not a bank run: it is the whole master sheet wearing the bank
 * headers. `inSend` is each template's OWN set, the one the modal writes
 * and the boss recognises, and it is eight columns for bank, ten for cash,
 * thirteen for expensing.
 *
 * So the default hidden set is everything the document does not send.
 * Served, never typed: a column added to `SEND` is included the day it is.
 */
/**
 * `useEndDate` is the ONE setting that moves this set, and it is threaded
 * rather than read here so her panel and the export modal cannot disagree
 * about what a default file carries. With the colour setting on, the end
 * date decides what a month owes, so a file without that column shows a red
 * payment start and no reason for it. See buildWorkbook's
 * SETTING_LED_COLUMNS, which is the one definition.
 *
 * The other two helpers above do not need it: `columnsFor` filters on
 * `required` and `columnKeysFor` returns every key a template has, and
 * neither answer changes with a setting.
 */
function defaultHiddenFor(template, { useEndDate = false } = {}) {
  const all = listPayoutColumns(template) ?? listExportColumns({ useEndDate });
  return all.filter((c) => !c.inSend && !c.required).map((c) => c.key);
}

// `useEndDate` reaches only the default hidden set. Passed in rather than
// read here: this file is synchronous and settings live behind the repo.
function normalise(input = {}, { useEndDate = false } = {}) {
  const template = pick(input.template, TEMPLATE_IDS, 'monthly-sheet');
  const method = METHOD_ONLY[String(input.method ?? '').toLowerCase()] ?? input.method ?? null;

  return {
    template,
    // DERIVED from the template unless one was named. It is not a second
    // thing to ask about, and asking would be the same question twice.
    preset: presetFor(template, input.preset, method),
    // NEVER carried forward silently. Last time's August is this time's
    // mistake, so an absent month is THIS month, said out loud.
    month: monthValue(input.month) ?? currentMonth(),
    groups: [...new Set((input.groups ?? []).map((g) => String(g).trim().toUpperCase()).filter(Boolean))],
    company: input.company ? String(input.company).trim() : null,
    method: method ? String(method).trim() : null,
    currency: input.currency ? String(input.currency).trim().toUpperCase() : null,
    status: input.status ? String(input.status).trim() : null,
    needsReview: typeof input.needsReview === 'boolean' ? input.needsReview : null,
    // HIDDEN is the state a human sets; `columns` is derived from it and
    // is what the route reads.
    //
    // UNTOUCHED MEANS THE DOCUMENT'S OWN SET, not everything. And it
    // re-derives on a template change, because "the bank columns" means a
    // different eight from "the cash columns": carrying the old hides
    // across would leave a bank sheet showing cash's postcode and label.
    // Once they have actually chosen, their choice survives the switch,
    // minus any key the new document has never heard of.
    hiddenColumns: input.columnsTouched
      ? [...new Set((input.hiddenColumns ?? []).map((c) => String(c).trim()).filter(Boolean))]
        .filter((k) => columnKeysFor(template).includes(k))
      : defaultHiddenFor(template, { useEndDate }),
    columnsTouched: Boolean(input.columnsTouched),
    // Which steps of the build they have actually settled. Carried rather
    // than derived because "every group" and "no colour" are real answers
    // that look exactly like not having been asked yet.
    answered: [...new Set(input.answered ?? [])],
    breakdownDesign: pick(input.breakdownDesign, DESIGN_IDS, DEFAULT_BREAKDOWN),
    primaryColor: pick(input.primaryColor, COLOR_IDS, null),
    secondaryColor: pick(input.secondaryColor, COLOR_IDS, null),
    multiFile: input.multiFile === true,
  };
}

/**
 * The draft as the query object `/export/*` reads.
 *
 * ONE SHAPE, THREE READERS: previewExport counts it, /export/xlsx builds
 * it, and the link below is a serialisation of it. A count that ran a
 * different object from the build is a file whose own description is wrong.
 */
function queryFor(draft) {
  const q = {
    template: draft.template,
    preset: draft.preset,
    month: draft.month,
  };
  if (draft.groups.length) q.group = draft.groups.join(',');
  if (draft.company) q.company = draft.company;
  if (draft.method) q.method = draft.method;
  if (draft.currency) q.currency = draft.currency;
  if (draft.status) q.status = draft.status;
  if (draft.needsReview !== null) q.needsReview = String(draft.needsReview);
  // DERIVED, never stored. Hidden is the state; this is what the route
  // reads, and computing it here is what stops the two disagreeing.
  const columns = columnsFor(draft.template, draft.hiddenColumns);
  if (columns.length) q.columns = columns.join(',');
  if (draft.breakdownDesign) q.breakdownDesign = draft.breakdownDesign;
  if (draft.primaryColor) q.primaryColor = draft.primaryColor;
  if (draft.secondaryColor) q.secondaryColor = draft.secondaryColor;
  if (draft.multiFile) q.multiFile = 'true';
  return q;
}

/** The path the browser downloads, identical to the modal's. */
function linkFor(draft) {
  return `/api/v1/export/xlsx?${new URLSearchParams(queryFor(draft)).toString()}`;
}

/**
 * What it will be CALLED, before it exists.
 *
 * The only part of an export that survives on somebody's disk, so it is
 * worth showing before the file rather than after. Uses the same two
 * helpers the route does, so the shown name is the real one.
 */
function fileNameFor(draft) {
  const scope = exportScope([], draft.groups);
  // WITH THE METHOD, because her draft carries one and `queryFor` sends
  // it. Without it she names a crypto run after the bank sheet it is
  // shaped like, and says a filename the download does not use.
  const label = fileLabelOf(templateFor(draft.template), draft.method);
  const base = exportFileName(scope, label, draft.month);
  return draft.multiFile && draft.groups.length !== 1 ? `${base}.zip` : `${base}.xlsx`;
}

module.exports = {
  normalise, queryFor, linkFor, fileNameFor, columnsFor, columnKeysFor,
  PRESET_FOR_TEMPLATE, METHOD_ONLY,
  TEMPLATE_IDS, DESIGN_IDS, COLOR_IDS,
};
