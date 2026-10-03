import { useState } from 'react';
import Button from '../buttons/Button';
import { FilterIcon, CloseIcon } from '../icons';

/**
 * One collapsible home for a page's secondary filters — group, role,
 * status, date range, whatever isn't essential enough to show before it's
 * asked for. Search (where a page has one) stays outside this, in the page:
 * the one control worth keeping always visible.
 *
 * `active` lights the icon even while collapsed, so "a filter is applied"
 * is visible without opening the panel.
 */
export default function FilterPanel({ children, active, activeCount, onClear }) {
  // Opens itself when a filter is already on. Otherwise a filtered list
  // looks like a broken list: the rows are missing and the controls that
  // removed them are hidden behind an icon.
  const [open, setOpen] = useState(Boolean(active));

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Always green, not only once a filter is on. As a quiet button it
          was a grey icon sitting between a search box and a checkbox, and
          it read as decoration rather than the way into every other
          control on the page. The count beside it is what says a filter is
          currently applied. */}
      <Button
        variant="primary"
        className="h-8 min-h-0 px-2 py-0"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Filters"
      >
        <FilterIcon width={16} height={16} />
        {/* The count is on the icon, not just inside the panel, so a
            filtered page says so even with the panel shut. */}
        {activeCount > 0 && <span className="tabular-nums text-xs">{activeCount}</span>}
      </Button>
      {open && children}
      {/* The way back out. Clicking "Needs a check" from the counts above
          the table applied a filter with no visible control to undo it —
          you had to work out which dropdown had changed. */}
      {active && onClear && (
        <Button variant="warning" className="h-8 min-h-0 px-2 py-0" onClick={onClear}>
          <CloseIcon width={13} height={13} />
          Clear
        </Button>
      )}
    </div>
  );
}
