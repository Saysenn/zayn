const test = require('node:test');
const assert = require('node:assert');
const { renderTable, worthAPicture } = require('./table');
const { pictureFor, payableTotal } = require('./fromAgent');

const row = (name, extra = {}) => ({ id: 1, name, company: 'Workforce', role: 'Mid 1', group: 'INDIGO', amount: 'GBP 500', currency: 'GBP', payable: 500, method: 'cash', paid: null, ...extra });
const list = (n, extra) => ({ type: 'list', list: { title: `${n} deals`, rows: Array.from({ length: n }, (_, i) => row(`P${i}`, extra)) } });

test('A PICTURE ONLY FOR A LONG RESULT, and never on plain text', () => {
  assert.equal(pictureFor(list(3), 'sheet'), null, '3 rows stay a card');
  assert.ok(pictureFor(list(4), 'sheet').pngs[0].subarray(1, 4).toString() === 'PNG');
  assert.equal(pictureFor(list(10), 'text'), null);
  assert.equal(worthAPicture({ style: 'sheet', sections: [{ rows: [{}, {}, {}, {}] }] }), true);
});

test('LONG TABLES ARE PAGES, the total on the last', () => {
  const pngs = renderTable({ title: 'Deals', columns: [{ label: 'Name' }], sections: [{ rows: Array.from({ length: 60 }, (_, i) => ({ cells: [`P${i}`] })) }], total: { value: 'GBP 1' } });
  assert.equal(pngs.length, 3);
});

test('THE PAYABLE TOTAL IS ADDED IN CODE, per currency', () => {
  assert.equal(payableTotal([row('a'), row('b', { payable: 474.19 }), row('c', { currency: 'AED', payable: 4100 })]), 'GBP 974.19  +  AED 4,100.00');
});

test('a sheet check and a plan both draw, in both styles', () => {
  const check = { type: 'check', check: { monthName: 'October 2026', rows: 90, total: 4, sections: [{ label: 'Pays wrong', rows: [1, 2, 3, 4].map((i) => ({ id: i, who: `P${i}`, where: 'INDIGO · Gab', fault: 'past its end date 2026-07-07, unanswered, still paying' })) }] } };
  const plan = { type: 'list', list: { kind: 'plan', title: 'Raise 4 deals', sections: [{ label: 'Raise', rows: [1, 2, 3, 4].map((i) => ({ name: `P${i}`, where: 'INDIGO', detail: 'GBP 500 → 525' })) }] } };
  for (const style of ['sheet', 'notebook']) {
    assert.ok(pictureFor(check, style).pngs.length === 1);
    assert.ok(pictureFor(plan, style).pngs.length === 1);
  }
});
