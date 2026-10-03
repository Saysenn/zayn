import { useState } from 'react';
import { useDuplicates } from '../../hooks/usePeople';
import { WarningIcon } from '../icons';

/**
 * "These numbers belong to more than one person."
 *
 * ON THE MASTER SHEET, not on People. A phone is a column on a ROW, so two
 * people sharing one is two rows to look at and the fix is made in a cell.
 * On People it sat above a list of humans, which is one step away from the
 * thing that is actually wrong and two steps from where it gets corrected.
 *
 * A NOTICE THAT ONLY TELLS YOU IS HALF A NOTICE. Every number here is the
 * button that filters the table to it, so the rows sharing it are on screen
 * in one click instead of being copied into the search box by hand. That is
 * the whole point of putting this on the page that holds the rows.
 *
 * SURFACED, NEVER ACTED ON. These are flagged so somebody can look, not so
 * anything gets merged: a person legitimately holds many deals, and two
 * people can legitimately share a phone (a household, a company line, the
 * sheet's own "Handled internally").
 */
export default function DuplicateBanner({ onShow, showing }) {
  const { data: duplicates } = useDuplicates();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !duplicates?.length) return null;

  // Four is what fits without the notice becoming the page. The rest are
  // one click away rather than behind a scroll nobody finds.
  const VISIBLE = 4;
  const shown = expanded ? duplicates : duplicates.slice(0, VISIBLE);
  const hidden = duplicates.length - shown.length;

  return (
    <div className="mb-4 flex items-start gap-3 border border-warning/30 bg-warning-tint px-4 py-3 text-sm">
      <WarningIcon width={16} height={16} className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {duplicates.length} phone {duplicates.length === 1 ? 'number is' : 'numbers are'} shared
          by more than one person.
        </p>
        <p className="mt-0.5 text-xs text-text-muted">
          Pick one to see its rows. Some are meant to be shared, so check before changing anything.
        </p>

        <ul className="mt-2 flex flex-wrap gap-1.5">
          {shown.map((d) => {
            const active = showing === d.phone;
            return (
              <li key={d.phone}>
                {/* The number and who holds it, in the control itself. A
                    separate "filter" button beside a line of text is two
                    targets for one act, and the number alone does not say
                    why it is listed. */}
                <button
                  type="button"
                  onClick={() => onShow?.(active ? '' : d.phone)}
                  aria-pressed={active}
                  title={active ? 'Stop showing only these rows' : `Show the ${d.names.length} rows on this number`}
                  className={`min-h-0 max-w-full gap-1.5 px-2 py-1 text-xs ${
                    active
                      ? 'border-accent bg-accent-tint font-semibold text-text'
                      : 'border-warning/30 bg-surface text-text-muted hover:border-accent hover:text-text'
                  }`}
                >
                  <span className="tabular-nums font-medium text-text">{d.phone}</span>
                  <span className="truncate">{d.names.join(', ')}</span>
                </button>
              </li>
            );
          })}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                className="btn-quiet min-h-0 border-0 p-1 text-xs underline"
                onClick={() => setExpanded(true)}
              >
                and {hidden} more
              </button>
            </li>
          )}
        </ul>
      </div>

      <button
        type="button"
        className="btn-quiet min-h-0 shrink-0 border-0 p-1 text-xs text-text-faint hover:text-text"
        onClick={() => setDismissed(true)}
      >
        Dismiss
      </button>
    </div>
  );
}
