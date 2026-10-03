const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMasterSheetWorkbook } = require('./buildWorkbook');
const { paymentBreakdown } = require('./groupTables');

/**
 * ***************************************************
 * * Add ons and fees on the exported breakdown
 * ***************************************************
 *
 * Built as real xlsx and read back, because the thing under test is what
 * lands in the file: the label, the sign, and which block it sits in.
 */

const deal = (over) => ({
  group_name: 'MILKMAN', company: 'Whitestone Swan', person_name: 'Neo',
  person_id: 'neo', role: 'mid', seat: 1, role_label: 'Mid 1',
  currency: 'GBP', payment_method: 'cash', payable_amount: 1000,
  monthly_amount: 1000, preset_on: '2026-08-01', payable_days: 31,
  location: 'Abu Dhabi', status: 'active',
  addon_percent: 0, fee_percent: 0, ...over,
});

// Gloria on 5% add on, Abe on 10% fee, Neo on nothing, all in one location.
const ROWS = [
  deal({ person_id: 'gloria', person_name: 'Gloria', payable_amount: 500, addon_percent: 5 }),
  deal({ person_id: 'abe', person_name: 'Abe', payable_amount: 1000, fee_percent: 10 }),
  deal({ person_id: 'neo', person_name: 'Neo', payable_amount: 1000 }),
];

/**
 * ===============================
 * * paymentBreakdown NO LONGER APPLIES RATES. ROWS ARRIVE RATED.
 * ===============================
 * They moved onto the Monthly amount, applied once by `withRates` at the
 * top of the build, so every reader after it adds the numbers in front of
 * it. A test handing it raw rows is testing a call that cannot happen.
 */
const { withRates } = require('../shared/rates.helper');
const rated = (rows, people = null, opts = {}) => rows.map((r) => withRates(r, people, opts));

function labelsFor(breakdownDesign, opts = {}) {
  const wb = buildMasterSheetWorkbook(ROWS, { month: '2026-08', breakdownDesign, ...opts });
  const out = [];
  wb.eachSheet((ws) => {
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        const v = cell.text;
        // Block headings AND person rows: "Add ons", "Gloria: 5% add on".
        // BOTH SEPARATORS, like the workbook reader: a dash on files written
        // before 2026-09-14, a colon on everything since.
        if (typeof v === 'string' && /^(add ons|fees)$|^\S.*(?: - |: )\d/i.test(v.trim())) {
          out.push({ text: v.trim(), row: row.number });
        }
      });
    });
  });
  return out;
}

test('the breakdown carries WHO and at WHAT RATE, not one aggregated Fee', () => {
  const b = paymentBreakdown(rated(ROWS));
  const line = b.methods[0].locations[0].lines.find((l) => l.currency === 'GBP');

  assert.deepEqual(line.adjustments.map((a) => [a.name, a.kind, a.percent, a.value]), [
    ['Gloria', 'addon', 5, 25],
    ['Abe', 'fee', 10, 100],
  ], 'add ons before fees, then by name');
});

test('a person and deal rate STACK into one line at the combined rate', () => {
  // 5% on the person plus 3% on the row is one 8% line, never two.
  const rows = [deal({ person_id: 'gloria', person_name: 'Gloria', payable_amount: 500, addon_percent: 3 })];
  const rates = new Map([['gloria', { addon: 5, fee: 0 }]]);
  const b = paymentBreakdown(rated(rows, rates));
  const { adjustments } = b.methods[0].locations[0].lines[0];

  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].percent, 8);
  assert.equal(adjustments[0].value, 40, '8% of 500');
});

test('one person at two different rates is two lines, each true', () => {
  // Same person, same bucket, different deal rates. One merged line would
  // have to name a rate that applies to neither.
  const rows = [
    deal({ person_id: 'g', person_name: 'Gloria', payable_amount: 500, addon_percent: 5 }),
    deal({ person_id: 'g', person_name: 'Gloria', payable_amount: 500, addon_percent: 10 }),
  ];
  const { adjustments } = paymentBreakdown(rated(rows))
    .methods[0].locations[0].lines[0];

  assert.deepEqual(adjustments.map((a) => a.percent), [5, 10]);
});

