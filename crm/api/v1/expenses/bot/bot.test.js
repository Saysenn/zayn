const test = require('node:test');
const assert = require('node:assert');
const { readReply } = require('./reply');
const { normalise, duplicates, ready } = require('./check');
const format = require('./format');
const { dayOf, moneyOf } = require('./extract');
const { e164 } = require('./store');

const admin = { name: 'Gary Test' };
const ctx = { admin, group: 'MANBAT', today: '2026-10-06' };

test('THE GUARD\'S PHONE: every way a number is written is one number', () => {
  assert.equal(e164('+44 7700 900001'), '+447700900001');
  assert.equal(e164('447700900001'), '+447700900001');
  assert.equal(e164('(+44) 7700-900001'), '+447700900001');
  assert.equal(e164('hello'), null);
});

test('ANSWERS TO A PREVIEW are read in code, all of it or none of it', () => {
  const p = { kind: 'add', items: [{ n: 1 }, { n: 2 }, { n: 3, missing: ['spentOn'] }] };
  const r = (s) => readReply(s, p, { year: 2026 });
  assert.deepEqual(r('yes please'), { kind: 'yes' });
  assert.deepEqual(r('cancel'), { kind: 'no' });
  assert.deepEqual(r('skip 2 and 3'), { kind: 'skip', which: [2, 3] });
  assert.deepEqual(r('only 1'), { kind: 'only', which: [1] });
  assert.deepEqual(r('2 is 150').parts, [{ which: [2], fixes: [{ field: 'rawAmount', value: 150 }] }]);
  assert.deepEqual(r('3 is 5 Oct').parts, [{ which: [3], fixes: [{ field: 'spentOn', value: '2026-10-05' }] }]);
  assert.deepEqual(r('2 paid to Careem, 3 is today').parts.map((x) => x.fixes[0].field), ['payee', 'spentOn']);
  assert.deepEqual(r('2 is £45').parts[0].fixes, [{ field: 'rawAmount', value: 45 }, { field: 'currency', value: 'GBP' }]);
  assert.deepEqual(r('3 is fine').ok, [3]);
  assert.equal(r('4 is 150'), null, 'no expense 4');
  assert.equal(r('2 is about 150 i think'), null, 'unclear goes to the model');
  assert.equal(r('actually it was 18 and yesterday'), null);
  assert.deepEqual(readReply('2', { kind: 'pick', choices: [7, 8] }), { kind: 'pick', n: 2 });
  assert.equal(readReply('3', { kind: 'pick', choices: [7, 8] }), null);
});

test('EVERY FIELD REQUIRED; AED when no currency is said; the group is the bot\'s; spent by the admin', () => {
  const x = normalise({ n: 1, spentOn: '2026-10-06', description: 'Taxi', payee: '', rawAmount: '45', currency: '' }, ctx);
  assert.equal(x.currency, 'AED');
  assert.equal(x.exchangeRate, 1);
  assert.equal(x.groupName, 'MANBAT');
  assert.equal(x.spentBy, 'Gary Test');
  assert.deepEqual(x.missing, ['payee']);
  assert.ok(!ready([x]));
  const y = normalise({ n: 2, spentOn: '', description: 'Lunch', payee: 'Zuma', rawAmount: '120', currency: 'dirhams', spentBy: 'Ali' }, ctx);
  assert.deepEqual(y.missing, ['spentOn']);
  assert.equal(y.spentBy, 'Ali');
});

test('DOUBTS are shown, not blocking; a rate note is neither', () => {
  const big = normalise({ n: 1, spentOn: '2026-10-06', description: 'Laptop', payee: 'Apple', rawAmount: '25000' }, ctx);
  assert.match(big.doubts[0], /large amount/);
  assert.ok(ready([big]), 'a doubt does not stop a save');
  const future = normalise({ n: 1, spentOn: '2026-12-01', description: 'X', payee: 'Y', rawAmount: '5' }, ctx);
  assert.match(future.doubts[0], /future/);
  const gbp = normalise({ n: 1, spentOn: '2026-10-06', description: 'Train', payee: 'Trainline', rawAmount: '45', currency: 'GBP' }, ctx);
  assert.equal(gbp.flag, false, 'no rate yet is a note');
  assert.match(gbp.notes[0], /no GBP to AED rate yet/);
  const fine = normalise({ n: 1, spentOn: '2026-10-06', description: 'Laptop', payee: 'Apple', rawAmount: '25000', ok: true }, ctx);
  assert.deepEqual(fine.doubts, [], '"1 is fine" clears it');
});

