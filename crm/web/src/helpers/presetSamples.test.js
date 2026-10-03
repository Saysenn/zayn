import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { presetFor, samplesFor, monthSpanFor, lastDayOf } from './presetSamples.js';
import {
  paymentStartState, paymentStartReason, ifToggled, START_STATE,
} from './paymentStartState.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, '..', p), 'utf8');

const { RUNNING, STARTED_THIS_MONTH: STARTED, NOT_STARTED } = START_STATE;

// Every month of a leap year and the two around it, so February and the
// year boundary are both walked over rather than argued about.
const MONTHS = Array.from({ length: 26 }, (_, i) => new Date(Date.UTC(2025, 11 + i, 17)));

const coloursAt = (now, useEndDate) => samplesFor(now)
  .map((s) => paymentStartState(s.start, presetFor(now), s.end, useEndDate));

// ===============================
// * THE WORKED EXAMPLE CANNOT ROT
// ===============================
// It was pinned to August 2026 with dates written for August, so in
// September the panel demonstrated the rules against a month nobody was in.
// The claim this file makes is that the six rows mean the same thing in
// every month, and this is that claim.
test('the six rows keep their colours in every month, end date ON', () => {
  const expected = [RUNNING, STARTED, NOT_STARTED, NOT_STARTED, STARTED, RUNNING];
  for (const now of MONTHS) {
    assert.deepEqual(coloursAt(now, true), expected, `end date on, ${now.toISOString().slice(0, 7)}`);
  }
});

test('and with it OFF, where only the start decides', () => {
  // Rows four and five are the ones the end date moves. With it ignored,
  // both fall back to what their start says, which is what the toggle is
  // there to show.
  const expected = [RUNNING, STARTED, NOT_STARTED, RUNNING, RUNNING, RUNNING];
  for (const now of MONTHS) {
    assert.deepEqual(coloursAt(now, false), expected, `end date off, ${now.toISOString().slice(0, 7)}`);
  }
});

test('every colour appears in both toggle states, or a row is wasted', () => {
  const now = new Date(Date.UTC(2026, 8, 17));
  for (const useEndDate of [true, false]) {
    const seen = new Set(coloursAt(now, useEndDate));
    assert.deepEqual([...seen].sort(), [NOT_STARTED, RUNNING, STARTED].sort(), `useEndDate ${useEndDate}`);
  }
});

test('the preset is the first of the month the reader is in', () => {
  assert.equal(presetFor(new Date(Date.UTC(2026, 8, 30, 23, 59))), '2026-09-01');
  assert.equal(presetFor(new Date(Date.UTC(2026, 0, 1))), '2026-01-01');
});

test('the caption names the real length of the real month', () => {
  assert.deepEqual(monthSpanFor(new Date(Date.UTC(2026, 8, 17))), { lastDay: 30, month: 'September' });
  assert.deepEqual(monthSpanFor(new Date(Date.UTC(2024, 1, 5))), { lastDay: 29, month: 'February' });
  assert.deepEqual(monthSpanFor(new Date(Date.UTC(2026, 1, 5))), { lastDay: 28, month: 'February' });
});

// A day picked later must not fall off the end of a short month.
test('a sample day is clamped to the month it lands in', () => {
  for (const now of MONTHS) {
    for (const { start, end } of samplesFor(now)) {
      for (const value of [start, end].filter(Boolean)) {
        const d = new Date(value);
        assert.ok(!Number.isNaN(d.getTime()), `${value} is not a date`);
        assert.ok(d.getUTCDate() <= lastDayOf(d), `${value} ran past the month`);
      }
    }
  }
});

// ===============================
// * WHAT THE TOGGLE IS COSTING A ROW
// ===============================
// A deal that finished months ago sits GREEN with the end date out of the
// formula, stays in the month's total, and nothing on the row says so. That
// is the case somebody has to act on, so it is the case that warns.
test('only the rows the toggle actually moves carry a warning', () => {
  for (const now of MONTHS) {
    const preset = presetFor(now);
    for (const useEndDate of [true, false]) {
      const flips = samplesFor(now)
        .map((s) => Boolean(ifToggled(s.start, preset, s.end, useEndDate)));
      // Rows four and five are the two the end date decides, and they are
      // deliberately next to the ones it does not.
      assert.deepEqual(flips, [false, false, false, true, true, false], `useEndDate ${useEndDate}`);
    }
  }
});

