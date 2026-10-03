const test = require('node:test');
const assert = require('node:assert/strict');
const { fieldsAsked, fieldAnswer, labelsIn } = require('./fieldAsked');

/**
 * ***************************************************
 * * THE RICHARD TURN, the half nobody answered
 * ***************************************************
 *
 * "okay whats richard payable days" drew his card and replied "Richard is
 * owed GBP 500 for September 2026". The number asked for was on screen.
 *
 * The card below is `dealCard`'s real shape, values already through
 * `readable`, so the labels are exactly the ones the admin sees.
 */
const CARD = {
  id: 91,
  name: 'Richard',
  groups: [
    {
      title: 'The deal',
      cells: [
        { label: 'Group', value: 'ALL GROUPS', editField: 'groupName' },
        { label: 'Role', value: 'Loss lead', editField: 'roleLabel' },
        { label: 'Company', value: 'Workforce', editField: 'company' },
        { label: 'Status', value: 'Active', editField: 'status' },
      ],
    },
    {
      title: 'Money',
      cells: [
        { label: 'Monthly', value: '500', editField: 'monthlyAmount' },
        { label: 'Payable', value: '500', editField: 'payableAmount' },
        { label: 'Payable days', value: '30', editField: 'payableDays' },
        { label: 'Currency', value: 'GBP', editField: 'currency' },
        { label: 'Method', value: 'cash', editField: 'paymentMethod' },
      ],
    },
    {
      title: 'Contact and bank',
      cells: [
        { label: 'Phone', value: null, editField: 'phone' },
        { label: 'Sort code', value: '20 - 82 - 23', editField: 'sortCode' },
      ],
    },
  ],
};

test('the question that started this is answered with the value', () => {
  const fields = fieldsAsked(CARD, 'okay whats richard payable days');
  assert.deepEqual(fields.map((f) => f.label), ['Payable days']);
  assert.equal(
    fieldAnswer('Richard', fields),
    "Richard's payable days: 30.",
  );
});

// ===============================
// * "PAYABLE" LIVES INSIDE "PAYABLE DAYS"
// ===============================
// Answering the amount to a question about the day count is the exact
// fault this file exists for.
test('the longest label wins', () => {
  assert.deepEqual(labelsIn(
    CARD.groups.flatMap((g) => g.cells),
    'whats his payable days',
  ), ['Payable days']);
});

test('but the amount is still reachable on its own', () => {
  const fields = fieldsAsked(CARD, 'what is his payable');
  assert.deepEqual(fields.map((f) => f.label), ['Payable']);
});

test('and both when both are said', () => {
  const fields = fieldsAsked(CARD, 'give me his payable and his payable days');
  assert.deepEqual(fields.map((f) => f.label), ['Payable', 'Payable days']);
  assert.equal(fieldAnswer('Richard', fields), 'Richard: payable 500, payable days 30.');
});

test('a two word label is matched through its spacing', () => {
  const fields = fieldsAsked(CARD, "what's his sort code");
  assert.deepEqual(fields.map((f) => f.value), ['20 - 82 - 23']);
});

test('an empty cell answers "not set" rather than nothing', () => {
  const fields = fieldsAsked(CARD, 'what is his phone');
  assert.equal(fieldAnswer('Richard', fields), "Richard's phone: not set.");
});

test('naming no field at all answers nothing, so the card stays the answer', () => {
  assert.deepEqual(fieldsAsked(CARD, 'can you show me richards details'), []);
  assert.equal(fieldAnswer('Richard', []), null);
});

test('cells come back in card order, not the order they were said', () => {
  const fields = fieldsAsked(CARD, 'his method and his role');
  assert.deepEqual(fields.map((f) => f.label), ['Role', 'Method']);
});

test('the money labels are marked, for the guard that asks', () => {
  assert.equal(fieldsAsked(CARD, 'his monthly')[0].money, true);
  assert.equal(fieldsAsked(CARD, 'his payable days')[0].money, false);
});

/**
 * ***************************************************
 * * THE COLUMNS THAT WERE NOT ON THE CARD
 * ***************************************************
 *
 * "Does Gloria accept postals" matched no label, so it fell through to
 * drawing the whole card. Fourteen of a deal's columns were unanswerable
 * that way. The card carries them now, and the two that were already on it
 * in another shape are read where they live rather than duplicated.
 */