test('the same person at the SAME rate on two rows is one line', () => {
  const rows = [
    deal({ person_id: 'g', person_name: 'Gloria', payable_amount: 500, addon_percent: 5 }),
    deal({ person_id: 'g', person_name: 'Gloria', payable_amount: 500, addon_percent: 5 }),
  ];
  const { adjustments } = paymentBreakdown(rated(rows))
    .methods[0].locations[0].lines[0];

  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].value, 50, 'both rows summed');
});

test('`with-usd` folds adjustments into totals without naming them', () => {
  const found = labelsFor('with-usd');
  const texts = found.map((f) => f.text);
  assert.ok(!texts.includes('Gloria: 5% add on'), texts.join(' | '));
  assert.ok(!texts.includes('Abe: 10% fee'), texts.join(' | '));
  assert.ok(!texts.includes('Add ons'), 'no separate block in this design');
});

test('the percentages table moves them OUT of the pivot into named blocks', () => {
  // The toggle, not a design. `percentagesTable` on the advance one is what
  // the retired `with-usd-table` id used to mean, and still means for a
  // saved link carrying it.
  const found = labelsFor('with-usd', { percentagesTable: true });
  const texts = found.map((f) => f.text);

  assert.ok(texts.includes('Add ons'), texts.join(' | '));
  assert.ok(texts.includes('Fees'), texts.join(' | '));
  // No kind on the label: the block heading above it already said which.
  assert.ok(texts.includes('Gloria: 5%'), texts.join(' | '));
  assert.ok(texts.includes('Abe: 10%'), texts.join(' | '));
  assert.ok(!texts.includes('Gloria: 5% add on'), 'not inline as well: that would print it twice');
});

test('the plain USD design does not print adjustment rows', () => {
  const wb = buildMasterSheetWorkbook(ROWS, { month: '2026-08', breakdownDesign: 'with-usd' });

  const labels = [];
  wb.eachSheet((ws) => {
    ws.eachRow((row) => {
      row.eachCell((cell) => labels.push(String(cell.text).trim()));
    });
  });

  assert.ok(!labels.includes('Gloria: 5% add on'));
  assert.ok(!labels.includes('Abe: 10% fee'));
});

test('every design is registered and none share an id', () => {
  const { listBreakdownDesigns } = require('./breakdowns');
  const ids = listBreakdownDesigns().map((d) => d.id);
  assert.deepEqual(ids, ['none', 'simple', 'standard', 'with-usd']);
  assert.equal(new Set(ids).size, ids.length);
});

test('the USD designs TOTAL the adjustments, not just print them', () => {
  // The bug this pins: totals() read the gross line, so the block showed
  // "Gloria: 5% add on 25.00" and then a total that did not contain it.
  // Gross 2,500, plus 25 add on, less 100 fee, is 2,425.
  for (const percentagesTable of [false, true]) {
    const design = 'with-usd';
    const wb = buildMasterSheetWorkbook(ROWS, { month: '2026-08', breakdownDesign: design, percentagesTable });
    let gbpTotal = null;
    wb.eachSheet((ws) => {
      ws.eachRow((row) => {
        row.eachCell((cell, col) => {
          if (String(cell.text).trim() === 'GBP Total') gbpTotal = row.getCell(col + 1).value;
        });
      });
    });
    assert.equal(gbpTotal, 2425, `percentagesTable=${percentagesTable}: 2500 + 25 - 100`);
  }
});

test('the pivot figure is NET whatever the toggle says', () => {
  // It used to choose between the gross line and the net one, because the
  // rates were added at the foot. They are inside the amount now, so there
  // is no gross to show and the switch only decides what is drawn below.
  const rightPivotAmounts = (percentagesTable) => {
    const wb = buildMasterSheetWorkbook(ROWS, { month: '2026-08', breakdownDesign: 'with-usd', percentagesTable });
    const amounts = [];
    wb.eachSheet((ws) => ws.eachRow((row) => {
      const label = String(row.getCell(5).value ?? '').trim();
      if (label === 'GBP') amounts.push(row.getCell(6).value);
    }));
    return amounts;
  };

  assert.deepEqual(rightPivotAmounts(false), [2425], '5% add on and 10% fee are inside the visible line');
  assert.deepEqual(rightPivotAmounts(true), [2425], 'and still are with the table on: it explains, it does not replace');
});