test('the flip names the colour the rules would really produce', () => {
  const preset = '2026-09-01';
  // Finished months ago: green while the end date is out, red once it is in.
  const ended = ifToggled('2025-05-01', preset, '2026-01-01', false);
  assert.deepEqual(ended, { now: RUNNING, other: NOT_STARTED, endedBefore: true });

  // Ending inside the month is amber, and it did not end BEFORE it.
  const ending = ifToggled('2025-05-01', preset, '2026-09-26', false);
  assert.deepEqual(ending, { now: RUNNING, other: STARTED, endedBefore: false });

  // Read the other way round, the answer is the mirror of itself.
  assert.deepEqual(ifToggled('2025-05-01', preset, '2026-01-01', true), {
    now: NOT_STARTED, other: RUNNING, endedBefore: true,
  });
});

test('a row the toggle cannot move says nothing', () => {
  const preset = '2026-09-01';
  assert.equal(ifToggled('2025-05-01', preset, '2027-01-20', false), null);
  assert.equal(ifToggled(null, preset, null, false), null);
  assert.equal(ifToggled('2026-10-11', preset, '2027-01-20', true), null);
});

// ===============================
// * THE REASON AND THE COLOUR CANNOT DISAGREE
// ===============================
// `paymentStartReason` repeats `paymentStartState`'s rule order to name
// WHICH rule fired. Two functions walking one order is exactly how a
// preview starts explaining a colour it is not showing, so every reason is
// checked against the state the real function returns.
const STATE_OF_REASON = {
  startsAfter: NOT_STARTED,
  endedBefore: NOT_STARTED,
  startsInside: STARTED,
  endsInside: STARTED,
  running: RUNNING,
  noStart: RUNNING,
};

test('every reason implies the colour the rules actually produce', () => {
  const extra = [
    { start: null, end: '2026-01-01' },
    { start: '2026-09-30', end: null },
    { start: '2026-09-01', end: '2026-09-01' },
    { start: null, end: null },
  ];
  for (const now of MONTHS) {
    const preset = presetFor(now);
    for (const s of [...samplesFor(now), ...extra]) {
      for (const useEndDate of [true, false]) {
        const reason = paymentStartReason(s.start, preset, s.end, useEndDate);
        assert.ok(STATE_OF_REASON[reason], `unknown reason ${reason}`);
        assert.equal(
          STATE_OF_REASON[reason],
          paymentStartState(s.start, preset, s.end, useEndDate),
          `${reason} does not match the colour for ${s.start} to ${s.end}, useEndDate ${useEndDate}`,
        );
      }
    }
  }
});

// ===============================
// * AND THE ORDER ITSELF IS PINNED
// ===============================
// The check above cannot see a reordering of two rules that reach the SAME
// colour, and there are two such pairs. So the rows where both rules fire
// are asserted directly: whichever rule `paymentStartState` stops at is the
// one that has to be named.
test('when two rules both fire, the earlier one is the one named', () => {
  const preset = '2026-09-01';

  // Starts after the month AND ended before it. Nonsense dates, but the
  // order still has to be the state function's order.
  assert.equal(paymentStartReason('2026-10-15', preset, '2026-08-01', true), 'startsAfter');

  // Starts inside the month AND ends inside it.
  assert.equal(paymentStartReason('2026-09-05', preset, '2026-09-26', true), 'startsInside');
});

// The reason has to MOVE with the toggle, or it is the fixed label all over
// again: "Finished months ago" printed beside a green cell.
test('the two rows the end date decides read differently in each state', () => {
  const preset = '2026-09-01';
  const finished = ['2025-05-01', '2026-01-01'];
  const ending = ['2025-05-01', '2026-09-26'];

  assert.equal(paymentStartReason(...[finished[0], preset, finished[1]], true), 'endedBefore');
  assert.equal(paymentStartReason(...[finished[0], preset, finished[1]], false), 'running');
  assert.equal(paymentStartReason(...[ending[0], preset, ending[1]], true), 'endsInside');
  assert.equal(paymentStartReason(...[ending[0], preset, ending[1]], false), 'running');
});

