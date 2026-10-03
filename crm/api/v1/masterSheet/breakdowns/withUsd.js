const { isAway } = require('../../shared/awayLocations.helper');
const { fillsFor } = require('./palette');
const { adjustmentLabel } = require('../../shared/rates.helper');
// Shared with Diane: one definition, or her figure and this file drift.
const { toUsd, AED_PER_USD } = require('../../shared/toUsd.helper');

/**
 * THE BOSS'S "ATTACH 1": the same breakdown, converted, and told where the
 * money goes.
 *
 * Standard answers "how much, in what, by which method". This answers the
 * two questions that come next and that he currently rebuilds by hand every
 * month: what is all of it worth in one currency, and how much of the cash
 * has to leave the country.
 *
 * Two pivots side by side, the same money cut twice, exactly as his sheet
 * lays it out:
 *
 *   left  (cols 1-3)   currency -> method,  with a per-currency total
 *   right (cols 5-7)   method -> location -> currency
 *
 * They must reconcile: the right pivot's GBP cash lines add up to the left
 * pivot's GBP Cash cell. Both are read from the SAME `breakdown` object
 * that `standard` uses, so they cannot drift by one filtering differently.
 *
 * ---- on blending currencies ----
 * groupTables.js says a method total is per currency and never blended,
 * because GBP plus AED is a number that means nothing. That rule still
 * holds here and this does not break it: the native figure and the
 * converted figure sit in adjacent columns and both rates are printed at
 * the foot. The blend is shown being made rather than asserted. Remove the
 * native column and this becomes exactly what that rule forbids.
 */

/**
 * TWO RATES, AND ONLY ONE OF THEM IS A RATE.
 *
 * AED is pegged to the dollar at 3.6725 and has been since 1997, so it does
 * not float and must not sit in the same input as GBP. His own sheet prints
 * one cell reading 1.36 while using both; both are named and printed here.
 *
 * GBP goes stale, so it is overridable per export. The constant is the
 * fallback, never the intended answer for a real payout run.
 */
const USD_PER_GBP = 1.362553;

const USD_FMT = '$#,##0.00';
const GBP_FMT = '£#,##0.00';
const NUM_FMT = '#,##0.00';
// SIX DECIMALS. The conversions already use the full rate; printing 1.36
// meant nobody could reproduce a figure by hand and be within 20 dollars.
const RATE_FMT = '#,##0.000000';

// Left pivot at column 1, right at column 5. The gap is his own layout and
// it is what lets the two read as separate answers rather than one wide
// table. Both sit inside the sheet's existing width.
const LEFT = 1;
const RIGHT = 5;
const HEADERS = ['Row Labels', 'Sum of Payable amount:', 'Converted to USD'];

// What the sheet says the rate is, beside the rate. `fallback` is named as
// such on purpose: it is a stale constant, and a reader deserves to know
// they are looking at one rather than at today's market.
// Beside the rate. The provenance used to be spelled out in brackets
// ('live mid-market', 'FALLBACK'); the boss reads this block every month
// and did not want the commentary, so the label is the unit alone.
const RATE_LABEL = 'USD per GBP';

/**
 * THREE WEIGHTS, AND NOTHING ELSE, so the eye can rank a block at a
 * glance rather than learn a key.
 *
 *   head   a heading, or a figure somebody signs.
 *   soft   a total, or a line that supports one.
 *   faint  barely there. Grouping rows, so the figures stand out from the
 *          labels that organise them.
 *
 * More than three would be decoration. The rule is that colour means
 * IMPORTANCE here, never category: a reader should be able to find the
 * numbers that matter without being told what each shade stands for.
 *
 * The three arrive from palette.js as a PAIR the admin picked, so the
 * block can be printed in any of five colours without any combination of
 * them being unreadable.
 */

/**
 * Locations that are not a PLACE, they are the absence of one.
 *
 * Four rows carry the word 'Away' in their Location column, from the days
 * when away was typed rather than worked out. They still count toward the
 * Away subtotal; they just have nothing to name underneath it.
 */
const UNPLACED = new Set(['away', '(no location)', '']);

const round = (n) => Math.round(n * 100) / 100;