test('THE CONTRACT: the design ids are written down here, and again web-side', () => {
  // crm/web pins the same list in components/export/breakdownPreviews.test.js
  // so a design added without a preview fails on both sides. NEITHER file
  // reads the other: the two codebases share nothing, so the list is
  // duplicated on purpose and that duplication is the point.
  const { listBreakdownDesigns } = require('./breakdowns');
  assert.deepEqual(
    listBreakdownDesigns().map((d) => d.id),
    ['none', 'simple', 'standard', 'with-usd'],
    'add it web-side too, or the modal shows a blank preview',
  );
});

/* ===============================
 * * The Active company list must agree with the money beside it
 * =============================== */

const { rollToMonth } = require('./rollToMonth');
const { activeCompanies } = require('./groupTables');

// NEXUS, as the August sheet holds it. A J Rayson ends in March, Nuvanta in
// August, and every payment start is 2025 so every cell is GREEN.
const NEXUS = [
  { person_id: 'juan', person_name: 'Juan Estrada', company: 'A J Rayson', role: 'director', group_name: 'NEXUS', payable_amount: 500, currency: 'GBP', payment_method: 'bank', location: 'Main City', preset_on: '2026-08-01', payment_start_on: '2025-06-04', end_on: '2026-03-06', status: 'active', payable_days: 31 },
  { person_id: 'abe', person_name: 'Abe', company: 'A J Rayson', role: 'mid', group_name: 'NEXUS', payable_amount: 500, currency: 'GBP', payment_method: 'cash', location: 'Abu Dhabi', preset_on: '2026-08-01', payment_start_on: '2025-06-04', end_on: '2026-03-06', status: 'active', payable_days: 31 },
  { person_id: 'dewell', person_name: 'Dewell', company: 'Nuvanta Resourcing', role: 'director', group_name: 'NEXUS', payable_amount: 750, currency: 'GBP', payment_method: 'bank', location: 'Main City', preset_on: '2026-08-01', payment_start_on: '2025-11-04', end_on: '2026-08-06', status: 'active', payable_days: 31 },
  { person_id: 'drew', person_name: 'Drew', company: 'Nuvanta Resourcing', role: 'mid', group_name: 'NEXUS', payable_amount: 750, currency: 'GBP', payment_method: 'cash', location: 'Black country', preset_on: '2026-08-01', payment_start_on: '2025-11-04', end_on: '2026-08-06', status: 'active', payable_days: 31 },
];

const listed = (useEndDate) => activeCompanies(
  rollToMonth(NEXUS, '2026-08', { useEndDate }).rows,
).map((c) => c.company);

test('THE INCIDENT: A J Rayson is paid on the tab and must be ON the list', () => {
  // V5 of the August sheet listed Nuvanta alone while totalling 4,775, a
  // figure that includes A J Rayson's 1,000. One tab, two answers.
  assert.deepEqual(listed(false), ['A J Rayson', 'Nuvanta Resourcing']);
});

test('with the end-date setting ON, an ended company drops, and only then', () => {
  assert.deepEqual(listed(true), ['Nuvanta Resourcing'], 'A J Rayson ended in March');
});

test('the list cannot contradict the total: both are isOwedThisMonth', () => {
  // The guarantee, not a coincidence. Whatever the setting, a company is on
  // the list exactly when at least one of its deals counts toward the money.
  const { countsTowardTotal } = require('../shared/owedThisMonth.helper');
  for (const useEndDate of [false, true]) {
    // THE SAME MONTH ON BOTH SIDES. `listed` rolls to August, which stamps
    // for_this_month; the raw rows have no stamp, so without the month here
    // they were judged against whatever month the server is in. The two
    // agreed only while that happened to be August.
    const paid = new Set(
      NEXUS.filter((r) => countsTowardTotal(r, { useEndDate, month: '2026-08' })).map((r) => r.company),
    );
    assert.deepEqual(listed(useEndDate).sort(), [...paid].sort(), `useEndDate ${useEndDate}`);
  }
});

