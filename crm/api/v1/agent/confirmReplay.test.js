const test = require('node:test');
const assert = require('node:assert/strict');

const {
  agreed, alreadyShown, facts, remember, recallAll, forget, completed, alreadyDone,
} = require('./confirmReplay');

// Most of these are about ONE pending call. `recallAll` answers with every
// call the agreement covers, so the single-call cases read the head of it.
const recall = (said, prior) => recallAll(said, prior)[0] ?? null;

/**
 * ***************************************************
 * * THE ADMIN SAID YES AND NOTHING HAPPENED
 * ***************************************************
 *
 * Reproduced every time in `scripts/dianeChat.js` on 2026-09-23: she
 * proposed a three person edit, was told "yes, go ahead", and asked the
 * identical question again. No confirmed write could be completed by
 * talking to her at all.
 *
 * Every case below is one of the real texts from those runs.
 */

// What the bulk tool hands back, verbatim, and what she said about it.
const CONFIRMING = 'set a DIFFERENT value on each of them: Quillon Marsh: payable days to "10" '
  + '(1 row) Tarn Vessey: payable days to "12" (1 row) Odile Prang: payable days to "25" (1 row) '
  + '3 deals';
const HER_ANSWER = "This would set Quillon Marsh's payable days to 10, Tarn Vessey's to 12, and "
  + 'Odile Prang\'s to 25, affecting three deals in total. Shall I go ahead, darling?';

/* ===============================
 * * WHAT COUNTS AS AGREEMENT
 * =============================== */

test('a plain yes is agreement', () => {
  for (const said of ['yes', 'yes, go ahead', 'ok', 'do it', 'confirm', 'please do', 'go']) {
    assert.equal(agreed(said), true, said);
  }
});

test('a condition or a question is NOT agreement', () => {
  // "yes but change Blake to 5" is a new instruction, and acting on the
  // pending call would write the value they just asked to change.
  for (const said of ['yes but change Blake to 5', 'ok?', 'no', 'yes, instead make it 12',
    'wait', 'yes, although hold on']) {
    assert.equal(agreed(said), false, said);
  }
});

test('a long message is not a bare agreement', () => {
  // A paragraph starting "yes" is a discussion, not a confirmation.
  assert.equal(agreed(`yes ${'and another thing '.repeat(6)}`), false);
});

/* ===============================
 * * IT MAY ONLY CONFIRM WHAT SHE ALREADY SHOWED THEM
 * =============================== */

test('the facts of the change have to be in the answer they replied to', () => {
  assert.equal(alreadyShown(CONFIRMING, HER_ANSWER), true);
});

test('a name she never said is not covered by their yes', () => {
  const other = 'set a DIFFERENT value on each of them: Blake Rowntree: payable days to "12" '
    + '(1 row) 1 deal';
  assert.equal(alreadyShown(other, HER_ANSWER), false);
});

test('a figure she never said is not covered by their yes', () => {
  const other = 'set a DIFFERENT value on each of them: Quillon Marsh: payable days to "19" '
    + '(1 row) 1 deal';
  assert.equal(alreadyShown(other, HER_ANSWER), false);
});

test('a summary with nothing identifiable in it is never self confirming', () => {
  assert.equal(alreadyShown('', HER_ANSWER), false);
  assert.equal(alreadyShown(CONFIRMING, ''), false);
});

/* ===============================
 * * THE THREE READINGS THAT LOST EVERY REPLAY
 * =============================== */

test('ALL CAPS is the tool shouting, never a fact about the change', () => {
  // "set a DIFFERENT value on each of them" put DIFFERENT among the facts.
  // She writes it in ordinary case if at all, so nothing was ever replayed.
  assert.equal(facts('a DIFFERENT value').has('different'), false);
});

test('she spells small numbers and the tool does not', () => {
  // "(2 rows)" came back as "on two deals". A spelled VALUE has to match
  // the digit the tool wrote; a spelled COUNT is dropped on both sides by
  // the rule below, which is how those two now agree.
  assert.equal(facts('payable days to ten').has('10'), true);
  assert.equal(facts('two deals').has('2'), false);
});

