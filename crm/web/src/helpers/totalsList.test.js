import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { totalsList, formatTotalsWhole } from './formatMoney.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, '..', p), 'utf8');

test('nothing owed is the placeholder, never a zero', () => {
  for (const empty of [undefined, null, {}]) {
    assert.deepEqual(totalsList(empty), []);
    assert.equal(formatTotalsWhole(empty), '—');
  }
});

// ===============================
// * SORTED BY CODE
// ===============================
// The map's order is whatever Postgres aggregated it in, so an unsorted
// list could put a different currency at the front of the same card between
// two loads.
test('the order is the code, not the map', () => {
  const one = totalsList({ GBP: 23000, AED: 54335, EURO: 2500 });
  const two = totalsList({ EURO: 2500, GBP: 23000, AED: 54335 });

  assert.deepEqual(one.map((entry) => entry.currency), ['AED', 'EURO', 'GBP']);
  assert.deepEqual(one, two, 'the same money always lists the same way round');
});

test('the pence go, the currency stays, ISO or not', () => {
  const [aed, euro, gbp] = totalsList({ GBP: 23000.49, AED: 54335.5, EURO: 2500 });

  assert.equal(gbp.text, '£23,000');
  assert.match(aed.text, /^AED\s?54,336$/);
  // The sheet's own EURO is not an ISO code, so Intl throws and the
  // fallback puts the code in front. It must not come out bare.
  assert.equal(euro.text, 'EURO 2,500');
});

test('a column with room prints every currency', () => {
  assert.equal(
    formatTotalsWhole({ GBP: 23000, EURO: 2500 }),
    'EURO 2,500 · £23,000',
  );
});

// ===============================
// * THE NAME CANNOT BE CRUSHED BY THE FIGURE
// ===============================
// A RecordCard's lead is `shrink-0 whitespace-nowrap`, so three currencies
// printed inline took the whole header row and the company's own NAME
// truncated to nothing: money on screen and no idea whose.
test('a card shows one currency and puts the rest behind an icon', () => {
  const money = read('components/display/MoneyTotals.jsx');
  const card = read('components/display/RecordCard.jsx');
  const people = read('pages/PeoplePage.jsx');
  const companies = read('pages/CompaniesPage.jsx');

  assert.match(money, /const \[first, \.\.\.rest\] = list/);
  assert.match(money, /\+\{rest\.length\}/, 'the count says there is more money behind the icon');
  assert.match(money, /<CellInfo label=\{label\}>/);
  assert.match(money, /Never added together\./);
  assert.match(money, /whitespace-nowrap/);

  // The left half gets a real share of the row, not merely what is left.
  assert.match(card, /flex min-w-0 basis-0 flex-1 items-start gap-3/);
  // The lead stays unshrinkable on purpose: money is not truncated.
  assert.match(card, /<div className="shrink-0 text-right">/);

  // A long name is readable on hover, and only when it is actually cut.
  assert.match(card, /<TruncatedText className="max-w-full">\{title\}<\/TruncatedText>/);
  assert.match(card, /import TruncatedText from '\.\/TruncatedText'/);
  // The browser draws a `title` attribute as a SECOND native tooltip.
  assert.doesNotMatch(card, /title=\{title\}/);

  // Both cards use it, and both tables still print every currency.
  for (const [name, page] of [['People', people], ['Companies', companies]]) {
    assert.match(page, /lead=\{<MoneyTotals totals=\{[\w.]+\.monthly_totals\}/, `${name} card`);
    assert.match(page, /\{formatTotalsWhole\([\w.]+\.monthly_totals\)\}/, `${name} table`);
    // And neither page keeps its own copy of the formatting any more.
    assert.doesNotMatch(page, /function formatTotals/, `${name} still formats its own totals`);
  }
});
