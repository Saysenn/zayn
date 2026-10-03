const test = require('node:test');
const assert = require('node:assert/strict');

const rowsRepo = require('../../repos/masterSheetRows.repo');
const companiesRepo = require('../../repos/companies.repo');
const peopleRepo = require('../../repos/people.repo');
const settingsRepo = require('../../repos/settings.repo');
const fxRates = require('../../shared/fxRates.helper');
const { exportSheet } = require('./exportSheet');

/**
 * ***************************************************
 * * Three faults from one export, all in one transcript
 * ***************************************************
 *
 * 1. THE BUILD CHANGED THE DOCUMENT. The card on screen was the BANK sheet
 *    over every group, as a zip. "Can we proceed with the export, please?"
 *    produced `MILKMAN - MASTER SHEET - 2026-09.xlsx`. A different shape and
 *    a different scope, from a sentence that changed neither.
 *
 * 2. "MULTI TAB" DELIVERED A ZIP. There is no multi-tab option: a single
 *    workbook ALREADY carries a tab per group, which is `multiFile: false`.
 *    Nothing said so, so "I want it multi-tab only" was heard as multi FILE
 *    and produced the opposite. She then reported it as done.
 *
 * 3. The counts were another export's. Fixed on the response instead, see
 *    `exportRoute.test.js` and `saveBlob.test.js`.
 */

const ROWS = [
  { id: 1, person_id: 'a', person_name: 'A', group_name: 'MILKMAN', company: 'X', payment_method: 'bank', currency: 'GBP', payable_amount: 100, payable_days: 30, preset_on: '2026-09-01', manually_overridden_fields: [] },
  { id: 2, person_id: 'b', person_name: 'B', group_name: 'NEXUS', company: 'Y', payment_method: 'bank', currency: 'GBP', payable_amount: 200, payable_days: 30, preset_on: '2026-09-01', manually_overridden_fields: [] },
];

/**
 * EVERY repo the card builder reaches, not just the rows.
 *
 * Stubbing findAllRows alone left settings, tiers, rates and the FX call
 * hitting real Postgres: the tests passed, and the process then HUNG on an
 * open pool instead of exiting. Green, and worthless on any machine with no
 * database.
 */
const withRows = (run) => {
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
  // The real groups, which the tool checks a named group against.
  peopleRepo.filterOptions = async () => ({ groups: ['MILKMAN', 'NEXUS'], companies: [] });
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

// The draft the client sends back each turn, as runAgent injects it.
const OPEN = {
  template: 'bank',
  groups: [],
  month: '2026-09',
  multiFile: true,
  hiddenColumns: [],
  answered: ['sheet', 'groups', 'breakdown', 'colour', 'delivery', 'columns'],
};

/* ===============================
 * * 1. A build may not change the document
 * =============================== */

test('A BUILD THAT MOVES THE SHAPE REFUSES, and says both', async () => {
  await withRows(async () => {
    const out = await exportSheet.handler({
      build: true, template: 'master-sheet', open: OPEN,
    });

    assert.equal(out.exportSession, undefined, 'it built a different document anyway');
    assert.match(out.summary, /NOTHING HAS BEEN BUILT/);
    assert.match(out.summary, /Bank/);
    assert.match(out.summary, /Master sheet/);
  });
});

test('A BUILD THAT MOVES THE SCOPE REFUSES TOO', async () => {
  await withRows(async () => {
    const out = await exportSheet.handler({
      build: true, groups: ['MILKMAN'], open: OPEN,
    });

    assert.equal(out.exportSession, undefined);
    assert.match(out.summary, /NOTHING HAS BEEN BUILT/);
    assert.match(out.summary, /MILKMAN/);
    assert.match(out.summary, /every group/);
  });
});

test('BUILDING THE CARD AS IT STANDS still works', async () => {
  // The guard must not make "go" impossible, which is the whole feature.
  await withRows(async () => {
    const out = await exportSheet.handler({ build: true, open: OPEN });

    assert.equal(out.exportSession.build, true);
    assert.match(out.summary, /BUILT/);
  });
});

test('naming the SAME shape and scope is not a change', async () => {
  await withRows(async () => {
    const out = await exportSheet.handler({
      build: true, template: 'bank', open: OPEN,
    });
    assert.equal(out.exportSession.build, true, 'repeating what is already set was refused');
  });
});

test('a build with NO card open is not blocked', async () => {
  await withRows(async () => {
    const out = await exportSheet.handler({ build: true, template: 'bank' });
    assert.equal(out.exportSession.build, true);
  });
});

test('changing WITHOUT building is untouched', async () => {
  await withRows(async () => {
    const out = await exportSheet.handler({ template: 'master-sheet', open: OPEN });
    assert.equal(out.exportSession.build, false);
    assert.equal(out.exportSession.draft.template, 'master-sheet');
  });
});

/* ===============================
 * * 2. "Multi tab" is ONE file
 * =============================== */

test('THE DELIVERY OPTIONS ARE NAMED SO "MULTI TAB" CANNOT MISLEAD', () => {
  const desc = exportSheet.parameters.properties.multiFile.description;

  // The old text was "One file per group, zipped", which says nothing about
  // what FALSE gives you, so "multi tab" read as "multi file".
  assert.match(desc, /TAB PER GROUP/);
  assert.match(desc, /Multi tab/i);
  assert.match(desc, /FALSE/);
});

test('and the card says which one it is, in the same words', async () => {
  await withRows(async () => {
    const one = await exportSheet.handler({ multiFile: false, open: OPEN });
    const many = await exportSheet.handler({ multiFile: true, open: OPEN });

    const valueOf = (r) => r.exportSession.stages.steps.find((s) => s.id === 'delivery')?.value;
    assert.match(valueOf(one), /a tab per group/);
    assert.match(valueOf(many), /zipped/);
  });
});