test("the possessive is how she writes a name the tool does not", () => {
  // "Quillon Marsh's payable days" against "Quillon Marsh:".
  assert.equal(facts("Quillon Marsh's").has('marsh'), true);
});

test('a count of rows is not a fact about the change', () => {
  // The per person block lists "(1 row)" after each name and she never
  // repeats it, so every remembered confirmation carried a 1 hers did not.
  assert.equal(facts('payable days to "10" (1 row)').has('1'), false);
  assert.equal(facts('payable days to "10" (1 row)').has('10'), true);
  // Spelled the same way, dropped the same way.
  assert.equal(facts('each on one deal').has('1'), false);
});

test('a thousands separator is not a different number', () => {
  assert.equal(facts('GBP 1,000').has('1000'), true);
});

/* ===============================
 * * THE PENDING CALL IS REMEMBERED ACROSS THE TURN
 * =============================== */

test('an agreement recalls the pending call, with the arguments it was made with', () => {
  remember('bulk_update_master_sheet', { perPerson: [1, 2, 3] }, CONFIRMING);
  const held = recall('yes, go ahead', HER_ANSWER);
  assert.equal(held?.name, 'bulk_update_master_sheet');
  assert.deepEqual(held.args, { perPerson: [1, 2, 3] });
  forget(held);
});

test('a message that is NOT agreement recalls nothing', () => {
  // The whole bound. Without this, any next message applies the pending
  // change, which is worse than the loop it was built to close.
  remember('bulk_update_master_sheet', { perPerson: [1] }, CONFIRMING);
  for (const said of ['no', 'yes but change Tarn to 5', 'what does that do?', 'hold on']) {
    assert.equal(recall(said, HER_ANSWER), null, said);
  }
  forget(recall('yes', HER_ANSWER));
});

test('it is answered ONCE', () => {
  remember('bulk_update_master_sheet', { perPerson: [1] }, CONFIRMING);
  const held = recall('yes', HER_ANSWER);
  assert.ok(held);
  forget(held);
  assert.equal(recall('yes', HER_ANSWER), null);
});

test('a pending change she never showed them is not recalled', () => {
  const unseen = 'make Mayah a special case 1 deal';
  remember('update_master_sheet_row', { id: 9 }, unseen);
  assert.equal(recall('yes', HER_ANSWER), null);
  // ...and still applies to the answer that DID describe it.
  const held = recall('yes', 'Make Mayah a special case, one deal. Go ahead?');
  assert.equal(held?.name, 'update_master_sheet_row');
  forget(held);
});

test('a confirmation older than ten minutes is asked again, not applied', () => {
  const realNow = Date.now;
  Date.now = () => realNow() - 11 * 60 * 1000;
  remember('update_master_sheet_row', { id: 4 }, 'set Zeb payable days to 4');
  Date.now = realNow;
  assert.equal(recall('yes', 'Set Zeb to 4 payable days.'), null);
});

test('a summary with no confirming field is never replayed', () => {
  // An older pending shape asks twice rather than confirming itself, which
  // is the safe direction.
  remember('update_master_sheet_row', { id: 1 }, '');
  assert.equal(recall('yes', HER_ANSWER), null);
});

test('the memory is bounded and keeps the newest', () => {
  for (let i = 0; i < 40; i += 1) {
    remember('t', { i }, `set payable days to "${i}" on Name${i}`);
  }
  const newest = recall('yes', 'set payable days to 39 on Name39');
  assert.equal(newest?.name, 't');
  forget(newest);
  assert.equal(recall('yes', 'set payable days to 0 on Name0'), null);
});

/* ===============================
 * * AND A YES TO SOMETHING ALREADY FINISHED
 * =============================== */

// A record or null; these read whether there is one.
const done = (...a) => Boolean(alreadyDone(...a));

test('a bare yes may not redo a write that just finished', () => {
  // She wrote 19, said so, and a "yes" answering nothing wrote 19 again.
  completed('update_master_sheet_row', { id: 5, payableDays: 19 });
  assert.equal(done('update_master_sheet_row', { id: 5, payableDays: 19 }, 'yes'), true);
});

