import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CHART_TOOLTIP } from '../../configs/dashboardTheme';

// ***************************************************
// * The popup both charts hang off the pointer
// ***************************************************
//
// CLIPPING IS NOT STACKING. Inside the panel it was cut off twice over:
// once by the scroll box around a narrow chart, and once by the panel's own
// `overflow-hidden`, which is what rounds the header. No z-index fixes
// either. This renders into <body> at viewport coordinates, so it is
// outside both boxes and can never resize the thing it describes.

const WIDTH = 248;
const GAP = 14;
// Clear of the bar itself when the popup goes beside it. A bar is around
// 32px wide, so half of that plus a gap.
const SIDE_GAP = 30;
const MARGIN = 8;
// Only used for the first frame, before the real height is measured.
const ESTIMATED_HEIGHT = 260;

const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

export default function ChartTooltip({ at, children }) {
  const box = useRef(null);
  // ===============================
  // * MEASURED, NOT GUESSED
  // ===============================
  // The height was a fixed 260 and it only ever decided whether to flip.
  // A group broken down by month AND currency runs past 500, so the popup
  // hung off the bottom of the screen with its totals unreadable.
  const [height, setHeight] = useState(ESTIMATED_HEIGHT);
  useLayoutEffect(() => {
    const measured = box.current?.getBoundingClientRect().height;
    if (measured) setHeight(measured);
  }, [at, children]);

  if (!at) return null;

  const room = { down: window.innerHeight - MARGIN - at.y - GAP, up: at.y - GAP - MARGIN };
  const centred = clamp(at.x - WIDTH / 2, MARGIN, window.innerWidth - WIDTH - MARGIN);
  // Below, then above, then BESIDE IT AT THE TOP. A popup taller than the
  // space either way cannot flip its way out of trouble, so it steps out of
  // the column entirely rather than being cut off.
  let top = at.y + GAP;
  let left = centred;
  if (height > room.down) {
    if (height <= room.up) {
      top = at.y - GAP - height;
    } else {
      top = clamp(MARGIN, MARGIN, Math.max(MARGIN, window.innerHeight - height - MARGIN));
      const rightOf = at.x + SIDE_GAP;
      left = rightOf + WIDTH <= window.innerWidth - MARGIN ? rightOf : Math.max(MARGIN, at.x - SIDE_GAP - WIDTH);
    }
  }

  return createPortal(
    // z-58, the layer the CRM's other two tooltips share. A tooltip clears
    // whatever the thing it explains is sitting on.
    // A hard stop as well as a placement. Nothing may be taller than the
    // screen, whatever a caller decides to put in it.
    <div ref={box} role="tooltip" style={{ top, left, width: WIDTH, maxHeight: window.innerHeight - MARGIN * 2 }} className={`pointer-events-none fixed z-[58] overflow-hidden p-3 ${CHART_TOOLTIP}`}>
      {children}
    </div>,
    document.body,
  );
}
