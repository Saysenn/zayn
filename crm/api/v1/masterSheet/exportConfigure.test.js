const test = require('node:test');
const assert = require('node:assert/strict');
const template = require('../templates/xlsx/masterSheet');
const { listExportColumns, listSheetPresets, RATES_COLUMN } = require('./buildWorkbook');
const { listPaletteColors, fillsFor } = require('./breakdowns/palette');
const { rateTextFor } = require('../shared/rateText.helper');
const { applyFilters, layoutOptions } = require('./exportQuery');

/**
 * ***************************************************
 * * CONFIGURING THE WORKING FILE. His call 2026-09-23.
 * ***************************************************
 *
 * Three things the master sheet export could not do: colour its header,
 * say what went on top of a figure, and be narrowed to one person.
 *
 * The first two were the same fault as `rates` before them. This template
 * NAMES the options it forwards, so every new one has to be listed by hand
 * and every one can be forgotten by hand. That is three now.
 */

const RATE = new Map([['maid', { addon: 5, fee: 0 }]]);

const BASE = {
  group_name: 'INDIGO',
  company: 'Workforce',
  currency: 'GBP',
  payable_days: 30,
  preset_on: '2026-09-01',
  source: 'import',
};

const ROWS = [
  {
    ...BASE, id: 1, role_label: 'Maid', person_id: 'maid', person_name: 'Maid',
    monthly_amount: 4700, payable_amount: 4700, payment_method: 'crypto',
  },
  {
    ...BASE, id: 2, role_label: 'Mid 1', person_id: 'plain', person_name: 'Plain',
    monthly_amount: 1000, payable_amount: 1000, payment_method: 'bank',
  },
  {
    ...BASE, id: 3, group_name: 'MILKMAN', role_label: 'Mid 2', person_id: 'plain',
    person_name: 'Plain', monthly_amount: 500, payable_amount: 500, payment_method: 'bank',
  },
];

const headers = (ws) => {
  const out = [];
  ws.getRow(1).eachCell((c) => out.push(String(c.value)));
  return out;
};

// ===============================
// * The rates column: words, not a number
// ===============================

test('IT SAYS THE DIRECTION, because three rates run two ways', () => {
  const rated = { rate_parts: { percent: { addon: 5, crypto: 1, fee: 2 } } };
  assert.equal(rateTextFor(rated), 'added 5% · 1% fx fee · 2% fee off');
});

test('A ROW WITH NO RATE GETS AN EMPTY CELL, not a 0%', () => {
  assert.equal(rateTextFor({}), '');
  assert.equal(rateTextFor({ rate_parts: { percent: { addon: 0, crypto: 0, fee: 0 } } }), '');
});

test('AND A RATE PRINTS WITHOUT TRAILING ZEROS', () => {
  assert.equal(rateTextFor({ rate_parts: { percent: { addon: 2.5, crypto: 0, fee: 0 } } }), 'added 2.5%');
  assert.equal(rateTextFor({ rate_parts: { percent: { addon: 5.0, crypto: 0, fee: 0 } } }), 'added 5%');
});

// ===============================
// * It is a switch, and switches are off
// ===============================

test('THE COLUMN IS ABSENT UNLESS THE SWITCH IS ON', async () => {
  const off = await template.build(ROWS, { rates: RATE, cryptoPercent: 1 });
  assert.ok(!headers(off.worksheets[0]).includes('Rates applied'));

  const on = await template.build(ROWS, { rates: RATE, cryptoPercent: 1, showRates: true });
  assert.ok(headers(on.worksheets[0]).includes('Rates applied'));
});

test('IT IS NOT IN THE PICKER, so a switch owns it alone', () => {
  const keys = listExportColumns().map((c) => c.key);
  assert.ok(!keys.includes(RATES_COLUMN), 'the column is offered as well as switched');
  for (const preset of listSheetPresets()) {
    assert.ok(!preset.columns.includes(RATES_COLUMN), `${preset.id} names the opt in column`);
  }
});

test('AND IT SURVIVES A NARROWED PICK', async () => {
  const wb = await template.build(ROWS, {
    rates: RATE, cryptoPercent: 1, showRates: true, columns: ['payable_amount', 'currency'],
  });
  const head = headers(wb.worksheets[0]);
  assert.ok(head.includes('Rates applied'), 'the switch lost to the column picker');
  assert.ok(head.includes('Payable amount'));
  // An empty choice means every column; adding one key must not narrow it.
  assert.ok(!head.includes('Location'), 'the narrowed pick was ignored');
});

