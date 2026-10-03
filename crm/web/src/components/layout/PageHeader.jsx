import { useEffect } from 'react';
import Button from '../buttons/Button';
import { useStickyState } from '../../hooks/useStickyState';
import { FilterIcon, CloseIcon } from '../icons';

/**
 * Title, subtitle, and the page's actions, laid out the same on every
 * page.
 *
 * Exists because the four pages had each grown their own header with its
 * own heading size, its own gap, and its own idea of where the buttons
 * go. This is the Master Sheet page's layout, extracted, so "make the
 * headers match" is one file rather than four.
 *
 * `actions` sits on the same row as the title on a wide screen and drops
 * below on a narrow one, rather than squeezing — a toolbar that shrinks
 * until the labels wrap is the thing this was built to stop.
 */
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 sm:mb-5">
      <div className="min-w-0">
        <h1 className="text-lg font-bold tracking-tight text-text sm:text-xl md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-text-muted sm:mt-1 sm:text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2 items-center flex-wrap">{actions}</div>}
    </div>
  );
}

/**
 * The search + filters + actions row that sits under a PageHeader.
 *
 * Actions are pushed right with ml-auto rather than justify-between on
 * the parent, so search and filters keep their natural left grouping when
 * the row wraps on a narrow screen instead of springing apart.
 */
/**
 * Two rows: search on top, filtering underneath.
 *
 * They were one row, and it wrapped badly — a search box, two checkboxes,
 * a filter button and five dropdowns competing for the same line meant
 * the filter icon landed somewhere different on every page depending on
 * how long the search placeholder was. Searching and filtering are also
 * two different acts, and putting them on one line implied they were one.
 *
 * `actions` stays on the search row and is pushed right, so page-level
 * buttons keep their own corner rather than being dragged around by
 * however many filters a page happens to have.
 */
/**
 * Two rows.
 *
 *   row 1   search, the always-visible checkbox filters, and the page's
 *           own actions pushed right
 *   row 2   the filter button and whatever it opens
 *
 * They were one row and it wrapped badly: a search box, two checkboxes, a
 * filter button and five dropdowns competing for one line meant the
 * filter button landed somewhere different on every page depending on how
 * long the search placeholder was.
 *
 * The split is by cost, not by category. A checkbox is one click with
 * nothing behind it, so it belongs next to the search where you can see
 * it. The filter button opens a menu, so it gets its own line where that
 * menu has room to appear.
 */
/**
 * The toolbar every list page uses.
 *
 *   row 1   search, the checkbox filters, the filter button, and the
 *           page's own actions pushed right
 *   row 2   the dropdown filters, only once the filter button is on
 *
 * The button and the things it opens are deliberately on DIFFERENT rows.
 * Keeping them together meant row one grew from four controls to nine the
 * moment anyone opened it, and everything after the button jumped
 * sideways. Now opening filters pushes the table down by one row and
 * nothing else moves.
 *
 * The split between the two kinds of filter is by cost. A checkbox is one
 * click with nothing behind it, so it sits in the open. A dropdown needs
 * room for a menu, so it waits until asked for.
 *
 * `alwaysOpen` DROPS THE BUTTON and leaves row two showing. For a page
 * with few enough filters that the row never grows past one line, the
 * button hides nothing worth hiding: it costs a click to reach three
 * controls that would have fitted on screen anyway, and it lets a page sit
 * there filtered with the controls that did it out of sight. Flagged is
 * the case — a status, a group and a date range.
 */
