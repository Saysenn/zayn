const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { cannotYet, PROMISES } = require('./cannotYet');

/**
 * ***************************************************
 * * SHE MUST NOT OFFER WHAT SHE HAS NO TOOL FOR
 * ***************************************************
 *
 * Asked "now can you forecast now?" she answered "Forecasting sounds
 * exciting, darling! What exactly do you want to forecast? Payments next
 * month, total income for a group, or something else?"
 *
 * She cannot forecast anything: no tool, no stored month to look back at,
 * and the snapshots table is not migrated yet. She offered three kinds of
 * it and asked the admin to choose.
 *
 * The same rule as "she must not claim to have done what she did not do",
 * one step earlier: she must not claim she CAN. An offer is a promise, and
 * the next turn has to break it.
 */

const TOOLS = [{ name: 'total_master_sheet' }, { name: 'filter_master_sheet' }];

const SAID = 'Forecasting sounds exciting, darling! But I will need a bit more detail, what '
  + 'exactly do you want to forecast? Payments next month, total income for a group, or '
  + 'something else?';

test('THE ACTUAL FAILURE is caught', () => {
  const out = cannotYet(SAID, TOOLS);
  assert.equal(out.ok, false);
  assert.equal(out.missing.what, 'forecasting');
  assert.match(out.missing.instead, /You CANNOT forecast/);
  // And the correction must stop her asking which kind they wanted.
  assert.match(out.missing.instead, /do\s+NOT ask them which kind/);
});

test('IT RETIRES ITSELF the day the tool exists', () => {
  // A guard that outlives the gap it describes becomes a rule nobody can
  // explain. Each entry names the tool that would make the offer honest.
  const withTool = [...TOOLS, { name: 'compare_months' }];
  assert.equal(cannotYet(SAID, withTool).ok, true);

  for (const p of PROMISES) {
    assert.ok(p.tool, `${p.what} names no tool, so it can never retire`);
  }
});

test('DECLINING IT PASSES, or the turn can never end', () => {
  // The guard must not fire on the very sentence it is asking for.
  for (const reply of [
    'I cannot forecast anything yet, darling: there is no stored history to work from.',
    'There is no forecasting here yet. I can give you this month\'s figures though.',
    'I do not have a tool for predictions, sweetheart.',
    'Nothing is stored from previous months, so I cannot compare it to last month.',
  ]) {
    assert.equal(cannotYet(reply, TOOLS).ok, true, reply);
  }
});

test('MENTIONING IT IS NOT OFFERING IT', () => {
  // "Next month" is an ordinary thing to say about a preset or an end date.
  for (const reply of [
    'That preset is for next month, so it is not in this total.',
    'Her payment starts next month, which is why nothing is owed yet.',
  ]) {
    assert.equal(cannotYet(reply, TOOLS).ok, true, reply);
  }
});

test('AN ORDINARY OFFER IS UNTOUCHED', () => {
  for (const reply of [
    'Nicola is owed GBP 2,900 for September 2026.',
    'Would you like me to open any of them by name?',
    'Shall I go ahead and set payable days to 25 on those three rows?',
  ]) {
    assert.equal(cannotYet(reply, TOOLS).ok, true, reply);
  }
});

test('comparing months is refused too, while nothing is stored', () => {
  const out = cannotYet('Would you like me to compare it to last month?', TOOLS);
  assert.equal(out.ok, false);
  assert.match(out.missing.instead, /You CANNOT compare months/);
});

test('an empty reply is not a promise', () => {
  assert.equal(cannotYet('', TOOLS).ok, true);
  assert.equal(cannotYet(null, TOOLS).ok, true);
});

test('IT IS WIRED INTO runAgent, with its own retry flag', () => {
  const SRC = fs.readFileSync(path.join(__dirname, 'runAgent.js'), 'utf8');
  assert.match(SRC, /const promised = cannotYet\(raw, context\.tools\);/);
  assert.match(SRC, /let promiseRetry = false;/);
  assert.match(SRC, /if \(raw && !promiseRetry\)/);
  // Its own flag: offering what she cannot do and repeating herself are
  // different mistakes, and each is worth one correction.
  assert.match(SRC, /promiseRetry = true;/);
  // And it is evidence, so the Logs page has the broken promise.
  assert.match(SRC, /offered a capability she does not have/);
});

/* ===============================
 * * And the check she was never asked for
 * =============================== */

test('SHE MUST NOT CLAIM A CHECK NOBODY ASKED FOR', () => {
  // The repeat retry used to end "if they asked whether you are sure, say
  // plainly that you checked and it has not moved", with the condition left
  // to her. Asked "convert it to usd" she opened "I double-checked and the
  // numbers are steady as ever ... Nothing has shifted!" for a question that
  // was not a doubt. Three replies in one session did it.
  const SRC = fs.readFileSync(path.join(__dirname, 'runAgent.js'), 'utf8');

  assert.match(SRC, /function askedToCheck\(said\)/);
  assert.match(SRC, /askedToCheck\(lastSaid\(history\)\)/);
  // Both branches, so the honest case still says it.
  assert.match(SRC, /They DID ask whether you are sure/);
  // The forbidding half spans a string concatenation, so match its pieces.
  assert.match(SRC, /They did NOT ask whether you were sure/);
  assert.match(SRC, /you double-checked, that nothing has changed/);
});

test('and the doubt itself is recognised, in the words they use', () => {
  const SRC = fs.readFileSync(path.join(__dirname, 'runAgent.js'), 'utf8');
  const line = SRC.match(/const ASKED_TO_CHECK = (\/.*\/i);/)?.[1];
  assert.ok(line, 'the pattern is gone');

  // eslint-disable-next-line no-eval
  const re = eval(line);
  for (const said of [
    'are you sure', 'double check that', 'I think thats wrong. double check',
    'is that right?', 'really?', 'check it again',
  ]) {
    assert.equal(re.test(said), true, said);
  }
  for (const said of [
    'convert it to usd', 'show me milkman', 'what is nicola owed',
    'add gloria and gloria difference',
  ]) {
    assert.equal(re.test(said), false, said);
  }
});
