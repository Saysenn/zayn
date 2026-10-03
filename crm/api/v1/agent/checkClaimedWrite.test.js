const test = require('node:test');
const assert = require('node:assert/strict');
const { claimedWrite, claimedStop } = require('./checkClaimedWrite');

// 2026-09-25: "yes", no tool call, and "Bram Okafor's profile fee was
// increased by 4%". Nothing had been written.

test('A YES TURN THAT WROTE NOTHING MAY NOT SAY IT CHANGED', () => {
  const reply = "Bram Okafor's profile fee was increased by 4%, lovely.";
  assert.equal(claimedWrite(reply, { said: 'yes', wrote: false }), true);
  assert.equal(claimedWrite(reply, { said: 'yes', wrote: true }), false, 'it did write');
  assert.equal(claimedWrite(reply, { said: 'what is bram on?', wrote: false }), false, 'not an agreement');
});

test('saying nothing changed, or what WOULD change, is not a claim', () => {
  for (const reply of [
    "Orla's add on is already 0%, so nothing was changed.",
    'His fee would be set to 5%. Shall I?',
    'No change was made.',
  ]) assert.equal(claimedWrite(reply, { said: 'yes', wrote: false }), false, reply);
});

test('a closure or a stop reported as done is a claim too', () => {
  const reply = "Dov Ashgrove's 2 deals have been ended as of the end of last month.";
  assert.equal(claimedWrite(reply, { said: 'yes', wrote: false }), true);
  assert.equal(claimedWrite('ZZ Close Co was closed.', { said: 'yes', wrote: false }), true);
});

test('HER OWN ACT with nothing written is a claim on ANY turn', () => {
  const reply = "Which of Ines's deals? Meanwhile, I've added 500 to Suki Varnell's payable amount this month.";
  assert.equal(claimedWrite(reply, { said: 'add 500 on suki and 750 on ines', wrote: false }), true);
  assert.equal(claimedWrite(reply, { said: 'add 500 on suki and 750 on ines', wrote: true }), false);
  // A question about the sheet, answered, is not an act.
  assert.equal(claimedWrite('Her fee is now 2%.', { said: 'what is her fee?', wrote: false }), false);
});

// 2026-09-28: "stop Suki's deal" wrote Should be paid = No, then she said the
// deal "has been stopped and moved to the Archive". Nothing stopped it.
test('A DEAL SAID STOPPED MUST HAVE BEEN STOPPED BY A TOOL THAT STOPS', () => {
  const said = "Suki Varnell's deal at ZZ Rate Co A has been stopped and moved to the Archive.";
  assert.equal(claimedStop(said, { wrote: true, stopped: false }), true);
  assert.equal(claimedStop('It was moved to the Archive.', { wrote: true, stopped: false }), true);
  assert.equal(claimedStop(said, { wrote: true, stopped: true }), false, 'stop_deal ran');
  // A read turn about a past stop is history, not a claim.
  assert.equal(claimedStop("Lee's deal was stopped on 24 September.", { wrote: false, stopped: false }), false);
  assert.equal(claimedStop('Nothing was stopped.', { wrote: true, stopped: false }), false);
});
