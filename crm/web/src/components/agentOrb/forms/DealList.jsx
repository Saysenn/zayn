import { useMemo, useRef, useState } from 'react';
import ScrollMore from '../ScrollMore';
import {
  Caption, LineSearch, Section, groupRows,
} from './Ledger';

/**
 * MORE MATCHES THAN FIT AS CARDS.
 *
 * A filter that lands on thirty rows cannot draw thirty DealCards: each is
 * four groups of cells, and the answer to "which of these are on an old
 * preset" is the SHAPE of the set, not every column of every row.
 *
 * ---- THE SHEET CHECK'S FORMAT, his call 2026-09-30 ----
 *
 * It was a wrap of pill bubbles. Now it is the same ledger the sheet check
 * draws: a caption, a section per GROUP with its count, and one aligned row
 * per deal, the name and where on the left and the money on the right. The
 * group leads because it is what tells one of a person's deals from another.
 *
 * Every row still opens its deal. Everything else is one tap away in the card.
 */
export default function DealList({ list, onOpen }) {
  const scrollRef = useRef(null);
  const [query, setQuery] = useState('');
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return list.rows;
    return list.rows.filter((row) => String(row.name ?? '').toLocaleLowerCase().includes(needle));
  }, [list.rows, query]);

  const sections = groupRows(visibleRows, (r) => r.group);

  return (
    <div>
      {/* THE SEARCH IS NOT THERE AT ONE ROW. A box over a single named deal
          is a control with nothing to find. */}
      <Caption
        aside={list.rows.length > 1 && (
          <LineSearch value={query} onChange={setQuery} label="Find a person in this deal list" />
        )}
      >
        {list.title}
      </Caption>

      <div className="relative">
        <div ref={scrollRef} className="agent-scroll max-h-[50vh] overflow-y-auto pr-1">
          {sections.map(([group, rows]) => (
            <Section
              key={group}
              label={group}
              count={rows.length}
              rows={rows.map((r) => ({
                key: r.id,
                who: r.name,
                where: [r.company, r.role].filter(Boolean).join(' · '),
                detail: r.amount ?? '',
                title: [r.name, r.group, r.company, r.role, r.amount].filter(Boolean).join(' · '),
                onClick: () => onOpen?.(r),
                // Only when somebody has DECIDED. A mark on an undecided row
                // would read as a refusal to pay that nobody made.
                trailing: r.paid !== null && r.paid !== undefined ? (
                  <span
                    title={r.paid ? 'paid' : 'unpaid'}
                    className={`h-1 w-1 shrink-0 self-center rounded-full ${r.paid ? 'bg-diane-signal' : 'bg-diane-warn'}`}
                  />
                ) : null,
              }))}
            />
          ))}
          {visibleRows.length === 0 && (
            <p className="m-0 py-2 text-[10px] text-white/45">No matching person</p>
          )}
        </div>
        <ScrollMore targetRef={scrollRef} label={`${visibleRows.length} deals`} watch={visibleRows.length} />
      </div>
    </div>
  );
}
