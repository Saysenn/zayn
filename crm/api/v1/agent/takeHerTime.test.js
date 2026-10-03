const test = require('node:test');
const assert = require('node:assert/strict');
const { unbackedAsk } = require('./checkUnbackedAsk');
const { foldIntoSet } = require('./knownArgs');
const { checkVerdict, withVerdict } = require('./checkVerdict');
const { KEEPS_REVIEW } = require('./setIntent');
const {
  remember, recallAll, declined, dropShown,
} = require('./confirmReplay');
const { claimedWrite } = require('./checkClaimedWrite');

// 2026-09-25, one replayed conversation. Each guard here closes a turn that
// answered before the tools had done the work.

test('A "SHALL I?" ON AN INSTRUCTION WITH NOTHING PENDING is caught', () => {
  const reply = 'Taking 1% off Suki means a fee of 1%. Should I go ahead and do that?';
  assert.equal(unbackedAsk(reply, { said: 'take 1% off suki varnell', pending: false, applied: false }), true);
  assert.equal(unbackedAsk(reply, { said: 'take 1% off suki varnell', pending: true, applied: false }), false, 'a real pending');
  assert.equal(unbackedAsk(reply, { said: "keep ines pardew's review deal going", pending: false, applied: false }), true);
});

test('an offer after a QUESTION, or a "which one?", is not caught', () => {
  assert.equal(unbackedAsk('She is on 5%. Would you like me to open her card?', { said: 'is suki on 5%?', pending: false, applied: false }), false);
  assert.equal(unbackedAsk('Which of her two deals, ZZ Close Co or ZZ Rate Co A?', { said: 'add 750 on ines', pending: false, applied: false }), false);
});

test('A RATE SENT BESIDE `set` IS MOVED INTO IT, never refused as a filter', () => {
  const tool = { parameters: { properties: { company: {}, set: { properties: { feePercent: {} } } } } };
  assert.deepEqual(foldIntoSet(tool, { company: 'ZZ Rate Co B', feePercent: 1 }), { company: 'ZZ Rate Co B', set: { feePercent: 1 } });
  // A top level key of the same name stays a filter.
  const both = { parameters: { properties: { paid: {}, set: { properties: { paid: {} } } } } };
  assert.deepEqual(foldIntoSet(both, { paid: true }), { paid: true });
});

const verdictResult = (line) => ({ summary: `OPEN YOUR ANSWER WITH THIS SENTENCE, word for word: "${line}" Then answer.` });

test('THE VERDICT IS PUT FIRST by code when her answer dropped it', () => {
  const results = [verdictResult('No. Dov Ashgrove is on 2% fee, not 3%.')];
  const reply = 'Dov Ashgrove has a 2% fee on their profile, not 3%.';
  assert.match(withVerdict(reply, results, { said: 'is dov on a 3% fee?' }), /^No\. Dov Ashgrove is on 2% fee, not 3%\. Dov/);
});

test('two people with the SAME first name, each line said, is never said twice', () => {
  const results = [
    verdictResult('Yes. Bram Tevish is on 2% add on on every deal.'),
    verdictResult('No. Bram Okafor is on 0% add on, not 2%.'),
  ];
  const reply = 'Yes. Bram Tevish is on 2% add on on every deal. No. Bram Okafor is on 0% add on, not 2%.';
  assert.equal(checkVerdict(reply, results).ok, true);
  assert.equal(withVerdict(reply, results), reply);
});

test('A BARE "NO" DROPS WHAT WAS SHOWN, so a later yes applies nothing', () => {
  for (const said of ['no', 'No.', 'nope', 'cancel', 'leave it']) assert.equal(declined(said), true, said);
  for (const said of ['no, set it to 4%', 'not yet?', 'yes']) assert.equal(declined(said), false, said);
  const shown = 'Zed Example at Co A: paid: off to on. Shall I?';
  remember('bulk_update_master_sheet', { people: ['Zed Example'] }, 'Zed Example at Co A: paid: off to on');
  dropShown(shown);
  assert.deepEqual(recallAll('yes', shown), []);
});

