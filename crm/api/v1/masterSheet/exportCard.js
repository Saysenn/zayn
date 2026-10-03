const { previewExport, rowsFor } = require('./exportQuery');
const { listExportColumns, presetFileWord } = require('./buildWorkbook');
const { listPayoutColumns } = require('./buildPayoutSheet');
const { exportFileName, exportScope } = require('../shared/exportFileName.helper');
const { templateFor, fileLabelOf } = require('../templates/xlsx');

// ***************************************************
// * The export card, built from the QUERY alone
// ***************************************************
//
// Diane's tool draws it and a route redraws it, so it is defined once. The
// query is the whole input, which is what lets the card be REBUILT rather
// than remembered.
//
// NOTHING HERE IS EVER STORED. The card the browser shows after a reload
// is not the one it had; it is a fresh one off the same query, because a
// remembered count is a count that has stopped being true. See
// docs/plans/diane-export.md.

// Five real rows is enough to recognise the document and few enough to
// read at a glance.
const PREVIEW_ROWS = 5;

/** The columns the FILE will carry, in the document's own order. */
function columnsFor(query) {
  const all = listPayoutColumns(query.template) ?? listExportColumns();
  if (!query.columns) return all;
  const wanted = new Set(String(query.columns).split(',').map((c) => c.trim()).filter(Boolean));
  return all.filter((c) => c.required || wanted.has(c.key));
}

/** What it will be called, before it exists. The route's own two helpers. */
function fileNameFor(query) {
  const groups = String(query.group ?? '').split(',').filter(Boolean);
  const people = String(query.personId ?? '').split(',').filter(Boolean);
  const base = exportFileName(
    exportScope(people, groups),
    // THE METHOD TOO, or the card predicts a name the download does not
    // use. This helper exists to say what the file will be called, so it
    // has to take the same query the route does.
    fileLabelOf(templateFor(query.template), presetFileWord(query.sheetPreset) ?? query.method),
    query.month,
  );
  return query.multiFile === 'true' && groups.length !== 1 ? `${base}.zip` : `${base}.xlsx`;
}

/**
 * Everything the card draws, in one round trip.
 *
 * @param {object} query  the same object `/export/xlsx` takes
 */
async function exportCardFor(query) {
  const [preview, sample] = await Promise.all([previewExport(query), rowsFor(query)]);
  const columns = columnsFor(query);

  return {
    preview,
    columns: columns.map(({ key, header }) => ({ key, header })),
    // Only the shown columns, so the preview cannot display a field the
    // file will not carry.
    rows: sample.rows.slice(0, PREVIEW_ROWS).map((r) => Object.fromEntries(
      columns.map((c) => [c.key, r[c.key] ?? null]),
    )),
    fileName: fileNameFor(query),
  };
}

module.exports = { exportCardFor, columnsFor, fileNameFor, PREVIEW_ROWS };
