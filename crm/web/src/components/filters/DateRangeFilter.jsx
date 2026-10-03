import Button from '../buttons/Button';

// The browser's LOCAL day as YYYY-MM-DD. Not toISOString: that is the UTC
// day, so a local midnight east of UTC printed the day before.
export function toDateInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function firstOfThisMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * A from/to range plus a "This month" shortcut — meant to live inside a
 * FilterPanel, not stand alone, so it never renders its own toggle.
 *
 * `onClear` + `filterActive` are optional — Flagged has an "unfiltered"
 * state to fall back to, the Calculator doesn't (it always shows some range).
 */
export default function DateRangeFilter({ from, to, onFrom, onTo, thisMonthActive, onThisMonth, filterActive, onClear }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <label htmlFor="from" className="field-label">From</label>
        <input id="from" type="date" className="input-inline" value={from} onChange={(e) => onFrom(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="to" className="field-label">To</label>
        <input id="to" type="date" className="input-inline" value={to} onChange={(e) => onTo(e.target.value)} />
      </div>
      <Button variant={thisMonthActive ? 'primary' : 'quiet'} className="input-inline" onClick={onThisMonth}>
        This month
      </Button>
      {onClear && filterActive && (
        <Button variant="quiet" className="input-inline" onClick={onClear}>
          Clear dates
        </Button>
      )}
    </>
  );
}
