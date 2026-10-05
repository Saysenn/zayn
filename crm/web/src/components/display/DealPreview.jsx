/**
 * THE ROWS THAT ARE ABOUT TO EXIST, as they will read.
 *
 * This was a sentence: "2 rows will be created, one per group and role
 * combination (MILKMAN · Developer, INDIGO · Developer), all with the
 * figures entered here." It told you the count and made you take the rest
 * on trust, and "all with the figures entered here" is the part worth
 * seeing rather than being promised, because the figures are on a step you
 * are no longer looking at.
 *
 * So it is the rows themselves. Group, role and company are what the count
 * multiplies out; the money is what every one of them carries. A blank
 * shows as a dash rather than as nothing, because an empty cell in a
 * preview reads as a rendering fault.
 *
 * ALWAYS SHOWN WHILE ADDING, even for a single row. The one-row case is
 * where a wrong group or a missing amount is easiest to miss, and a panel
 * that appears only once you pick a second group teaches nobody it exists.
 *
 * `existing` marks the row an edit is changing rather than creating, so a
 * form that saves one row and creates two says which is which.
 */
export default function DealPreview({ rows, existing = false }) {
  if (rows.length === 0) return null;

  const created = existing ? rows.length - 1 : rows.length;

  return (
    <div className="mt-4 border border-border">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">
          What this will write
        </span>
        <span className="text-xs tabular-nums text-text-muted">
          {existing && 'this row, and '}
          {created} new {created === 1 ? 'row' : 'rows'}
        </span>
      </div>

      {/* Scrolls rather than growing: two groups and three roles is six
          rows, and the buttons underneath must stay reachable. */}
      <ul className="max-h-40 divide-y divide-border overflow-y-auto">
        {rows.map((r, i) => (
          <li
            key={`${r.group}-${r.role}-${i}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-xs"
          >
            {existing && (
              <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">
                {i === 0 ? 'edit' : 'new'}
              </span>
            )}
            <span className="font-semibold">{r.person || '—'}</span>
            <span className="text-text-muted">{r.role || '—'}</span>
            <span className="text-text-muted">{r.group || '—'}</span>
            <span className="min-w-0 flex-1 truncate text-text-muted">{r.company || '—'}</span>
            <span className="tabular-nums">
              {r.amount ? `${r.currency} ${r.amount}` : <span className="text-text-faint">no amount</span>}
            </span>
            <span className="text-text-muted">{r.method}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
