import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * A breakdown design has a preview, or the modal shows a blank box
 * ***************************************************
 *
 * THE CONTRACT, pinned on THIS side only. The design ids live in
 * crm/api/v1/masterSheet/breakdowns/index.js and this file must never read
 * that path: the two codebases share no file. The api pins its own half.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'breakdownPreviews.jsx'), 'utf8');

// The TABLED block only. Anchoring on 'adjustmentsInTable' alone catches the
// inline row first, and the test then passes on the wrong half of the file.
function tabledBlock() {
  const from = src.indexOf('OUT of the pivot');
  const to = src.indexOf('Total bank', from);
  assert.ok(from > 0 && to > from, 'the tabled block must be findable');
  return src.slice(from, to);
}

// Written down TWICE on purpose, once per codebase. If a design is added
// api-side and not here, its test fails there and this one fails here.
//
// `with-usd-table` LEFT THE LIST on 2026-09-12. It differed from `with-usd`
// by one option, so it is a toggle on that design now and the id survives
// only as an alias for old links (breakdowns/index ALIASES). There is
// nothing to preview separately.
const DESIGN_IDS = ['none', 'simple', 'standard', 'with-usd'];

test('every design id has an entry in BREAKDOWN_PREVIEWS', () => {
  const block = src.slice(src.indexOf('BREAKDOWN_PREVIEWS'));
  for (const id of DESIGN_IDS) {
    const key = /^[a-z]+$/.test(id) ? `${id}:` : `'${id}':`;
    assert.ok(block.includes(key), `no preview registered for "${id}"`);
  }
});

test('only `none` may be null: the others draw something', () => {
  // A missing component renders an empty box beside a named option, which
  // reads as "this design produces nothing".
  const block = src.slice(src.indexOf('BREAKDOWN_PREVIEWS'));
  const nulls = [...block.matchAll(/'?([a-z-]+)'?\s*:\s*null/g)].map((m) => m[1]);
  assert.deepEqual(nulls, ['none']);
});

test('ONE USD component, and the toggle drives it rather than a second copy', () => {
  // A second hand-maintained copy of that layout would drift from the
  // xlsx the first time either was touched. The percentages table is a
  // prop on this one, passed from the picker's own switch.
  assert.equal((src.match(/function WithUsdPreview/g) || []).length, 1);
  assert.match(src, /'with-usd':\s*WithUsdPreview/);
  assert.doesNotMatch(src, /'with-usd-table'/, 'the retired design must not come back as a preview');

  // The picker hands the switch through, or the sample shows a shape the
  // file will not have.
  const picker = fs.readFileSync(path.join(here, 'BreakdownPicker.jsx'), 'utf8');
  assert.match(picker, /adjustmentsInTable=\{percentagesTable\}/);
});

test('SIMPLE is registered, and it is the CURRENCY FIRST summary', () => {
  // The two stages swapped on 2026-09-12: stage 1 is his indigo shape
  // (currency, its methods, that currency's total) and stage 2 is his
  // nexus shape (method, location, currency). The ids did not move.
  // `includes`, not a built regex: an escape written through a heredoc
  // has collapsed twice in this file's history and matched nothing.
  assert.ok(src.includes('simple: SimplePreview'));
  const block = src.slice(src.indexOf('function SimplePreview'), src.indexOf('function StandardPreview'));
  assert.ok(block.includes('label="AED Total"'), 'a total per currency');
  assert.ok(block.includes('label="GBP Total"'), 'a total per currency');
  assert.ok(!block.includes('label="Grand Total"'), 'no grand total: nothing adds across currencies');
  for (const place of ['Main City', 'Abu Dhabi', 'South East']) {
    assert.ok(!block.includes(`label="${place}"`), `stage 1 carries no location, saw ${place}`);
  }
});

test('STANDARD is the DETAILED one, with location and a grand total', () => {
  const block = src.slice(src.indexOf('function StandardPreview'), src.indexOf('export const BREAKDOWN_PREVIEWS'));
  assert.ok(block.includes('label="Main City"'), 'the location level is the point of stage 2');
  assert.ok(block.includes('label="Grand Total"'));
  assert.ok(block.includes('label="Bank Total"'));
});

