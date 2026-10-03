// ***************************************************
// * Fixture months that MOVE WITH THE CLOCK
// ***************************************************
//
// THIRTEEN TESTS FAILED AT MIDNIGHT ON THE FIRST OF THE MONTH, and nothing
// had changed. Their fixtures were pinned to `preset_on: '2026-08-01'`,
// and `countsTowardTotal` falls back to `isForMonth(row)`, which means the
// month we are in NOW. On 31 August every fixture counted; on 1 September
// none of them did, so totals went to zero, adjustment rows vanished from
// the workbook, and the failures pointed at the breakdown writer.
//
// A SUITE THAT CRIES WOLF EVERY MONTH IS A SUITE PEOPLE STOP READING, and
// this one would have done it again on 1 October.
//
// So a fixture that means "the month being paid" says so, and a fixture
// that means "some other month" is expressed RELATIVE to now. Only tests
// that are genuinely about a specific calendar date should hardcode one,
// and then they must pass that month in explicitly rather than relying on
// the fallback.
//
// TESTING ONLY. Nothing in v1/ may require this.

/** 'YYYY-MM' for the month we are in, UTC. Matches presetMonth.helper. */
function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

/** A preset_on value that COUNTS: the first of the current month. */
function presetNow() {
  return `${thisMonth()}-01`;
}

/**
 * A preset_on `n` months away, for "marked for another month" cases.
 * Negative is the past. Always a real month, so December plus one is
 * January of the next year rather than month thirteen.
 */
function presetOffset(n) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n, 1));
  return d.toISOString().slice(0, 10);
}

/** A date `n` months from the start of this month, for starts and ends. */
function dateOffset(n) {
  return presetOffset(n);
}

module.exports = { thisMonth, presetNow, presetOffset, dateOffset };
