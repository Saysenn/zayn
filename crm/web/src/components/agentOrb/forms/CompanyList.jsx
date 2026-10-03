import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ScrollMore from '../ScrollMore';
import {
  Caption, LineSearch, Section, groupRows,
} from './Ledger';

/**
 * HER COMPANY ANSWERS, drawn. She answered companies in prose only; this is
 * the same ledger the sheet check draws (his call 2026-09-30): a section per
 * status with its count, and one row per company, the name and its groups on
 * the left and deals, handlers and money on the right. A row opens the
 * company's own page.
 */
export default function CompanyList({ list }) {
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const [query, setQuery] = useState('');
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return list.rows;
    return list.rows.filter((row) => String(row.name ?? '').toLocaleLowerCase().includes(needle));
  }, [list.rows, query]);

  const sections = groupRows(visibleRows, (r) => r.statusLabel ?? r.status);

  return (
    <div>
      <Caption
        aside={list.rows.length > 1 && (
          <LineSearch value={query} onChange={setQuery} placeholder="Find a company" label="Find a company in this list" />
        )}
      >
        {list.title}
      </Caption>

      <div className="relative">
        <div ref={scrollRef} className="agent-scroll max-h-[50vh] overflow-y-auto pr-1">
          {sections.map(([status, rows]) => (
            <Section
              key={status}
              label={status}
              count={rows.length}
              rows={rows.map((c) => ({
                key: c.id ?? c.name,
                who: c.name,
                where: [c.groups, c.tier && `tier ${c.tier}`, c.oldGroup && `old group ${c.oldGroup}`].filter(Boolean).join(' · '),
                detail: [c.dealsText, c.amount].filter(Boolean).join(' · '),
                title: [c.name, c.statusLabel ?? c.status, c.groups, c.dealsText, c.amount].filter(Boolean).join(' · '),
                onClick: c.href ? () => navigate(c.href) : undefined,
              }))}
            />
          ))}
          {visibleRows.length === 0 && (
            <p className="m-0 py-2 text-[10px] text-white/45">No matching company</p>
          )}
        </div>
        <ScrollMore targetRef={scrollRef} label={`${visibleRows.length} companies`} watch={visibleRows.length} />
      </div>
    </div>
  );
}
