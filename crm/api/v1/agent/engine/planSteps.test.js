const test = require('node:test');
const assert = require('node:assert');
const {
  looksMultiStep, readReply, callsFor, pendingPlan, planCard,
} = require('./planSteps');

const plan = {
  id: 'p1',
  status: 'preview',
  request: 'x',
  steps: [
    { n: 1, action: 'update', person: 'Zayn', ids: [413], changes: [{ field: 'monthlyAmount', mode: 'add', value: '100' }], lines: [] },
    { n: 2, action: 'update', person: 'Paddy', ids: [94], changes: [{ field: 'payableDays', mode: 'set', value: '20' }], lines: [] },
    { n: 3, action: 'stop', person: 'Juno Park', deals: [{ person: 'Juno Park', company: 'Harbor Nine', group: 'BAKER' }], changes: [], lines: [] },
  ],
};

test('SEVERAL CHANGES IN ONE MESSAGE are a plan; one change is not', () => {
  assert.equal(looksMultiStep('add 100 to zayn indigo, set paddy days to 20 and stop juno'), true);
  assert.equal(looksMultiStep('add 100 to zayn indigo then deduct 50 from paddy'), true);
  assert.equal(looksMultiStep('add 100 to craig and dean'), false, 'one change, two people');
  assert.equal(looksMultiStep('set paddy payable days to 31 and how much is he owed'), false, 'a change and a question');
  assert.equal(looksMultiStep('add a deal for Sweep Tester, role Mid 1, group ZZTEST, company Scratch Alpha'), false);
  assert.equal(looksMultiStep('undo that and then add 100 to zayn'), false, 'an undo always asks on its own');
  assert.equal(looksMultiStep('how much is zayn owed'), false);
});

test('A REPLY TO THE PLAN is read the way a person means it', () => {
  assert.deepEqual(readReply('yes', plan), { kind: 'all' });
  assert.deepEqual(readReply('yes, do it', plan), { kind: 'all' });
  assert.deepEqual(readReply('cancel', plan), { kind: 'cancel' });
  assert.deepEqual(readReply('yes but skip 3', plan), { kind: 'skip', steps: [3], run: true });
  assert.deepEqual(readReply('skip 2 and 3', plan), { kind: 'skip', steps: [2, 3], run: false });
  assert.deepEqual(readReply('do all but the stop', plan), { kind: 'skip', steps: [3], run: true });
  assert.deepEqual(readReply('yes except juno', plan), { kind: 'skip', steps: [3], run: true });
  assert.deepEqual(readReply('make step 1 4600', plan), { kind: 'value', step: 1, value: 4600 });
  assert.deepEqual(readReply('no, the indigo one for zayn', plan), { kind: 'revise' });
  assert.deepEqual(readReply('also add 50 to otto', plan), { kind: 'revise' });
});

test('EACH STEP IS THE CALL SHE WOULD HAVE MADE, confirmed, and a later month is parked', () => {
  assert.deepEqual(callsFor(plan.steps[0]), [{ name: 'update_master_sheet_row', args: { id: 413, add: { monthlyAmount: 100 }, confirmed: true } }]);
  assert.deepEqual(callsFor(plan.steps[1]), [{ name: 'update_master_sheet_row', args: { id: 94, payableDays: 20, confirmed: true } }]);
  assert.deepEqual(callsFor(plan.steps[2]), [{ name: 'stop_deal', args: { person: 'Juno Park', company: 'Harbor Nine', group: 'BAKER', confirmed: true } }]);
  assert.deepEqual(callsFor({ ...plan.steps[1], when: '2026-11' }), [{
    name: 'park_for_month',
    args: { tool: 'update_master_sheet_row', args: { id: 94, payableDays: 20 }, months: ['2026-11'], confirmed: true },
  }]);
});

test('THE PLAN WAITING ON THEM is the one on the card just before their message', () => {
  const card = planCard(plan);
  const history = [
    { role: 'user', content: 'add 100 to zayn, set paddy days to 20 and stop juno' },
    { role: 'assistant', content: '[listed]', list: card },
    { role: 'assistant', content: "Here's the plan" },
    { role: 'user', content: 'yes' },
  ];
  assert.equal(pendingPlan(history).id, 'p1');
  assert.equal(pendingPlan([...history, { role: 'assistant', content: 'Done' }, { role: 'user', content: 'yes' }]), null, 'not a plan two messages back');
  assert.equal(pendingPlan([history[0], { role: 'assistant', content: '[listed]', list: planCard({ ...plan, status: 'done' }) }, { role: 'user', content: 'yes' }]), null, 'a finished plan waits on nothing');
});

test('THE CARD says what each step is, and marks a stop', () => {
  const card = planCard(plan);
  assert.equal(card.kind, 'plan');
  assert.equal(card.title, '3 changes');
  assert.match(card.sections[2].label, /⛔ Stop/);
});

// THE BOX'S PREVIEW, 2026-10-08: what she understood, in one plain line.
test('THE PREVIEW SAYS WHAT SHE UNDERSTOOD, by action, with the names', () => {
  const card = planCard({ ...plan, status: 'preview' });
  assert.match(card.note, /I understood: change \d+ deals? for [^;]+; stop 1 deal for Juno Park\./);
  assert.doesNotMatch(planCard({ ...plan, status: 'done' }).note, /I understood/, 'a finished plan says what was done instead');
});

test('AN UNUSUAL ITEM IS NAMED UNDER "CHECK FIRST", by its number', () => {
  const odd = { ...plan, status: 'preview', steps: plan.steps.map((s, i) => (i === 1 ? { ...s, lines: [{ ...(s.lines?.[0] ?? {}), detail: 'this deal is stopped' }] } : s)) };
  assert.match(planCard(odd).note, /Check first: 2 \(/);
  assert.doesNotMatch(planCard({ ...plan, status: 'preview' }).note, /Check first/, 'nothing unusual, no line');
});

test('A PLAN LEFT 30 MINUTES IS CLOSED: a yes then is not to it', () => {
  const card = planCard({ ...plan, status: 'preview' });
  const history = [{ role: 'user', content: 'do it all' }, { role: 'assistant', content: '[listed]', list: card }, { role: 'user', content: 'yes' }];
  assert.ok(pendingPlan(history), 'fresh, it waits');
  const old = { ...card, plan: { ...card.plan, at: Date.now() - 31 * 60 * 1000 } };
  assert.equal(pendingPlan([history[0], { ...history[1], list: old }, history[2]]), null);
});
