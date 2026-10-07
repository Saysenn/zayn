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
  assert.deepEqual(gbp.missing, ['exchangeRate'], 'with no rate known, the rate is asked');
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

test('THE PREVIEW is WhatsApp formatting written by code: a field per line, separators, bold total', () => {
  const items = [
    normalise({ n: 1, spentOn: '2026-10-06', description: 'Taxi', payee: 'Careem', rawAmount: '45' }, ctx),
    normalise({ n: 2, spentOn: '', description: 'Ink', payee: 'Amazon', rawAmount: '180' }, ctx),
  ];
  const text = format.addPreview(items, 'MANBAT');
  assert.match(text, /^\*2 EXPENSES · MANBAT\*\n_Not saved yet_\n==================/);
  assert.match(text, /\*1\. Taxi\*\n• Amount: \*AED 45\.00\*\n• Date: 06 Oct 2026\n• Paid to: Careem\n• Spent by: Gary Test/);
  assert.match(text, /\*2\. Ink\* ⚠️\n• Amount: \*AED 180\.00\*\n• Date: ❓ _missing_/);
  assert.match(text, /\*TOTAL:\* \*AED 225\.00\*/);
  assert.match(text, /⚠️ \*Needs an answer\*\n• No\. 2: what date\?/);
  assert.match(text, /Reply with the answers \(like \*2 is 5 Oct\*\) · \*modify\* · \*cancel\*$/);
  assert.doesNotMatch(text, /is 150\* to fix/, 'yes, modify, cancel: never "1 is 150 to fix"');
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

test('NOT ABOUT EXPENSES: the router is told an admin\'s own pay is "other", handed back to WhatBot', () => {
  const src = require('fs').readFileSync(require.resolve('./understand'), 'utf8');
  assert.match(src, /other: anything NOT about the business\\'s expenses, above all the admin\\'s OWN pay/);
  const brain = require('fs').readFileSync(require.resolve('./brain'), 'utf8');
  assert.match(brain, /default:[\s\S]{0,250}\/\/ NOT ABOUT EXPENSES[\s\S]*?return HAND_OFF;/);
  assert.match(brain, /if \(reply === HAND_OFF\)[\s\S]*?return \{ registered: true, handOff: true \};[\s\S]*?if \(expired && reply\)/, 'checked before anything adds text to it');
});

test('FROM THE COMMAND CENTER: any group, read or asked; spent by asked, never assumed', () => {
  const all = { admin: { name: null }, group: '*', groups: ['INDIGO', 'MANBAT'], today: '2026-10-06' };
  const x = normalise({ n: 1, spentOn: '2026-10-06', description: 'Taxi', payee: 'Careem', rawAmount: '45', groupName: 'manbat' }, all);
  assert.equal(x.groupName, 'MANBAT', 'as the CRM spells it');
  assert.deepEqual(x.missing, ['spentBy']);
  const y = normalise({ n: 2, spentOn: '2026-10-06', description: 'Taxi', payee: 'Careem', rawAmount: '45', spentBy: 'Gary', groupName: 'Narnia' }, all);
  assert.deepEqual(y.missing, ['groupName']);
  assert.match(y.doubts[0], /"Narnia" is not a group/);
  const r = readReply('1 is MANBAT, 2 by Ali', { kind: 'add', items: [{ n: 1 }, { n: 2 }] }, { year: 2026, groups: ['INDIGO', 'MANBAT'] });
  assert.deepEqual(r.parts.map((p) => p.fixes[0]), [{ field: 'groupName', value: 'MANBAT' }, { field: 'spentBy', value: 'Ali' }]);
});

test('DIANE\'S VIEW: a preview is a card, the reply plain, and nothing becomes a deal link', () => {
  const { forDiane, plain } = require('./forDiane');
  const all = { admin: { name: null }, group: '*', groups: ['MANBAT'], today: '2026-10-06' };
  const items = [
    normalise({ n: 1, spentOn: '2026-10-06', description: 'Taxi', payee: 'Careem', rawAmount: '45', spentBy: 'Gary', groupName: 'MANBAT' }, all),
    normalise({ n: 2, spentOn: '', description: 'Ink', payee: 'Amazon', rawAmount: '180', spentBy: 'Gary', groupName: 'MANBAT' }, all),
  ];
  const state = { pending: { kind: 'add', items } };
  const out = forDiane(format.addPreview(items, '*'), state);
  assert.equal(out.card.kind, 'plan');
  assert.equal(out.card.title, '2 expenses · AED 225.00');
  assert.deepEqual(out.card.sections.map((s) => s.label), ['Needs an answer · 1', 'Ready · 1']);
  assert.equal(out.card.sections[1].rows[0].where, 'MANBAT · 06 Oct · paid to Careem · by Gary');
  assert.ok(!/[*_#]/.test(out.reply), out.reply);
  assert.equal(plain('✅ *Saved 1 expense* · _ok_ #3'), '✅ Saved 1 expense · ok no. 3');
});

test('YES, MODIFY, CANCEL: the line under a ready preview, and "modify" is understood', () => {
  const items = [normalise({ n: 1, spentOn: '2026-10-06', description: 'Taxi', payee: 'Careem', rawAmount: '45' }, ctx)];
  assert.match(format.addPreview(items, 'MANBAT'), /Reply \*yes\* to save · \*modify\* to change · \*cancel\*$/);
  for (const t of ['modify', 'Modify', 'change something', 'edit']) assert.deepEqual(readReply(t, { kind: 'add', items }), { kind: 'modify' }, t);
});

test('"NEW" ANSWERS THE DUPLICATE QUESTION, never a currency; only real codes are currencies', () => {
  const { currencyOf } = require('./check');
  const p = { kind: 'add', items: [{ n: 1 }, { n: 2 }] };
  assert.equal(currencyOf('new'), null);
  assert.equal(currencyOf('gbp'), 'GBP');
  assert.deepEqual(readReply('all new', p, { year: 2026 }).ok, [1, 2]);
  assert.deepEqual(readReply("they're all new ones", p, { year: 2026 }).ok, [1, 2]);
  assert.deepEqual(readReply('1 is new', p, { year: 2026 }).ok, [1]);
});

test('"NO, CANCEL THAT" CANCELS, in its many forms', () => {
  const p = { kind: 'edit' };
  for (const t of ['no cancel that', 'NO cancel that', 'no leave it', 'no leave those', 'forget it', 'nah scrap that', 'cancel']) {
    assert.deepEqual(readReply(t, p), { kind: 'no' }, t);
  }
});

test('THE RATE TO AED: market rate filled in, their own wins, missing is asked, and it is shown', () => {
  const live = { GBP: { rate: 4.86, source: 'hourly market rate' } };
  const x = normalise({ n: 1, spentOn: '2026-10-06', description: 'Train', payee: 'Trainline', rawAmount: '86.40', currency: 'GBP' }, { ...ctx, live });
  assert.equal(x.exchangeRate, 4.86);
  assert.equal(x.rateSource, 'hourly market rate');
  assert.deepEqual(x.missing, []);
  const own = normalise({ n: 1, spentOn: '2026-10-06', description: 'Train', payee: 'Trainline', rawAmount: '86.40', currency: 'GBP', rateGiven: 4.9 }, { ...ctx, live });
  assert.equal(own.exchangeRate, 4.9);
  const none = normalise({ n: 1, spentOn: '2026-10-06', description: 'Hotel', payee: 'X', rawAmount: '100', currency: 'JPY' }, ctx);
  assert.deepEqual(none.missing, ['exchangeRate']);
  const text = format.addPreview([x], 'MANBAT');
  assert.match(text, /• Rate: 1 GBP = 4\.86 AED _\(hourly market rate\)_\n• In AED: \*AED 419\.90\*/);
  assert.match(format.ratesBubble([x]), /💱 \*RATES TO AED\*[\s\S]*1 GBP = \*4\.86 AED\*/);
  assert.match(format.addPreview([none], 'MANBAT'), /No\. 1: 1 JPY to AED is\?/);
});

test('THEIR OWN RATE, in the ways people say it', () => {
  const { readRates } = require('./reply');
  assert.deepEqual(readRates('1 gbp to aed is 4.85'), { rates: { GBP: 4.85 } });
  assert.deepEqual(readRates('£1 = 4.9 aed'), { rates: { GBP: 4.9 } });
  assert.deepEqual(readRates('4.85 for pounds'), { rates: { GBP: 4.85 } });
  assert.deepEqual(readRates('1 usd to aed is 3.67, 1 euro to aed is 4.1'), { rates: { USD: 3.67, EUR: 4.1 } });
  assert.deepEqual(readRates('same as last time'), { lastUsed: true });
  assert.equal(readRates('2 is £45'), null, 'an amount, not a rate');
});

test('THE PICTURE: a PNG drawn by code, and a short caption that can still be answered', () => {
  const { renderCard } = require('./card');
  const items = [
    normalise({ n: 1, spentOn: '2026-10-06', description: 'Taxi', payee: 'Careem', rawAmount: '45' }, ctx),
    normalise({ n: 2, spentOn: '', description: 'Ink', payee: 'Amazon', rawAmount: '180' }, ctx),
  ];
  const png = renderCard(items, { group: 'MANBAT' });
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.ok(png.length > 5000, 'a real picture');
  const cap = format.caption(items, 'MANBAT');
  assert.match(cap, /^\*2 EXPENSES · MANBAT\* _\(not saved yet\)_\n\*TOTAL:\* \*AED 225\.00\*/);
  assert.match(cap, /• No\. 2: what date\?/);
  assert.match(cap, /Reply with the answers/);
  assert.match(format.caption(items, 'MANBAT', { saved: true }), /^✅ \*SAVED · 2 expenses · MANBAT\*[\s\S]*Reply \*undo\*/);
});
