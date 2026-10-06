import { SearchIcon } from '../../icons';

/**
 * ***************************************************
 * * ONE LOOK FOR EVERYTHING SHE DRAWS IN THE CONVERSATION
 * ***************************************************
 *
 * His call 2026-09-30: the sheet check's format, on every card. No panel
 * around it, a caption for a header, section labels with their count at the
 * far edge, and rows that line up on a two column grid because they share
 * it, not because anything is drawn around them.
 *
 * These are the pieces; SheetCheck, DealList, RecentChangesList, CompanyList
 * and DealCard are built from them, so a change to the look is made once.
 */

export const SEP = ' · ';

/** The header: a small caption, never a panel title. */
export function Caption({ children, aside = null }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <p className="m-0 min-w-0 truncate text-[10px] font-semibold uppercase tracking-wider text-white/35">
        {children}
      </p>
      {aside}
    </div>
  );
}

/**
 * THE SEARCH IS A LINE, not a bubble. His call 2026-09-30: an underline and
 * a search icon on the right, nothing rounded and nothing filled.
 *
 * FOCUSED, ONLY THE UNDERLINE LIGHTS. The app-wide `input:focus` outline
 * outranks a plain `outline-none`, so it needs the focus variant.
 */
export function LineSearch({ value, onChange, placeholder = 'Find a person', label }) {
  return (
    <label className="group flex w-32 shrink-0 items-center gap-1 border-b border-white/15 transition-colors focus-within:border-diane-signal sm:w-40">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 py-0.5 text-[10px] text-white/80 shadow-none outline-none ring-0 placeholder:text-white/25 focus:shadow-none focus:outline-none focus:ring-0"
      />
      <SearchIcon width={11} height={11} className="shrink-0 text-white/35 transition-colors group-focus-within:text-diane-signal" aria-hidden="true" />
    </label>
  );
}

/** A section's label, with its count at the far edge. A word, not a header. */
export function SectionLabel({ label, count }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-diane-signal/80">{label}</span>
      {count !== undefined && count !== null && (
        <span className="shrink-0 text-[10px] tabular-nums text-white/35">{count}</span>
      )}
    </div>
  );
}

/**
 * THE ROWS. `max-content` on the first column sizes it to the longest name
 * in THIS section, and `contents` on each row puts its two halves into the
 * parent grid so every row lines up with every other. One column on a phone.
 *
 * A row is { key, who, where, detail, title, onClick, trailing }.
 */
export function Rows({ rows, wrap = false }) {
  return (
    // minmax, not a bare max-content: a long name pushed the right column
    // off the card and cut "Will never be bank" mid word. The left column
    // truncates, the right one keeps at least 40% and wraps. 2026-09-30.
    // WRAP, for a plan: every word of who and where is read, nothing is cut.
    <div className={`mt-1 grid gap-x-4 gap-y-0.5 ${wrap ? 'sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : 'sm:grid-cols-[minmax(0,max-content)_minmax(40%,1fr)]'}`}>
      {rows.map((row) => {
        const Tag = row.onClick ? 'button' : 'div';
        return (
          <Tag
            key={row.key}
            {...(row.onClick ? { type: 'button', onClick: row.onClick } : {})}
            title={row.title}
            // whitespace-normal: every <button> in the app is nowrap (index.css),
            // and a clickable row inherited it, so its detail could never wrap.
            className="contents min-h-0 whitespace-normal border-0 bg-transparent p-0 text-left"
          >
            <span className={`${wrap ? 'break-words' : 'truncate'} py-0.5 text-[10.5px] leading-snug text-white/85 ${row.onClick ? 'hover:text-diane-signal' : ''}`}>
              <span className="text-white/35">●{' '}</span>
              {row.who}
              {row.where && <span className="text-white/40">{SEP}{row.where}</span>}
            </span>
            <span className="flex min-w-0 items-baseline gap-1.5 pb-1 text-[10.5px] leading-snug text-white/50 sm:py-0.5 sm:pb-0.5">
              <span className="min-w-0 break-words">{row.detail}</span>
              {row.trailing}
            </span>
          </Tag>
        );
      })}
    </div>
  );
}

/** One labelled block of rows, and the cut said out loud when there is one. */
export function Section({ label, count, rows, shown = rows.length, wrap = false }) {
  return (
    <div className="mt-3 first:mt-0">
      {label && <SectionLabel label={label} count={count} />}
      <Rows rows={rows} wrap={wrap} />
      {count > shown && (
        <p className="m-0 mt-1 px-0.5 text-[10px] text-white/30">showing {shown} of {count}</p>
      )}
    </div>
  );
}

/** Rows grouped by a key, in first seen order, for a sectioned list. */
export function groupRows(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row) || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups];
}
