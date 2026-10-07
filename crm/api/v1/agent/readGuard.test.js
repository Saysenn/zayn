const test = require('node:test');
const assert = require('node:assert');
const { guardFilters } = require('./readGuard');

const g = (said, args, saidRecent = '') => guardFilters({ said, saidRecent, ...args });

test('CASH PAID IS HOW, NOT WHETHER: the live misread', () => {
  const r = g('hi show me cash paid deals in mlkman', { group: 'MILKMAN', paymentMethod: ['cash'], paid: true });
  assert.equal(r.args.paid, undefined);
  assert.deepEqual(r.args.paymentMethod, ['cash']);
  assert.deepEqual(r.dropped, ['paid status']);
  assert.equal(g('cash deals already paid in milkman', { paymentMethod: ['cash'], paid: true }).args.paid, true);
});

test('A FILTER WITH NO WORD BEHIND IT IS DROPPED', () => {
  assert.equal(g('show me everyone in INDIGO', { group: 'INDIGO', needsReview: true }).args.needsReview, undefined);
  assert.equal(g('who is on bank in nexus', { paymentMethod: ['bank'], missingBank: true }).args.missingBank, true, 'bank is the word');
  assert.equal(g('list milkman deals', { status: ['ended'] }).args.status, undefined);
  assert.deepEqual(g('who ended last month', { status: ['ended'] }).args.status, ['ended']);
  assert.equal(g('show deals in indigo', { companyStatus: ['liquidation'] }).args.companyStatus, undefined);
});

test('AN AMOUNT MUST BE ONE THEY SAID', () => {
  assert.equal(g('who is on more than 1k', { amountMin: 1000 }).args.amountMin, 1000);
  assert.equal(g('who is over 1,500 in indigo', { amountMin: 1500.01 }).args.amountMin, 1500.01);
  assert.equal(g('who earns the most in indigo', { amountMin: 2000 }).args.amountMin, undefined);
});

test('ONLY THE VALUES THEY NAMED', () => {
  assert.deepEqual(g('who is paid by cash', { paymentMethod: ['cash', 'bank'] }).args.paymentMethod, ['cash']);
  assert.deepEqual(g('who is paid in pounds', { currency: ['GBP', 'AED'] }).args.currency, ['GBP']);
  assert.deepEqual(g('deals at souracore', { company: ['Souracore'] }).args.company, ['Souracore']);
  assert.deepEqual(g('deals at sourcore', { company: ['Souracore'] }).args.company, ['Souracore'], 'one slip');
  assert.equal(g('show me milkman', { company: ['Reliapay'] }).args.company, undefined);
});

test('A FOLLOW UP KEEPS THE LAST MESSAGE\'S WORDS', () => {
  assert.deepEqual(g('and in milkman?', { paymentMethod: ['cash'] }, 'who is paid by cash in indigo').args.paymentMethod, ['cash']);
});

test('WORDS WITH ONE MEANING ADD THEIR FILTER', () => {
  const r = g('show me unpaid cash deals in indigo', { group: 'INDIGO' });
  assert.equal(r.args.paid, false);
  assert.deepEqual(r.args.paymentMethod, ['cash']);
  assert.deepEqual(r.added, ['unpaid', 'cash']);
  assert.equal(g('who is missing bank details', {}).args.paymentMethod, undefined, 'bank details is not the method');
  assert.deepEqual(g('who is paid in AED', {}).args.currency, ['AED']);
});

test('A PLAN STEP IS NOT READ AGAIN (its words were cleared)', () => {
  const r = guardFilters({ said: '', paid: true });
  assert.equal(r.args.paid, true);
});

test('A WRONG FILTER THAT WOULD LEAVE NOTHING NARROWED IS SENT BACK, not run wide', () => {
  assert.equal(guardFilters({ said: "who's on hold in milkman", group: 'MILKMAN', status: ['not_started'] }).emptied, true);
  assert.equal(guardFilters({ said: 'total for cash in indigo this month', paymentMethod: ['cash'], presetWhen: ['current'] }).args.presetWhen[0], 'current');
});

test('"this month" alone does not count as narrowing', () => {
  assert.equal(guardFilters({ said: "who's on hold in milkman", group: 'MILKMAN', status: ['not_started'], presetWhen: ['current'] }).emptied, true);
});
