const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSetInstruction, isSpecialCaseInstruction, answeredWithoutWriting, correctionFor,
} = require('./setIntent');

/**
 * ***************************************************
 * * AN INSTRUCTION ANSWERED WITH A LOOKUP
 * ***************************************************
 *
 * Both of these are real, against the real model, 2026-09-23 and 24:
 *
 *   "make bram oakhurst a special case deal" -> "Bram Oakhurst's special
 *                                               case: No."
 *   "set quillon marsh payable days to 7"    -> "Quillon Marsh's payable
 *                                               days: 30."
 *
 * Each read back the CURRENT value of the field the admin was changing,
 * and in both runs the admin's next word was taken as the go ahead for a
 * change that had never been proposed.
 */

test('an imperative is an instruction', () => {
  for (const said of [
    'set quillon marsh payable days to 7',
    'make corin ashby a special deal',
    'change her monthly amount to 1200',
    'update the appointment date to 3 July',
    'mark zayn as paid',
    'undo that',
    'remove the fee',
    'can you set her days to 7?',
    'please change it to 12',
  ]) assert.equal(isSetInstruction(said), true, said);
});

test('a question is not an instruction, however it mentions a field', () => {
  for (const said of [
    'how many deals are reviewed monthly',
    'what is the total owed for september in gbp',
    'which deals are going concerns',
    'is bram a special case?',
    'show me quillon marsh',
    'list the deals in nexus',
    'tell me her payable days',
    'what would happen if i set her days to 7',
    'yes, go ahead',
    '',
  ]) assert.equal(isSetInstruction(said), false, said);
});

/* ===============================
 * * THE SPECIAL CASE SWITCH, WHICHEVER WAY IT IS ORDERED
 * =============================== */

test('every phrasing of the switch reaches the field', () => {
  // The switch reads "Make this deal Special Case", so these are what the
  // admin types. All three were tried live and behaved differently.
  for (const said of [
    'make wren halliday a special deal',
    'make bram oakhurst a special case deal',
    'make ilsa trenow a special deal case',
    'make mayah a special case',
    'stop wren being a special case',
    'remove the special case from ilsa',
    // The older wording, which carries its own verb.
    'pay them anyway this month',
  ]) assert.equal(isSpecialCaseInstruction(said), true, said);
});

test('asking ABOUT the switch is not setting it', () => {
  for (const said of [
    'is bram a special case?',
    'which deals are special cases',
    'what makes a special case',
    'should they be paid anyway',
  ]) assert.equal(isSpecialCaseInstruction(said), false, said);
});

/* ===============================
 * * THE TURN, NOT THE TOOL
 * =============================== */

test('it fires when the turn wrote nothing', () => {
  assert.equal(answeredWithoutWriting('set her days to 7', false, []), true);
});

test('it is silent once something wrote', () => {
  // Reading the deal first is RIGHT: she needs to know which row. The
  // fault is ending the turn on the lookup.
  assert.equal(answeredWithoutWriting('set her days to 7', true, []), false);
});

test('a question she HAD to ask is not a failure to act', () => {
  // More than one candidate means she must ask which, and pushing her past
  // that is the one thing resolvePerson exists to stop.
  assert.equal(answeredWithoutWriting('set her days to 7', false, [{ ambiguous: true }]), false);
});

test('an ordinary question never fires it', () => {
  assert.equal(answeredWithoutWriting('how many are active', false, []), false);
});

test('the special case correction names the field, the general one does not', () => {
  assert.match(correctionFor('make her a special case'), /specialCaseDeal/);
  assert.doesNotMatch(correctionFor('set her days to 7'), /specialCaseDeal/);
  // Both have to send her to a tool, or she looks it up again.
  assert.match(correctionFor('set her days to 7'), /Call the tool that makes it/);
});

test('"take 5% off ines" is an instruction, so answering without a tool is caught', () => {
  assert.equal(isSetInstruction('take 5% off ines pardew'), true);
});

test('"mark them as paid" is sent to the PAID SWITCH, never the review', () => {
  assert.match(correctionFor('mark suki varnell and ines pardew as paid'), /overridePaid: true/);
  assert.doesNotMatch(correctionFor('set her payable days to 19'), /overridePaid/);
});

test('"end his deals marked for review" is an instruction, sent to the review answer', () => {
  const said = "end dov ashgrove's deals that are marked for review";
  assert.equal(isSetInstruction(said), true);
  assert.match(correctionFor(said), /bulk_answer_monthly_review/);
  assert.equal(isSetInstruction('close ZZ Close Co'), true);
});

test('"end of the month" is a question, never an instruction', () => {
  assert.equal(isSetInstruction('end of the month, what do we owe?'), false);
});

// 2026-09-28: "add gloria and zayn together" was taken as an edit.
test('A SUM ASKED FOR IS NOT AN EDIT', () => {
  for (const said of ['add gloria and zayn together', 'add them up', 'can you add up milkman and nexus']) {
    assert.equal(isSetInstruction(said), false, said);
  }
  // A real add still is one.
  assert.equal(isSetInstruction('add 500 to Suki'), true);
  assert.equal(isSetInstruction('add a 5% fee to Dov'), true);
});

