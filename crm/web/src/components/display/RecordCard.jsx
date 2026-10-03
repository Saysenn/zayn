import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import CellInfo from './CellInfo';
import TruncatedText from './TruncatedText';

// Tailwind's JIT only sees class names written out in full, so a clamp
// cannot be interpolated from the number. One map, and the set of allowed
// depths is visible rather than whatever a caller happened to pass.
const CLAMP = { 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' };

export function ClampedText({ children, lines = 2, className = '', infoLabel = 'Full text' }) {
  const textRef = useRef(null);
  const [clipped, setClipped] = useState(false);

  const measure = useCallback(() => {
    const node = textRef.current;
    if (node) setClipped(node.scrollHeight > node.clientHeight);
  }, []);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined' || !textRef.current) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(textRef.current);
    return () => observer.disconnect();
  }, [measure, children, lines]);

  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <p ref={textRef} className={`${CLAMP[lines] ?? CLAMP[2]} min-w-0 flex-1 break-words ${className}`}>
        {children}
      </p>
      {clipped && <CellInfo label={infoLabel}>{children}</CellInfo>}
    </div>
  );
}

/**
 * One record, as a card. What a table row becomes on a phone, and what a
 * whole list becomes on Flagged.
 *
 * NOT A NARROWER TABLE. Hiding columns was tried in spirit with the frozen
 * columns and it only moves the problem: a row is still a row, and the
 * thing a phone cannot do is show one. So the row is turned inside out.
 * The two or three facts you actually scan for go on top at full size, and
 * the rest become label/value pairs underneath.
 *
 * WHAT GOES WHERE, and it is the same question on every page:
 *
 *   title     who or what this is. The thing you are scanning for.
 *   badges    state you judge at a glance: flagged, ended, paid.
 *   lead      the one number that matters. Money, nearly always, because
 *             the question a phone gets asked is "what do they earn" or
 *             "did they get paid".
 *   facts     everything else, two per row, label above value.
 *   actions   what you can do without opening it.
 *
 * `onOpen` makes the whole card the target rather than a chevron. A thumb
 * is about 44px wide and a chevron is not.
 *
 * A FACT CAN BE CLAMPED AND CAN CARRY AN ICON. `clamp` fixes it to a
 * number of lines so one card with a long message cannot be three times
 * the height of its neighbours, and `info` puts the whole thing behind a
 * CellInfo icon, on hover and on click. Without the clamp a grid of these
 * is ragged; without the icon the clamp would lose the text.
 *
 * `interactive` is for a card that IS the list rather than a phone's copy
 * of one. It lifts, scales and strengthens its shadow, and stretches to its
 * row's height so a grid has no gaps.
 */
export default function RecordCard({
  title,
  subtitle,
  icon: Icon,
  badges,
  lead,
  leadLabel,
  body,
  facts = [],
  actions,
  onOpen,
  interactive = false,
}) {
  const cardBody = (
    <>
      {/* ===============================
          * THE NAME CANNOT BE CRUSHED BY THE FIGURE
          * ===============================
          The lead is `shrink-0` and `whitespace-nowrap`, so a wide one took
          the whole row and the title beside it truncated to NOTHING: a
          company paid in three currencies showed its money and no name.
          `basis-0 flex-1` gives the left block a real share of the row
          rather than only what is left over. Keeping the lead unshrinkable
          is deliberate: money is not a thing to truncate. What stops it
          being wide is MoneyTotals, not this. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 basis-0 flex-1 items-start gap-3">
          {Icon && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-tint text-accent-strong">
              <Icon width={16} height={16} />
            </span>
          )}
          <div className="min-w-0">
            {/* No `title` attribute: the browser draws that as a second,
                native tooltip on top of this one. TruncatedText measures
                and only appears when the name is ACTUALLY cut. */}
            <p className="text-sm font-semibold leading-5 text-text">
              <TruncatedText className="max-w-full">{title}</TruncatedText>
            </p>
            {subtitle && <p className="mt-1 truncate text-xs text-text-muted">{subtitle}</p>}
          </div>
        </div>
        {lead !== undefined && lead !== null && (
          <div className="shrink-0 text-right">
            {leadLabel && (
              <p className="text-[10px] font-medium uppercase tracking-wide text-text-faint">{leadLabel}</p>
            )}
            <p className="mt-0.5 whitespace-nowrap text-sm font-semibold tabular-nums text-text">{lead}</p>
          </div>
        )}
      </div>

      {badges && <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges}</div>}

      {(body || facts.length > 0) && (
        <div className="mt-2.5 rounded-md bg-surface-sunken p-2.5">
          {body}
          {facts.length > 0 && (
            <dl className={`grid grid-cols-2 gap-x-4 gap-y-2.5 ${body ? 'mt-3 border-t border-border pt-3' : ''}`}>
              {facts.map((f) => (
                <div key={f.label} className={f.wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-text-faint">
                    {f.label}
                  </dt>
                  <dd className="mt-0.5 flex items-start gap-1 text-xs text-text">
                    <span className={f.clamp ? `${CLAMP[f.clamp]} break-words` : 'truncate'}>
                      {f.value ?? '—'}
                    </span>
                    {f.info && <CellInfo label={`Full ${f.label.toLowerCase()}`}>{f.info}</CellInfo>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </>
  );

  /**
   * THE CARD IS THE TARGET, and it is a div rather than a <button>.
   *
   * It used to wrap its body in one, which forbade putting any control
   * inside: a button within a button is invalid and the inner one stops
   * responding. That is why `actions` had to sit outside the clickable
   * area, and it is why a fact could not carry a CellInfo icon at all.
   *
   * So the click, the keyboard handling and the role move to the card
   * itself. Everything inside is now free to be a control, and `actions`
   * stops the click reaching the card so pressing one does not also open
   * the record.
   */
  const open = onOpen
    ? {
        role: 'button',
        tabIndex: 0,
        onClick: onOpen,
        onKeyDown: (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          onOpen();
        },
      }
    : {};

  return (
    <div
      {...open}
      className={`flex flex-col rounded-lg border border-border bg-surface p-3 shadow-sm ${
        onOpen ? 'cursor-pointer' : ''
      } ${
        // The hover z keeps a lifted card above the neighbour that follows
        // it in the document.
        interactive
          ? 'relative h-full transition duration-150 hover:z-[1] hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
          : ''
      }`}
    >
      {cardBody}

      {actions && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2.5"
        >
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * The list wrapper, so every page's cards sit at the same rhythm and every
 * page hides its table at the same width.
 *
 * `md` is the switch, not `sm`: at 640px a table of five columns is still
 * unreadable, and 768px is where a landscape phone stops pretending.
 *
 * `columns` is for a page whose cards ARE the list at every width, not a
 * phone's version of a table. It stays visible on desktop and lays out as
 * a grid: four to five across on a wide screen, one on a phone. Rows
 * stretch to equal height, which with a clamped fact is what keeps the
 * grid gapless — a masonry flow would fill the gaps too, at the cost of
 * reading down each column instead of across, and this list is ordered by
 * urgency.
 */
export function CardList({ children, columns = false }) {
  if (columns) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {children}
      </div>
    );
  }
  return <div className="flex flex-col gap-2 md:hidden">{children}</div>;
}
