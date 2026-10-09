import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REVIEW_ANSWER, REVIEW_ANSWER_LABEL, REVIEW_ANSWER_TONE, REVIEW_ANSWER_MEANS,
  REVIEW_ANSWER_LEAVES_LIST, REVIEW_ANSWER_LOG_FIELD, REVIEW_WAITING_LABEL,
  REVIEW_WAITING_TONE, monthLabel,
} from './monthlyReview.js';

/**
 * ***************************************************
 * * THE WEB'S HALF OF THE REVIEW CONTRACT
 * ***************************************************
 *
 * The config named this test and this test did not exist, so the mirror it
 * claims to pin was unpinned on this side: the set could have lost an
 * answer, or a tone, and nothing here would have noticed until a badge
 * rendered blank or a button posted a value the route refuses. Written
 * 2026-09-29.
 *
 * ITS OWN HALF ONLY. `crm/api` and `crm/web` share no file, and "it reads
 * it, it doesn't import it" is not an exemption, so nothing here opens
 * anything under `api/`. The server pins the same facts in
 * `api/v1/repos/reviewQueueRule.test.js` and migration 057's CHECK.
 *
 * THE VALUES ARE THE WIRE. The labels are ours and the server never sees
 * them, so a label is checked for being THERE, never for its words.
 */

const source = () => readFileSync(new URL('./monthlyReview.js', import.meta.url), 'utf8');

test('THREE ANSWERS, and the values are what goes on the wire', () => {
  assert.deepEqual(Object.keys(REVIEW_ANSWER), ['YES', 'FINAL', 'NO']);
  assert.deepEqual(Object.values(REVIEW_ANSWER), ['yes', 'final', 'no']);
});

test('EVERY ANSWER HAS A LABEL, A TONE AND A SENTENCE', () => {
  // A missing tone renders `badge-undefined`, which Tailwind never built,
  // so the badge silently loses its colour rather than throwing.
  for (const value of Object.values(REVIEW_ANSWER)) {
    assert.ok(REVIEW_ANSWER_LABEL[value], `${value} has no label`);
    assert.ok(REVIEW_ANSWER_TONE[value], `${value} has no tone`);
    assert.ok(REVIEW_ANSWER_MEANS[value], `${value} has no sentence`);
  }
});

test('AND NOTHING IS LABELLED THAT IS NOT AN ANSWER', () => {
  // A fourth key here is a value this side believes in and the route
  // refuses. The wire is the three, and the maps are keyed by the wire.
  const wire = new Set(Object.values(REVIEW_ANSWER));
  for (const map of [REVIEW_ANSWER_LABEL, REVIEW_ANSWER_TONE, REVIEW_ANSWER_MEANS]) {
    assert.deepEqual(Object.keys(map).filter((k) => !wire.has(k)), []);
  }
});

test('THE THREE ANSWERS READ DIFFERENTLY, every one of them', () => {
  // The gap between `final` and `no` is one month's money for one person,
  // which is why they are two buttons and not a checkbox. Two of them
  // wearing one label or one tone is that gap made invisible.
  const labels = Object.values(REVIEW_ANSWER).map((v) => REVIEW_ANSWER_LABEL[v]);
  const tones = Object.values(REVIEW_ANSWER).map((v) => REVIEW_ANSWER_TONE[v]);
  assert.equal(new Set(labels).size, 3, 'two answers share a label');
  assert.equal(new Set(tones).size, 3, 'two answers share a colour');
});

test('WAITING IS NOT AN ANSWER, and never wears the ended red', () => {
  // Undecided is not an alarm. `open` is the red "already ended" wears.
  assert.equal(REVIEW_WAITING_TONE, 'sent');
  assert.notEqual(REVIEW_WAITING_TONE, REVIEW_ANSWER_TONE[REVIEW_ANSWER.NO]);
  assert.ok(REVIEW_WAITING_LABEL);
  // It must not be reachable as a value: the queue row carries `answer:
  // null` for it, and a fourth wire value is what this prevents.
  assert.equal(Object.values(REVIEW_ANSWER).includes('waiting'), false);
  assert.equal(REVIEW_ANSWER_LABEL.waiting, undefined);
});

/**
 * ===============================
 * * WHICH ANSWER TAKES THE ROW OFF THE LIST
 * ===============================
 * His call 2026-09-29. `no` stops the deal at the end of LAST month, so it
 * is out of this month entirely; `final` is still paid in full this month
 * and stays on the list until the month turns.
 */