/**
 * PADDING, AS FAR AS A SPREADSHEET HAS ANY.
 *
 * There is no cell padding in xlsx. `indent` is the only equivalent, it is
 * measured in character widths, and Excel APPLIES IT ONLY WHEN HORIZONTAL
 * ALIGNMENT IS SET: on a default-aligned cell it is silently ignored,
 * which is why figures were sitting hard against the gridline.
 *
 * So alignment is always stated. Labels left with their nesting indent
 * plus one, figures right with one, and everything gets a little air at
 * the top and bottom from the row height set by the caller.
 */
const PAD = 1;

/**
 * The three writers, bound to one colour pair.
 *
 * A FACTORY rather than module constants, because the colours are now a
 * choice made per export. Module-level mutable fills would be a shared
 * value in a process that can render two exports at once.
 */
function painter(fills) {
  const BOX = {
    top: fills.edge, left: fills.edge, bottom: fills.edge, right: fills.edge,
  };


  function put(sheet, r, c, value, { fmt, bold, fill, indent = 0, align } = {}) {
  const cell = sheet.getCell(r, c);
  if (value !== undefined && value !== null) cell.value = value;
  if (fmt) cell.numFmt = fmt;
  // WHITE ON THE DARK STEP, decided here rather than at the eight call
  // sites that paint with it. `head` went dark with the palette, and a cell
  // keeping the default black type is a black word on a dark ground.
  const onHead = fill === fills.head;
  if (bold || onHead) {
    cell.font = onHead
      ? { bold: Boolean(bold), color: fills.headText }
      : { bold: true };
  }
  if (fill) cell.fill = fill;
  cell.alignment = {
    horizontal: align ?? 'left',
    vertical: 'middle',
    indent: indent + PAD,
  };
  cell.border = BOX;
  return cell;
}

  /** Three bordered cells: a label and its two figures. */
  function line(sheet, r, col, label, { native, usd, bold, indent, fill } = {}) {
  put(sheet, r, col, label, { bold, indent, fill });
  put(sheet, r, col + 1, native === undefined ? null : round(native), { fmt: NUM_FMT, bold, fill, align: 'right' });
  put(sheet, r, col + 2, usd === undefined ? null : round(usd), { fmt: USD_FMT, bold, fill, align: 'right' });
  return r + 1;
}

  function header(sheet, r, col) {
    HEADERS.forEach((h, i) => put(sheet, r, col + i, h, { bold: true, fill: fills.head }));
    return r + 1;
  }

  return { put, line, header, fills };
}

/**
 * Everything the two pivots and the summary need, counted once.
 *
 * Walks `breakdown.methods`, which is already method -> location ->
 * currency, so nothing is re-derived from the rows and the block cannot
 * disagree with the standard design about what is in it.
 */
function totals(breakdown, usdPerGbp, localLocations, perUsd) {
  const byCurrency = new Map(); // currency -> method -> { native, usd }
  const methodUsd = new Map();  // method -> usd
  let awayUsd = 0;
  let localUsd = 0;
  let awayGbp = 0;
  const noRate = new Set();

  for (const m of breakdown.methods) {
    for (const loc of m.locations) {
      for (const l of loc.lines) {
        // NET, not gross. Every figure below is one somebody acts on: what
        // to send, what stays local, what the run costs. This read l.total
        // alone, so the block printed an add on row and then totalled
        // without it, which is the wrong figure for the one question a rate
        // answers. The right pivot's net lines are what add up to the left
        // pivot's cell. Adjustments are folded into that net value here.
        // ALREADY NET. The rates live on the Monthly amount now, so the
        // line arrives with them inside it; re-adding the parts here would
        // charge every rate twice. It read `total + addon + crypto - fee`
        // while the lines were raw.
        const net = l.total;
        const usd = toUsd(net, l.currency, usdPerGbp, perUsd);
        if (usd === null) noRate.add(l.currency);
        const u = usd ?? 0;

        if (!byCurrency.has(l.currency)) byCurrency.set(l.currency, new Map());
        const cur = byCurrency.get(l.currency).get(m.method) ?? { native: 0, usd: 0 };
        byCurrency.get(l.currency).set(m.method, { native: cur.native + net, usd: cur.usd + u });

        methodUsd.set(m.method, (methodUsd.get(m.method) ?? 0) + u);

        // THE SPLIT IS ON CASH ONLY. A transfer has no notes to carry
        // anywhere, so counting it would make "of which UK" answer a
        // question nobody asked.
        if (/cash/i.test(m.method)) {
          if (isAway(loc.location, localLocations)) {
            awayUsd += u;
            if (String(l.currency).toUpperCase() === 'GBP') awayGbp += net;
          } else {
            localUsd += u;
          }
        }
      }
    }
  }
  return { byCurrency, methodUsd, awayUsd, localUsd, awayGbp, noRate: [...noRate] };
}

