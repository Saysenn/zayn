// ***************************************************
// * `2026-08` as `Aug 2026`
// ***************************************************
//
// It was written inside DashboardPage, which meant a shared badge could not
// name a month without importing a page. Anything that is not a month comes
// straight back out, because a label is not the place to discover that a
// value is malformed.

export function monthLabel(value, long = false) {
  if (!/^\d{4}-\d{2}$/.test(String(value))) return value || 'This month';
  return new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export default monthLabel;
