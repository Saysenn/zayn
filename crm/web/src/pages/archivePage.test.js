import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ***************************************************
 * * The Archive is READ ONLY, and Stop is not Delete
 * ***************************************************
 *
 * SOURCE TEXT, not a render. A .jsx cannot be imported into node:test, and
 * what these pin is structural: which components a page reaches for, and
 * which it must never reach for. Comments are stripped first, or a guard
 * matches its own explanation and passes forever.
 */

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
  // Block and line comments go, so a rule cannot be satisfied by the
  // sentence describing it.
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const archive = read('./ArchivePage.jsx');
const sheet = read('./MasterSheetPage.jsx');
const company = read('./CompanyDetailPage.jsx');

// The attributes of the bulk bar button labelled `label`, '' when there is
// none. Lazy, and never across a second <BulkAction, so it is that button's.
const barAction = (src, label) => src.match(
  new RegExp(`<BulkAction\\b((?:(?!<BulkAction\\b)[\\s\\S])*?)>\\s*${label}\\s*</BulkAction>`),
)?.[1] ?? '';

// ===============================
// * The Archive
// ===============================

test('THE ARCHIVE IS THE SAME LIST WITH ONE FLAG, not a second endpoint', () => {
  assert.match(archive, /useMasterSheet\(/);
  assert.match(archive, /stopped:\s*true/);
});

test('IT EDITS NOTHING. Every editable control is absent', () => {
  // A finished deal's figures are what was actually paid. The point of
  // moving it here is that nobody edits it while working the live sheet.
  for (const banned of ['EditableCell', 'useMasterSheetCellEdit', 'onCellSave', 'Toggle']) {
    assert.doesNotMatch(archive, new RegExp(banned), `${banned} must not be on the Archive`);
  }
});

test('IT DELETES NOTHING EITHER', () => {
  for (const banned of ['useDeleteMasterSheetRow', 'bulkDelete', 'TrashIcon']) {
    assert.doesNotMatch(archive, new RegExp(banned), `${banned} must not be on the Archive`);
  }
});

test('RESUME IS THE ONLY WRITE', () => {
  // The bulk bar's, for one deal or many: the row button is gone.
  assert.match(archive, /masterSheet\.bulkResume\(/);
  // LAZY. Greedy `\w*` swallows the verb and the alternation never fires,
  // so the guard found nothing and passed on an empty list.
  const writes = archive.match(/\buse\w*?(?:Update|Delete|Create|Stop|Resume|Answer)\w*/g) ?? [];
  assert.deepEqual([...new Set(writes)], [], 'no write hook besides the bulk bar');
  const calls = archive.match(/apiService\.masterSheet\.\w+/g) ?? [];
  assert.deepEqual([...new Set(calls)], ['apiService.masterSheet.bulkResume']);
});

test('IT SAYS WHY EACH ROW IS THERE', () => {
  assert.match(archive, /STOPPED_REASON_LABEL/);
  assert.match(archive, /Stopped on/);
  assert.match(archive, /Why/);
});

test('A COMPANY CLOSURE OFFERS THE COMPANY, not a dead Resume button', () => {
  assert.match(archive, /REOPEN_THE_COMPANY/);
  // The reason itself links there, rather than a second button per row.
  assert.match(archive, /<Link\s+to=\{`\/companies\/\$\{encodeURIComponent\(row\.company\)\}`\}/);
});

test('ITS FILTERS SURVIVE THE PAGE, and Clear FORGETS', () => {
  assert.match(archive, /useStickyState/);
  assert.match(archive, /useClearSticky/);
  assert.match(archive, /forgetFilters\(\)/);
});

test('THE DATE RANGE IS ON THE STOP, not the end date', () => {
  assert.match(archive, /stoppedFrom/);
  assert.match(archive, /stoppedTo/);
  assert.doesNotMatch(archive, /endWhen/);
});

// ===============================
// * Stop, beside Delete, on the master sheet
// ===============================

test('THE BAR HAS BOTH, and they are different acts', () => {
  // The row's own Stop / Delete icons went when the bulk bar took them over.
  assert.ok(barAction(sheet, 'Stop'), 'the bar has a Stop');
  assert.ok(barAction(sheet, 'Delete'), 'the bar has a Delete');
});

test('STOP AND DELETE ARE TOLD APART BY SHAPE, not by colour', () => {
  /**
   * ===============================
   * * THIS REPLACES "STOP IS NOT TINTED LIKE DELETE", 2026-09-17
   * ===============================
   * That rule said the reversible ending must not read as the destructive
   * one, and carried the whole distinction on colour. His call is icons
   * only and BOTH red, which is the better half of the same idea: the red
   * says "this one counts", and the SHAPE says which it is. That is how
   * CellSuggestion's three marks already work.
   *
   * (A UI pass in 2026-10 made Stop quiet; he reversed that the same
   * month. Both red again, the palm and the bin tell them apart.)
   *
   * What still must not happen is the two becoming interchangeable, so
   * this pins that they are different icons and that Edit is neither.
   */
  const stop = barAction(sheet, 'Stop');
  const del = barAction(sheet, 'Delete');
  assert.match(stop, /icon=\{StopHandIcon\}/);
  assert.match(stop, /variant="danger"/, 'Stop is red');
  assert.match(del, /icon=\{TrashIcon\}/);
  assert.match(del, /variant="danger"/, 'Delete is red');
  assert.doesNotMatch(stop, /TrashIcon/);
  assert.doesNotMatch(sheet, /<BulkMenu\s+icon=\{EditIcon\}[^>]*variant="danger"/, 'Edit is neither');
});

test('STOP AND DELETE HAVE SEPARATE STATE, so neither confirm can show the other\'s words', () => {
  assert.match(sheet, /setConfirmingBulkStop/);
  assert.match(sheet, /setConfirmingBulkDelete/);
  assert.match(sheet, /confirm\.bulkStopRows/);
  assert.match(sheet, /confirm\.bulkDeleteRows/);
});

test('THE REVIEW BUTTON ONLY APPEARS WHEN THERE IS SOMETHING TO ANSWER', () => {
  // A permanent "Review 0" is a control that teaches you to ignore it.
  assert.match(sheet, /reviewPending\.count > 0/);
});

test('NO MONTH PICKER ANYWHERE NEAR THE REVIEW', () => {
  assert.doesNotMatch(sheet, /reviewMonth|setReviewPeriod/);
});

// ===============================
// * Liquidation, on the company page
// ===============================

/**
 * FIVE NOW, and the page no longer lists them itself: it hands the whole
 * choice to CompanyStatusPicker, the same control the Manage modal uses,
 * so one decision cannot be a dropdown on one door and a row on the other.
 * The contract is pinned where it lands, in closureContracts.test.js.
 */
test('THE STATUS PICKER OFFERS ALL FIVE, from the one contract', () => {
  assert.match(company, /CompanyStatusPicker/);
  // The two it used to hardcode must be gone, or there are two lists.
  assert.doesNotMatch(company, /\{ value: 'closed', label: 'Closed' \}/);
});

test('ONLY THE TWO TERMINAL ONES ASK FIRST', () => {
  assert.match(company, /isTerminalStatus\(next\)/);
  assert.match(company, /confirm\.closeCompany/);
});

test('LIQUIDATION OPENS THE PANEL, because the status alone sets no amounts', () => {
  assert.match(company, /COMPANY_STATUS\.LIQUIDATION/);
  assert.match(company, /setLiquidating\(true\)/);
});

test('NOTHING COMPUTES A DEAL AMOUNT FROM THE SETTLEMENT', () => {
  // A multiplier cannot express a director going to zero while a mid
  // stays at 750. There is no factor, anywhere.
  const panel = read('../components/modals/LiquidationPanel.jsx');
  assert.doesNotMatch(panel, /liquidation_total\s*\*/);
  assert.doesNotMatch(panel, /settlement\s*\*\s*\w*(?:amount|monthly)/i);
  assert.match(panel, /Allocated/);
});

test('THE PANEL WARNS BOTH WAYS AND REFUSES NEITHER', () => {
  const panel = read('../components/modals/LiquidationPanel.jsx');
  assert.match(panel, /over the settlement/);
  assert.match(panel, /still unallocated/);
  // No disabled Save on a mismatch: the CRM holds the settlement second
  // hand, and a refusal gets worked around by typing a fake one.
  assert.doesNotMatch(panel, /disabled=\{[^}]*gap/);
});