test('LOOKS ALREADY SAVED, or twice in one batch: a doubt, never merged', () => {
  const items = [
    normalise({ n: 1, spentOn: '2026-10-05', description: 'Printer ink', payee: 'Amazon', rawAmount: '180' }, ctx),
    normalise({ n: 2, spentOn: '2026-10-05', description: 'Printer ink', payee: 'Amazon', rawAmount: '180' }, ctx),
  ];
  duplicates(items, [{ spent_on: '2026-10-05', raw_amount: '180.00', currency: 'AED', description: 'Printer ink' }]);
  assert.match(items[0].doubts.join(), /looks already saved: Printer ink on 05 Oct/);
  assert.match(items[1].doubts.join(), /same as 1/);
});

test('THE PREVIEW is WhatsApp formatting written by code: problems first, one line saying what to reply', () => {
  const items = [
    normalise({ n: 1, spentOn: '2026-10-06', description: 'Taxi', payee: 'Careem', rawAmount: '45' }, ctx),
    normalise({ n: 2, spentOn: '', description: 'Ink', payee: 'Amazon', rawAmount: '180' }, ctx),
  ];
  const text = format.addPreview(items, 'MANBAT');
  assert.match(text, /^\*2 expenses for MANBAT\* \(not saved yet\)/);
  assert.match(text, /⚠️ \*1 needs an answer\*\n2\. Ink: _date missing_/);
  assert.match(text, /1\. Taxi · \*AED 45\*\n {3}06 Oct · paid to Careem · by Gary Test/);
  assert.match(text, /Total \*AED 225\*/);
  assert.match(text, /Answer the ⚠️ ones \(like \*2 is 5 Oct\*\)/);
  assert.ok(!/\*\*|^#/m.test(text), 'never Markdown');
});

test('FILE CELLS: dates day first, amounts with their currency', () => {
  assert.equal(dayOf('06/10/2026', 2026), '2026-10-06');
  assert.equal(dayOf('6 Oct', 2026), '2026-10-06');
  assert.equal(dayOf('Oct 6th 2026', 2026), '2026-10-06');
  assert.equal(dayOf('31/13/2026', 2026), null);
  assert.deepEqual(moneyOf('AED 1,250.50'), { amount: 1250.5, currency: 'AED' });
  assert.deepEqual(moneyOf('£45'), { amount: 45, currency: 'GBP' });
});

test('A TYPO IN AN EDIT WORD still goes to the router, never saved as a new expense', () => {
  const { editish } = require('./brain');
  assert.ok(editish("chnage yestrday's uber to 35"), 'swapped letters');
  assert.ok(editish('updte the taxi 50'), 'one letter missing');
  assert.ok(editish("yesterday's lunch was 130"), 'a possessive points at something saved');
  assert.ok(!editish('taxi to the office 45 paid to careem'), 'a plain new expense');
  assert.ok(!editish('uber 32 to dubai mall'));
});

test('SAME PAYEE, SAME DAY, ANOTHER AMOUNT: asked whether it is new or a change', () => {
  const items = [normalise({ n: 1, spentOn: '2026-10-05', description: 'Uber to airport', payee: 'Uber', rawAmount: '50' }, ctx)];
  duplicates(items, [{ spent_on: '2026-10-05', raw_amount: '35.00', currency: 'AED', payee: 'Uber', description: 'Uber' }]);
  assert.match(items[0].doubts[0], /another Uber on 05 Oct \(AED 35\): new, or a change to that one\?/);
});