const FULL = {
  id: 91,
  name: 'Gloria',
  groups: [
    {
      title: 'The deal',
      cells: [
        { label: 'Role', value: 'Mid 1', editField: 'roleLabel' },
        { label: 'Label', value: 'VIP', editField: 'label' },
        { label: 'Source', value: 'synced', editField: null },
      ],
    },
    {
      title: 'Money',
      cells: [
        { label: 'Payable', value: '500', editField: 'payableAmount' },
        { label: 'Add on %', value: 3, editField: 'addonPercent' },
        { label: 'Person add on %', value: 5, editField: null },
      ],
    },
    {
      title: 'Contact and bank',
      cells: [
        { label: 'Door number', value: '14a', editField: 'doorNumber' },
        { label: 'Accepting postals', value: 'Yes', editField: 'acceptingPostals' },
      ],
    },
  ],
  switches: [
    { label: 'Should be paid', value: null, editField: 'overrideShouldBePaid', fallback: true },
    { label: 'Paid', value: true, editField: 'overridePaid', fallback: false },
  ],
  sheetSays: { shouldBePaid: 'yes pls', paid: null },
};

test('the question that started this: does she accept postals', () => {
  const fields = fieldsAsked(FULL, 'does gloria accept postals');
  assert.equal(fieldAnswer('Gloria', fields), "Gloria's accepting postals: Yes.");
});

test('a switch is answerable where it lives, not as a duplicate cell', () => {
  const fields = fieldsAsked(FULL, 'has gloria been paid');
  assert.deepEqual(fields.map((f) => f.label), ['Paid']);
  assert.equal(fieldAnswer('Gloria', fields), "Gloria's paid: yes.");
});

// An untouched override is NULL, a real third state, and saying "no" would
// be reporting a decision nobody has made.
test('an undecided switch says so, and says what it defaults to', () => {
  const fields = fieldsAsked(FULL, 'should gloria be paid');
  assert.equal(fields[0].value, 'not decided, defaults to yes');
});

test("the sheet's own words are a different fact from the switch", () => {
  const fields = fieldsAsked(FULL, 'what does the sheet say about should be paid');
  assert.ok(fields.some((f) => f.label === 'Should be paid on the sheet'));
});

test('the deal rate and the person rate are both answerable, and kept apart', () => {
  assert.deepEqual(fieldsAsked(FULL, 'whats his add on').map((f) => f.label), ['Add on %']);
  assert.deepEqual(fieldsAsked(FULL, 'whats his person add on').map((f) => f.label), ['Person add on %']);
});

test('door number, label and source all answer now', () => {
  assert.equal(fieldsAsked(FULL, 'whats her door number')[0].value, '14a');
  assert.equal(fieldsAsked(FULL, 'whats her label')[0].value, 'VIP');
  assert.equal(fieldsAsked(FULL, 'where did this row come from, whats the source')[0].value, 'synced');
});

// ===============================
// * A SHORT LABEL NEEDS A REAL WORD
// ===============================
// `End` lives in "send", "spend" and "weekend"; `Role` lives in "payroll".
const SHORT = {
  groups: [{
    title: 'Dates',
    cells: [
      { label: 'End', value: '2026-12-31', editField: 'endOn' },
      { label: 'Role', value: 'Mid 1', editField: 'roleLabel' },
      { label: 'Payable days', value: 30, editField: 'payableDays' },
    ],
  }],
};

test('a short label does not match inside another word', () => {
  assert.deepEqual(fieldsAsked(SHORT, 'did you send it'), []);
  assert.deepEqual(fieldsAsked(SHORT, 'what about the weekend'), []);
  assert.deepEqual(fieldsAsked(SHORT, 'how much payroll is that'), []);
});

test('but it still matches when it IS the word', () => {
  assert.deepEqual(fieldsAsked(SHORT, 'whats his end date').map((f) => f.label), ['End']);
  assert.deepEqual(fieldsAsked(SHORT, 'whats his role').map((f) => f.label), ['Role']);
});