test('`confirmed` and key order do not make it a different call', () => {
  completed('update_master_sheet_row', { id: 7, payableDays: 3 });
  assert.equal(
    done('update_master_sheet_row', { payableDays: 3, id: 7, confirmed: true }, 'ok'),
    true,
  );
});

test('a repeated INSTRUCTION still writes', () => {
  // The admin saying it again is an instruction. Refusing that would be
  // the worse failure.
  completed('update_master_sheet_row', { id: 8, payableDays: 3 });
  assert.equal(
    done('update_master_sheet_row', { id: 8, payableDays: 3 }, 'set it to 3 again'),
    false,
  );
});

test('a different row, value or tool still writes', () => {
  completed('update_master_sheet_row', { id: 11, payableDays: 3 });
  assert.equal(done('update_master_sheet_row', { id: 12, payableDays: 3 }, 'yes'), false);
  assert.equal(done('update_master_sheet_row', { id: 11, payableDays: 4 }, 'yes'), false);
  assert.equal(done('bulk_update_master_sheet', { id: 11, payableDays: 3 }, 'yes'), false);
});

/* ===============================
 * * WHAT IT SAID TRAVELS WITH IT
 * =============================== */

test('a finished write is remembered WITH what it said, so the refusal can quote it', () => {
  completed('update_person', { person: 'suki', addonPercent: 6 }, { summary: 'Suki Varnell: add on to 6%.' });
  assert.match(alreadyDone('update_person', { person: 'suki', addonPercent: 6 }, 'yes').answer, /Suki Varnell: add on to 6%/);
});

/* ===============================
 * * ONE AGREEMENT, EVERY CALL IT COVERS
 * ===============================
 * 2026-09-24. "update Alex and Blake add on rates to 5%" was two pending
 * calls. The runtime applied the newest, told her it was done, and she
 * narrated both. One person was written and nobody was told.
 */

// Two people, one question, as she puts it and as the tool hands it back.
const TWO = "Alex Example's PROFILE, which is all 5 of their deals: add on 0% to 5% (added)";
const TWO_B = "Blake Example's PROFILE, which is all 2 of their deals: add on 0% to 5% (added)";
const SHE_ASKED = "Alex Example and Blake Example's profile add on rates would go to 5%. "
  + 'Shall I go ahead, darling?';

test('an agreement answers EVERY pending call it covers, oldest first', () => {
  remember('update_person', { person: 'Alex Example' }, TWO);
  remember('update_person', { person: 'Blake Example' }, TWO_B);

  const held = recallAll('yes', SHE_ASKED);
  assert.deepEqual(held.map((h) => h.args.person), ['Alex Example', 'Blake Example']);
  for (const one of held) forget(one);
});

test('a pending her answer never described is left OUT of the set', () => {
  // The whole safety of the replay: the admin's yes covers what they were
  // shown and nothing else.
  remember('update_person', { person: 'Alex Example' }, TWO);
  remember('update_person', { person: 'Casey Example' }, "Casey Example's PROFILE: add on 0% to 9% (added)");

  const held = recallAll('yes', SHE_ASKED);
  assert.deepEqual(held.map((h) => h.args.person), ['Alex Example']);
  for (const one of held) forget(one);
  forget(recallAll('yes', "Casey Example's profile add on to 9%, one deal. Go ahead?")[0]);
});

test('the same change proposed twice is applied ONCE', () => {
  remember('update_person', { person: 'Alex Example' }, TWO);
  remember('update_person', { person: 'Alex Example' }, TWO);

  const held = recallAll('yes', SHE_ASKED);
  assert.equal(held.length, 1);
  forget(held[0]);
});

/* ===============================
 * * THE VALUE IT IS COMING FROM
 * ===============================
 * The summary writes a change FROM AND TO, ALWAYS. She says "to 5%" and
 * not a word about the 0, so requiring the 0 made a plain "yes pls
 * proceed" fall through to an identical second question. 2026-09-24.
 */

test('the value a change is LEAVING need not be in her answer', () => {
  assert.equal(
    alreadyShown('add on 0% to 5% (added)', 'I would set their add on to 5%. Go ahead?'),
    true,
  );
});

test('but the value it is GOING TO still must be', () => {
  assert.equal(
    alreadyShown('add on 0% to 9% (added)', 'I would set their add on to 5%. Go ahead?'),
    false,
  );
});