// The panel is a WORKED EXAMPLE, so it must colour with the sheet's own
// function and name no month of its own.
test('the preview shows the preset it is measuring against', () => {
  const panel = read('components/settings/PaymentStartRules.jsx');

  assert.match(panel, />Preset<\/th>/);
  // THE ICON IS ON THE CELL THE COLOUR IS ABOUT, on every row, in both
  // toggle states: a row without one would read as a row with nothing to
  // say. Warning only where the toggle would actually move it.
  assert.match(panel, /<PaymentStartWhy start=\{s\.start\} preset=\{preset\} end=\{s\.end\} useEndDate=\{useEndDate\} \/>/);
  // The Colour column names the RULE THAT FIRED, derived per toggle state,
  // never a fixed label on the sample.
  assert.match(panel, /const words = paymentStartWords\(s\.start, preset, s\.end, useEndDate\)/);
  assert.match(panel, /\{` · \$\{words\.reason\}`\}/);
  // Guarded on the CODE, not on the old prose: the comments in that file
  // quote the wording they replaced, on purpose.
  assert.doesNotMatch(panel, /s\.note/);
  assert.doesNotMatch(panel, /because: \(useEnd\)/);
  // The hand rolled `?` popup is gone, and so is its state.
  assert.doesNotMatch(panel, /function Why\(\{/);
  assert.doesNotMatch(panel, /useState/);
});

// ===============================
// * ONE COMPONENT, BOTH PAGES
// ===============================
// The preview exists to teach the rule the sheet applies, so two copies of
// the wording is two chances for the lesson and the thing being taught to
// disagree.
test('the sheet and the preview explain the colour with the same component', () => {
  const why = read('components/display/PaymentStartWhy.jsx');
  const sheet = read('pages/MasterSheetPage.jsx');
  const panel = read('components/settings/PaymentStartRules.jsx');

  assert.match(why, /tone: flip \? 'warning' : 'info'/);
  // The flip is still asked from the one helper, and is SKIPPED once the
  // special case switch is on: that decision is read before either date,
  // so "the end date setting would move this row" is a line about a rule
  // that no longer applies to it. Migration 064.
  assert.match(why, /ifToggled\(start, preset, end, useEndDate\)/);
  assert.match(why, /specialCaseDeal \? null : ifToggled\(/);
  assert.match(why, /export function paymentStartWords/);
  // No place is named in the SENTENCE it prints: it is read where the
  // toggle is on screen and where it is not. Scoped to the function, not
  // the file, because the comment above it explains that in those words.
  const sentence = why.match(/function toggleLine\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(sentence, /Settings|Preset formula/);

  // ===============================
  // * ONE DEFINITION OF THE WORDS, TWO SHAPES OF ICON
  // ===============================
  // The preview RENDERS the component; the sheet folds the same words into
  // the date suggestion's own popup, because a cell may carry only one
  // icon. Both come out of this file, which is the whole point: two copies
  // of the sentence is two chances for the lesson and the sheet to
  // disagree. Changed 2026-09-17, on sight: the cell had two icons.
  assert.match(panel, /import PaymentStartWhy(, \{ paymentStartWords \})? from/, 'the preview does not use it');
  assert.match(panel, /<PaymentStartWhy/, 'the preview does not render it');
  assert.match(sheet, /import \{ paymentStartWhyParts \} from/, 'the sheet does not use it');
  assert.match(why, /export function paymentStartWhyParts/, 'and it must be exported to be shared');

  // ON EVERY ROW of the sheet's payment start column, and through ONE
  // marker. Where a date suggestion exists the explanation is stacked
  // inside it; where none does, the explanation IS the marker. A cell with
  // no icon has to mean "nothing to say", never "the icon lost a fight".
  assert.match(sheet, /after=\{dateMarkers\.payment_start_on\}/);
  assert.match(sheet, /notices\.payment_start_on = startNotice/);
  // ===============================
  // * AND NOTHING NATIVE DRAWS OVER THE POPUP IT OPENS
  // ===============================
  // The cell carries `title="Click to edit ..."`. A browser draws that
  // itself, above every z-index there is, so hovering a marker popped the
  // grey box straight over the panel the marker had just opened.
  assert.match(sheet, /<span title="" className="ml-auto flex shrink-0 items-center gap-1">/);
  assert.match(sheet, /start: row\.payment_start_on,\s*preset: row\.preset_on,\s*end: row\.end_on,\s*useEndDate,/);
  assert.match(panel, /paymentStartState\(s\.start, preset, s\.end, useEndDate\)/);
  assert.match(panel, /const preset = presetFor\(\)/);
  assert.match(panel, /const \{ lastDay, month \} = monthSpanFor\(\)/);
  // Nothing pinned, and no month named in the source.
  assert.doesNotMatch(panel, /const PRESET = '/);
  assert.doesNotMatch(panel, /\b20\d\d-\d\d-\d\d\b/);
  assert.doesNotMatch(panel, /August|October|January/);
});
