import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPENSE_SEARCH_FIELDS, SEARCH_ANY } from '../configs/searchFields.js';

/**
 * ***************************************************
 * * The expenses page keeps the CRM's own promises
 * ***************************************************
 *
 * Skeletons, optimistic writes and server side filters are easy to say and
 * easy to leave out, and none of them fails loudly when they are missing:
 * the page just feels a bit worse. So they are pinned on the shape of the
 * code.
 *
 * READ WITH COMMENTS STRIPPED. A doesNotMatch guard over raw source
 * happily matches its own explanatory comment and passes on a broken file.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, ...p), 'utf8');

function codeOf(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const page = codeOf(read('ExpensesPage.jsx'));
const hook = codeOf(read('..', 'hooks', 'useExpenses.js'));
const modal = codeOf(read('..', 'components', 'modals', 'AddExpense.jsx'));
const diff = codeOf(read('..', 'components', 'import', 'ExpensesDiffModal.jsx'));

test('the table shows a SKELETON while loading, not an empty state', () => {
  assert.match(page, /import \{ TableSkeleton \}/);
  assert.match(page, /isLoading \? \([\s\S]{0,80}<TableSkeleton/);
});

test('the header count is undefined while loading, never a flash of 0', () => {
  assert.match(page, /count=\{isLoading \? undefined : total\}/);
});

test('the empty state waits for the load to finish', () => {
  // `rows?.length ? ... :` sits inside the isLoading ternary's else branch,
  // so an empty table can only render once loading is over.
  assert.match(page, /isLoading \? \([\s\S]*?\) : rows\?\.length \?/);
});

test('EVERY WRITE IS OPTIMISTIC, through the one implementation', () => {
  for (const name of ['useCreateExpense', 'useExpenseCellEdit', 'useDeleteExpense']) {
    assert.match(
      hook,
      new RegExp(`export function ${name}\\(\\)[\\s\\S]{0,120}?useOptimisticUpdate\\(`),
      `${name} must go through useOptimisticUpdate`,
    );
  }
  // Never hand rolled: onMutate/onError/onSettled belong to the shared hook.
  assert.doesNotMatch(hook, /onSettled/);
});

test('FILTERS ARE SERVER SIDE: no client filter over the loaded page', () => {
  assert.doesNotMatch(page, /rows\.filter\(/);
  assert.doesNotMatch(page, /rows\?\.filter\(/);
  // Every filter travels in the request instead.
  assert.match(page, /const filters = \{[\s\S]*?currencies,[\s\S]*?\}/);
  assert.match(page, /useExpenses\(filters\)/);
});

test('filters survive leaving the page, and Clear FORGETS as well as resets', () => {
  assert.match(page, /useStickyState\(/);
  assert.match(page, /useClearSticky\(/);
  assert.match(page, /function clearFilters\(\)[\s\S]*?forget\(\)/);
});

test('THE AED CELL IS NEVER EDITABLE: the database generates it', () => {
  // The row's own rate and raw amount are editable; the figure they make
  // is not, or there would be a third number free to disagree.
  assert.doesNotMatch(page, /EditableCell[\s\S]{0,200}?aed_amount/);
  assert.match(page, /value=\{row\.exchange_rate\}/);
  assert.match(page, /value=\{row\.raw_amount\}/);
});

test('the page never reads the global rates', () => {
  for (const [name, source] of [['ExpensesPage', page], ['useExpenses', hook], ['AddExpense', modal]]) {
    assert.doesNotMatch(source, /fxRates/, `${name} must not reach the rates panel's data`);
    assert.doesNotMatch(source, /useSettings/, `${name} must not read the settings`);
  }
});

test('AED locks the rate at 1, so a self conversion cannot be typed wrong', () => {
  assert.match(modal, /rateLocked = form\.currency === AED/);
  assert.match(modal, /disabled=\{rateLocked\}/);
});

test('both directions of the rate are printed, because it is invertible', () => {
  assert.match(modal, /1 \{form\.currency\} = \{formatNumber\(rate, 4\)\}/);
  assert.match(modal, /1 \{AED\} = \{formatNumber\(1 \/ rate, 4\)\}/);
});

test('EXPENSE_SEARCH_FIELDS is the web half of the search contract', () => {
  // CONTRACT, pinned on this side only. The api's half is SEARCH_COLUMNS in
  // repos/expenses.repo.js, pinned by its own test. The two repos share no
  // file, so each states the same fact and proves its own half.
  const values = EXPENSE_SEARCH_FIELDS.map((f) => f.value);
  assert.deepEqual(values, [SEARCH_ANY, 'description', 'payee', 'spentBy']);
  // Every field says what its box is for, or the placeholder lies when the
  // picker moves.
  for (const field of EXPENSE_SEARCH_FIELDS) {
    assert.ok(field.placeholder, `${field.label} needs its own placeholder`);
  }
});

test('people are searched, not filtered, so there is one way to ask', () => {
  const values = EXPENSE_SEARCH_FIELDS.map((f) => f.value);
  assert.ok(values.includes('payee') && values.includes('spentBy'));
  // And neither appears as a filter control on the page.
  assert.doesNotMatch(page, /placeholder="Any payee"/);
  assert.doesNotMatch(page, /placeholder="Any spender"/);
});

/**
 * ===============================
 * * THIS MONTH, AND THE PAGE DOES NOT CHOOSE IT
 * ===============================
 * The ledger is one month at a time. The server decides which from the
 * business's clock, because the admin's is ten hours from it and a browser
 * picking its own would put two people on two different ledgers at a
 * boundary, with neither looking wrong.
 */
