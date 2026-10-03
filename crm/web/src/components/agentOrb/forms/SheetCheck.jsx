import {
  Caption, Section, SEP,
} from './Ledger';

/**
 * ***************************************************
 * * EVERY DISCREPANCY, IN COST ORDER, ON NO CARD
 * ***************************************************
 *
 * His format, 2026-09-30, and his two corrections to my first pass: no
 * panel around it, and nothing hidden.
 *
 * ---- NO CONTAINER ----
 *
 * It sits on the conversation's own ground like the deal bubbles do. A
 * bordered, filled box inside a column of bordered, filled boxes is what
 * made every answer read as the same grey slab.
 *
 * ---- THE ALIGNMENT IS A GRID, NOT A BOX ----
 *
 * The faults line up because the rows share a two column grid, not because
 * anything is drawn around them. See Ledger, which every other card in the
 * conversation now shares, his call the same day.
 *
 * ---- AND THE CAP IS SAID ----
 *
 * A long section cuts at twelve and prints "showing 12 of 40". A cap you
 * cannot see is the bug; hiding is what he objected to, not counting.
 */
export default function SheetCheck({ check, onOpen }) {
  if (!check) return null;

  return (
    <div>
      <Caption>
        Sheet check{SEP}{check.monthName}{SEP}{check.rows} rows
        {check.total > 0 && `${SEP}${check.total} to look at`}
      </Caption>

      {/* SILENT WHEN CLEAN. A report that always finds something is one
          nobody reads twice. */}
      {check.total === 0 ? (
        <p className="m-0 text-[11px] text-white/50">Nothing to flag.</p>
      ) : (
        check.sections.map((section) => (
          <Section
            key={section.key}
            label={section.label}
            count={section.count}
            shown={section.rows.length}
            rows={section.rows.map((row) => ({
              key: `${section.key}-${row.id}-${row.fault}`,
              who: row.who,
              where: row.where,
              detail: row.fault,
              title: `${row.who}${SEP}${row.where} — ${row.fault}`,
              onClick: () => onOpen?.({ id: row.id }),
            }))}
          />
        ))
      )}
    </div>
  );
}
