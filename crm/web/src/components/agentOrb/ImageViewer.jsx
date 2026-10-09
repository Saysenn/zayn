import { useEffect } from 'react';
import { useAgentImage } from './forms/ExpenseImage';
import { ChevronIcon, CloseIcon, DownloadIcon } from '../icons';

/**
 * ONE PICTURE, LARGE, over Diane. Escape or a click outside closes it and
 * leaves her open (AgentOverlay holds its Escape while this is up).
 *
 * SEVERAL PICTURES ARE A ROW TO STEP THROUGH (his call 2026-10-08): the
 * arrows on screen or ← / → on the keyboard go to the previous and next one
 * in the conversation, with "2 of 5" so it is clear where you are. `images`
 * is every picture in the conversation, oldest first; `onMove` opens another.
 */
const arrow = 'btn-quiet flex h-10 w-10 min-h-0 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/40 p-0 text-white/80 hover:border-white/40 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25';

export default function ImageViewer({ image, images = [], onMove, onClose }) {
  const { url } = useAgentImage(image?.id);
  const at = image ? images.findIndex((x) => x.id === image.id) : -1;
  const prev = at > 0 ? images[at - 1] : null;
  const next = at >= 0 && at < images.length - 1 ? images[at + 1] : null;
  useEffect(() => {
    if (!image) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && prev) { e.preventDefault(); onMove?.(prev); }
      else if (e.key === 'ArrowRight' && next) { e.preventDefault(); onMove?.(next); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [image, prev, next, onMove, onClose]);
  if (!image) return null;
  const several = images.length > 1 && at >= 0;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.caption || 'Picture'}
      className="fixed inset-0 z-[80] flex items-center justify-center gap-3 bg-black/80 p-4"
      onClick={onClose}
    >
      {several && (
        <button type="button" className={arrow} disabled={!prev} onClick={(e) => { e.stopPropagation(); onMove?.(prev); }} aria-label="Previous picture" title="Previous picture (←)">
          <ChevronIcon width={18} height={18} className="rotate-180" />
        </button>
      )}
      <div className="flex max-h-full w-full max-w-4xl flex-col gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 text-xs text-white/70">
          <span className="min-w-0 truncate">{image.caption}</span>
          <span className="flex shrink-0 items-center gap-1">
            {several && <span className="px-2 tabular-nums text-white/50">{at + 1} of {images.length}</span>}
            {url && (
              <a
                href={url}
                download={`diane-${image.id.slice(0, 8)}.png`}
                className="flex h-8 w-8 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Download the picture"
                title="Download the picture"
              >
                <DownloadIcon width={16} height={16} />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="btn-quiet flex h-8 w-8 min-h-0 items-center justify-center border-0 bg-transparent p-0 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Close"
              title="Close"
            >
              <CloseIcon width={16} height={16} />
            </button>
          </span>
        </div>
        <div className="min-h-0 overflow-auto rounded-lg bg-white">
          {url ? <img src={url} alt={image.caption || ''} className="block h-auto w-full" /> : <div className="h-96 animate-pulse bg-black/10" />}
        </div>
      </div>
      {several && (
        <button type="button" className={arrow} disabled={!next} onClick={(e) => { e.stopPropagation(); onMove?.(next); }} aria-label="Next picture" title="Next picture (→)">
          <ChevronIcon width={18} height={18} />
        </button>
      )}
    </div>
  );
}