test('A WORKBOOK IS JUDGED AGAINST THE MONTH IT IS FOR, not against today', () => {
  // `buildMasterSheetWorkbook` took a `month` option and silently ignored
  // it, so an unrolled row fell back to `isForMonth(row)` and was measured
  // against whatever month the server was in. In production the rows are
  // rolled first and carry `for_this_month`, which hid it; thirteen tests
  // found it at midnight on the first of the month and blamed the writer.
  // THE BREAKDOWN, not the row. A row marked for another month still
  // belongs ON the sheet and out of the FIGURE, so the tell is whether the
  // total block exists at all, never whether the amount is printed.
  const august = [deal({ preset_on: '2026-08-01', payable_amount: 1234 })];
  const hasTotal = (month) => {
    const wb = buildMasterSheetWorkbook(august, { month, breakdownDesign: 'standard' });
    const out = [];
    wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => out.push(String(c.text).trim()))));
    return out.includes('Grand Total');
  };

  assert.equal(hasTotal('2026-08'), true, 'the month it is FOR must count');
  assert.equal(hasTotal('2024-01'), false, 'a different month must not');
});

test('the Add ons and Fees headings take the PRIMARY colour', () => {
  // palette.js: primary owns the headings, secondary owns the totals. On
  // `soft` the block read as uncoloured beside Total bank whenever the
  // secondary was grey, which is the default pair.
  const src = require('node:fs').readFileSync(
    require.resolve('./breakdowns/withUsd.js'), 'utf8',
  );
  const block = src.slice(src.indexOf('if (opts.adjustmentsInTable)'));
  const heading = block.slice(0, block.indexOf('for (const a of found[kind])'));

  assert.match(heading, /line\(sheet, q, RIGHT, heading, \{ bold: true, fill: fills\.head \}\)/);
});

test('the block is painted from the CHOSEN pair, never a literal', () => {
  // A hex typed in here would ignore the picker entirely.
  const src = require('node:fs').readFileSync(
    require.resolve('./breakdowns/withUsd.js'), 'utf8',
  );
  const block = src.slice(src.indexOf('if (opts.adjustmentsInTable)'), src.indexOf('---- right: the answer block'));
  assert.ok(!/FF[0-9A-F]{6}/i.test(block), 'no literal colour in the block');
  assert.match(block, /fills\.head/);
  assert.match(block, /fills\.faint/);
});

/**
 * ===============================
 * * CONTRACT: ONE PICKED PAIR PAINTS THE WHOLE FILE
 * ===============================
 *
 * THE BUG, 2026-09-14. Three colours were typed into the builders and never
 * asked the picker: the title band was BLACK, the month sheet's Grand Total
 * was GREEN and the division sheet's was ORANGE. Pick green and you got a
 * black bar over green headers; pick orange and the Grand Total stayed
 * green. The picker showed a colour the file did not keep.
 *
 * Asserted against `fillsFor`, never a typed hex, so retuning a shade in
 * palette.js moves the file and this test together.
 */
const { fillsFor } = require('./breakdowns/palette');
const { buildPayoutWorkbook } = require('./buildPayoutSheet');

const PICKED = { primaryColor: 'green', secondaryColor: 'blue' };
const argbOf = (cell) => cell.fill?.fgColor?.argb;

/** Every cell in the workbook, so a stray colour cannot hide on one tab. */
function everyCell(wb) {
  const out = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => out.push(cell))));
  return out;
}

function firstRowLabelled(wb, label) {
  let found = null;
  wb.eachSheet((ws) => ws.eachRow((row) => {
    if (!found && String(row.getCell(1).value ?? '').trim() === label) found = row;
  }));
  return found;
}