/* ===============================
 * * HER `confirmed` IS NOT THE ADMIN'S YES
 * ===============================
 * 2026-09-25. She showed Orla's line only, heard "yes please", sent
 * confirmed herself, and Ines was written without being shown. */

test('a confirmed call stands only for a pending the answer SHOWED IN FULL', () => {
  const { confirmationHeld } = require('./confirmReplay');
  const args = { people: ['Orla Quennell', 'Ines Pardew'], addonPercentDelta: 3 };
  remember('update_person', args,
    "Orla Quennell's PROFILE: add on 0% to 3%\nInes Pardew's PROFILE: add on 0% to 3%");

  const half = "This would add 3% to Orla Quennell's profile. Shall I?";
  const whole = 'Orla Quennell and Ines Pardew would each go to 3%. Shall I?';
  assert.equal(confirmationHeld('update_person', args, 'yes please', half), false, 'Ines was never shown');
  assert.equal(confirmationHeld('update_person', args, 'yes please', whole), true);
  assert.equal(confirmationHeld('update_person', args, 'yes but not ines', whole), false, 'not a plain yes');
  assert.equal(confirmationHeld('update_person', { ...args, addonPercentDelta: 4 }, 'yes', whole), false, 'a different call');
});

test('a first call sent confirmed, with nothing pending, is not held', () => {
  const { confirmationHeld } = require('./confirmReplay');
  assert.equal(confirmationHeld('rename_company', { name: 'A', newName: 'B' }, 'yes', 'A to B?'), false);
});

test('ONE PROPOSAL UNDER TWO ARGUMENT SHAPES IS APPLIED ONCE', () => {
  // 2026-09-25: two undo calls for the same batch were both applied on one
  // "yes", and the second would have put back an OLDER change.
  const text = 'undo the change on Zelda Quorn';
  remember('undo_master_sheet_change', { people: ['Zelda Quorn'], batch: true }, text);
  remember('undo_master_sheet_change', { people: ['Zelda Quorn'] }, text);
  const held = recallAll('yes', 'Shall I undo the change on Zelda Quorn?')
    .filter((h) => h.name === 'undo_master_sheet_change');
  assert.equal(held.length, 1);
  assert.deepEqual(held[0].args, { people: ['Zelda Quorn'] }, 'the newest wins');
  held.forEach(forget);
});

// 2026-09-25: "GBP 1,000.00" split into "1,000" and "00"; her "1,000 GBP"
// lacked the "00", so a company close could never be confirmed.
test('A FIGURE IS ONE FACT, however it is written', () => {
  assert.equal(alreadyShown('STOP 2 live deals, GBP 1,000.00 a month', 'It would stop 2 live deals, 1,000 GBP a month.'), true);
  assert.equal(alreadyShown('GBP 3,118.5 to find', 'That is 3,118.50 to find.'), true);
  assert.equal(alreadyShown('GBP 1,000.00 a month', 'That is 1,100 a month.'), false, 'a different figure');
});

test('"each one is already over" is not the number one', () => {
  assert.equal(alreadyShown(
    'answer "no" for every unanswered deal, 1,568.00 a month between them, which means each one is already over',
    'Stopping his 2 deals would take 1,568 GBP a month off. Shall I?',
  ), true);
  // A real "one" is still a figure.
  assert.equal(facts('set it to one').has('1'), true);
});

test('the FROM value is dropped with a currency code on either side', () => {
  assert.equal(alreadyShown(
    'Suki Varnell at ZZ Rate Co A: payable amount GBP 3,000 to GBP 3,500',
    "Suki Varnell's payable at ZZ Rate Co A would go from 3,000 to 3,500 GBP. Shall I?",
  ), true);
});

test('A DATE IN NUMBERS AND THE SAME DATE IN WORDS ARE ONE FACT', () => {
  assert.equal(alreadyShown(
    'set preset date to "2026-10-01", holding back Dov Ashgrove',
    "Moving 8 deals to the preset date of 1 October 2026, holding back Dov Ashgrove's 2 deals.",
  ), true);
  // A different day is a different fact.
  assert.equal(alreadyShown('set preset date to "2026-10-02"', 'to 1 October 2026'), false);
});

