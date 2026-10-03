import { useMemo, useRef, useState } from 'react';
import ScrollMore from '../ScrollMore';
import { Caption, LineSearch, Section } from './Ledger';

/**
 * A busy change window, in the sheet check's format (his call 2026-09-30):
 * a caption with the search on it, then one aligned row per change, the
 * person and where on the left and what moved on the right.
 */
export default function RecentChangesList({ list, onOpen }) {
  const scrollRef = useRef(null);
  const [query, setQuery] = useState('');
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return list.rows;
    return list.rows.filter((row) => String(row.name ?? '').toLocaleLowerCase().includes(needle));
  }, [list.rows, query]);

  const lines = visibleRows.flatMap((change) => {
    const moved = (change.changes ?? []).map((field) => ({
      key: `${change.id}-${field.field}`,
      who: change.name,
      where: change.where || 'no company or group',
      detail: `${field.label}: ${field.oldValue || 'blank'} to ${field.newValue || 'blank'}`,
      onClick: () => onOpen?.(change),
    }));
    const more = (change.changeCount ?? 0) - (change.changes?.length ?? 0);
    return more > 0
      ? [...moved, {
        key: `${change.id}-more`, who: change.name, where: '', detail: `+${more} more changes`, onClick: () => onOpen?.(change),
      }]
      : moved;
  });

  return (
    <section aria-label="Recent changes">
      <Caption aside={<LineSearch value={query} onChange={setQuery} label="Find a person in recent changes" />}>
        {list.title}
      </Caption>

      <div className="relative">
        <div ref={scrollRef} className="agent-scroll max-h-[55vh] overflow-y-auto pr-1">
          {lines.length > 0 && <Section rows={lines} />}
          {visibleRows.length === 0 && (
            <p className="m-0 py-2 text-[10px] text-white/45">No matching person</p>
          )}
        </div>
        <ScrollMore targetRef={scrollRef} label={`${visibleRows.length} deals`} watch={visibleRows.length} />
      </div>
    </section>
  );
}