test('EVERY header and band takes the picked primary, in white type', () => {
  const fills = fillsFor(PICKED.primaryColor, PICKED.secondaryColor);
  const wb = buildMasterSheetWorkbook(HIS_NEXUS, {
    month: '2026-08', breakdownDesign: 'standard', groupTotals: true, ...PICKED,
  });
  const ws = wb.getWorksheet('MILKMAN');

  // The deal header row.
  assert.equal(argbOf(ws.getRow(1).getCell(1)), argbOf({ fill: fills.head }));
  assert.equal(ws.getRow(1).getCell(1).font.color.argb, fills.headText.argb);

  // The breakdown title and the group total band, the two that were black.
  for (const label of ['Row Labels', 'Total for MILKMAN']) {
    const row = firstRowLabelled(wb, label);
    assert.ok(row, `${label} must be on the sheet`);
    assert.equal(argbOf(row.getCell(1)), argbOf({ fill: fills.head }), label);
    assert.equal(row.getCell(1).font.color.argb, fills.headText.argb, label);
  }
});

test('NOTHING IS BLACK ANY MORE, on any tab', () => {
  // The one assertion that catches a fourth hardcode nobody remembered.
  const wb = buildMasterSheetWorkbook(HIS_NEXUS, {
    month: '2026-08', breakdownDesign: 'standard', groupTotals: true, ...PICKED,
  });
  const black = everyCell(wb).filter((c) => argbOf(c) === 'FF111111');
  assert.equal(black.length, 0, `${black.length} cells still painted black`);
});

test('the Grand Total is a BAND over the secondary ground, in the picked pair', () => {
  const fills = fillsFor(PICKED.primaryColor, PICKED.secondaryColor);
  // Two currencies, so the block is a heading with rows: the shape that
  // shows both halves of the treatment at once.
  const wb = buildMasterSheetWorkbook(HIS_MIXED, {
    month: '2026-08', breakdownDesign: 'standard', ...PICKED,
  });
  const ws = wb.getWorksheet('MILKMAN');
  const head = firstRowLabelled(wb, 'Grand Total');

  assert.equal(argbOf(head.getCell(1)), argbOf({ fill: fills.head }), 'the heading is the band');
  assert.equal(head.getCell(1).font.color.argb, fills.headText.argb);
  assert.equal(
    head.getCell(1).border.top.color.argb,
    fills.grandBorder.color.argb,
    'and the box is the primary, not a fixed green',
  );

  // The currency rows under it sit on the secondary's pale ground.
  const under = ws.getRow(head.number + 1);
  assert.equal(argbOf(under.getCell(1)), argbOf({ fill: fills.grandFill }));
});

test('A PAYOUT FILE FOLLOWS THE SAME PICK, not the last month sheet built', () => {
  /**
   * A MONTH SHEET IS BUILT FIRST, IN A DIFFERENT COLOUR, ON PURPOSE.
   *
   * The payout builder borrows buildWorkbook's `styleHeader`, which paints
   * from module state only the month sheet used to set. Asserted without
   * this line the test passed against a payout builder that set NOTHING:
   * it was reading the green another test had left behind two cases
   * earlier. Maroon here means green can only come from this call.
   */
  buildMasterSheetWorkbook(HIS_NEXUS, {
    month: '2026-08', primaryColor: 'maroon', secondaryColor: 'maroon',
  });

  const fills = fillsFor(PICKED.primaryColor, PICKED.secondaryColor);
  const stale = fillsFor('maroon', 'maroon');
  assert.notEqual(fills.head.fgColor.argb, stale.head.fgColor.argb, 'the two picks must differ');

  const wb = buildPayoutWorkbook(
    [{ ...deal({ payment_method: 'bank' }), bank_details: 'X', account_number: '1', sort_code: '2' }],
    'bank',
    PICKED,
  );
  const head = wb.getWorksheet('General').getRow(1).getCell(1);

  assert.equal(argbOf(head), fills.head.fgColor.argb);
  assert.equal(head.font.color.argb, fills.headText.argb);
});

test('THE INDIGO CASE: a company whose deals start later is still ACTIVE', () => {
  // His August list carries Umbrella UK Holdings (starts November) and
  // Churchill Knight (starts October). Reading "not owed" as "ended"
  // dropped both, so his list had 17 rows and ours 12.
  const later = [
    { person_id: 'a', person_name: 'Tiarna', company: 'Umbrella UK Holdings', role: 'director', group_name: 'INDIGO', payable_amount: 1000, currency: 'GBP', payment_method: 'cash', location: 'Main City', preset_on: '2026-08-01', payment_start_on: '2026-11-09', end_on: '2027-08-11', status: 'active', payable_days: 31 },
    { person_id: 'b', person_name: 'Gab', company: 'Gab', role: 'director', group_name: 'INDIGO', payable_amount: 500, currency: 'GBP', payment_method: 'cash', location: 'Main City', preset_on: '2026-08-01', payment_start_on: '2025-03-31', end_on: null, status: 'active', payable_days: 31 },
  ];
  const names = activeCompanies(rollToMonth(later, '2026-08').rows).map((c) => c.company);
  assert.deepEqual(names, ['Gab', 'Umbrella UK Holdings']);
});