test('A PENDING WITH NOTHING TO CHECK stands on its shape and a plain yes', () => {
  const { confirmationHeld } = require('./confirmReplay');
  // "set paid (admin override) to true" over a group: no name, no figure.
  remember('bulk_x', { group: 'ZZTEST', set: { overridePaid: true } }, 'set paid (admin override) to "true"');
  assert.equal(confirmationHeld('bulk_x', { group: 'ZZTEST', set: { overridePaid: true } }, 'yes', 'Mark them paid?'), true);
  assert.equal(confirmationHeld('bulk_x', { group: 'ZZTEST', set: { overridePaid: true } }, 'no', 'Mark them paid?'), false);
  assert.equal(confirmationHeld('bulk_x', { group: 'OTHER', set: { overridePaid: true } }, 'yes', 'Mark them paid?'), false);
});

test('A NEWER PROPOSAL ABOUT THE SAME PERSON SUPERSEDES THE OLDER, so one yes applies it once', () => {
  remember('update_master_sheet_row', { id: 44, add: { payableAmount: 500 } },
    'change this deal Suki Varnell at ZZ Rate Co A: payable amount GBP 3,000 to GBP 3,500');
  remember('bulk_update_master_sheet', { perPerson: [1, 2] },
    'set a DIFFERENT value on each of them Suki Varnell at ZZ Rate Co A: payable amount GBP 3,000 to GBP 3,500 Ines Pardew at ZZ Rate Co A: payable amount GBP 1,100 to GBP 1,850');
  const held = recallAll('yes', 'Suki Varnell at ZZ Rate Co A: 3,000 to 3,500. Ines Pardew at ZZ Rate Co A: 1,100 to 1,850. Shall I?');
  assert.deepEqual(held.map((h) => h.name), ['bulk_update_master_sheet']);
  held.forEach(forget);
});

test('different people stay separate proposals', () => {
  remember('r1', { id: 1 }, 'make Orla Quennell at ZZ Rate Co B a special case for September 2026');
  remember('r2', { id: 2 }, 'make Bram Tevish at ZZ Rate Co B a special case for September 2026');
  const held = recallAll('yes', 'Orla Quennell and Bram Tevish at ZZ Rate Co B, special cases for September 2026?');
  assert.deepEqual(held.map((h) => h.name).sort(), ['r1', 'r2']);
  held.forEach(forget);
});

test('TWO DIFFERENT PER PERSON CALLS ARE TWO SHAPES, however many entries', () => {
  const special = { perPerson: [{ person: 'Orla Quennell', set: { specialCaseDeal: true } }, { person: 'Bram Tevish', set: { specialCaseDeal: true } }] };
  const payable = { perPerson: [{ person: 'Suki Varnell', add: { payableAmount: 500 } }, { person: 'Ines Pardew', add: { payableAmount: 750 } }] };
  completed('bulk_update_master_sheet', special, { summary: 'Done.' });
  assert.equal(alreadyDone('bulk_update_master_sheet', payable, 'yes'), null, 'a different change read as already done');
  // Key ORDER still does not matter, at any depth.
  const reordered = { perPerson: [{ set: { specialCaseDeal: true }, person: 'Orla Quennell' }, { set: { specialCaseDeal: true }, person: 'Bram Tevish' }] };
  assert.ok(alreadyDone('bulk_update_master_sheet', reordered, 'yes'));
});

// 2026-09-28: "remove Orla's deal at ZZ Rate Co B" then "yes" asked again, and
// again: the delete summary named "#1459", which she never says.
test('A ROW NUMBER IS NOT A FACT THE ADMIN AGREES TO', () => {
  const confirming = 'delete these entirely: Orla Quennell · ZZ Rate Co B · ZZTEST · #1459 , touching 1 row';
  const shown = "Removing Orla Quennell's deal at ZZ Rate Co B would delete one deal entirely. Shall I go ahead?";
  assert.equal(alreadyShown(confirming, shown), true);
  // The name still has to match: a different person's delete is not covered.
  assert.equal(alreadyShown(confirming.replace('Orla Quennell', 'Ines Pardew'), shown), false);
});
