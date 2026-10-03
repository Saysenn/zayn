import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * ACCEPT ALL NEVER APPLIES A GUESSED APPOINTMENT
 * ***************************************************
 *
 * The rule this pins is the reason the batch button was safe to build. A
 * FORWARD suggestion restates the boss's own formula. A BACKWARD one
 * invents an appointment date, which is a real day somebody was onboarded
 * and not something arithmetic can recover, so it is offered one row at a
 * time and never in a batch.
 *
 * The same rule is stated on the server in
 * api/v1/shared/suggestDates.helper.js and pinned by its own test. This
 * file pins the UI half: the batch must filter, and the confirm must say
 * what it left alone.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const panel = fs.readFileSync(path.join(here, 'ExportWarnings.jsx'), 'utf8');
const confirms = fs.readFileSync(
  path.join(here, '..', '..', 'configs', 'confirms.config.js'),
  'utf8',
);

test('forward is the only direction the batch will accept', () => {
  assert.match(panel, /const isForward = \(r\) => r\.suggest\?\.direction === 'forward'/);
  // The button's own count, and the list it hands to the writer, both come
  // off that filter. Either one drifting is how a guess gets written.
  assert.match(panel, /const forward = w\.input === 'dates' \? w\.rows\.filter\(isForward\) : \[\]/);
  assert.match(panel, /const forward = w\.rows\.filter\(isForward\)/);
  assert.doesNotMatch(panel, /acceptRows\(w\.rows\)/, 'never the unfiltered list');
});

test('the batch button only exists while the list is open', () => {
  // A date written onto eight rows from a collapsed strip is a batch
  // nobody has read. Review opens the list, and the button sits next to
  // what it is about to change.
  assert.match(panel, /\{rowsOpen && forward\.length > 0 && \(/);
});

test('the confirm says how many guesses it is leaving behind', () => {
  assert.match(confirms, /acceptAllDates: \(\{ count, group, skipped \}\)/);
  assert.match(confirms, /never filled in in bulk/);
});

test('an accepted row leaves the list on the press, not on the refetch', () => {
  // The panel reads ['export-count'], a different query from the one the
  // optimistic write patches, so without this an accepted row sat there
  // looking unaccepted and the header kept its old count.
  assert.match(panel, /function useAccepted\(warnings\)/);
  assert.match(panel, /useEffect\(\(\) => \{ setDone\(new Set\(\)\); \}, \[warnings\]\)/);
  assert.match(panel, /markAccepted\(list\.map\(\(r\) => r\.id\)\)/);
});

test('EVERY count on the panel is of what is left', () => {
  // The header total, the amber/grey decision and the per-group line all
  // read `left`. One of them still reading `warnings` is how the strip ends
  // up saying 8 over a list of 3.
  assert.match(panel, /const rows = left\.reduce\(\(n, w\) => n \+ w\.count, 0\)/);
  assert.match(panel, /const acts = left\.some\(\(w\) => w\.severity === 'warning'\)/);
  assert.match(panel, /\{open && left\.map\(\(w\) => \{/);
  assert.doesNotMatch(panel, /warnings\.reduce/);
  assert.doesNotMatch(panel, /warnings\.some/);
});

test('a scenario with no per-row list keeps the count the server sent', () => {
  // The two bulk-fix scenarios carry `ids` but no `rows`. Recomputing their
  // count from an empty list would have hidden them entirely.
  assert.match(panel, /const count = w\.rows\?\.length \? remaining\.length : w\.count/);
});

test('the header does not claim every listed row moves money', () => {
  // A derivable date changes no figure. Once that scenario started listing
  // not-started rows too, most of the strip was claiming to affect a total
  // it never touches. The money half is counted and named separately.
  assert.match(panel, /const owed = left\s*\n?\s*\.filter\(\(w\) => w\.severity === 'warning'\)/);
  assert.match(panel, /rows need a look/);
  assert.doesNotMatch(panel, /rows affect' \} this total/);
  // The "in N ways" count is of what is LEFT, not of what the server sent.
  assert.match(panel, /\{left\.length\} \{left\.length === 1 \? 'way' : 'ways'\}/);
  assert.doesNotMatch(panel, /warnings\.length \{warnings\.length/);
});