test('"keep her review deal going" is recognised, and claiming it kept is a claim', () => {
  assert.equal(KEEPS_REVIEW.test("keep ines pardew's review deal going"), true);
  assert.equal(KEEPS_REVIEW.test('keep going'), false);
  assert.equal(claimedWrite("Ines Pardew's deal at ZZ Rate Co A is kept running.", { said: 'yes', wrote: false }), true);
});

test('THE "WHICH DEAL?" REFUSAL READ OUT is caught as a leak', () => {
  const { checkLeak } = require('./checkLeak');
  const said = "Ines Pardew holds 2 deals. This moves one deal's money, so ask WHICH, then send that entry again with its company.";
  assert.equal(checkLeak(said).ok, false);
  assert.equal(checkLeak('Which of her two deals should get the 750, ZZ Close Co or ZZ Rate Co A?').ok, true);
});

test('A PROPOSAL ANSWERS THE NEXT MESSAGE ONLY, never a "yes" twenty turns on', () => {
  const { nextTurn } = require('./confirmReplay');
  const shown = "Undo Wyn Example's add on change on 2 deals? Shall I?";
  remember('undo_master_sheet_change', { people: ['Wyn Example'] }, "undo Wyn Example's part of change");
  nextTurn();
  assert.equal(recallAll('yes', shown).length, 1, 'the very next message may agree');
  nextTurn();
  assert.deepEqual(recallAll('yes', shown), [], 'a later one may not');
});

test('"IS KEPT RUNNING" WITH NOTHING WRITTEN is a claim on any turn, not only after a yes', () => {
  const reply = "Ines Pardew's deal at ZZ Close Co is kept running for September 2026. All set, lovely!";
  assert.equal(claimedWrite(reply, { said: 'ZZ Close Co', wrote: false }), true);
  assert.equal(claimedWrite(reply, { said: 'ZZ Close Co', wrote: true }), false, 'it did write');
});

test('A FEE GOING UP SAID AS "REDUCED", or as the add on, is caught', () => {
  const { checkRateDirection } = require('./checkRateDirection');
  const results = [{ summary: "Suki Varnell's PROFILE, which is their only deal: fee 0% to 1%" }];
  assert.equal(checkRateDirection("Suki Varnell's fee was reduced by 1% on their only deal.", results).ok, false);
  assert.equal(checkRateDirection("Suki Varnell's add on would be reduced by 1% on their only deal.", results).ok, false);
  assert.equal(checkRateDirection("Suki Varnell's fee would go from 0% to 1%, taken off what she is owed.", results).ok, true);
  assert.equal(checkRateDirection("Bram's add on was increased by 2%.", [{ summary: 'Bram: add on 0% to 2% (all 3 of their deals).' }]).ok, true);
  assert.equal(checkRateDirection('His fee was reduced.', []).ok, true, 'nothing moved, nothing to hold her to');
});

test('A RATE CHANGE WITH NO VERB still needs its pending before "right?"', () => {
  const reply = 'You want me to change her add on from 0% (or whatever it is now) to 99%, right? Shall I?';
  assert.equal(unbackedAsk(reply, { said: "99% to suki varnells add on", pending: false, applied: false }), true);
  assert.equal(unbackedAsk('She is on 5%. Want me to change it?', { said: 'is suki on a 5% add on?', pending: false, applied: false }), false, 'a question');
});

test('"TAKE 1% OFF" SOMEONE ALREADY ON A FEE asks replace or on top, whatever she sent', () => {
  const { settleRates } = require('./rateChange');
  for (const fields of [{ feePercentDelta: 1 }, { feePercent: 1 }, { feePercentDelta: -1 }]) {
    const out = settleRates({
      fields, current: { addonPercent: 0, feePercent: 2 }, said: 'take 1% off dov ashgrove', max: 100, level: 'profile', who: 'Dov',
    });
    assert.match(out.error ?? '', /REPLACES it \(fee 2% to 1%\) or goes ON TOP \(fee 2% to 3%\)/, JSON.stringify(fields));
  }
  // Their answer carries no "take off", so it goes through as they said it.
  const onTop = settleRates({
    fields: { feePercentDelta: 1 }, current: { addonPercent: 0, feePercent: 2 }, said: 'on top', max: 100, level: 'profile', who: 'Dov',
  });
  assert.equal(onTop.error, undefined);
});