test('GIVE ME, SHOW ME, and a sum with a conversion are not edits', () => {
  for (const said of ['give me her totals and the percentage rates', 'show me gloria', 'add Gloria and Gloria Difference then convert it to USD']) {
    assert.equal(isSetInstruction(said), false, said);
  }
  for (const said of ['give Suki a 3% fee', 'add a 5% fee to Dov and Ines', 'add 500 to Suki and Ines']) {
    assert.equal(isSetInstruction(said), true, said);
  }
});

/**
 * ***************************************************
 * * A SLIP IN THE VERB IS STILL THE VERB
 * ***************************************************
 *
 * Live 2026-09-29: "aupdate A J Rayson status" was not read as an
 * instruction, so the turn fell through to the lookup path and drew a
 * chooser at somebody who had just given an order. One letter.
 *
 * THE DANGEROUS DIRECTION IS THE OTHER ONE. Reading a QUESTION as an
 * instruction is what moves money nobody asked to move, so the tolerance
 * is only allowed on the FIRST word, only at five letters, and never on an
 * inflection of the verb, which is a real word and not a typo.
 */
test('A MISTYPED VERB IS STILL AN INSTRUCTION', () => {
  for (const said of [
    'aupdate A J Rayson status',   // an extra letter, his own
    'udpate her status',           // the commonest swap
    'chnage her days to 7',        // the other commonest swap
    'updte her status',            // a dropped letter
  ]) {
    assert.equal(isSetInstruction(said), true, said);
  }
});

test('AND AN ORDINARY WORD NEAR A VERB IS NOT', () => {
  // Every one of these is a LOOKUP. "closer" is one letter from "close",
  // and read as a slip it turns a question into a change.
  for (const said of [
    'closer look at zayn',
    'closed deals this month',
    'changes this week',
    'updates for zayn',
    'removed people',
    'deleted rows',
    'stopped deals',
    'renamed companies',
    'increased amounts',
    'ending soon?',
    'undone work',
  ]) {
    assert.equal(isSetInstruction(said), false, said);
  }
});

test('AND A QUESTION IS STILL A QUESTION, slip or no slip', () => {
  // The position is what makes the whole test work, so the tolerance must
  // not reach past the first word.
  for (const said of [
    'what would happen if I set her days to 7',
    'which deals are marked reviewed monthly',
    'show me gloria',
    'total for MILKMAN',
  ]) {
    assert.equal(isSetInstruction(said), false, said);
  }
});

test('A SHORT VERB TAKES NO SLIP AT ALL', () => {
  // "add", "end" and "put" are one edit from ordinary words, so allowing a
  // slip there would cost more than it saves.
  assert.equal(isSetInstruction('and zayn to the sheet'), false);
  assert.equal(isSetInstruction('odd rows this month'), false);
});

/**
 * ***************************************************
 * * THE COLUMNS THAT ARE NOT MONEY
 * ***************************************************
 *
 * 2026-09-29. Every example tried until then moved a FIGURE, so the sweep
 * that found these was the first time anybody asked what happens to a
 * status, a date or a switch. Three verbs were simply missing.
 */
test('RESUME, REOPEN AND ANSWER ARE INSTRUCTIONS', () => {
  for (const said of [
    'resume zayn milkman deal',
    'reopen zz close co',
    'restart zayn deal',
    'answer yes for zayn milkman',
  ]) assert.equal(isSetInstruction(said), true, said);
});

test('AND THEIR ORDINARY WORDS ARE STILL LOOKUPS', () => {
  for (const said of [
    'resumed deals',
    'reopened companies',
    'answers this month',
    'show me answers',
  ]) assert.equal(isSetInstruction(said), false, said);
});

test('"SPECIAL" ON ITS OWN IS THE SWITCH', () => {
  // "make zayn special" and "stop zayn being special" both missed, because
  // the matcher wanted the noun after it. Nothing else on a deal is called
  // special, so the word alone is not ambiguous.
  for (const said of [
    'make zayn milkman special',
    'stop zayn milkman being special',
    'make zayn milkman a special case',
  ]) assert.equal(isSpecialCaseInstruction(said), true, said);
});

test('BUT ASKING ABOUT IT IS STILL ASKING', () => {
  for (const said of [
    'is zayn special?',
    'which deals are special cases',
    'what makes a special case',
  ]) assert.equal(isSpecialCaseInstruction(said), false, said);
});

// TERSE ORDERS, gpt-4.1 bulk sweep 2026-10-06: each was read as a lookup.
test('a terse order with no verb in front is still an order; a lookup is not', () => {
  const { isSetInstruction } = require('./setIntent');
  for (const s of [
    'dudcut 200 to kiran vales deals', 'kiran vale monthly 2750 every deal', 'switch all kiran vale deals to aed',
    'door no 12b for kiran all deals', 'label all kiran deals VIP', 'kiran accepts postals, set it on all',
    'note on every kiran deal: chase the invoice', 'kiran vale fee 5% everywhere', 'end date 31 dec for all of kirans deals',
    'kiran shouldnt get paid this month on any deal', 'add 100 to zayn deals',
  ]) assert.equal(isSetInstruction(s), true, s);
  for (const s of [
    'how much is kiran owed', 'show all kiran deals', 'list kiran vale deals', 'what is kirans monthly?',
    'kiran vale', 'total for milkman this month', 'who is paid by bank', 'is kiran paid on any deal?', 'closer look at zayn',
  ]) assert.equal(isSetInstruction(s), false, s);
});