export function Toolbar({
  search,
  inline,
  filters,
  filtersActive,
  filtersCount,
  onClearFilters,
  actions,
  count,
  countLabel = 'rows',
  alwaysOpen = false,
  storageKey,
}) {
  // `filtersActive` decides whether the dropdown row springs open, so it
  // only counts the dropdowns. `filtersCount` counts everything applied,
  // including the checkboxes, which is what Clear needs to know about.
  const anyFilter = filtersCount > 0;
  /**
   * OPEN OR SHUT SURVIVES A RELOAD, same as the filters themselves.
   *
   * It was plain `useState`, so every refresh collapsed the row and you
   * reopened it by hand to reach controls you had just been using. The
   * values were already sticky; the panel showing them was not, which is
   * the half that made it feel like clicking twice for nothing.
   *
   * `storageKey` is optional so a page without one behaves exactly as
   * before rather than silently sharing a key with another page.
   */
  const [open, setOpen] = useStickyState(
    storageKey ?? 'toolbar.unkeyed',
    Boolean(filtersActive),
  );

  // And it opens WHENEVER a filter turns on, not just on first render.
  // Filters get applied from elsewhere on the page — the Master Sheet's
  // "6 need a check" link sets one, and that control now lives in this
  // panel — so a mount-time default would leave the list visibly filtered
  // with nothing on screen explaining why. Only ever opens: closing it by
  // hand while a filter is on has to stick.
  useEffect(() => {
    if (filtersActive) setOpen(true);
  }, [filtersActive]);

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border bg-surface p-2.5 shadow-sm">
      <div className="flex gap-2 items-center flex-wrap">
        {search}

        {/* Always green. See FilterPanel for the same call: a grey icon
            between a search box and a checkbox read as decoration, not as
            the way into the page's other controls. */}
        {filters && !alwaysOpen && (
          <Button
            variant="primary"
            className="h-8 min-h-0 px-2 py-0"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label="Filters"
          >
            <FilterIcon width={16} height={16} />
            {/* The count rides on the button, so a filtered page says so
                even with the row below it collapsed. */}
            {filtersCount > 0 && <span className="tabular-nums text-xs">{filtersCount}</span>}
          </Button>
        )}

        {inline}

        {/* The way back out. Applying a filter from a link elsewhere on
            the page used to leave no visible control to undo it, and a
            ticked checkbox counts as a filter here even though it lives
            in the open. */}
        {(filtersActive || anyFilter) && onClearFilters && (
          <Button variant="warning" className="h-8 min-h-0 px-2 py-0" onClick={onClearFilters}>
            <CloseIcon width={13} height={13} />
            Clear
          </Button>
        )}

        {/* HOW MANY ROWS THE FILTERS MATCH. Pinned to the right edge with
            the actions and reading as a caption, not as a control: in
            amongst the filter checkboxes it sat at the same weight as
            "Should be paid" and looked like one more thing to click.
            Quieter and further away, it is the label on the list that the
            controls to its left produce.

            Not the same fact as Pagination's "1-25 of 96" under the table,
            which says which slice you are on. This says how big the answer
            is, and it shows on a single page, where Pagination hides itself
            entirely and a filtered list had nothing saying what it removed. */}
        {(typeof count === 'number' || actions) && (
          <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
            {typeof count === 'number' && (
              <span className="text-xs tabular-nums text-text-faint">
                {count} {count === 1 ? countLabel.replace(/s$/, '') : countLabel}
              </span>
            )}
            {actions}
          </div>
        )}
      </div>

      {(alwaysOpen || open) && filters && (
        <div className="flex gap-2 items-center flex-wrap">{filters}</div>
      )}
    </div>
  );
}

/**
 * The search box, identical everywhere. Same width, same icon, same
 * placement of it — three pages had three slightly different versions.
 */
export function SearchInput({ value, onChange, placeholder = 'Search…', icon: Icon, className = '' }) {
  return (
    // Full width on a phone, a fixed 16rem from sm up. w-64 alone made
    // the row wider than the screen the moment the filter button and a
    // checkbox sat beside it.
    <div className={`relative w-full sm:w-auto ${className}`}>
      <input
        type="search"
        placeholder={placeholder}
        className="h-8 min-h-0 w-full py-0 pl-7 pr-2 text-[16px] sm:w-64 sm:text-sm"
        value={value}
        onChange={onChange}
      />
      {Icon && <Icon className="absolute left-1.5 top-1/2 -translate-y-1/2 text-text-faint w-3.5 h-3.5" />}
    </div>
  );
}
