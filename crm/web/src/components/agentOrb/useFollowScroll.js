import { useEffect } from 'react';

/**
 * A HAND IN THE PANEL HOLDS IT STILL, AND GROWTH IS FOLLOWED.
 *
 * Live 2026-09-30: a click on a row landed on a heading because the panel
 * scrolled under the pointer, and a card that grew after it was drawn left
 * her reply below the fold behind "Latest".
 *
 * A click, wheel or touch holds the automatic scroll off for `holdMs`. While
 * they sit at the bottom (`stuckRef`), any bubble that grows, including one
 * added later, pulls the view down with it.
 */
export function useFollowScroll(scrollRef, stuckRef, holdUntilRef, { open, holdMs = 1500 }) {
  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el) return undefined;
    const hold = () => { holdUntilRef.current = Date.now() + holdMs; };
    el.addEventListener('pointerdown', hold, { passive: true });
    el.addEventListener('wheel', hold, { passive: true });
    el.addEventListener('touchstart', hold, { passive: true });

    const grown = new ResizeObserver(() => {
      if (stuckRef.current && Date.now() > holdUntilRef.current) el.scrollTop = el.scrollHeight;
    });
    for (const child of el.children) grown.observe(child);
    const added = new MutationObserver((records) => {
      for (const r of records) for (const node of r.addedNodes) if (node.nodeType === 1) grown.observe(node);
    });
    added.observe(el, { childList: true });

    return () => {
      added.disconnect();
      grown.disconnect();
      el.removeEventListener('pointerdown', hold);
      el.removeEventListener('wheel', hold);
      el.removeEventListener('touchstart', hold);
    };
  }, [open, holdMs, scrollRef, stuckRef, holdUntilRef]);
}
