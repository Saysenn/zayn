import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEAL_STATUS_OPTIONS } from '../configs/dealStatus.js';

/**
 * ***************************************************
 * * NARROWING BY DEAL STATUS
 * ***************************************************
 *
 * The column and the dropdown shipped 2026-09-22 with no way to filter by
 * them, so "which deals are going concerns" meant reading the whole sheet.
 * Diane could not answer it either, for the same reason one layer down.
 *
 * A filter has FIVE places it has to appear on this page and it is wrong
 * in a different way if any one is missed: the request, the page reset,
 * the selection reset, the Clear button's count, and Clear itself. This
 * pins all five, because four of them fail silently.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, 'MasterSheetPage.jsx'), 'utf8');

test('it is SERVER SIDE, a param, never a filter over the loaded page', () => {
  assert.match(SRC, /dealStatus: dealStatus \|\| undefined,/);
});

test('it survives leaving the page', () => {
  // Sticky under the masterSheet prefix, which is also what Clear forgets.
  assert.match(SRC, /useStickyState\('masterSheet\.dealStatus', ''\)/);
});

test('changing it goes back to page 1 and drops the selection', () => {
  // A filter that leaves you on page 7 of 2 shows an empty table, and a
  // selection surviving a filter change acts on rows nobody can see.
  // MEMBERSHIP, NOT POSITION. These pinned `dealStatus]`, the last entry,
  // so adding a filter after it turned them red on a page where nothing
  // had changed. What has to hold is that it is IN the list.
  const resets = SRC.match(/paymentMethod, dealStatus[,\]]/g) ?? [];
  assert.ok(resets.length >= 2, `only ${resets.length} of the reset effects list it`);
  assert.match(SRC, /setSelectedIds\(new Set\(\)\), \[[^\]]*dealStatus[^\]]*, page\]/);
});

test('CLEAR undoes it, and the count knows about it', () => {
  assert.match(SRC, /filtersCount=\{\[[^\]]*dealStatus[^\]]*\]\.filter\(Boolean\)\.length\}/);
  assert.match(SRC, /setDealStatus\(''\);/);
});

test('the options come from the config, never typed into the page', () => {
  assert.match(SRC, /DEAL_STATUS_OPTIONS\.map/);
  for (const o of DEAL_STATUS_OPTIONS) {
    assert.doesNotMatch(
      SRC,
      new RegExp(`value: '${o.value}', label: '`),
      `${o.value} is spelled into the page`,
    );
  }
});

/**
 * ===============================
 * * THREE THINGS ON THIS PAGE ARE CALLED A STATUS
 * ===============================
 * payment period (the deal, derived), company status, and Deal Status.
 * Two filters sitting side by side with the word "status" and nothing else
 * is the confusion `.claude/CLAUDE.md` renamed payment period to end.
 */
test('the two status filters SAY WHICH ONE THEY ARE', () => {
  assert.match(SRC, /label: `Company: \$\{o\.label\.toLowerCase\(\)\}`/);
  assert.match(SRC, /label: `Deal: \$\{o\.label\.toLowerCase\(\)\}`/);
  assert.match(SRC, /placeholder="Any deal status"/);
  assert.match(SRC, /placeholder="Any company status"/);
});

/**
 * ===============================
 * * THE FILTER AND THE WRITE MAY NOT SHARE A NAME
 * ===============================
 * `const dealStatus = useDealStatus()` was already in scope when the
 * filter was added. One name for a mutation and a query param on one page
 * is how the wrong one gets passed, and it would have type checked.
 */
test('the write hook is named for the write', () => {
  assert.match(SRC, /const dealStatusWrite = useDealStatus\(\)/);
  assert.doesNotMatch(SRC, /const dealStatus = useDealStatus\(\)/);
});
