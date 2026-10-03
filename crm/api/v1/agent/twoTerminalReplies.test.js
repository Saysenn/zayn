const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * ***************************************************
 * * THE FIRST REPLY CANNOT SPEAK FOR THE WHOLE SCREEN
 * ***************************************************
 *
 * Live 2026-09-18. "Competex pro has two people, which one? Or should I
 * show both?" was right. "Show both" then ran `find_and_show_details`
 * TWICE, one per person. Both cards were drawn, and the FIRST call's
 * sentence became the turn's whole answer:
 *
 *   "James McCamley has one deal. The full details are on screen."
 *
 * Two people on screen, a sentence about one.
 *
 * The turn loop is not unit testable without mocking a whole model round,
 * so this pins the SHAPE of the guard in the source: the shortcut must be
 * disqualified by a second terminal reply, not merely ignore it.
 */

const SRC = fs.readFileSync(
  path.join(__dirname, 'runAgent.js'), 'utf8',
);

test('a second, different terminal reply disqualifies the shortcut', () => {
  assert.match(SRC, /let terminalPartial = false;/);
  // Set when a SECOND tool hands back a different finished answer.
  assert.match(
    SRC,
    /if \(terminalReply && result\.reply !== terminalReply\) terminalPartial = true;/,
  );
  // And read by the shortcut, or setting it would change nothing.
  //
  // NOT PINNED TO WHAT FOLLOWS IT. This read `&& \(` and broke the day a
  // second disqualifier was added between the two, reporting a guard as
  // gone when it was untouched. What matters is that the shortcut reads
  // the flag, not what else it reads.
  assert.match(SRC, /if \(terminalReply && !terminalPartial\b/);
});

test('the FIRST reply is still taken when it is the only one', () => {
  // The shortcut exists to save a model round on an ordinary single tool
  // turn, which is most of them. Losing that would cost ~12 seconds an
  // answer, so the guard has to be narrow.
  assert.match(SRC, /else if \(!terminalReply\) \{/);
});

test('an identical reply twice is NOT partial', () => {
  // The round dedup already serves the first result to a duplicate call,
  // so the same summary can legitimately arrive twice. That is one answer,
  // not two, and must keep the shortcut.
  assert.match(SRC, /result\.reply !== terminalReply/);
});