test('STANDARD on ONE currency puts the figure on the location, with no currency row', () => {
  // The export dropped the row on 2026-09-13 and this file draws the
  // single-currency form, so a GBP row here is a document it never writes.
  // The api pins its own half in masterSheet/groupLayout.test.js.
  // `previewBlock`, not a slice to BREAKDOWN_PREVIEWS: that reaches past
  // this component into WithUsdPreview, whose GBP rows are legitimate.
  const block = previewBlock('Standard');
  assert.ok(!block.includes('label="GBP"'), 'no currency row on a single-currency group');
  assert.ok(
    block.includes('label="Main City" indent={1} native={num(bankGbpNet)}'),
    'the location carries its own figure',
  );
});

/**
 * ===============================
 * * CONTRACT: A HEAD CELL IS DARK WITH WHITE TYPE, BOTH SIDES
 * ===============================
 *
 * The preview drew `head` as a PALE tint with black type while the export
 * wrote a black band, so the sample showed a document the file has never
 * produced. `strong` is the dark step now and white goes on it. The api
 * pins its half in masterSheet/adjustmentRows.test.js.
 */
test('the preview paints white type on the dark head, never black', () => {
  // Both are needed: the fill without the colour is white-on-nothing, the
  // colour without the fill is white on white.
  assert.match(src, /const HEAD_TEXT = '#FFFFFF'/, 'the white is named once');
  assert.match(
    src, /const color = fill === fills\.head \? HEAD_TEXT : undefined/,
    'a Row on the head fill takes it',
  );
  assert.match(
    src, /background: fills\.head, color: HEAD_TEXT/,
    'and so does the table header',
  );
});

test('the default head is the DARK step, matching palette.js', () => {
  // A pale default here is the old design, and it is what the picker shows
  // before the served palette has loaded.
  const head = src.match(/const DEFAULT_FILLS = \{ head: '(#[0-9A-Fa-f]{6})'/)?.[1];
  assert.ok(head, 'DEFAULT_FILLS must name a head colour');
  // Luminance, not a hex match: the point is that white type is readable
  // on it, which a second copy of the hex would not prove.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(head.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  assert.ok(lum < 0.3, `head ${head} is too light for white type (luminance ${lum.toFixed(2)})`);
});

test('SIMPLE totals take the SECONDARY, because GRAND_FILL paints them', () => {
  // They wore the primary while simple.js painted the pale ground, which
  // is a shape the export never writes.
  const block = previewBlock('Simple');
  for (const label of ['AED Total', 'GBP Total']) {
    assert.ok(
      block.includes(`label="${label}" bold tint="soft"`),
      `${label} must take the secondary, not the primary`,
    );
  }
});

test('the preview shows adjustments only in the explicit tabled design', () => {
  // The plain `with-usd` design folds them into totals. The transparent
  // `with-usd-table` option keeps the named block.
  assert.doesNotMatch(src, /ADJUSTMENT\.label\} add on/, 'no inline row');
  assert.match(src, /label="Add ons"/, 'the block heading');
  assert.match(src, /adjustmentsInTable && \(/, 'table only when explicitly selected');
});

test('the plain preview shows net detail while the tabled preview keeps gross detail', () => {
  assert.match(src, /const bankGbpNet = SAMPLE\.bankGbp \+ ADJUSTMENT\.value - DEDUCTION\.value/);
  assert.match(src, /adjustmentsInTable \? SAMPLE\.bankGbp : bankGbpNet/);
  assert.match(src, /native=\{num\(totalGbpNet\)\}/, 'the visible GBP total includes adjustments');
});

test('the Add ons and Fees headings take the PRIMARY, like every other heading', () => {
  // `tint` alone maps to fills.head; `tint="soft"` is the secondary, which
  // is grey by default and made the block read as uncoloured.
  const rows = tabledBlock();

  for (const heading of ['Add ons', 'Fees']) {
    assert.match(
      rows, new RegExp(`label="${heading}" bold tint native`),
      `${heading} must use the primary, not tint="soft"`,
    );
  }
});

test('the sample shows BOTH halves of the block', () => {
  // With add ons alone the picker never shows what a fee looks like, and a
  // fee is the half that prints negative.
  assert.match(src, /const DEDUCTION = /);
  assert.match(src, /native=\{num\(-DEDUCTION\.value\)\}/, 'fees print negative');
});

test('the preview paints from `fills`, never a literal, or the swatches do nothing', () => {
  const rows = tabledBlock();
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(rows), 'no literal colour in the block');
  const painted = (rows.match(/fills=\{fills\}/g) || []).length;
  const drawn = (rows.match(/<Row /g) || []).length;
  assert.ok(drawn >= 4, `the block must draw both headings and both rows, saw ${drawn}`);
  assert.equal(painted, drawn, 'every row takes the chosen pair');
});

