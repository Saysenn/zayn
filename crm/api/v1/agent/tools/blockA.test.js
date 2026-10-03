const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePerson } = require('./resolvePerson');
const { checkFigures } = require('../checkFigures');
const { farOffMonth } = require('../../shared/guessedYear.helper');
const { currentMonth } = require('../../shared/presetMonth.helper');
const { exportSheet } = require('./exportSheet');
const rowsRepo = require('../../repos/masterSheetRows.repo');
const companiesRepo = require('../../repos/companies.repo');
const peopleRepo = require('../../repos/people.repo');
const settingsRepo = require('../../repos/settings.repo');
const fxRates = require('../../shared/fxRates.helper');

/**
 * ***************************************************
 * * The block of fixes agreed after the full sweep
 * ***************************************************
 *
 * Each one is a live failure, not a hypothetical:
 *
 *   A2  a guessed year reached the EXPORT, where it builds an empty
 *       workbook named for a month nobody asked for. A file is harder to
 *       disbelieve than a sentence.
 *   A3  "multi tab please" produced a ZIP. Twice. I rewrote the wording
 *       both times, which is what "prompting is not a guard" means.
 *   A4  "actually no, all of them" left the card on two groups, because
 *       omitting `groups` merges as "unchanged" rather than "clear".
 *   A6  checkFigures flagged the YEAR in "September 2026" and a phone
 *       number, costing a retry each on replies that were correct.
 *   A7  "what's glori on" answered about Gloria without asking, because
 *       she tidied the fragment into a name that then matched exactly.
 */

const YEAR = Number(currentMonth().slice(0, 4));

/* ===============================
 * * A2: one rule for a guessed year, in shared/
 * =============================== */

test('THE RULE LIVES IN shared/, so a new tool cannot re-earn the 2024 bug', () => {
  // It was in masterSheet.js and exportSheet.js imported it from there,
  // which is a require CYCLE: a cycle means the guard can be `undefined`
  // at call time depending on load order, and an undefined guard is none.
  const src = require('node:fs').readFileSync(require.resolve('./exportSheet.js'), 'utf8');
  assert.match(src, /require\('\.\.\/\.\.\/shared\/guessedYear\.helper'\)/);
  assert.doesNotMatch(src, /farOffMonth.*require\('\.\/masterSheet'\)/);
});

test('a year they never said is far off; one they said is theirs', () => {
  assert.equal(farOffMonth(`${YEAR - 3}-09`, 'total for september'), true);
  assert.equal(farOffMonth(`${YEAR - 3}-09`, `september ${YEAR - 3} please`), false);
  assert.equal(farOffMonth(`${YEAR}-09`, 'total for september'), false, 'this year is never a guess');
  assert.equal(farOffMonth(null, 'anything'), false);
});

/* ===============================
 * * A2/A3/A4: the export
 * =============================== */

const OPEN = {
  template: 'bank',
  groups: ['MILKMAN', 'INDIGO'],
  month: currentMonth(),
  multiFile: false,
  hiddenColumns: [],
  answered: ['sheet', 'groups'],
};

const ROWS = ['MILKMAN', 'INDIGO', 'NEXUS'].map((group, i) => ({
  id: i + 1,
  person_id: `p${i}`,
  person_name: `P${i}`,
  group_name: group,
  company: 'Co',
  role_label: 'Director',
  currency: 'GBP',
  payment_method: 'bank',
  payable_amount: 1000,
  payable_days: 30,
  preset_on: `${currentMonth()}-01`,
  manually_overridden_fields: [],
}));

const stub = (run) => {
  const saved = {
    findAllRows: rowsRepo.findAllRows,
    tierMap: companiesRepo.tierMap,
    rateMap: peopleRepo.rateMap,
    filterOptions: peopleRepo.filterOptions,
    get: settingsRepo.get,
    localLocations: settingsRepo.localLocations,
    cryptoPercent: settingsRepo.cryptoPercent,
    usdPerGbp: fxRates.usdPerGbp,
  };
  rowsRepo.findAllRows = async () => ROWS;
  companiesRepo.tierMap = async () => new Map();
  peopleRepo.rateMap = async () => new Map();
  peopleRepo.filterOptions = async () => ({ groups: ['MILKMAN', 'INDIGO', 'NEXUS'], companies: [] });
  settingsRepo.get = async () => ({ color_uses_end_date: false, crypto_percent: 0 });
  settingsRepo.localLocations = async () => [];
  settingsRepo.cryptoPercent = async () => 0;
  fxRates.usdPerGbp = async () => ({ usdPerGbp: 1.27, source: 'fallback', asOf: null, perUsd: { GBP: 0.79 } });

  return run().finally(() => {
    rowsRepo.findAllRows = saved.findAllRows;
    companiesRepo.tierMap = saved.tierMap;
    peopleRepo.rateMap = saved.rateMap;
    peopleRepo.filterOptions = saved.filterOptions;
    settingsRepo.get = saved.get;
    settingsRepo.localLocations = saved.localLocations;
    settingsRepo.cryptoPercent = saved.cryptoPercent;
    fxRates.usdPerGbp = saved.usdPerGbp;
  });
};

