import { useLayoutEffect, useState } from 'react';

// ***************************************************
// * Where a portalled panel goes, worked out once
// ***************************************************

/**
 * A panel portalled to <body> has to place itself, and the clamping maths
 * was written out separately in CellInfo and again in TruncatedText. This
 * is that maths, so a third caller is not a third copy.
 *
 * It only knows about a rectangle and a viewport, so it is a plain function
 * and can be tested without a DOM.
 */

// Clear of the anchor, and clear of the window edge.
const GAP = 4;
const EDGE = 8;

/**
 * @param {DOMRect|object} rect the anchor's bounding box
 * @param {object} box  { width, height } the panel's own size
 * @param {object} view { width, height } the viewport
 * @returns {{top: number, left: number}} fixed coordinates
 */
export function popoverPosition(rect, box, view) {
  const below = view.height - rect.bottom;
  return {
    // Flips above when there is no room, which is the bottom row of any
    // long table and the case that made this obvious.
    top: below < box.height ? rect.top - box.height - GAP : rect.bottom + GAP,
    // Kept on screen: a panel on the rightmost column would otherwise hang
    // off the edge of the window.
    left: Math.max(EDGE, Math.min(rect.left, view.width - box.width - EDGE)),
  };
}

/**
 * The same thing, measured off a live ref.
 *
 * `box.height` is an ESTIMATE and has to be: the panel is not in the
 * document yet when the position is computed. It decides the flip only, so
 * being a little out moves the panel rather than breaking it.
 *
 * @returns {null|{top: number, left: number}} null while closed
 */
export default function usePopoverPosition(ref, showing, box) {
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!showing || !ref.current) { setPos(null); return; }
    setPos(popoverPosition(
      ref.current.getBoundingClientRect(),
      box,
      { width: window.innerWidth, height: window.innerHeight },
    ));
    // `box` is a literal at every call site, so a new object each render.
    // Its two numbers are what matter.
  }, [showing, ref, box.width, box.height]);

  return pos;
}