module.exports = {
  // Exported for the tests: it is money arithmetic on a payout document.
  id: 'with-usd',
  // Diane's historical group report uses the exact same arithmetic as the
  // workbook answer block. Keeping this public prevents the chat and the
  // downloaded sheet from growing separate definitions of bank, cash,
  // crypto, local cash and UK/away cash.
  totals,
  // 'Bank Transfer' in the pivots, as his own attach 1 writes it. The
  // summary block below still shortens it to 'Bank': that is his too.
  methodStyle: 'long',
  label: 'Advance',
  description:
    'Both pivots side by side with a USD column, the rates printed, and the cash split '
    + 'into what stays local and what has to be sent. Converted to USD. Turn on the '
    + 'percentages table to name every add on and fee in a block of its own.',

  write(ctx, breakdown, opts = {}) {
    const { sheet } = ctx;
    if (breakdown.methods.length === 0) return;

    const usdPerGbp = Number(opts.usdRate) > 0 ? Number(opts.usdRate) : USD_PER_GBP;
    const { put, line, header, fills } = painter(fillsFor(opts.primaryColor, opts.secondaryColor));
    const perUsd = opts.perUsd ?? {};
    const t = totals(breakdown, usdPerGbp, opts.localLocations, perUsd);

    // Absolute rows, because the two pivots run down the sheet in parallel
    // and addRow() can only append one of them.
    const top = sheet.rowCount + 3;

    // ---- left: currency, then method ----
    let r = header(sheet, top, LEFT);
    for (const currency of [...t.byCurrency.keys()].sort()) {
      r = line(sheet, r, LEFT, currency, { bold: true, fill: fills.faint });
      // A currency with no rate shows BLANK, not $0.00. Zero on a payout
      // document reads as "worth nothing" rather than "not converted", and
      // it is the same lie the null in toUsd exists to avoid.
      const rated = !t.noRate.includes(currency);
      let native = 0;
      let usd = 0;
      const methods = [...t.byCurrency.get(currency).keys()].sort();
      for (const method of methods) {
        const v = t.byCurrency.get(currency).get(method);
        native += v.native;
        usd += v.usd;
        r = line(sheet, r, LEFT, method, {
          native: v.native, usd: rated ? v.usd : undefined, indent: 2,
        });
      }
      r = line(sheet, r, LEFT, `${currency} Total`, {
        native, usd: rated ? usd : undefined, bold: true, fill: fills.soft,
      });
    }

    // ---- left: one USD figure per method ----
    r += 1;
    put(sheet, r, LEFT, null, { fill: fills.head });
    put(sheet, r, LEFT + 1, 'USD', { bold: true, fill: fills.head });
    r += 1;
    for (const method of [...t.methodUsd.keys()].sort()) {
      put(sheet, r, LEFT, /bank/i.test(method) ? 'Bank' : method, { bold: true, fill: fills.soft });
      put(sheet, r, LEFT + 1, round(t.methodUsd.get(method)), { fmt: USD_FMT, bold: true, fill: fills.soft, align: 'right' });
      r += 1;
    }

    // Crypto charges, like add ons and fees, are already inside every net
    // method total above. The transparent tabled design names them below;
    // the plain design keeps them folded into its figures.

    // ---- left: the rates, printed ----
    // A document that converts money has to say what it converted at, or
    // the figures cannot be checked next month.
    r += 2;
    put(sheet, r, LEFT, 'Rate', { bold: true, fill: fills.faint });
    put(sheet, r, LEFT + 1, usdPerGbp, { fmt: RATE_FMT, fill: fills.faint, align: 'right' });
    // WHERE THE RATE CAME FROM, on the sheet itself. A converted figure
    // whose rate has no provenance cannot be checked next month, and
    // "live" and "the fallback because the feed was down" are worth
    // telling apart when somebody is reconciling a payment.
    sheet.getCell(r, LEFT + 2).value = RATE_LABEL;
    r += 1;
    put(sheet, r, LEFT, null, { fill: fills.faint });
    put(sheet, r, LEFT + 1, AED_PER_USD, { fmt: RATE_FMT, fill: fills.faint, align: 'right' });
    sheet.getCell(r, LEFT + 2).value = 'AED per USD';
    const leftEnd = r;

    // ---- right: method, then location, then currency ----
    /**
     * AWAY IS A COMPUTED HEADING, AND ONLY UNDER CASH.
     *
     * "Away" used to appear only because four rows literally have the word
     * in their Location column, so it drew on INDIGO and MILKMAN and was
     * simply absent from NEXUS, ALL GROUPS and MANBAT. That reads as a
     * missing figure when it is really a missing spelling, and it meant a
     * rename could move money to the wrong side. It now comes from the
     * SETTINGS LOCAL LIST, so every group gets one whatever its places are
     * called, and it PRINTS EVEN WHEN EMPTY: "nothing is going out" is an
     * answer, and a line that is sometimes there is one nobody can look for
     * in the same place twice.
     *
     * CASH ONLY, matching the summary block's own rule. A transfer has no
     * notes to carry anywhere, so splitting it by where the money "goes"
     * answers a question nobody asked. Bank and crypto list their
     * locations plainly.
     *
     * THERE IS NO "LOCAL" HEADING. Local is the default and needs no
     * announcing: those locations sit directly under Cash, and Away is the
     * one exception worth naming. A pair of headings made the common case
     * look like a special case.
     */
    let q = header(sheet, top, RIGHT);
    for (const m of breakdown.methods) {
      q = line(sheet, q, RIGHT, m.method, { bold: true, fill: fills.head });

      const splits = /cash/i.test(m.method);
      const writeLocation = (loc, depth) => {
        // A row whose location IS the word "Away" has no place to name: it
        // already says "not here". Printing it would read as "Away, of
        // which Away", so it contributes its money and gets no line.
        if (UNPLACED.has(loc.location.trim().toLowerCase())) return;
        q = line(sheet, q, RIGHT, loc.location, { indent: depth });
        for (const l of loc.lines) {
          // The plain design shows the final net amount directly. The
          // tabled design keeps the gross line and lists each adjustment in
          // its dedicated block below so that readers can reconcile it.
          // ONE FIGURE EITHER WAY. The toggle used to choose between the
          // gross line and the net one, because the rates were added at the
          // foot. They are inside the amount now, so there is no gross to
          // show: the switch only decides whether the named blocks BELOW
          // are drawn.
          const shown = l.total;
          q = line(sheet, q, RIGHT, l.currency, {
            native: shown,
            usd: toUsd(shown, l.currency, usdPerGbp, perUsd) ?? undefined,
            indent: depth + 2,
          });

          // Add ons and fees are already included in the net totals used by
          // both pivots and the answer block. The plain Converted to USD
          // design intentionally keeps those adjustments out of the detail
          // rows; the separate with-usd-table design is the transparent
          // option when the admin wants them named individually.
        }
      };

      if (!splits) {
        for (const loc of m.locations) writeLocation(loc, 1);
        continue;
      }

      const away = (loc) => isAway(loc.location, opts.localLocations);
      for (const loc of m.locations.filter((l) => !away(l))) writeLocation(loc, 1);

      q = line(sheet, q, RIGHT, 'Away', { bold: true, indent: 1, fill: fills.soft });
      for (const loc of m.locations.filter(away)) writeLocation(loc, 2);
    }

    // ---- right: add ons and fees, for the transparent tabled design ----
    // The plain Converted to USD design stops at the net totals above. The
    // tabled variant opts into this block so every adjustment is named once,
    // grouped by type, above the totals that contain it.
    if (opts.adjustmentsInTable) {
      const found = { addon: [], crypto: [], fee: [] };
      for (const m of breakdown.methods) {
        for (const loc of m.locations) {
          for (const l of loc.lines) {
            for (const a of l.adjustments ?? []) found[a.kind].push({ ...a, currency: l.currency });
          }
        }
      }

      // CRYPTO IS ITS OWN BLOCK, between the two. An add on is what a
      // PERSON costs; a crypto charge is what the RAIL costs, and the two
      // answer different questions even though both add.
      const BLOCKS = [['addon', 'Add ons'], ['crypto', 'Crypto charges'], ['fee', 'Fees']];
      for (const [kind, heading] of BLOCKS) {
        if (found[kind].length === 0) continue;
        q += 1;
        // PRIMARY OWNS THE HEADINGS. This is a block heading, level with
        // the method headings and Total bank, so it takes `head`. On soft
        // it read as uncoloured beside them whenever the secondary is grey.
        q = line(sheet, q, RIGHT, heading, { bold: true, fill: fills.head });
        for (const a of found[kind]) {
          const signed = kind === 'fee' ? -a.value : a.value;
          q = line(sheet, q, RIGHT, adjustmentLabel(a, { withKind: false }), {
            native: signed,
            usd: (toUsd(a.value, a.currency, usdPerGbp, perUsd) ?? 0) * Math.sign(signed) || undefined,
            indent: 1,
            fill: fills.faint,
          });
        }
      }
    }

    // ---- right: the answer block ----
    /**
     * ===============================
     * * Every METHOD, then the cash split
     * ===============================
     *
     * Bank, cash and crypto are the three rails, and each stands alone.
     * CRYPTO WAS MISSING: the left pivot printed "Crypto $1,160.90" and the
     * answer block beside it named only bank and cash, so the one place
     * somebody reads before paying was short by a whole method.
     *
     * Only when the group HAS a crypto row. A zero line on every other
     * group is a row that has to be read and dismissed each time.
     *
     * "Of which UK" and "Of which other" are untouched by this: they split
     * the CASH total in half and must still sum back to it. Crypto is not
     * cash and never was, which is why it goes ABOVE them rather than
     * between them.
     */
    q += 1;
    const methodUsd = (re) => [...t.methodUsd.entries()].find(([m]) => re.test(m));
    const bank = methodUsd(/bank/i)?.[1] ?? 0;
    const cash = methodUsd(/cash/i)?.[1] ?? 0;
    const crypto = methodUsd(/crypto/i);

    const summary = [
      ['Total bank', bank, fills.head],
      ['Total Cash', cash, fills.head],
      // Present, not merely non-zero: a group paying in coin that nets to
      // nothing this month still has the rail, and the reader should see it.
      ...(crypto ? [['Total Crypto', crypto[1] ?? 0, fills.head]] : []),
      ['Of which UK', t.awayUsd, fills.soft],
      ['Of which other', t.localUsd, fills.soft],
    ];
    for (const [label, value, fill] of summary) {
      put(sheet, q, RIGHT + 1, label, { bold: true, fill });
      put(sheet, q, RIGHT + 2, round(value), { fmt: USD_FMT, bold: true, fill, align: 'right' });
      q += 1;
    }

    // The only figure that goes back into pounds: what actually gets sent,
    // in the currency it gets sent in. Nobody can hand over a USD
    // equivalent.
    q += 1;
    put(sheet, q, RIGHT + 1, 'UK send in GBP', { bold: true, fill: fills.head });
    put(sheet, q, RIGHT + 2, round(t.awayGbp), { fmt: GBP_FMT, bold: true, fill: fills.soft, align: 'right' });
    q += 1;

    // NAMED, NOT SWALLOWED. A currency with no rate contributed nothing to
    // any USD figure above, and one blank cell is not enough warning on a
    // document somebody pays from.
    if (t.noRate.length > 0) {
      q += 1;
      const note = sheet.getCell(q, RIGHT + 1);
      note.value = `No USD rate for ${t.noRate.join(', ')}. `
        + 'Those rows are NOT in any converted figure above.';
      note.font = { bold: true, size: 9, color: { argb: 'FFB4501E' } };
      q += 1;
    }

    // Leave the cursor below whichever pivot ran longer, so anything the
    // workbook writes after this does not land on top of it.
    const end = Math.max(leftEnd, q);
    while (sheet.rowCount < end) sheet.addRow({});
  },
};