test('ONLY "ALREADY ENDED" LEAVES THE LIST', () => {
  assert.deepEqual([...REVIEW_ANSWER_LEAVES_LIST], [REVIEW_ANSWER.NO]);
  assert.equal(REVIEW_ANSWER_LEAVES_LIST.includes(REVIEW_ANSWER.FINAL), false);
  assert.equal(REVIEW_ANSWER_LEAVES_LIST.includes(REVIEW_ANSWER.YES), false);
});

test('AND EVERY ONE OF THEM IS A REAL ANSWER', () => {
  // A value here that is not on the wire filters nothing, silently: the
  // rows keep their answers and the list never shortens.
  for (const value of REVIEW_ANSWER_LEAVES_LIST) {
    assert.ok(Object.values(REVIEW_ANSWER).includes(value), `${value} is not an answer`);
  }
});

test('THE HOOK ACTUALLY DROPS THEM, rather than only declaring it', () => {
  // The optimistic paint is the half somebody sees. Without the filter the
  // row sat there answered until the refetch landed and then vanished under
  // the pointer.
  const hook = readFileSync(new URL('../hooks/useMonthlyReview.js', import.meta.url), 'utf8');
  assert.match(hook, /REVIEW_ANSWER_LEAVES_LIST\.includes\(row\.answer\)/);
});

test('THE MIRROR NAMES ITS OTHER HALF, so neither side is orphaned', () => {
  // A pointer, never an import: naming the other folder is fine, reaching
  // into it is not.
  const src = source();
  assert.match(src, /MIRRORED, NEVER IMPORTED/);
  assert.ok(src.includes('api/v1/repos/monthlyReview.repo.js'), 'the server half is named');
  assert.ok(src.includes('STAYS_AFTER_STOP'), 'and so is the constant that mirrors this one');
});

test('AND IT IMPORTS NOTHING FROM THE OTHER CODEBASE', () => {
  // The boundary rule, pinned on the file it would be easiest to break it
  // on: this one exists because both sides need the same three strings.
  assert.doesNotMatch(source(), /from '.*\/api\//);
  assert.doesNotMatch(source(), /require\(/);
});

test('THE LOG FIELD IS THE ONE HISTORY WRITES UNDER', () => {
  // History reads the answer back through this key, and shows its label
  // through the same one. A rename here turns every logged answer into a
  // row printing raw wire values.
  assert.equal(REVIEW_ANSWER_LOG_FIELD, 'reviewAnswer');
  const list = readFileSync(new URL('../components/history/HistoryList.jsx', import.meta.url), 'utf8');
  assert.match(list, /\[REVIEW_ANSWER_LOG_FIELD\]: 'monthly review answer'/);
  assert.match(list, /VALUE_LABELS = \{[^}]*\[REVIEW_ANSWER_LOG_FIELD\]: REVIEW_ANSWER_LABEL,/);
});

/**
 * ===============================
 * * THE MONTH IS THE SERVER'S, and this only spells it
 * ===============================
 * `monthLabel` must never reach for the browser's idea of the month: the
 * answer is stored against the period the server named, and a label built
 * from `new Date()` would disagree with it across a boundary.
 */
test('THE LABEL IS BUILT FROM THE PERIOD, never from today', () => {
  assert.equal(monthLabel('2026-08'), 'August 2026');
  assert.equal(monthLabel('2026-01'), 'January 2026');
  assert.equal(monthLabel('2026-12'), 'December 2026');
});

test('AND A PERIOD IT CANNOT READ SAYS SO, rather than guessing one', () => {
  assert.equal(monthLabel(undefined), 'this month');
  assert.equal(monthLabel(null), 'this month');
  assert.equal(monthLabel(''), 'this month');
  assert.equal(monthLabel('nonsense'), 'this month');
  assert.equal(monthLabel('2026-'), 'this month');
  // Month 0 is not a month. `new Date(Date.UTC(y, -1, 1))` would happily
  // answer December of the year before.
  assert.equal(monthLabel('2026-00'), 'this month');
});

test('NOTHING HERE IS EDITABLE AT RUNTIME', () => {
  // A frozen map is what lets every reader treat these as the contract
  // rather than as a default somebody may have patched.
  for (const map of [REVIEW_ANSWER, REVIEW_ANSWER_LABEL, REVIEW_ANSWER_TONE,
    REVIEW_ANSWER_MEANS, REVIEW_ANSWER_LEAVES_LIST]) {
    assert.equal(Object.isFrozen(map), true);
  }
});