test('A2: A GUESSED YEAR NEVER BUILDS A FILE NAMED FOR IT', async () => {
  await stub(async () => {
    // They said September, so the card is the nearest September, never the
    // year she invented. It used to fall back to this month, which was a
    // month they had not asked for either.
    const out = await exportSheet.handler({
      month: `${YEAR - 3}-09`, said: 'give me the september sheet', open: OPEN,
    });
    const { month } = out.exportSession.draft;
    assert.match(month, /-09$/, `the month they named was lost: ${month}`);
    assert.notEqual(month, `${YEAR - 3}-09`, 'it kept the year she invented');
  });
});

test('A2: and a month she invented WHOLE falls back to this one', async () => {
  await stub(async () => {
    // No month word in the sentence, so there is nothing to repair it to.
    const out = await exportSheet.handler({
      month: `${YEAR - 3}-09`, said: 'give me the sheet', open: OPEN,
    });
    assert.equal(out.exportSession.draft.month, currentMonth());
  });
});

test('A2: and a year they DID say is honoured', async () => {
  await stub(async () => {
    const out = await exportSheet.handler({
      month: `${YEAR - 3}-09`, said: `the september ${YEAR - 3} sheet`, open: OPEN,
    });
    assert.equal(out.exportSession.draft.month, `${YEAR - 3}-09`);
  });
});

test('A3: "TABS" FORCES ONE FILE, whatever flag she sent', async () => {
  await stub(async () => {
    const out = await exportSheet.handler({ multiFile: true, said: 'multi tab please', open: OPEN });
    assert.equal(out.exportSession.draft.multiFile, false);
    assert.match(out.exportSession.fileName, /\.xlsx$/);
  });
});

test('A3: asking for SEPARATE files still gets a zip', async () => {
  for (const said of ['separate files per group, zipped', 'a file each please']) {
    // eslint-disable-next-line no-await-in-loop
    await stub(async () => {
      const out = await exportSheet.handler({ multiFile: true, said, open: OPEN });
      assert.equal(out.exportSession.draft.multiFile, true, said);
    });
  }
});

test('A4: "ALL OF THEM" WIDENS, where omitting groups does not', async () => {
  await stub(async () => {
    const kept = await exportSheet.handler({ said: 'carry on', open: OPEN });
    assert.deepEqual(kept.exportSession.draft.groups, ['MILKMAN', 'INDIGO'], 'omitting must not clear');

    const wide = await exportSheet.handler({
      allGroups: true,
      said: 'actually no, all of them',
      open: { ...OPEN, answered: ['sheet'] },
    });
    assert.deepEqual(wide.exportSession.draft.groups, []);
    assert.equal(
      wide.exportSession.stages.next,
      'breakdown',
      'allGroups widened the rows but left the tracker stuck on Groups',
    );
  });
});

test('A4: the group literally CALLED "ALL GROUPS" is still nameable', async () => {
  // The trap: "all of them" and a real group of that name are two things.
  await stub(async () => {
    const out = await exportSheet.handler({ groups: ['MILKMAN'], said: 'just milkman', open: OPEN });
    assert.deepEqual(out.exportSession.draft.groups, ['MILKMAN']);
  });
});

/* ===============================
 * * A6: not every number is a figure
 * =============================== */

const known = [{ total: { GBP: 2000 }, addon: { GBP: 100 }, totalWithRates: { GBP: 2100 } }];

test('A6: A YEAR IS NOT AN UNSUPPORTED FIGURE', () => {
  const out = checkFigures(`Gloria is owed GBP 2,000 for September ${YEAR}, plus GBP 100, so GBP 2,100.`, known);
  assert.equal(out.ok, true, JSON.stringify(out.unsupported));
});

test('A6: nor a date, nor an ordinal, nor a phone number', () => {
  for (const reply of [
    'Her end date is 2026-12-31 and she is owed GBP 2,000.',
    'I set the end date to the 31st of December. She is owed GBP 2,000.',
    'The phone number 07700900000 is set. She is owed GBP 2,000.',
    'Set on 01/09/2026. She is owed GBP 2,000.',
  ]) {
    assert.equal(checkFigures(reply, known).ok, true, reply);
  }
});

test('A6: A WRONG FIGURE IS STILL CAUGHT, or the check is worthless', () => {
  const out = checkFigures(`Gloria is owed GBP 3,750 for September ${YEAR}.`, known);
  assert.equal(out.ok, false);
  assert.deepEqual(out.unsupported, [3750]);
});

/* ===============================
 * * A7: their fragment, not her tidy-up
 * =============================== */

const PEOPLE = [
  { id: 1, person_id: 'gloria', person_name: 'Gloria' },
  { id: 2, person_id: 'gloria', person_name: 'Gloria' },
  { id: 3, person_id: 'gloria-difference', person_name: 'Gloria difference' },
  { id: 4, person_id: 'nathan', person_name: 'Nathan' },
];

