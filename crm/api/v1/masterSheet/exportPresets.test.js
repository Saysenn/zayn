const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listSheetPresets, SHEET_PRESETS, listExportColumns, buildMasterSheetWorkbook,
} = require('./buildWorkbook');

/**
 * ***************************************************
 * * FOUR NAMED COLUMN SETS, BECAUSE HE PICKS THE SAME ONES EVERY TIME
 * ***************************************************
 *
 * His call 2026-09-22. Eleven columns out of twenty one, chosen by hand,
 * every month, to produce the same four documents.
 *
 * THE KEYS ARE THE DANGER. A preset naming a column that does not exist
 * selects nothing for it and says nothing: the file comes out short and
 * looks deliberate. So they live beside the column list and these refuse
 * any key it does not know.
 */

const keys = () => new Set(listExportColumns().map((c) => c.key));

test('EVERY PRESET NAMES REAL COLUMNS, and nothing else', () => {
  const real = keys();
  for (const preset of listSheetPresets()) {
    const unknown = preset.columns.filter((k) => !real.has(k));
    assert.deepEqual(unknown, [], `${preset.id} names columns that do not exist: ${unknown}`);
  }
});

/**
 * AND NEVER A REQUIRED ONE. Group, role, name and company are written into
 * every file whatever is picked, so they are not in the picker at all.
 * Listing one in a preset would suggest it could be left out, and would
 * select a key the control does not offer.
 */
test('NO PRESET NAMES A COLUMN THAT IS ALWAYS WRITTEN', () => {
  const required = listExportColumns().filter((c) => c.required).map((c) => c.key);
  assert.ok(required.length > 0, 'the required set went missing');
  for (const preset of listSheetPresets()) {
    for (const key of required) {
      assert.ok(!preset.columns.includes(key), `${preset.id} names the always-written ${key}`);
    }
  }
});

test('ALL MEANS EVERY OPTIONAL COLUMN, resolved not guessed', () => {
  const optional = listExportColumns().filter((c) => !c.required).map((c) => c.key);
  const all = listSheetPresets().find((p) => p.id === 'all');
  assert.deepEqual([...all.columns].sort(), [...optional].sort());
  // Declared without a list, so it cannot fall behind a column added later.
  assert.equal(SHEET_PRESETS.find((p) => p.id === 'all').columns, undefined);
});

test('THE FOUR HE ASKED FOR ARE ALL THERE', () => {
  assert.deepEqual(
    listSheetPresets().map((p) => p.id),
    ['all', 'standard', 'bank', 'cash', 'crypto'],
  );
});

// ===============================
// * What each one actually produces
// ===============================

/**
 * SPELLED OUT, in his words, so a set changing is a deliberate edit to a
 * test that says what he asked for rather than a quiet reshuffle.
 */
const ASKED_FOR = {
  standard: ['payable_days', 'payment_method', 'payable_amount', 'currency', 'location'],
  bank: ['payable_days', 'payment_method', 'payable_amount', 'currency',
    'bank_details', 'account_number', 'sort_code'],
  cash: ['payable_days', 'payment_method', 'payable_amount', 'currency',
    'location', 'door_number', 'postcode', 'phone', 'accepting_postals'],
  crypto: ['payable_days', 'payment_method', 'payable_amount', 'currency'],
};

test('EACH SET IS EXACTLY WHAT HE LISTED', () => {
  const by = Object.fromEntries(listSheetPresets().map((p) => [p.id, p.columns]));
  for (const [id, wanted] of Object.entries(ASKED_FOR)) {
    assert.deepEqual(by[id], wanted, `${id} is not the set he asked for`);
  }
});

/**
 * AND THE FILE COMES OUT IN SHEET ORDER whichever preset made the choice.
 * `pickColumns` filters the canonical list, so a preset cannot reshuffle
 * the document even though its own list is written in his order.
 */
test('A PRESET CHOOSES COLUMNS, never their order', async () => {
  const rows = [{
    id: 1, group_name: 'INDIGO', role_label: 'Mid 1', person_name: 'Maid',
    company: 'Workforce', currency: 'AED', payable_amount: 4700, payable_days: 30,
    payment_method: 'bank', bank_details: 'X', account_number: '1', sort_code: '20',
    preset_on: '2026-09-01', source: 'import',
  }];
  const bank = listSheetPresets().find((p) => p.id === 'bank');
  const wb = await buildMasterSheetWorkbook(rows, { singleTab: true, columns: bank.columns });

  const headers = [];
  wb.worksheets[0].getRow(1).eachCell((c) => headers.push(String(c.value)));

  // The four always-written ones lead, then the picked set in sheet order.
  assert.deepEqual(headers, [
    'Group', 'Role', 'Name of individual', 'Company in question',
    'Payable days this month', 'Method of payment', 'Payable amount', 'Currency',
    'Bank details of individual', 'Account number', 'Sort code',
  ]);
});

test('AND A PRESET NEVER DROPS A REQUIRED COLUMN', async () => {
  const rows = [{
    id: 1, group_name: 'INDIGO', role_label: 'Mid 1', person_name: 'Maid',
    company: 'Workforce', currency: 'AED', payable_amount: 4700, payable_days: 30,
    payment_method: 'crypto', preset_on: '2026-09-01', source: 'import',
  }];
  const crypto = listSheetPresets().find((p) => p.id === 'crypto');
  const wb = await buildMasterSheetWorkbook(rows, { singleTab: true, columns: crypto.columns });
  const headers = [];
  wb.worksheets[0].getRow(1).eachCell((c) => headers.push(String(c.value)));
  for (const always of ['Group', 'Role', 'Name of individual', 'Company in question']) {
    assert.ok(headers.includes(always), `${always} is written into every file and was dropped`);
  }
});