test('IT IS LAST, because every other column is his', async () => {
  const wb = await template.build(ROWS, { rates: RATE, cryptoPercent: 1, showRates: true });
  assert.equal(headers(wb.worksheets[0]).at(-1), 'Rates applied');
});

test('AND IT CARRIES THE STACKED FIGURE, per row', async () => {
  const wb = await template.build(ROWS, { rates: RATE, cryptoPercent: 1, showRates: true });
  const ws = wb.worksheets[0];
  const at = headers(ws).indexOf('Rates applied') + 1;
  const seen = [];
  ws.eachRow((row, i) => { if (i > 1) seen.push(String(row.getCell(at).value ?? '')); });
  assert.ok(seen.includes('added 5% · 1% fx fee'), `the rated row says "${seen}"`);
  assert.ok(seen.includes(''), 'an unrated row was given words');
});

// ===============================
// * The header colour, and the light one
// ===============================

test('THE TEMPLATE FORWARDS THE HEADER COLOUR', async () => {
  const wb = await template.build(ROWS, { primaryColor: 'green' });
  const fill = wb.worksheets[0].getRow(1).getCell(1).fill;
  assert.equal(fill.fgColor.argb, fillsFor('green', 'grey').head.fgColor.argb);
});

/**
 * ===============================
 * * NO COLOUR MAY BE A GRADIENT, and this is why
 * ===============================
 * `blue-white` was one, and it printed as a WHITE band: exceljs writes a
 * gradientFill Excel accepts and does not paint here, so the one visible
 * thing the colour existed for did not happen. Reported on sight
 * 2026-09-23. A flat tint always renders.
 */
test('EVERY COLOUR IS A FLAT FILL, on the header he actually opens', async () => {
  for (const c of listPaletteColors()) {
    const wb = await template.build(ROWS, { primaryColor: c.id });
    const fill = wb.worksheets[0].getRow(1).getCell(1).fill;
    assert.equal(fill.type, 'pattern', `${c.id} is a gradient and will print white`);
    assert.match(fill.fgColor.argb, /^FF[0-9A-F]{6}$/, `${c.id} has no solid colour`);
  }
});

/**
 * SAMPLED FROM HIS OWN SCREENSHOT, pixel for pixel: #DDEBF7 band, BLACK
 * bold type, white body. Excel's Blue Accent 1 Lighter 80%, which is what
 * a finance table looks like by default. Spelled out rather than read off
 * the palette, so changing it is a deliberate edit to a test that says
 * where the number came from.
 */
test('BLUE WHITE IS HIS LIGHT HEADER, to the byte', async () => {
  const wb = await template.build(ROWS, { primaryColor: 'blue-white' });
  const cell = wb.worksheets[0].getRow(1).getCell(1);
  assert.equal(cell.fill.fgColor.argb, 'FFDDEBF7');
  assert.equal(cell.font.color.argb, 'FF000000');
  assert.equal(cell.font.bold, true);
});

/**
 * THREE LIGHT, THREE DARK. Gold and grey joined `blue-white` on
 * 2026-09-23, once he had seen it. Spelled out because the split is the
 * point: a palette that drifted to all light or all dark is one choice
 * wearing six hats.
 */
test('EVERY COLOUR TAKES BLACK OR WHITE, and which is not a guess', () => {
  const by = Object.fromEntries(listPaletteColors().map((c) => [c.id, c.headText]));
  assert.deepEqual(by, {
    maroon: '#FFFFFF',
    blue: '#FFFFFF',
    green: '#FFFFFF',
    gold: '#000000',
    'blue-white': '#000000',
    grey: '#000000',
  });
});

/**
 * AND THE TYPE MATCHES THE BAND IT SITS ON. The rule that generates the
 * table above, so a colour added later cannot pair a pale band with white
 * type and print an invisible header. Luminance off the band's own hex,
 * never off a list of ids.
 */
test('A PALE BAND NEVER CARRIES WHITE TYPE', () => {
  for (const c of listPaletteColors()) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.strong.slice(i, i + 2), 16));
    const light = (0.299 * r + 0.587 * g + 0.114 * b) > 140;
    assert.equal(
      c.headText,
      light ? '#000000' : '#FFFFFF',
      `${c.id} is a ${light ? 'pale' : 'dark'} band carrying ${c.headText} type`,
    );
  }
});

