const test = require('node:test');
const assert = require('node:assert/strict');
const { asksUndo, undoSentence } = require('./undoIntent');

test('A "YES" OR AN "UNDO THAT" IS READ OFF THE MESSAGE BEFORE IT', () => {
  const saidRecent = 'undo the tier change on Acqua. yes';
  assert.equal(undoSentence({ said: 'yes', saidRecent }), saidRecent);
  assert.equal(undoSentence({ said: 'undo that', saidRecent: 'set the tier of Acqua to T3. undo that' }), 'set the tier of Acqua to T3. undo that');
  // A sentence that says what it means is its own, whatever came before.
  assert.equal(undoSentence({ said: "undo Bram's preset change", saidRecent: 'set tier to T3' }), "undo Bram's preset change");
});

test('PUTTING A VALUE BACK IS A SET, not an undo', () => {
  assert.equal(asksUndo('undo the tier change'), true);
  assert.equal(asksUndo('revert that'), true);
  assert.equal(asksUndo('put ZZ Close Co back to active'), false);
});