test('A7: A HALF NAME THEY TYPED IS A QUESTION', () => {
  // She passed "Gloria", her own tidying of "glori", and the exact-name
  // rule then fired on a name the admin never wrote.
  const out = resolvePerson(PEOPLE, 'Gloria', "what's glori on");
  assert.equal(out.ambiguous, true);
  assert.deepEqual(out.names, ['Gloria', 'Gloria difference']);
  assert.equal(out.fragment, 'glori');
});

test('A7: A PRONOUN IS NOT A HALF NAME, which is the case that must not break', () => {
  // They named nobody; she supplies the name from the previous turn.
  // Asking here re-opens the loop resolvePerson exists to close.
  const out = resolvePerson(PEOPLE, 'Gloria', 'and her percentages?');
  assert.equal(out.ambiguous, false);
  assert.deepEqual([...new Set(out.rows.map((r) => r.person_name))], ['Gloria']);
});

test('A7: a name typed in FULL is never second guessed', () => {
  for (const [typed, said] of [
    ['Gloria', 'what is gloria owed'],
    ['Gloria difference', 'show me gloria difference'],
    ['Nathan', 'how much for nathan'],
  ]) {
    assert.equal(resolvePerson(PEOPLE, typed, said).ambiguous, false, said);
  }
});

test('A7: a short word can never be a fragment', () => {
  // "and", "the", "her" would otherwise qualify constantly.
  assert.equal(resolvePerson(PEOPLE, 'Gloria', 'and the pay for her').ambiguous, false);
});

test('A7: a fragment reaching only ONE person is not ambiguous', () => {
  assert.equal(resolvePerson(PEOPLE, 'Nathan', 'what about nath').ambiguous, false);
});

test('A2: a month ALREADY ON THE CARD is never dropped', async () => {
  // `base` is the open draft merged with this call. Checking it would
  // re-date an export on an unrelated turn: "make it blue" would quietly
  // move a month set two turns ago. Only THIS turn's argument is judged.
  await stub(async () => {
    const open = { ...OPEN, month: `${YEAR - 3}-08` };
    const out = await exportSheet.handler({ primaryColor: 'blue', said: 'make it blue', open });

    assert.equal(out.exportSession.draft.month, `${YEAR - 3}-08`, 'the month was re-dated');
    assert.deepEqual(out.exportSession.draft.groups, ['MILKMAN', 'INDIGO'], 'the groups were lost');
  });
});

/* ===============================
 * * From the live test run
 * =============================== */

test('SHE MUST NOT NARRATE THE YEAR SHE ASKED FOR', async () => {
  // Live: "the september sheet" became 2023, the card and the FILE were both
  // correct, and she announced "I switched the sheet to September 2023" and
  // then built "the bank sheet for September 2023". Everything right except
  // the half a person reads.
  //
  // The year is now REPAIRED rather than dropped, so the card is the nearest
  // September instead of this month. Her own argument still says 2023, so
  // the note stays: a corrected card does not correct her sentence.
  await stub(async () => {
    const out = await exportSheet.handler({
      month: `${YEAR - 3}-09`, said: 'the september sheet', open: OPEN,
    });

    assert.match(out.summary, /YOU ASKED FOR September/);
    assert.match(out.summary, new RegExp(`Do NOT say September ${YEAR - 3}`));
    // And the card itself is a September they might actually have meant.
    assert.match(out.summary, /September \d{4}/);
    assert.doesNotMatch(out.summary, new RegExp(`the card is September ${YEAR - 3}`, 'i'));
  });
});

test('A MONTH SHE INVENTED WHOLE is still dropped, and still says so', async () => {
  // No month word in the sentence, so there is nothing to repair it to.
  // Guessing a second time is not a fix.
  await stub(async () => {
    const out = await exportSheet.handler({
      month: `${YEAR - 3}-09`, said: 'give me the sheet', open: OPEN,
    });

    assert.match(out.summary, /YOU ASKED FOR September/);
    assert.match(out.summary, /they never said that year/);
    assert.match(out.summary, /Do NOT describe it as the month you asked for/);
  });
});

test('and a normal turn carries no such note', async () => {
  await stub(async () => {
    const out = await exportSheet.handler({ said: 'carry on', open: OPEN });
    assert.doesNotMatch(out.summary, /YOU ASKED FOR/);
  });
});

test('THERE IS NO SHAPE THAT REFUSES SEPARATE FILES', async () => {
  // Live: asked for separate files on the bank sheet she said "that is not
  // available for the bank sheet" and "one file is the only option". Both
  // untrue. An invented limit is worse than a wrong setting: they stop
  // asking for something they can have.
  await stub(async () => {
    const out = await exportSheet.handler({
      multiFile: true, said: 'separate files per group', open: OPEN,
    });
    assert.equal(out.exportSession.draft.multiFile, true);
  });

  const src = require('node:fs').readFileSync(require.resolve('./exportSheet.js'), 'utf8');
  assert.match(src, /BOTH ARE AVAILABLE ON EVERY SHAPE/);
});
