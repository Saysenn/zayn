/**
 * Did this column actually move, and what does it read as?
 *
 * One definition, because three things now ask it: the change log an
 * upload writes, the diff the comparison modal shows, and the commit that
 * follows. Two of them disagreeing would mean the modal showing a change
 * that the log then says never happened.
 *
 * The two sides are genuinely different shapes. node-postgres hands a
 * `date` column back as a Date and a `numeric` back as a string, while the
 * parser produces 'YYYY-MM-DD' strings and JS numbers for the same
 * columns.
 */

/** A stored value as text, for display and for the change log. */
function asText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/**
 * Compared as text, then as numbers when both look numeric.
 *
 * `payable_amount` comes back from Postgres as "3675.00" and goes in as
 * 3675. Without this every upload would report every money column as
 * changed, which is the fastest way to make a diff worth ignoring.
 */
function sameStoredValue(a, b) {
  const x = asText(a);
  const y = asText(b);
  if (x === y) return true;
  const nx = Number(x);
  const ny = Number(y);
  return x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny) && nx === ny;
}

module.exports = { asText, sameStoredValue };