/**
 * GREY IS `DEFAULT_SECONDARY`, so its soft and faint weights paint the
 * totals and grouping rows of almost every export ever made. Making its
 * BAND light must not have moved them.
 */
test('MAKING GREY LIGHT MOVED NO EXISTING DOCUMENT', () => {
  const f = fillsFor('maroon', 'grey');
  assert.equal(f.soft.fgColor.argb, 'FFF2F2F2');
  assert.equal(f.faint.fgColor.argb, 'FFF9F9F9');
});

/**
 * A PALE BAND NEEDS A RULE BETWEEN THE CELLS. His own table draws one;
 * without it #DDEBF7 reads as one long smear rather than a row of columns.
 */
test('THE HEADER CELLS ARE RULED, in the colour that goes with the band', async () => {
  for (const id of ['blue-white', 'maroon']) {
    const wb = await template.build(ROWS, { primaryColor: id });
    const border = wb.worksheets[0].getRow(1).getCell(2).border;
    assert.ok(border, `${id} lost its header rule`);
    for (const side of ['top', 'bottom', 'left', 'right']) {
      assert.equal(border[side].style, 'thin', `${id} has no ${side} rule`);
      assert.equal(border[side].color.argb, fillsFor(id, 'grey').headBorder.color.argb);
    }
  }
});

// ===============================
// * One person, and the groups still split
// ===============================

test('A PERSON FILTER NARROWS THE ROWS, by id', () => {
  const only = applyFilters(ROWS, { personId: 'maid' });
  assert.deepEqual(only.map((r) => r.id), [1]);
  const two = applyFilters(ROWS, { personId: 'maid,plain' });
  assert.deepEqual(two.map((r) => r.id), [1, 2, 3]);
});

/**
 * AND THE GROUPS STILL SPLIT. His words: "I dont need them in one file, I
 * still need group segregation per tab or per file". One person across two
 * groups is two tabs, not one.
 */
test('ONE PERSON ACROSS TWO GROUPS IS STILL TWO TABS', async () => {
  const rows = applyFilters(ROWS, { personId: 'plain' });
  const wb = await template.build(rows, { perGroupTabs: true });
  assert.deepEqual(wb.worksheets.map((w) => w.name).sort(), ['INDIGO', 'MILKMAN']);
});

test('AND A GROUP THEY HAVE NO DEAL IN GETS NO TAB', async () => {
  const rows = applyFilters(ROWS, { personId: 'maid' });
  const wb = await template.build(rows, { perGroupTabs: true });
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['INDIGO']);
});

test('A PERSON AND A METHOD PRESET NARROW TOGETHER', () => {
  const bank = listSheetPresets().find((p) => p.id === 'bank');
  const out = applyFilters(ROWS, { personId: 'plain', method: bank.method });
  assert.deepEqual(out.map((r) => r.id), [2, 3], 'the two filters do not stack');
});

test('AND THE SWITCH TRAVELS ON THE QUERY', () => {
  assert.equal(layoutOptions({ showRates: 'true' }).showRates, true);
  // Absent means off, so a link saved before this existed keeps its shape.
  assert.equal(layoutOptions({}).showRates, false);
  assert.equal(layoutOptions({ primaryColor: 'blue-white' }).primaryColor, 'blue-white');
});

// ===============================
// * Where an uncounted row says so
// ===============================

/**
 * THE AMOUNT, NOT THE ROW, on every document. His call 2026-09-23, on
 * seeing it: a whole tinted line reads as "this row is broken" when what
 * is true is narrower, that this FIGURE is out of this month.
 *
 * READ OFF THE PALETTE, never typed. The mark follows the picked
 * secondary now, so a literal hex here would pass on the default and lie
 * about every other colour.
 */
const markFor = (secondary) => fillsFor(undefined, secondary).tint.fgColor.argb;

const TINT_ROWS = [
  {
    ...BASE, id: 1, role_label: 'Admin', person_id: 'a', person_name: 'Counted',
    monthly_amount: 1000, payable_amount: 1000, payment_method: 'cash',
  },
  {
    // Preset says October, the file is for September, so it is out.
    ...BASE, id: 2, role_label: 'Mid 1', person_id: 'b', person_name: 'OtherMonth',
    monthly_amount: 1000, payable_amount: 1000, payment_method: 'cash', preset_on: '2026-10-01',
  },
];

