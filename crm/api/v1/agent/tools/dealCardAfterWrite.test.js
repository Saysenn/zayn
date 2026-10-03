const test = require('node:test');
const assert = require('node:assert/strict');

const { dealCard } = require('./masterSheet');
const { recomputePayable } = require('../../shared/recomputePayable.helper');

/**
 * ***************************************************
 * * What she hands back after a write
 * ***************************************************
 *
 * `add_deal` and `update_master_sheet_row` used to return `summarizeRow`
 * alone: id, name, role, group, company, payable amount, currency, status,
 * the two rates and the method. NO DATES.
 *
 * So an admin filled an appointment date into her form, four more cells
 * moved, and the only place any of it appeared was one sentence. Both
 * tools return the full card now, which is the server's own answer rather
 * than something the browser painted and might have to take back.
 *
 * HER FORM DOES NOT WRITE, deliberately: it sends the values back as an
 * ordinary turn and she calls the tool, so there is one write path with
 * one set of validation and one change log entry. That is why the fix is
 * what she RETURNS and not an optimistic patch in the overlay.
 */

const cellsOf = (card) => Object.fromEntries(
  card.groups.flatMap((g) => g.cells).map((c) => [c.editField, c.value]),
);

test('the card carries every cell the cascade moves', () => {
  const card = dealCard({
    id: 12,
    person_name: 'Rae Example',
    role_label: 'Director',
    group_name: 'GROUP ONE',
    company: 'Monument',
    assigned_on: '2026-04-15',
    payment_start_on: '2026-07-14',
    end_on: '2027-04-15',
    preset_on: '2026-07-01',
    monthly_amount: 1000,
    payable_days: 18,
    payable_amount: 580.65,
    currency: 'GBP',
    payment_method: 'cash',
  });

  const cells = cellsOf(card);
  // The one the admin types, and the four that follow it. A chip carried
  // exactly one of these five.
  assert.ok('assignedOn' in cells, 'appointment date');
  assert.ok('paymentStartOn' in cells, 'payment start');
  assert.ok('endOn' in cells, 'end date');
  assert.ok('payableDays' in cells, 'payable days');
  assert.ok('payableAmount' in cells, 'payable amount');
});

test('and the values on it are the ones the cascade produced', () => {
  // Row 12 of master.xlsx with the appointment moved to 15 April: the
  // same worked example the cascade tests use.
  const stored = {
    assigned_on: new Date('2026-01-20T00:00:00Z'),
    payment_start_on: new Date('2026-04-20T00:00:00Z'),
    end_on: new Date('2027-01-20T00:00:00Z'),
    preset_on: new Date('2026-07-01T00:00:00Z'),
    monthly_amount: 1000,
    payable_days: 31,
    payable_amount: 1000,
  };
  const fields = { assignedOn: new Date('2026-04-15T00:00:00Z') };
  recomputePayable(stored, fields);

  // The row as the repo would return it after that patch landed.
  const card = dealCard({
    id: 12,
    person_name: 'Rae Example',
    role_label: 'Director',
    group_name: 'GROUP ONE',
    company: 'Monument',
    assigned_on: fields.assignedOn,
    payment_start_on: fields.paymentStartOn,
    end_on: fields.endOn,
    preset_on: stored.preset_on,
    monthly_amount: 1000,
    payable_days: fields.payableDays,
    payable_amount: fields.payableAmount,
    currency: 'GBP',
    payment_method: 'cash',
  });

  const cells = cellsOf(card);
  assert.match(String(cells.paymentStartOn), /2026-07-14|14 Jul/);
  assert.match(String(cells.endOn), /2027-04-15|15 Apr/);
  assert.equal(String(cells.payableDays), '18');
  assert.match(String(cells.payableAmount), /580\.65/);
});

test('BOTH write tools hand back a card, not only a chip', () => {
  const src = require('node:fs').readFileSync(require.resolve('./masterSheet.js'), 'utf8');
  // add_deal and update_master_sheet_row. Asserted on the source because
  // the handlers need a database to run.
  const returns = [...src.matchAll(/cards: \[dealCard\(row\)\]/g)];
  assert.ok(
    returns.length >= 2,
    'add_deal and update_master_sheet_row must each return the finished row',
  );
});

test('the chip stays too, so nothing that reads rows breaks', () => {
  const src = require('node:fs').readFileSync(require.resolve('./masterSheet.js'), 'utf8');
  // `rows` feeds her own counting guards and the deal list. Replacing it
  // with the card rather than adding to it would have been a silent change
  // to what checkFigures sees.
  const both = /cards: \[dealCard\(row\)\],\s*\n\s*rows: \[summarizeRow\(row\)\]/;
  assert.match(src, both);
});
