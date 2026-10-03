// ***************************************************
// * The worked example behind the Settings preview
// ***************************************************
//
// ===============================
// * THE PRESET IS THIS MONTH, AND THE SAMPLES MOVE WITH IT
// ===============================
// It was pinned to 2026-08-01 with sample dates written for August, so by
// September the panel was demonstrating the rules against a month nobody
// was in: "Joined mid month" was a date two months back, and every colour
// in the table argued for a month the reader had left.
//
// Every date is an OFFSET from the preset month now, and the preset is the
// month it is. Nothing in here needs editing again.
//
// `now` IS AN ARGUMENT, not `new Date()` buried inside. It is what lets the
// test run the whole table through twelve months and check the colours come
// out the same every time, which is the only claim this file makes.

const iso = (d) => d.toISOString().slice(0, 10);

const firstOf = (offset, now) => new Date(Date.UTC(
  now.getUTCFullYear(),
  now.getUTCMonth() + offset,
  1,
));

/** Last day of the month `d` falls in, UTC. */
export const lastDayOf = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

/** A day inside the month `offset` months from this one. Clamped, so a day
 *  somebody picks later cannot fall off the end of February. */
function dayIn(offset, day, now) {
  const first = firstOf(offset, now);
  const at = Math.min(day, lastDayOf(first));
  return iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), at)));
}

/** The month the reader is in, as the sheet writes a preset. */
export function presetFor(now = new Date()) {
  return iso(firstOf(0, now));
}

/** "1 to 30 September", for the caption over the table. */
export function monthSpanFor(now = new Date()) {
  const first = firstOf(0, now);
  return {
    lastDay: lastDayOf(first),
    month: first.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }),
  };
}

/**
 * One row per case worth understanding. Chosen so every colour appears at
 * least once in BOTH toggle states, and so the two rows the end date moves
 * are visible beside the ones it does not.
 *
 * NO NOTE ON A SAMPLE. Each row carried a fixed label, "Finished months
 * ago", and the label did not move when the toggle did: it sat beside a
 * GREEN cell and read as though green meant finished. The Colour column
 * says which RULE fired instead, which is a different sentence in each
 * toggle state because it is a different rule. See paymentStartReason.
 */
export function samplesFor(now = new Date()) {
  const longAgo = dayIn(-16, 1, now);
  const farAhead = dayIn(5, 20, now);
  return [
    { start: longAgo, end: farAhead },
    { start: dayIn(0, 13, now), end: farAhead },
    { start: dayIn(1, 11, now), end: farAhead },
    { start: longAgo, end: dayIn(-8, 1, now) },
    { start: longAgo, end: dayIn(0, 26, now) },
    { start: null, end: null },
  ];
}