/** The header names of every cell on one person's row carrying `argb`. */
function markedOn(ws, person, argb) {
  const head = [];
  ws.getRow(1).eachCell((c) => head.push(String(c.value)));
  const at = head.indexOf('Name of individual') + 1;
  let found = null;
  ws.eachRow((row, i) => {
    if (i === 1 || String(row.getCell(at).value) !== person) return;
    const out = [];
    row.eachCell((c, n) => {
      if (c.fill && c.fill.fgColor && c.fill.fgColor.argb === argb) out.push(head[n - 1]);
    });
    found = out;
  });
  return found;
}

test('AN UNCOUNTED ROW TINTS ITS AMOUNT AND NOTHING ELSE', async () => {
  const wb = await template.build(TINT_ROWS, { perGroupTabs: true, month: '2026-09' });
  assert.deepEqual(markedOn(wb.worksheets[0], 'OtherMonth', markFor()), ['Payable amount']);
});

test('AND A COUNTED ROW IS NOT TINTED AT ALL', async () => {
  const wb = await template.build(TINT_ROWS, { perGroupTabs: true, month: '2026-09' });
  assert.deepEqual(markedOn(wb.worksheets[0], 'Counted', markFor()), []);
});

/**
 * THE MARK IS THE PICKED SECONDARY'S OWN SOFT WEIGHT, his call 2026-09-23.
 * It was a typed beige, so a document picked in maroon marked its amounts
 * in a colour that was in no palette at all.
 *
 * AGAINST `soft`, NEVER AGAINST `tint`. Asserting the mark equals
 * `fillsFor().tint` proves nothing: both sides move together, and the
 * first draft of this test passed with `tint` pinned back to the old
 * beige. `soft` is derived from the secondary independently, so a `tint`
 * that stops following it turns this red.
 */
test('AND IT IS PAINTED IN THE PICKED SECONDARY', async () => {
  const maroon = fillsFor(undefined, 'maroon').soft.fgColor.argb;
  const grey = fillsFor(undefined, 'grey').soft.fgColor.argb;
  assert.notEqual(maroon, grey, 'the two secondaries must differ or this proves nothing');

  const wb = await template.build(TINT_ROWS, {
    perGroupTabs: true, month: '2026-09', primaryColor: 'maroon', secondaryColor: 'maroon',
  });
  assert.deepEqual(markedOn(wb.worksheets[0], 'OtherMonth', maroon), ['Payable amount']);
});

/**
 * AND THE PAYOUT FILES MARK IT IN THE SAME COLOUR. The beige was typed in
 * buildWorkbook and again in buildPayoutSheet, so one fact was painted
 * twice and could drift on the first retune.
 */
test('THE PAYOUT FILES READ THE SAME MARK', () => {
  const { readFileSync } = require('node:fs');
  const src = readFileSync(require.resolve('./buildPayoutSheet'), 'utf8');
  assert.match(src, /ENDED_FILL = fills\.tint/, 'the payout builder keeps its own mark');
  assert.doesNotMatch(src, /argb: 'FFFDF3E7'/, 'the typed beige came back');
});

/**
 * THE MONTH GENERATION FOLLOWS, his call 2026-09-23. It kept the row tint
 * on the argument that its totals print underneath, so a line outside them
 * is a fact about the line. One rule beats two documents disagreeing.
 */
test('THE MONTH GENERATION TINTS THE AMOUNT TOO', async () => {
  const { buildMasterSheetWorkbook } = require('./buildWorkbook');
  const wb = await buildMasterSheetWorkbook(TINT_ROWS, { month: '2026-09' });
  assert.deepEqual(markedOn(wb.worksheets[0], 'OtherMonth', markFor()), ['Payable amount']);
});

/**
 * AND IT SAYS NOTHING RATHER THAN WASHING THE ROW. It used to fall back to
 * tinting all twenty columns when the picker dropped the amount, which is
 * the thing the rule exists to stop. A document that does not show the
 * figure has nothing to say about it, the same answer the payment start
 * tint gives when its own column is gone.
 */
test('WITH THE AMOUNT COLUMN DROPPED, NOTHING IS TINTED', async () => {
  const wb = await template.build(TINT_ROWS, {
    perGroupTabs: true, month: '2026-09', columns: ['currency', 'payment_method'],
  });
  assert.deepEqual(markedOn(wb.worksheets[0], 'OtherMonth', markFor()), []);
});