test('a company whose deals have ENDED still drops, which is the point', () => {
  const done = [{
    person_id: 'a', person_name: 'X', company: 'Finished Ltd', role: 'director', group_name: 'INDIGO',
    payable_amount: 500, currency: 'GBP', payment_method: 'cash', location: 'Main City',
    preset_on: '2026-08-01', payment_start_on: '2025-01-01', end_on: '2026-03-06',
    status: 'active', payable_days: 31,
  }];
  assert.deepEqual(activeCompanies(rollToMonth(done, '2026-08', { useEndDate: true }).rows), []);
  // Toggle off, the end date takes no part and it stays.
  assert.equal(activeCompanies(rollToMonth(done, '2026-08').rows).length, 1);
});


/* ===============================
 * * THE TWO STAGES, PINNED TO HIS OWN FILES
 * ===============================
 *
 * `simple` is docs/boss/references/indigo 1 august.xlsx and milkman
 * august.xlsx: currency, its methods, that currency's total. No location
 * level and no grand total.
 *
 * `standard` is docs/boss/references/nexus august.xlsx: method, location, a
 * total per method and a grand total. The currency row appears only when
 * the group is paid in more than one; his nexus sheet is not.
 *
 * THEY SWAPPED ON 2026-09-12. Stage 1 used to be the detailed one, so the
 * ladder read backwards: picking "standard" gave you less than "simple".
 * The IDS DID NOT MOVE, so a saved ?breakdownDesign= still names a stage.
 */
function blockOf(design, rows) {
  const wb = buildMasterSheetWorkbook(rows, { month: '2026-08', breakdownDesign: design });
  const out = [];
  wb.eachSheet((ws) => {
    let inBlock = false;
    ws.eachRow((row) => {
      const label = String(row.getCell(1).value ?? '').trim();
      if (label === 'Row Labels') { inBlock = true; return; }
      if (!inBlock || !label) return;
      let value = null;
      for (let c = 2; c <= 12; c += 1) {
        const v = row.getCell(c).value;
        if (typeof v === 'number') { value = v; break; }
      }
      out.push([label, value]);
    });
  });
  return out;
}

// His HIS_NEXUS figures, exactly.
const HIS_NEXUS = [
  deal({ person_id: 'a', person_name: 'A', payment_method: 'bank', location: 'Main city', payable_amount: 750 }),
  deal({ person_id: 'b', person_name: 'B', payment_method: 'bank', location: 'South east', payable_amount: 500 }),
  deal({ person_id: 'c', person_name: 'C', location: 'Abu dhabi', payable_amount: 1000 }),
  deal({ person_id: 'd', person_name: 'D', location: 'Black country', payable_amount: 750 }),
  deal({ person_id: 'e', person_name: 'E', location: 'South east', payable_amount: 1750 }),
];
const HIS_MIXED = [
  ...HIS_NEXUS,
  deal({ person_id: 'f', person_name: 'F', location: 'Abu dhabi', currency: 'AED', payable_amount: 3675 }),
  deal({ person_id: 'g', person_name: 'G', location: 'Chip county', currency: 'EURO', payable_amount: 1000 }),
];

test('STANDARD, one currency, IS his nexus august sheet row for row', () => {
  // NO CURRENCY ROW, his call 2026-09-13. One currency in the group means
  // the code said nothing on every line and pushed each figure an indent
  // away from the place the cash is going.
  assert.deepEqual(blockOf('standard', HIS_NEXUS), [
    ['Bank', null],
    ['Main city', 750],
    ['South east', 500],
    ['Bank Total', 1250],
    ['Cash', null],
    ['Abu dhabi', 1000],
    ['Black country', 750],
    ['South east', 1750],
    ['Cash Total', 3500],
    ['Grand Total', 4750],
  ]);
});

