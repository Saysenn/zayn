import { useMemo, useRef, useState } from 'react';
import ScrollMore from '../ScrollMore';
import { Caption, LineSearch, Section } from './Ledger';

/**
 * ANY SECTIONED ANSWER, drawn in the sheet check's ledger (his call
 * 2026-09-30): the review queue, the Archive, a breakdown, a month compared
 * with another. They were walls of text in a bubble.
 *
 * list = { kind, title, note?, sections: [{ label, count?, rows: [{ id?, name, where?, detail }] }] }
 * A row with an id opens the deal.
 */
export default function SectionedList({ list, onOpen }) {
  const scrollRef = useRef(null);
  const [query, setQuery] = useState('');
  const sections = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (list.sections ?? [])
      .map((s) => ({
        ...s,
        rows: needle
          ? s.rows.filter((r) => `${r.name} ${r.where ?? ''} ${r.detail ?? ''}`.toLocaleLowerCase().includes(needle))
          : s.rows,
      }))
      .filter((s) => s.rows.length > 0);
  }, [list.sections, query]);
  const all = (list.sections ?? []).reduce((n, s) => n + s.rows.length, 0);
  const shown = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <section aria-label={list.title}>
      <Caption aside={all > 4 && <LineSearch value={query} onChange={setQuery} placeholder="Find" label="Find in this list" />}>
        {list.title}
      </Caption>
      {list.note && <p className="m-0 mb-2 whitespace-pre-line px-0.5 text-[10px] text-white/40">{list.note}</p>}

      <div className="relative">
        <div ref={scrollRef} className="agent-scroll max-h-[55vh] overflow-y-auto pr-1">
          {sections.map((s, i) => (
            <Section
              key={`${s.label}-${i}`}
              label={s.label}
              count={s.count}
              shown={s.rows.length}
              rows={s.rows.map((r, j) => ({
                key: r.id ?? `${i}-${j}`,
                who: r.name,
                where: r.where,
                detail: r.detail,
                title: [r.name, r.where, r.detail].filter(Boolean).join(' · '),
                onClick: onOpen && r.id ? () => onOpen({ id: r.id }) : undefined,
              }))}
            />
          ))}
          {shown === 0 && <p className="m-0 py-2 text-[10px] text-white/45">Nothing matches</p>}
        </div>
        {all > 8 && <ScrollMore targetRef={scrollRef} label={`${shown} rows`} watch={shown} />}
      </div>
    </section>
  );
}
