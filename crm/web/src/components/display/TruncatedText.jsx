import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A long value, cut with an ellipsis, shown whole on hover.
 *
 * NOT CellInfo, and the difference is the whole point. CellInfo is an icon
 * for information BESIDE a value ("the sheet says Handled Internally").
 * This is the value ITSELF being wider than its column, so there is
 * nothing to add and nothing to click: the cell already says the right
 * thing, it just cannot say all of it at once.
 *
 * THREE THINGS THAT MAKE IT WORK, all of them easy to get wrong:
 *
 *   It only appears when the text is ACTUALLY cut. Measured with
 *   scrollWidth > clientWidth on the real element, not guessed from a
 *   character count, because column widths change with the viewport. A
 *   tooltip on every cell regardless would be noise on the 90% that fit.
 *
 *   It never eats the click. These cells open an editor when clicked, so
 *   the panel is pointer-events: none and there is no click handler here
 *   at all. Hovering shows it; clicking still edits, exactly as before.
 *
 *   It is portalled to <body>. The table scrolls in its own box, so a
 *   panel rendered in the cell would be clipped at the table's edge,
 *   which is precisely where the widest columns are. Same reason
 *   CellInfo and Select's panel are portalled.
 */

// Below this, a value is short enough that the ellipsis never triggers and
// the measuring is wasted. Not a hard limit: the measurement still decides.
const MAX_WIDTH = 'max-w-[16rem]';

export default function TruncatedText({ children, className = '' }) {
  const ref = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState(null);

  const text = typeof children === 'string' ? children : null;

  useLayoutEffect(() => {
    if (!hovered || !ref.current) { setPos(null); return; }
    const el = ref.current;
    // The only reliable test for "is this cut off". A value that fits gets
    // no tooltip at all.
    if (el.scrollWidth <= el.clientWidth) { setPos(null); return; }

    const r = el.getBoundingClientRect();
    const WIDTH = 320;
    const below = window.innerHeight - r.bottom;
    setPos({
      // Flips above when there is no room, so the bottom rows of a long
      // table still show theirs.
      top: below < 80 ? undefined : r.bottom + 4,
      bottom: below < 80 ? window.innerHeight - r.top + 4 : undefined,
      left: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8)),
    });
  }, [hovered]);

  return (
    <>
      <span
        ref={ref}
        className={`block truncate ${MAX_WIDTH} ${className}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        // Keyboard users reach the cell, not this span, so focus on the
        // cell reveals it too.
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        {children}
      </span>

      {pos && text && createPortal(
        <span
          role="tooltip"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
          // pointer-events-none is load bearing: without it the panel sits
          // over the cell it describes and swallows the click that opens
          // the editor.
          // z-[58], THE SAME LAYER AS CellInfo, because it is the same kind
          // of thing: a portalled panel explaining the cell under it. It sat
          // at 45, and the comment here claimed that matched CellInfo when
          // CellInfo is 58 — so the two tooltips were a layer apart and this
          // one was BELOW Modal at 50. Not reachable today, since the cells
          // it decorates are on the page rather than in a dialog, but that
          // is the exact shape of the bug the z-index table exists to stop.
          className="pointer-events-none fixed z-[58] max-w-[20rem] whitespace-pre-wrap break-words
                     border border-border-strong bg-surface px-3 py-2 text-left text-xs
                     font-normal normal-case tracking-normal text-text shadow-lg"
        >
          {text}
        </span>,
        document.body,
      )}
    </>
  );
}