test('there is NO month picker, and no month in the request', () => {
  assert.doesNotMatch(page, /month:/, 'the page never sends a month');
  assert.doesNotMatch(page, /MonthPicker|setMonth\(/);
});

test('the month it is showing is NAMED, never left as "this month"', () => {
  // A month the reader has to work out is a month they can get wrong.
  assert.match(page, /monthLabel\(month\)/);
  assert.match(page, /subtitle=\{when \?/);
});

// ===============================
// * IMPORT AND EXPORT
// ===============================

test('the three toolbar actions are Export, Import and Add, in that order', () => {
  // Take a copy out, bring a file in, add one by hand. The primary sits
  // last, where the eye lands.
  // To the Toolbar, not to the first `/>`: the icons are self closing and
  // the slice ended before any of the labels.
  const actions = page.slice(page.indexOf('actions={('), page.indexOf('<Toolbar'));
  assert.ok(actions.indexOf('Export') < actions.indexOf('Import'), 'Export before Import');
  assert.ok(actions.indexOf('Import') < actions.indexOf('Add expense'), 'Add is last');
  assert.match(actions, /<FileButton/, 'Import is a file picker, not a navigation');
});

test('THE IMPORT IS TWO REQUESTS, and the first writes nothing', () => {
  assert.match(hook, /importPreview/);
  assert.match(hook, /importCommit/);
  // The preview only sets state; nothing in it invalidates or writes.
  const preview = hook.slice(hook.indexOf('function pick('), hook.indexOf('function commit('));
  assert.doesNotMatch(preview, /invalidateQueries|importCommit/);
});

test('the expenses import shares NOTHING with the master sheet\'s', () => {
  // One parser reaching the other\'s file reads zero rows and reports an
  // empty file rather than a wrong one, which is worse than failing.
  for (const [name, source] of [['useExpenses', hook], ['ExpensesDiffModal', diff], ['page', page]]) {
    assert.doesNotMatch(source, /useImportFlow/, `${name} must not reuse the master sheet's flow`);
    assert.doesNotMatch(source, /ImportDiffModal\b/, `${name} must not reuse its modal`);
    assert.doesNotMatch(source, /masterSheet/i, `${name} must not reach the master sheet`);
  }
});

test('A DUPLICATE STARTS UNTICKED, and nothing is written until Import', () => {
  // Two identical spends on one day are two real expenses. Ticking them by
  // default would make the safe press the destructive one.
  assert.match(diff, /const startsTicked = \(tab\) => tab !== 'duplicate'/);
  assert.match(diff, /Nothing has been written yet/);
  assert.match(diff, /onConfirm\(accepted\)/, 'only ticked rows are sent');
});

test('the select all is a CHECKBOX with an indeterminate third state', () => {
  assert.match(diff, /type="checkbox"/);
  assert.match(diff, /el\.indeterminate = /);
  assert.doesNotMatch(diff, /Select all<\/Button>/, 'never a pair of buttons');
});

test('the export reports itself, and only once it is actually saved', () => {
  const exporter = hook.slice(hook.indexOf('function useExportExpenses'));
  assert.match(exporter, /const saved = await saveBlob\(/);
  assert.match(exporter, /if \(saved\)/, 'a cancelled save must not claim success');
});

test('one form for adding and editing, not two that drift', () => {
  assert.match(modal, /expense = null/);
  assert.match(modal, /const editing = Boolean\(expense\)/);
  assert.match(modal, /editing \? 'Edit expense' : 'Add expense'/);
  // Bulk entry keeps the repeated half rather than retyping it per receipt.
  assert.match(modal, /Save and add another/);
  assert.match(modal, /const REPEATED = /);
});

test('the expenses export modal has NO TABS, and four fixed questions', () => {
  const exportModal = codeOf(read('..', 'components', 'export', 'ExpensesExportModal.jsx'));
  // A ledger is a list. The master sheet's modal is tabbed because a payout
  // file is a preset, a layout, a month and a breakdown design; four short
  // questions behind tabs is four clicks to see one screen.
  assert.doesNotMatch(exportModal, /setTab|activeTab|TABS/);

  assert.match(exportModal, /label="Groups"/);
  assert.match(exportModal, /label=\{`Columns · \$\{chosen\.length\} of \$\{optional\.length\}`\}/);
  assert.match(exportModal, /<SettingRow label="Files">/);
  assert.match(exportModal, /<SettingRow label="Colour">/);

  // Everything it offers is served, never listed here as well.
  assert.match(exportModal, /options\?\.columns/);
  assert.match(exportModal, /options\?\.palettes/);
  assert.doesNotMatch(exportModal, /const PALETTE = \[/, 'the palette is the API\'s');
});

test('BOTH EXPORT MODALS DRAW A SETTING THE SAME WAY', () => {
  // Two modals answering the same kind of question two different ways is
  // the fault SettingRow was written to fix, one level up.
  const exportModal = codeOf(read('..', 'components', 'export', 'ExpensesExportModal.jsx'));
  const sheet = codeOf(read('..', 'components', 'export', 'MasterSheetExportModal.jsx'));
  const picker = codeOf(read('..', 'components', 'export', 'BreakdownPicker.jsx'));

  assert.match(exportModal, /from '\.\/ExportControls'/);
  assert.match(sheet, /from '\.\/ExportControls'/);
  assert.match(picker, /from '\.\/ExportControls'/);
  // And nobody keeps a private copy.
  for (const [name, source] of [['expenses', exportModal], ['master sheet', sheet], ['picker', picker]]) {
    assert.doesNotMatch(source, /^function (SettingRow|Choice|Swatches)\(/m, `${name} redraws one`);
  }
});

test('one file per group needs more than one group to mean anything', () => {
  const exportModal = codeOf(read('..', 'components', 'export', 'ExpensesExportModal.jsx'));
  assert.match(exportModal, /const canSplit = groupsInPlay > 1/);
  assert.match(exportModal, /perGroup: perGroup && canSplit/);
});

test('the search placeholders are SHORT enough to fit the box', () => {
  // "Search description, payee or spent b" was being cut off mid word,
  // which reads as a broken field rather than a hint.
  for (const field of EXPENSE_SEARCH_FIELDS) {
    assert.ok(
      field.placeholder.length <= 26,
      `${field.label}: "${field.placeholder}" is too long for the box`,
    );
  }
});

test('archiving is gone entirely, not just hidden', () => {
  // A filter removed while the button stayed would strand every archived
  // row: Restore lives on the row, and the row would be unreachable.
  assert.doesNotMatch(page, /archiv/i);
  assert.doesNotMatch(hook, /archiv/i);
});
