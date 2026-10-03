const test = require('node:test');
const assert = require('node:assert/strict');
const { screenReading } = require('./screenReading');

const check = {
  monthName: 'September 2026',
  rows: 90,
  total: 3,
  sections: [
    {
      key: 'paysWrong', label: 'PAYS WRONG', count: 1,
      rows: [{ id: 1, who: 'Alex Example', where: 'ALPHA · Northstar Care', fault: 'payable 2,000 over monthly 1,250' }],
    },
    {
      key: 'worthALook', label: 'WORTH A LOOK', count: 2,
      rows: [{ id: 2, who: 'Blake Example', where: 'BETA · Northstar Care', fault: 'no phone' }],
      // The card cut this one; the voice must not.
      all: [
        { id: 2, who: 'Blake Example', where: 'BETA · Northstar Care', fault: 'no phone' },
        { id: 3, who: 'Casey Example', where: 'BETA · Northstar Care', fault: 'no phone' },
      ],
    },
  ],
};

test('NOTHING DRAWN, NOTHING CHANGES', () => {
  assert.deepEqual(screenReading('Hi.', []), { reply: 'Hi.', spoken: null });
});

test('A SHEET CHECK REPLACES HER PARTIAL LINE WITH EVERY SECTION', () => {
  const out = screenReading('The biggest issues are 2 deals.', [{ type: 'check', check }]);
  assert.doesNotMatch(out.reply, /biggest issues/);
  assert.match(out.reply, /3 things to look at across 90 deals/);
  assert.match(out.reply, /Pays wrong: 1\./);
  assert.match(out.reply, /Worth a look: 2\./);
});

test('AND READS EVERY ROW ALOUD, the ones the card cut included', () => {
  const { spoken } = screenReading('x', [{ type: 'check', check }]);
  assert.match(spoken, /Alex Example, ALPHA, Northstar Care: payable 2,000 over monthly 1,250\./);
  assert.match(spoken, /Casey Example, BETA, Northstar Care: no phone\./);
});

test('A LIST IS READ IN FULL, after her own line', () => {
  const list = {
    title: '2 deals across every group',
    rows: [
      { id: 1, name: 'Alex Example', group: 'ALPHA', company: 'Northstar Care', role: 'Tech', amount: 'GBP 900' },
      { id: 2, name: 'Blake Example', group: 'BETA', company: 'Northstar Care', role: 'Admin', amount: 'AED 4,000' },
    ],
  };
  const out = screenReading('Two deals.', [{ type: 'list', list }]);
  assert.equal(out.reply, 'Two deals.', 'the bubble keeps her line; the card shows the rows');
  assert.match(out.spoken, /^Two deals\./);
  assert.match(out.spoken, /Alex Example, ALPHA, Northstar Care, Tech, GBP 900\./);
  assert.match(out.spoken, /Blake Example, BETA, Northstar Care, Admin, AED 4,000\./);
});

test('A DEAL CARD READS EVERY FIELD IT SHOWS, never an empty one', () => {
  const card = {
    name: 'Alex Example',
    headline: 'GBP 900',
    payableThisMonth: true,
    groups: [{ title: 'THE DEAL', cells: [{ label: 'Group', value: 'ALPHA' }, { label: 'Phone', value: null }] }],
  };
  const { spoken } = screenReading('Here.', [{ type: 'card', card }]);
  assert.match(spoken, /Alex Example, GBP 900\. Payable this month\./);
  assert.match(spoken, /Group ALPHA/);
  assert.doesNotMatch(spoken, /Phone/);
});

test('A COMPANY LIST IS READ ROW BY ROW', () => {
  const list = {
    kind: 'companies',
    title: '1 company',
    rows: [{ name: 'Northstar Care', statusLabel: 'Active', groups: 'ALPHA', dealsText: '3 deals, 2 handlers', amount: 'GBP 1,200' }],
  };
  assert.match(screenReading('One.', [{ type: 'list', list }]).spoken, /Northstar Care, Active, ALPHA, 3 deals, 2 handlers, GBP 1,200\./);
});

test('AN OPEN OFFER UNDER A DRAWN LIST IS DROPPED, a real question is kept', () => {
  const list = { title: 't', rows: [{ name: 'Alex Example' }] };
  const shown = [{ type: 'list', list }];
  assert.equal(screenReading('5 companies in ALPHA. What would you like to do next, darling?', shown).reply, '5 companies in ALPHA.');
  assert.equal(screenReading('Two deals. Which deal would you like to update?', shown).reply, 'Two deals. Which deal would you like to update?');
});

test('A DRAWN LIST IS NOT RECITED BACK, and a real question is kept', () => {
  const list = { kind: 'companies', title: '5', rows: ['Alpha Co', 'Beta Co', 'Gamma Co', 'Delta Co', 'Echo Co'].map((name) => ({ name })) };
  const shown = [{ type: 'list', list }];
  assert.equal(
    screenReading('There are 5 companies in ALPHA. They include Alpha Co, Beta Co, Gamma Co, Delta Co and Echo Co.', shown).reply,
    'There are 5 companies in ALPHA.',
  );
  const card = [{ type: 'card', card: { name: 'Alex Example', groups: [] } }];
  assert.equal(screenReading("Alex Example's deal is stopped. Would you like me to resume it first?", card).reply,
    "Alex Example's deal is stopped. Would you like me to resume it first?");
});

test('A RECITAL INSIDE THE COUNTING SENTENCE IS CUT WHERE THE NAMES BEGIN', () => {
  const list = { title: '6', rows: ['Gary', 'Gloria', 'James Heath', 'Klaud', 'Smurf'].map((name) => ({ name })) };
  assert.equal(
    screenReading('MANBAT has 6 deals held by 5 people: Gary, Gloria, James Heath, Klaud and Smurf.', [{ type: 'list', list }]).reply,
    'MANBAT has 6 deals held by 5 people.',
  );
});
