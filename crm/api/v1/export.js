const { Router } = require('express');
const companiesRepo = require('./repos/companies.repo');
const { listTemplates, templateFor, fileLabelOf } = require('./templates/xlsx');
const { listBreakdownDesigns, DEFAULT_ID: DEFAULT_BREAKDOWN } = require('./masterSheet/breakdowns');
const {
  listPaletteColors, DEFAULT_PRIMARY, DEFAULT_SECONDARY,
} = require('./masterSheet/breakdowns/palette');
// His four named column sets, defined beside the columns they name.
const { listSheetPresets, presetFileWord } = require('./masterSheet/buildWorkbook');
const settingsRepo = require('./repos/settings.repo');
const peopleRepo = require('./repos/people.repo');
const fxRates = require('./shared/fxRates.helper');
const { listExportColumns } = require('./masterSheet/buildWorkbook');
const { listPayoutColumns } = require('./masterSheet/buildPayoutSheet');
// THE ONE READER of what an export contains. See exportQuery.js: this
// router and Diane's tool both go through it, so a count and a build can
// never have run different filters.
const {
  PRESETS, presetFor, layoutOptions, rowsFor, previewExport,
} = require('./masterSheet/exportQuery');
const { exportCardFor } = require('./masterSheet/exportCard');
const { exportFileName, exportScope } = require('./shared/exportFileName.helper');
const { rowsByGroup } = require('./shared/rowsByGroup.helper');
const { AppError } = require('./middlewares/errors');
const { messages } = require('./shared/messages');

/**
 * Export — what replaced the Calculator page.
 *
 * The calculator's whole visible output was four xlsx files. Those files
 * survive here as PRESETS: a preset is a filter plus a grouping, nothing
 * more, so the boss still receives exactly what he received before while
 * everything else the user asked for (one person, a filtered slice, PDF)
 * becomes possible with the same machinery.
 *
 *   expensing   everyone, in the master sheet's own shape
 *   cash        payment_method = 'cash'
 *   bank        payment_method = 'bank'
 *   admin       staff roles only
 *   breakdown   what each person earns this month, per company handled,
 *               with their bank details and the arithmetic shown
 *
 * The LAYOUT is separate from the filter. Any preset renders either as the
 * master sheet (one row per deal, the boss's own columns) or as a
 * breakdown (grouped by person, each company they handle listed under
 * them with a total). A person export is always a breakdown — "here is
 * the whole sheet, filtered to you" answers nothing.
 *
 * PDF is deliberately not a server library. It is print-styled HTML the
 * browser turns into a PDF — no new dependency, and the layout is the one
 * already on the person detail page.
 */

const router = Router();

// THE PRESETS, THE FILTERS, THE MONTH AND THE COUNT ALL MOVED to
// masterSheet/exportQuery.js when Diane learned to export. This router was
// their only reader; a second one would have meant a second copy, and two
// answers to "how many rows are in this file" is the one thing a payout
// export cannot have. Nothing about them changed on the way out.

// A ZIP because a browser will not accept several downloads from one click.
// Moved to shared/ on 2026-09-14 when the expenses export needed the same
// thing; the fixed timestamp reasoning went with it. The split itself is
// rowsByGroup, also in shared/.
const { zipBuffer } = require('./shared/zipBuffer.helper');

/**
 * A finished file, with its length declared.
 *
 * Content-Length is the whole point: without it the response is chunked,
 * the browser's `lengthComputable` is false, and a download bar has nothing
 * to measure. The export modal shows a real percentage off this.
 */
/**
 * ===============================
 * * WHAT IS IN THE FILE TRAVELS WITH THE FILE
 * ===============================
 *
 * Diane announced a bank run over every group, 21 rows and 18 people, as
 * "BANK - 2026-09.zip is yours: 3 rows, 3 people". The file was right. The
 * numbers were the previous export's, read out of a client side cache that
 * had not caught up.
 *
 * A COUNT DERIVED ANYWHERE BUT HERE CAN DISAGREE WITH THE FILE. Guarding
 * the cache would fix that render; the next state variable, or the next
 * ordering change, brings it back. So the counts are computed from the rows
 * this response was BUILT from, and ride on the response. Nothing on the
 * client is consulted, so nothing on the client can be stale.
 */
