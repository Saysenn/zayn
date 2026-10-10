import { useEffect, useState } from 'react';
import { ChevronIcon } from '../icons';

// ***************************************************
// * "There is more below", instead of a second scrollbar
// ***************************************************
//
// A deal list scrolls inside the conversation, which scrolls inside the
// panel, so two bars sat side by side down the right edge. Two bars is a
// question ("which one moves what?") where one affordance is an answer.
//
// So Diane's scroll areas hide their bars (see `.agent-scroll` in
// index.css) and say it in words instead: one small mark at the bottom
// centre, only while there IS something below, and clicking it goes there.
//
// `watch` is what re-checks it. Content growing changes `scrollHeight` and
// not the element's size, so a ResizeObserver never fires: the caller
// passes whatever count means "the content changed".

// A couple of pixels of rounding error must not read as more content.
const FLOOR = 24;

export default function ScrollMore({ targetRef, label = 'More', watch }) {
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return undefined;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > FLOOR);
    check();
    el.addEventListener('scroll', check, { passive: true });
    return () => el.removeEventListener('scroll', check);
  }, [targetRef, watch]);

  if (!more) return null;

  return (
    <button
      type="button"
      onClick={() => targetRef.current?.scrollTo({
        top: targetRef.current.scrollHeight,
        behavior: 'smooth',
      })}
      className="dm-latest absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-diane-line/40 bg-diane-panel/95 px-2 py-0.5 text-[9px] uppercase tracking-wide text-diane-dim shadow-lg backdrop-blur-sm transition-colors hover:border-diane-signal/60 hover:text-diane-signal"
    >
      <ChevronIcon width={10} height={10} className="rotate-90" />
      {label}
    </button>
  );
}