test('a two word label is matched by its words, in any order', () => {
  assert.deepEqual(fieldsAsked(SHORT, 'his payable days').map((f) => f.label), ['Payable days']);
  assert.deepEqual(fieldsAsked(SHORT, 'how many days are payable').map((f) => f.label), ['Payable days']);
});

/**
 * ***************************************************
 * * WHAT TALKING TO HER FOUND, 2026-09-17
 * ***************************************************
 *
 * Every one of these is a real turn from a live audit, not an invented
 * phrasing. That is the rule `askShapes.js` follows and the reason these
 * lists stay usable.
 */
const LIVE = {
  name: 'Richard',
  groups: [
    {
      title: 'The deal',
      cells: [
        { label: 'Company', value: 'Workforce', editField: 'company' },
        {
          label: 'Company status',
          value: 'active',
          editField: null,
          options: ['active', 'liquidation', 'dissolved', 'closed'],
        },
        { label: 'Status', value: 'Active', editField: 'status' },
      ],
    },
    {
      title: 'Money',
      cells: [
        { label: 'Monthly', value: '500', editField: 'monthlyAmount' },
        { label: 'Payable this month', value: 'No, payable days is 0', editField: null },
        { label: 'Payable days', value: 0, editField: 'payableDays' },
      ],
    },
    {
      title: 'Contact and bank',
      cells: [{ label: 'Location', value: 'Main City', editField: 'location' }],
    },
  ],
};

const asked = (said) => fieldsAsked(LIVE, said).map((f) => f.label);

// "Located" is not a prefix of "location" and neither is a prefix of the
// other, so only a stem catches the pair.
test('"where is he located" reaches the Location cell', () => {
  assert.deepEqual(asked('where is he located'), ['Location']);
});

// "Active" is a VALUE of Status, not a word in any label.
test('"is he active" reaches Status through its value', () => {
  assert.deepEqual(asked('is he active'), ['Status']);
});

// THE UNQUALIFIED CELL WINS AN UNQUALIFIED WORD. `active` is also one of
// Company status' options, and bailing left the question unanswered.
test('and not Company status, which holds the same word', () => {
  assert.equal(asked('is he active').includes('Company status'), false);
});

/**
 * A VOCABULARY WORD STRENGTHENS A LABEL, it never qualifies one alone.
 * "Liquidating" plus half of "Company status" beats "Company" on its own.
 */
test('"is his company liquidating" reaches Company status, not Company', () => {
  assert.deepEqual(asked('is richard\'s company liquidating'), ['Company status']);
  assert.deepEqual(asked('has his company closed'), ['Company status']);
});

test('but the plain company question still answers the NAME', () => {
  assert.deepEqual(asked('whats his company'), ['Company']);
});

// Same length, so neither prefixes the other, and their suffixes cut to
// different stems: "liquidat" and "liquid". Compared on the stems, they
// are one word.
test('liquidating and liquidation are the same word', () => {
  assert.deepEqual(asked('is his company in liquidation'), ['Company status']);
  assert.deepEqual(asked('is his company liquidating'), ['Company status']);
});

/**
 * AND A STATUS WORD ON ITS OWN NAMES NOTHING, deliberately.
 *
 * This is the same rule seen from the other side. If a vocabulary word
 * could qualify a cell by itself, "is he active" would be answered about
 * the COMPANY rather than the deal. The price is that a sentence naming
 * only the status and no part of the label goes to the card instead, which
 * is the safe way to be wrong.
 */
test('a status word alone does not name the cell', () => {
  assert.deepEqual(asked('is it in liquidation'), []);
});

// At a prefix of five, "this MONTH" reached the MONTHLY amount, so the
// answer to "why is he not payable" carried his rate.
test('"this month" does not reach the Monthly rate', () => {
  assert.deepEqual(asked('why is he not payable this month'), ['Payable this month']);
  assert.deepEqual(asked('whats his monthly'), ['Monthly']);
});

test('the reason is what that cell holds, not a yes or a no', () => {
  const [field] = fieldsAsked(LIVE, 'why is he not payable this month');
  assert.equal(field.value, 'No, payable days is 0');
});
