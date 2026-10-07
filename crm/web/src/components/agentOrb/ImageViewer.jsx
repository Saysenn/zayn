import { useEffect } from 'react';
import { useAgentImage } from './forms/ExpenseImage';
import { CloseIcon, DownloadIcon } from '../icons';

/**
 * ONE PICTURE, LARGE, over Diane. Escape or a click outside closes it and
 * leaves her open (AgentOverlay holds its Escape while this is up).
 */
export default function ImageViewer({ image, onClose }) {
  const { url } = useAgentImage(image?.id);
  useEffect(() => {
    if (!image) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [image, onClose]);
  if (!image) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.caption || 'Picture'}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="flex max-h-full w-full max-w-4xl flex-col gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 text-xs text-white/70">
          <span>{image.caption}</span>
          <span className="flex items-center gap-1">
            {url && (
              <a
                href={url}
                download={`expenses-${image.id.slice(0, 8)}.png`}
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
    </div>
  );
}