test('THE MIRROR: the preview draws what the export writes, and nothing it does not', () => {
  // It is kept in step BY HAND, and it drifted: the export stopped writing
  // the "1% FEE" line when the crypto charge moved onto the rows, and this
  // file kept drawing it for a week. The api pins the other half.
  // On the RENDERED label, not the prose: the comment explaining why the
  // row went still names it, and should.
  assert.ok(!src.includes('CRYPTO_FEE_RATE'), 'the old subtotal fee line is gone');
  assert.ok(!/label=\{?[`'"][^`'"]*% FEE/.test(src), 'and so is its label');

  // Every block the tabled design writes must appear here.
  for (const block of ['Add ons', 'Crypto charges', 'Fees']) {
    assert.ok(src.includes(`label="${block}"`), `${block} is missing from the sample`);
  }
});

test('the sample prints the RATE at six decimals, as the file does', () => {
  // 1.36 is not what the conversions used, and a reader checking 9,275 GBP
  // by hand against a 2dp rate lands 23 dollars out.
  assert.match(src, /const RATE = 1\.362553/);
  assert.match(src, /label="Rate"[^/]*native=\{num\(RATE, 6\)\}/);
});


/**
 * ===============================
 * * CONTRACT: the answer block, row for row
 * ===============================
 *
 * This file is a hand-maintained mirror of the export's `withUsd.js`, and
 * it went out of step the moment `Total Crypto` was added there: the sample
 * kept printing "Crypto" in the block above while naming only bank and cash
 * below, so it showed a document the export no longer produces.
 *
 * WRITTEN TWICE, NEVER READ ACROSS. `crm/web` and `crm/api` share no file,
 * and reading one from the other is not an exemption to that: either side
 * must build and test on a machine holding only itself. The API's half is
 * `masterSheet/answerBlock.test.js`, which asserts the builder writes
 * exactly these labels in exactly this order.
 *
 * Adding a row to the export means editing this list and that one.
 */
const ANSWER_BLOCK = [
  'Total bank',
  'Total Cash',
  // ABOVE the split: "Of which" divides the CASH total and must still sum
  // back to it. Crypto is not cash and never was.
  'Total Crypto',
  'Of which UK',
  'Of which Other',
  'UK send in GBP',
];

test('THE ANSWER BLOCK IS DRAWN IN FULL, and in order', () => {
  let at = -1;
  for (const label of ANSWER_BLOCK) {
    const found = src.indexOf(`label="${label}"`);
    assert.ok(found > -1, `the preview is missing "${label}", which the export writes`);
    assert.ok(found > at, `"${label}" is out of order against the export`);
    at = found;
  }
});

/**
 * ***************************************************
 * * A PROP IS DECLARED BY THE COMPONENT THAT USES IT
 * ***************************************************
 *
 * THE BUG THIS EXISTS FOR, 2026-09-12. `percentagesTable` was added to
 * `BreakdownPicker`'s signature, and the switch and the sample that read it
 * live in `Settings` below it. The file parsed, every source-text test
 * passed, and opening the panel threw "percentagesTable is not defined".
 *
 * Source tests cannot see scope, so this reconstructs it: every top level
 * function in the file that MENTIONS one of these names must also declare
 * it in its own parameter list.
 */
function componentsIn(file) {
  const text = fs.readFileSync(path.join(here, file), 'utf8');
  const starts = [...text.matchAll(/^(?:export default )?function (\w+)\(/gm)];
  return starts.map((m, i) => ({
    name: m[1],
    body: text.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : text.length),
  }));
}

test('every component reading a breakdown prop also destructures it', () => {
  // PLAIN `includes`, NEVER a built regex. The first version of this used
  // `new RegExp(\`\\b${prop}\\b\`)`, the escape collapsed to a literal
  // backspace character, nothing could ever match and the test passed
  // against a file broken on purpose. These names are distinctive enough
  // that a substring test is the honest one: "percentagesTable" is not
  // inside "onPercentagesTable", the P differs.
  const PROPS = ['percentagesTable', 'onPercentagesTable', 'Preview', 'fills'];

  let checked = 0;
  for (const { name, body } of componentsIn('BreakdownPicker.jsx')) {
    // The parameter list is everything up to the first `) {`.
    const params = body.slice(0, body.indexOf(') {') + 1);
    const rest = body.slice(params.length);

    for (const prop of PROPS) {
      if (!rest.includes(prop)) continue;
      checked += 1;
      // A PROP OR A LOCAL. `Preview` is computed inside BreakdownPicker
      // rather than passed in, and asking only about the parameter list
      // called that a bug. What matters is that the name is BOUND.
      const bound = params.includes(prop)
        || rest.includes(`const ${prop}`)
        || rest.includes(`let ${prop}`);
      assert.ok(
        bound,
        `${name} uses "${prop}" but never binds it: it will throw at render`,
      );
    }
  }

  // THE GUARD HAS TO HAVE SOMETHING TO GUARD. Zero means the walk matched
  // no components and every assertion above was skipped, which is exactly
  // how the first version of this test passed against a broken file.
  assert.ok(checked >= 4, `expected several prop uses to check, saw ${checked}`);
});

test('and the wrapper actually passes them down', () => {
  const picker = fs.readFileSync(path.join(here, 'BreakdownPicker.jsx'), 'utf8');
  const call = picker.slice(picker.indexOf('<Settings'), picker.indexOf('/>', picker.indexOf('<Settings')));
  assert.match(call, /percentagesTable=\{percentagesTable\}/);
  assert.match(call, /onPercentagesTable=\{onPercentagesTable\}/);
});

/**
 * ===============================
 * * ALL THREE RAILS, ON THE DESIGNS THAT DO NOT CONVERT
 * ===============================
 * `payment_method` is cash, bank or crypto. A sample naming only two says
 * the third produces nothing, which is the same class of fault as a design
 * with no preview at all.
 */
function previewBlock(name) {
  const from = src.indexOf(`function ${name}Preview`);
  assert.ok(from > 0, `${name}Preview must exist`);
  const to = src.indexOf('\nfunction ', from + 1);
  return src.slice(from, to > from ? to : src.length);
}

test('BOTH STAGES DRAW ALL THREE RAILS', () => {
  // `payment_method` is cash, bank or crypto. A sample naming only two
  // says the third produces nothing.
  for (const design of ['Simple', 'Standard']) {
    const block = previewBlock(design);
    for (const method of ['Bank', 'Cash', 'Crypto']) {
      assert.ok(block.includes(`label="${method}"`), `${design}Preview never names "${method}"`);
    }
  }
  // Only stage 2 totals PER METHOD. Stage 1 totals per currency.
  assert.ok(previewBlock('Standard').includes('label="Crypto Total"'));
  assert.ok(previewBlock('Simple').includes('label="GBP Total"'));
});

test('SIMPLE adds up: its grand total is computed from the lines it draws', () => {
  // A typed literal is how a sample starts disagreeing with itself, and
  // this design's whole claim is that the lines reach the total.
  assert.ok(
    src.includes('const simpleGrand = bankGbpNet + cashGbp + SAMPLE.cryptoGbp'),
    'the grand total must be the sum of the three rails the sample draws',
  );
  const block = previewBlock('Simple');
  assert.ok(block.includes('num(simpleGrand)'), 'and the row must print it');
  // NET on the bank line, or the block shows 2,500 above a 2,425 total.
  assert.ok(block.includes('num(bankGbpNet)'), 'the bank line is net of the add on and the fee');
  assert.ok(!block.includes('num(SAMPLE.bankGbp)'), 'never the gross figure');
});

test('the percentages switch shows its NAME, not just an aria-label', () => {
  // Toggle puts `label` on the element for screen readers and renders
  // nothing, so a switch given only that prop draws bare: no words, just a
  // sentence underneath with no clue what the control is called.
  const picker = fs.readFileSync(path.join(here, 'BreakdownPicker.jsx'), 'utf8');
  const NAME = 'Include percentage table';

  assert.ok(picker.includes(`label="${NAME}"`), 'the accessible name');
  assert.ok(picker.includes(`<span className="text-sm">${NAME}</span>`), 'and the visible one');
  // Wrapped in a <label> so the words toggle it too, same as SwitchRow.
  assert.ok(
    picker.includes('<label className="flex items-center gap-2.5">'),
    'the switch and its name must be one click target',
  );
});
