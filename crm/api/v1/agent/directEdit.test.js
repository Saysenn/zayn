const test = require('node:test');
const assert = require('node:assert');
const { parseEdit, callFor, followUp } = require('./directEdit');

const roster = {
  people: ['Zayn', 'Paddy', 'Johnathon', 'Craig Sterling', 'Dean Cole', 'Zayn Malik'],
  groups: ['INDIGO', 'MILKMAN', 'MANBAT', 'ALL GROUPS'],
};
const read = (s) => parseEdit(s, roster);

test('THE EVERYDAY EDITS are read exactly', () => {
  assert.deepEqual(read('add 5 days to zayn payable days'),
    { person: 'Zayn', group: null, allDeals: false, field: 'payableDays', op: 'add', value: 5 });
  assert.deepEqual(read('deduct 500 to paddy'),
    { person: 'Paddy', group: null, allDeals: false, field: 'monthlyAmount', op: 'add', value: -500 });
  assert.deepEqual(read('add 100 to zayn indigo'),
    { person: 'Zayn', group: 'INDIGO', allDeals: false, field: 'monthlyAmount', op: 'add', value: 100 });
  assert.deepEqual(read('deduct 500 from paddy payable'),
    { person: 'Paddy', group: null, allDeals: false, field: 'payableAmount', op: 'add', value: -500 });
  assert.deepEqual(read('set paddy payable days to 20'),
    { person: 'Paddy', group: null, allDeals: false, field: 'payableDays', op: 'set', value: 20 });
  assert.deepEqual(read('paddy payable days 31'),
    { person: 'Paddy', group: null, allDeals: false, field: 'payableDays', op: 'set', value: 31 });
  assert.deepEqual(read('zayn indgo 4500 monthly pls'), null, 'the figure is not last: not read, she takes it');
  assert.deepEqual(read('change zayn indgo monthly to 4500'),
    { person: 'Zayn', group: 'INDIGO', allDeals: false, field: 'monthlyAmount', op: 'set', value: 4500 });
  assert.deepEqual(read('add 50 to all zayn deals'),
    { person: 'Zayn', group: null, allDeals: true, field: 'monthlyAmount', op: 'add', value: 50 });
  assert.deepEqual(read('take 1.5k off zayn milkman'),
    { person: 'Zayn', group: 'MILKMAN', allDeals: false, field: 'monthlyAmount', op: 'add', value: -1500 });
  assert.deepEqual(read("add 100 to zayn's deals"),
    { person: 'Zayn', group: null, allDeals: true, field: 'monthlyAmount', op: 'add', value: 100 });
});

test('AN OPENER AND PLURAL DEALS are read too', () => {
  assert.deepEqual(read('cool. deduct 100 to all deals of zayn'),
    { person: 'Zayn', group: null, allDeals: true, field: 'monthlyAmount', op: 'add', value: -100 });
  assert.equal(read('add 100 to zayns deals').allDeals, true);
  assert.equal(read('add 100 to zayn deal').allDeals, false);
});

test('ANYTHING IT DOES NOT FULLY UNDERSTAND goes to her, untouched', () => {
  for (const s of [
    'add 100 to johnny nobody', // nobody by that name
    'add 100 to craig sterling and dean cole', // two people
    'set paddy payable days to 31 and how much is he owed', // a second ask
    'from next month raise paddy monthly to 14000', // a later month
    'give zayn indigo a 2% add on', // a rate
    'set paddy to 500', // a figure for no field
    'how much is paddy owed', // a question
    'show me zayns deals',
    'stop paddy deal',
    'undo that',
    'add a deal for sweep tester',
    'add 100 to zayn because he asked nicely', // words it does not know
  ]) assert.equal(read(s), null, s);
});

test('THE LONGER NAME WINS, so "zayn malik" is never Zayn', () => {
  assert.equal(read('add 100 to zayn malik').person, 'Zayn Malik');
});

test('THE CALL IS THE ONE SHE WOULD HAVE SENT', () => {
  assert.deepEqual(callFor(read('add 5 days to zayn payable days')),
    { name: 'update_master_sheet_row', args: { targetPerson: 'Zayn', add: { payableDays: 5 } } });
  assert.deepEqual(callFor(read('set paddy payable days to 20')),
    { name: 'update_master_sheet_row', args: { targetPerson: 'Paddy', payableDays: 20 } });
  assert.deepEqual(callFor(read('add 50 to all zayn deals')),
    { name: 'bulk_update_master_sheet', args: { perPerson: [{ person: 'Zayn', allDeals: true, add: { monthlyAmount: 50 } }] } });
});

test('"BOTH" OR A GROUP ANSWERS HER QUESTION with the edit asked a moment ago', () => {
  const asked = 'Zayn has 2 deals. Which group should get the change, or both?';
  assert.deepEqual(followUp('both', 'add 5 days to zayn payable days', asked, roster),
    { person: 'Zayn', group: null, allDeals: true, field: 'payableDays', op: 'add', value: 5 });
  assert.equal(followUp('indigo', 'add 5 days to zayn payable days', asked, roster).group, 'INDIGO');
  assert.equal(followUp('the milman one', 'add 5 days to zayn payable days', asked, roster).group, 'MILKMAN');
  assert.equal(followUp('show me zayns deals', 'add 5 days to zayn payable days', asked, roster), null);
  assert.equal(followUp('both', 'add 5 days to zayn payable days', 'Done.', roster), null, 'only after her question');
});

test('TWO LETTERS SWAPPED is one typo: "zyan indgo" is Zayn in INDIGO', () => {
  assert.deepEqual(read('add 100 to zyan indgo'),
    { person: 'Zayn', group: 'INDIGO', allDeals: false, field: 'monthlyAmount', op: 'add', value: 100 });
  assert.equal(read('add 100 to nayz'), null, 'more than one typo is not a guess it makes');
});

test('"SAME FOR PADDY" repeats the last edit on someone else; "what about paddy?" does not', () => {
  const { sameFor } = require('./directEdit');
  const done = 'Done. Zayn: monthly 3,800 → 3,300.';
  const want = { person: 'Paddy', group: null, allDeals: false, field: 'monthlyAmount', op: 'add', value: -500 };
  assert.deepEqual(sameFor('same for paddy', 'deduct 500 to zayn', done, roster), want);
  assert.deepEqual(sameFor('paddy too', 'deduct 500 to zayn', done, roster), want);
  assert.deepEqual(sameFor('do the same for paddy', 'deduct 500 to zayn', done, roster), want);
  assert.deepEqual(sameFor('and paddi as well', 'deduct 500 to zayn', done, roster), want, 'one slip in the name');
  assert.equal(sameFor('what about paddy?', 'deduct 500 to zayn', done, roster), null, 'could be a question');
  assert.equal(sameFor('same for nobody', 'deduct 500 to zayn', done, roster), null, 'not on the sheet');
  assert.equal(sameFor('same for paddy', 'how much is zayn owed', done, roster), null, 'nothing to repeat');
  assert.equal(sameFor('same for paddy', 'deduct 500 to zayn', 'Which deal: INDIGO or MILKMAN?', roster), null, 'she was asking');
});
