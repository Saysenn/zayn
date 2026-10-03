const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * ***************************************************
 * * ARCHIVED IS OFF THE SHEET, AND EVERY READER HAS TO AGREE
 * ***************************************************
 *
 * THE INCIDENT, found in an exported file 2026-09-22.
 *
 * Four deals were archived in the morning. The export written after it
 * carried 43 INDIGO rows against his 41, and 29 MILKMAN against his 27:
 * all four archived rows were still in the file, in the tabs he reads.
 *
 * `findAllRows()` is the "whole sheet, unpaginated" reader and it had no
 * `stopped_on` filter, so archiving took a deal off the PAGE and off
 * nothing else. It feeds six things, not one:
 *
 *   the xlsx export          wrote them into his tabs
 *   the dashboard            summed them, under a variable named liveRows
 *   whatbot's 5 minute pull  could message somebody about an ended deal
 *   Diane's breakdowns       counted them in a total
 *   snapshots, the briefing  same
 *
 * SO THE FILTER BELONGS IN THE REPO, not in each reader. Five call sites
 * remembering is five chances to forget, and the sixth is written next
 * month by somebody who never saw this.
 *
 * NO DATABASE. This reads the repo's own source, the way the other
 * contract tests here do.
 */

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'repos', 'masterSheetRows.repo.js'),
  'utf8',
);

// Code only. A doesNotMatch over the whole file catches the comment that
// explains the very thing it guards.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FIND_ALL = CODE.match(/function findAllRows\(\)\s*\{[\s\S]*?\n\}/)?.[0];

test('findAllRows STILL EXISTS, under that name', () => {
  assert.ok(FIND_ALL, 'findAllRows has been renamed or removed');
});

test('AND IT EXCLUDES THE ARCHIVED ROWS', () => {
  assert.match(
    FIND_ALL,
    /WHERE stopped_on IS NULL/,
    'the whole-sheet reader is handing back archived deals again',
  );
});

test('IT IS STILL ONE QUERY OVER THE WHOLE TABLE', () => {
  // Not narrowed to a group or a month by accident while adding the filter:
  // every caller wants the sheet, and a LIMIT here is a silent truncation.
  assert.match(FIND_ALL, /FROM tb_mastersheet/);
  assert.ok(!/LIMIT/i.test(FIND_ALL), 'a LIMIT would silently shorten the sheet');
  assert.ok(!/OFFSET/i.test(FIND_ALL), 'findAllRows is the unpaginated reader');
});

/**
 * AND THE ARCHIVE PAGE IS UNTOUCHED. It reads the paged query, which asks
 * the opposite question. Both spellings have to stay in the file or one of
 * the two screens goes blank.
 */
test('THE ARCHIVE PAGE KEEPS ITS OWN, OPPOSITE FILTER', () => {
  assert.match(
    CODE,
    /stopped \? 'stopped_on IS NOT NULL' : 'stopped_on IS NULL'/,
    'the paged query no longer chooses between live and archived',
  );
});