function sendFile(res, body, filename, contentType, counts = null) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', body.length);
  if (counts) {
    res.setHeader('X-Row-Count', String(counts.rows));
    res.setHeader('X-People-Count', String(counts.people));
  }
  // The browser cannot read these off a same-origin XHR without this: the
  // modal downloads via XHR to draw progress, and it needs the server's own
  // filename and counts rather than inventing a second set that would drift.
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Row-Count, X-People-Count');
  res.end(body);
}

/** Counted off the rows the workbook was built from, never off a query. */
const countsOf = (rows) => ({
  rows: rows.length,
  people: new Set(rows.map((r) => String(r.person_id ?? r.person_name ?? '').trim().toLowerCase())
    .filter(Boolean)).size,
});

// How many rows an export would contain, so the modal can say so before
// anyone commits to generating it. THE SAME CALL DIANE MAKES, so her panel
// and this one cannot disagree about what is in the file.
router.get('/export/count', async (req, res, next) => {
  try {
    res.json(await previewExport(req.query));
  } catch (err) {
    next(err);
  }
});

/**
 * THE EXPORT CARD, REBUILT FROM ITS QUERY.
 *
 * Diane's card survives a page reload and refreshes when the sheet
 * changes, and it does both by being rebuilt rather than remembered. The
 * browser keeps the CONFIG; the counts, the warnings and the five preview
 * rows come from here every time.
 *
 * A REMEMBERED COUNT IS A COUNT THAT HAS STOPPED BEING TRUE. Somebody
 * edits a row while the card sits on screen and a stored figure would be
 * quietly wrong on a document about to be sent.
 *
 * Same builder her tool uses, so a refreshed card cannot differ from the
 * one she drew.
 */
router.get('/export/card', async (req, res, next) => {
  try {
    res.json(await exportCardFor(req.query));
  } catch (err) {
    next(err);
  }
});

// The layouts the Export modal offers. Served rather than hardcoded in
// the modal so adding a template is one file in v1/templates/xlsx/ and
// nothing in crm/web. The PDF layouts are the web app's own — they render
// in the browser and never reach this server.
router.get('/export/templates', (req, res) => {
  res.json({ templates: listTemplates() });
});

// The breakdown DESIGNS, for the picker on the month tab. Same reasoning
// as templates above: served, so adding one is a file in
// v1/masterSheet/breakdowns/ and a preview component in crm/web, never a
// list typed out in both places and left to drift.
router.get('/export/breakdown-designs', (req, res) => {
  // The palette rides along: the picker draws both, and two requests for
  // one control is two chances for them to disagree about what exists.
  // THE DEFAULT IS SERVED, never typed again in the modal. Two copies of
  // it drift the moment either side changes, and the modal would open on a
  // design the export no longer defaults to.
  // THE COLOURS' DEFAULTS RIDE ALONG for the same reason the design's
  // does. The modal typed 'orange' and 'grey' of its own, so the picker
  // opened on one colour while an export that sent none took another.
  res.json({
    designs: listBreakdownDesigns(),
    defaultId: DEFAULT_BREAKDOWN,
    colors: listPaletteColors(),
    defaultColor: DEFAULT_PRIMARY,
    defaultSecondary: DEFAULT_SECONDARY,
  });
});

