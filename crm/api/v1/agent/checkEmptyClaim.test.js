const test = require('node:test');
const assert = require('node:assert/strict');
const { answeredFromMemory } = require('./checkEmptyClaim');

// 2026-09-28: "Nobody is up for review" with no tool (three were), and "Northstar
// Care and Workforce are in liquidation" with no tool (none are).
test('A QUESTION ABOUT THE DATA NEEDS A TOOL BEHIND THE ANSWER', () => {
  assert.equal(answeredFromMemory('Nobody is up for review this month.', { said: 'who is up for review this month in ZZTEST?', toolCount: 0 }), true);
  assert.equal(answeredFromMemory('Northstar Care and Workforce.', { said: 'which companies are in liquidation?', toolCount: 0 }), true);
  assert.equal(answeredFromMemory('Mid 1.', { said: 'and his role?', toolCount: 0 }), true);
  // A tool ran: the answer is its answer.
  assert.equal(answeredFromMemory('Northstar Care.', { said: 'which companies are in liquidation?', toolCount: 1 }), false);
});

test('BUT NOT CHAT, which has no data in it', () => {
  assert.equal(answeredFromMemory('I can read and change the sheet.', { said: 'what can you do?', toolCount: 0 }), false);
  assert.equal(answeredFromMemory('Nothing to add, sweetie.', { said: 'thanks', toolCount: 0 }), false);
  assert.equal(answeredFromMemory('All good, darling.', { said: 'how are you?', toolCount: 0 }), false);
});

test('A REQUEST ABOUT THE DATA COUNTS, question mark or not', () => {
  // "back up status" was answered "it passes its checksum" with no tool; not configured.
  assert.equal(answeredFromMemory('The backup passes its checksum.', { said: 'back up status', toolCount: 0 }), true);
  assert.equal(answeredFromMemory('Gloria has 4 deals.', { said: 'gloria deals', toolCount: 0 }), true);
  assert.equal(answeredFromMemory('It ran fine.', { said: 'did the backup run?', toolCount: 0 }), true);
  // "what are the months ahead" was answered with no tool: "months" was not a data word.
  assert.equal(answeredFromMemory('September and October.', { said: 'what are the months ahead', toolCount: 0 }), true);
});

test('AN INSTRUCTION IS LEFT TO ITS OWN GUARDS', () => {
  // Judged here too, "stop Bram's deal" cost a round and "delete Suki" went to the dead list.
  for (const said of ["stop Bram Okafor's deal at ZZ Close Co", 'set the tier of ZZ Rate Co B to T3', 'mark Dov as paid this month']) {
    assert.equal(answeredFromMemory('Shall I?', { said, toolCount: 0 }), false, said);
  }
});