test('SIMPLE, several currencies, IS his indigo shape', () => {
  assert.deepEqual(blockOf('simple', HIS_MIXED), [
    ['AED', null], ['Cash', 3675], ['AED Total', 3675],
    ['EURO', null], ['Cash', 1000], ['EURO Total', 1000],
    ['GBP', null], ['Bank', 1250], ['Cash', 3500], ['GBP Total', 4750],
  ]);
});

test('SIMPLE with one currency is the same shape, one block', () => {
  assert.deepEqual(blockOf('simple', HIS_NEXUS), [
    ['GBP', null], ['Bank', 1250], ['Cash', 3500], ['GBP Total', 4750],
  ]);
});

test('SIMPLE carries NO location and NO grand total, both his', () => {
  // A currency's total is the whole of that currency's run, so a grand
  // total below could only repeat the same figures one indent left.
  const labels = blockOf('simple', HIS_MIXED).map(([l]) => l);
  assert.ok(!labels.includes('Grand Total'), labels.join(' | '));
  for (const place of ['Main city', 'Abu dhabi', 'Black country', 'Chip county']) {
    assert.ok(!labels.includes(place), `${place} must not appear in stage 1`);
  }
});

test('STANDARD keeps LOCATION however many currencies there are', () => {
  // The point of stage 2. Stage 1 does not say where the cash goes.
  const labels = blockOf('standard', HIS_MIXED).map(([l]) => l);
  for (const place of ['Main city', 'Abu dhabi', 'Black country', 'Chip county', 'South east']) {
    assert.ok(labels.includes(place), `${place} missing: ${labels.join(' | ')}`);
  }
});

test('A STANDARD TOTAL IS ONE LINE FOR ONE CURRENCY, GATHERED FOR SEVERAL', () => {
  // He has no example of this shape with two currencies, so it is ours.
  // One line keeps his own sheet identical to what he writes.
  const rows = blockOf('standard', HIS_MIXED);
  const at = (label) => rows.findIndex(([l]) => l === label);

  assert.deepEqual(rows[at('Bank Total')], ['Bank Total', 1250], 'one currency, one line');

  assert.equal(rows[at('Cash Total')][1], null, 'several: a heading, no figure of its own');
  assert.deepEqual(rows.slice(at('Cash Total') + 1, at('Cash Total') + 4), [
    ['AED', 3675], ['EURO', 1000], ['GBP', 3500],
  ]);

  assert.equal(rows[at('Grand Total')][1], null);
  assert.deepEqual(rows.slice(at('Grand Total') + 1, at('Grand Total') + 4), [
    ['AED', 3675], ['EURO', 1000], ['GBP', 4750],
  ]);
});

test('BANK, not Bank Transfer, in both stages', () => {
  // His call 2026-09-12. Only `advance` keeps the long spelling, because
  // that is what its pivots have always written.
  for (const design of ['simple', 'standard']) {
    const labels = blockOf(design, HIS_MIXED).map(([l]) => l);
    assert.ok(labels.includes('Bank'), `${design}: ${labels.join(' | ')}`);
    assert.ok(!labels.some((l) => l.includes('Bank Transfer')), `${design} must not say Bank Transfer`);
  }
});

test('the retired id still produces the file it always did', () => {
  const { breakdownDesignFor, forcesPercentagesTable } = require('./breakdowns');
  assert.equal(breakdownDesignFor('with-usd-table').id, 'with-usd');
  assert.equal(forcesPercentagesTable('with-usd-table'), true);
  assert.equal(forcesPercentagesTable('with-usd'), false);

  const found = labelsFor('with-usd-table').map((f) => f.text);
  assert.ok(found.includes('Add ons'), found.join(' | '));
});

test('STANDARD is the default, not the converting one', () => {
  const { DEFAULT_ID, breakdownDesignFor } = require('./breakdowns');
  assert.equal(DEFAULT_ID, 'standard');
  assert.equal(breakdownDesignFor('nonsense').id, 'standard');
});