// Which columns the two master-sheet layouts can carry, and which they can
// never drop. Served rather than typed out again in the modal, so adding a
// column to buildWorkbook's list is one file.
router.get('/export/columns', async (req, res, next) => {
  try {
  // Per TEMPLATE, because the payout sheets have their own vocabulary for
  // the same fields: one `payable_amount` is "Payable amount" on Expensing,
  // "Amount" on Cash and "Amount payable" on Bank, and the picker has to
  // offer the name the reader of that document knows. Absent means the
  // master sheet, which is what every existing caller means.
    // WHICH COLUMNS COME PRESELECTED depends on one setting: with the end
    // date deciding what a month owes, a file without that column shows a
    // red payment start and no reason for it. The payout templates have
    // their own sets and do not take part.
    const useEndDate = Boolean((await settingsRepo.get()).color_uses_end_date);
    /**
     * THE PRESETS RIDE ALONG, for the same reason the palette does on the
     * designs route: two requests for one control is two chances for them
     * to disagree about what exists. Master sheet only, because they are
     * ITS four documents; a payout sheet already IS one of them.
     */
    const payout = listPayoutColumns(req.query.template);
    res.json({
      columns: payout ?? listExportColumns({ useEndDate }),
      presets: payout ? [] : listSheetPresets({ useEndDate }),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/export/xlsx', async (req, res, next) => {
  try {
    const { rows } = await rowsFor(req.query);
    if (rows.length === 0) return next(new AppError(404, messages.nothingMatches));

    // WHICH LAYOUT, in precedence order.
    //
    // ONE person with no template asked for gets the breakdown: the
    // master-sheet shape filtered to one person answers nothing. A preset
    // that names a layout gets it. Only after those does ?template= apply,
    // so a person export cannot land in a shape that does not answer its
    // question. Unknown ids fall back in the registry rather than 400ing on
    // a stale link.
    //
    // SEVERAL PEOPLE DO NOT FORCE IT, and neither does one who was asked for
    // in a named layout. A Bank run narrowed to nine people is still a Bank
    // run, and forcing the breakdown on it would hand over the wrong
    // document. This read `Boolean(req.query.personId)` while a person
    // export could only ever mean "explain this one person's figure".
    const people = String(req.query.personId ?? '').split(',').filter(Boolean);
    const onePerson = people.length === 1 && !req.query.template;
    // `presetFor`, not a bare `preset`: that name was never declared in
    // this handler, so EVERY export threw a ReferenceError before it built
    // anything. The client caught it, said "that one would not build on my
    // end", and Diane then announced the file as downloading in the same
    // breath, because her turn was already in flight.
    const forced = onePerson || presetFor(req.query.preset).layout === 'breakdown';
    // Tier is the one thing on a per-group tab that is NOT a reading of
    // the deal rows: it lives on tb_companies, so it is fetched here and
    // handed to the builder rather than the builder reaching for a repo.
    const template = templateFor(forced ? 'breakdown' : req.query.template);
    // localLocations is read here rather than inside the design, so the
    // designs stay pure layout with no database of their own.
    const layout = layoutOptions(req.query);

    // A TYPED RATE ALWAYS WINS. The live one is mid-market and the admin's
    // is what they were actually quoted, so looking one up when they have
    // already said would overrule a person with an average.
    const fx = layout.usdRate ? null : await fxRates.usdPerGbp();

    // localLocations and the rate are read here rather than inside the
    // design, so a breakdown design stays pure layout with no database and
    // no network of its own.
    const opts = {
      ...layout,
      tiers: await companiesRepo.tierMap(),
      localLocations: await settingsRepo.localLocations(),
      // Whether the end date takes part in the payment start colour.
      colorUsesEndDate: (await settingsRepo.get()).color_uses_end_date,
      // Standing rates per person: add ons up, fees down.
      rates: await peopleRepo.rateMap(),
      // The exchange's two cuts on a crypto run. Settings, not a constant:
      // two rates it can renegotiate are config.
      // What a crypto payment costs us in gas, added to those rows.
      cryptoPercent: await settingsRepo.cryptoPercent(),
      usdRate: layout.usdRate ?? fx?.usdPerGbp,
      usdRateSource: layout.usdRate ? 'typed' : fx?.source,
      usdRateAsOf: fx?.asOf ?? null,
      // The whole table, so a currency the sheet happens to use converts
      // without anyone adding it to a list by hand. A typed GBP rate does
      // not stop the other currencies resolving.
      perUsd: fx?.perUsd ?? (await fxRates.usdPerGbp()).perUsd,
    };

    // A rolled sheet is named for the month it is FOR, not the day it was
    // generated. Two August sheets made a week apart are the same run, and
    // dating them by today would file them as different ones.
    const rolledTo = rows[0]?.rolled_to;
    const stamp = rolledTo ?? new Date().toISOString().slice(0, 10);
    const groups = String(req.query.group ?? '').split(',').filter(Boolean);
    // THE CHOSEN DOCUMENT IS PART OF THE NAME. Four runs of one sheet
    // must not share a filename. The preset first, because Standard is a
    // document and carries no method; the method behind it, for a caller
    // that sends one without a preset, which is Diane's crypto run.
    const label = fileLabelOf(template, presetFileWord(req.query.sheetPreset) ?? req.query.method);

    // ONE FILE PER GROUP, only when there is more than one group to split.
    // Asking for it on a single-group selection is not an error, it just
    // has nothing to do, and a zip holding one file is worse than the file.
    const byGroup = req.query.multiFile === 'true' ? rowsByGroup(rows) : null;
    if (byGroup && byGroup.size > 1) {
      // EVERY WORKBOOK IS BUILT BEFORE ANYTHING IS SENT. Once the first
      // byte of a zip is on the wire the status is 200 and the error
      // handler cannot answer any more, so a builder throwing half way
      // through would hand over a truncated archive that opens as a
      // corrupt file. Five groups of a few hundred KB is nothing to hold.
      const files = [];
      for (const [groupName, groupRows] of byGroup) {
        const wb = template.build(groupRows, opts);
        files.push({
          name: `${exportFileName(groupName, label, stamp)}.xlsx`,
          body: Buffer.from(await wb.xlsx.writeBuffer()),
        });
      }

      // FINISHED INTO A BUFFER, NOT PIPED AT THE RESPONSE.
      //
      // Two reasons, and the second is the one that shows. A throw now
      // happens before any header is sent, so the error handler can still
      // answer with JSON instead of the socket dying mid archive. And a
      // complete buffer has a LENGTH, so the response carries
      // Content-Length and the browser can report real download progress;
      // a piped archive is chunked, `lengthComputable` is false, and the
      // bar has nothing to fill against.
      const body = await zipBuffer(files);
      const zipName = exportFileName(exportScope(people, []), label, stamp);
      // Counted across every file in the archive, which is what the admin
      // asked for: one export, however many workbooks it arrives in.
      return sendFile(res, body, `${zipName}.zip`, 'application/zip', countsOf(rows));
    }

    const wb = template.build(rows, opts);
    const name = exportFileName(exportScope(people, groups), label, stamp);
    // Buffered for the same reason: a length is what makes the progress
    // bar honest, and a month sheet is a few hundred KB.
    return sendFile(
      res,
      Buffer.from(await wb.xlsx.writeBuffer()),
      `${name}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      countsOf(rows),
    );
  } catch (err) {
    next(err);
  }
});

// The rows behind an export, as JSON — what the PDF view renders from, so
// the printed page and the spreadsheet can never disagree about the
// figures.
router.get('/export/rows', async (req, res, next) => {
  try {
    const { rows, stats } = await rowsFor(req.query);
    // `?limit=` is for a SAMPLE, and only Diane's panel asks for one: it
    // draws three real rows and redraws them on every tick, so pulling the
    // whole set each time to show three is work nobody uses. The print
    // page sends no limit and still gets everything.
    //
    // TOTAL COUNTS ARE UNAFFECTED. `month` is computed off the full set
    // above and the slice happens after, so a limited request can never
    // report a smaller month than the file will contain.
    const limit = Number(req.query.limit);
    const sent = Number.isInteger(limit) && limit > 0 ? rows.slice(0, limit) : rows;
    // The layout options travel with the rows so the print view draws the
    // same shape the spreadsheet would, off the same one reader.
    res.json({
      rows: sent,
      // The TRUE total, always, so a sample can never read as the whole
      // set. A cap you cannot see is the bug.
      total: rows.length,
      preset: req.query.preset ?? 'expensing',
      month: stats,
      layout: layoutOptions(req.query),
    });
  } catch (err) {
    next(err);
  }
});

// PRESETS now lives in masterSheet/exportQuery.js, which is where both
// this router and Diane read it from.
module.exports = { router };
