import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PlusIcon, MinusIcon, DownloadIcon, CloseIcon,
} from '../icons';
import { saveBlob } from '../../helpers/api.helper';
import { zoomAt, MIN_ZOOM, MAX_ZOOM } from '../../helpers/zoom';

// ***************************************************
// * A RECEIPT, FOR A QUICK LOOK
// ***************************************************
//
// His call 2026-10-07: just the image, nothing else on screen, and four
// icons: zoom out, zoom in, download, close. Wheel, pinch, drag and double
// click still work, they just are not spelled out. A PDF shows the same way.

const STEP = 1.4;
const FIT = { scale: 1, x: 0, y: 0 };

/** One round icon button on the dark backdrop. */
function Tool({ label, onClick, disabled = false, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="btn-quiet flex h-9 min-h-0 w-9 items-center justify-center rounded-full border-0 bg-white/10 p-0 text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/**
 * @param {{ file: { blob: Blob, filename?: string }, title: string, onClose: () => void }} props
 */
export default function ReceiptViewer({ file, title, onClose }) {
  const [url, setUrl] = useState(null);
  const [view, setView] = useState(FIT);
  const box = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const drag = useRef(null);
  const moved = useRef(false);
  const isImage = /^image\//.test(file.blob.type || '');
  const isPdf = (file.blob.type || '') === 'application/pdf';

  useEffect(() => {
    const u = URL.createObjectURL(file.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file.blob]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setView((v) => zoomAt(v, v.scale * STEP, { x: 0, y: 0 }));
      if (e.key === '-') setView((v) => zoomAt(v, v.scale / STEP, { x: 0, y: 0 }));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // a point from the middle of the screen, where the picture is centred
  const local = useCallback((clientX, clientY) => {
    const r = box.current.getBoundingClientRect();
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  }, []);

  // the wheel needs a non-passive listener to stop the page scrolling
  useEffect(() => {
    const el = box.current;
    if (!el || !isImage) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      setView((v) => zoomAt(v, v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [local, isImage]);

  const onPointerDown = (e) => {
    if (!isImage) return;
    box.current.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), view };
      drag.current = null;
    } else {
      drag.current = { x: e.clientX, y: e.clientY, view };
    }
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      moved.current = true;
      setView(zoomAt(pinch.current.view, pinch.current.view.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist), local((a.x + b.x) / 2, (a.y + b.y) / 2)));
    } else if (drag.current && view.scale > 1) {
      const d = drag.current;
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) moved.current = true;
      setView({ ...d.view, x: d.view.x + e.clientX - d.x, y: d.view.y + e.clientY - d.y });
    }
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!pointers.current.size) drag.current = null;
  };
  // a click on the dark around it closes, never the end of a drag
  const onBackdrop = (e) => { if (e.target === e.currentTarget && !moved.current) onClose(); };
  const step = (k) => setView((v) => zoomAt(v, v.scale * k, { x: 0, y: 0 }));

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/85" role="dialog" aria-modal="true" aria-label={`Receipt: ${title}`}>
      <div
        ref={box}
        className={`absolute inset-0 flex touch-none select-none items-center justify-center overflow-hidden p-4 sm:p-10 ${isImage ? (view.scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in') : ''}`}
        onClick={onBackdrop}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => isImage && setView((v) => (v.scale > 1 ? FIT : zoomAt(v, 2.5, local(e.clientX, e.clientY))))}
      >
        {url && isImage && (
          <img
            src={url}
            alt={`Receipt for ${title}`}
            draggable={false}
            className="max-h-full max-w-full rounded-sm object-contain shadow-2xl"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: drag.current || pinch.current ? 'none' : 'transform 120ms ease-out' }}
          />
        )}
        {url && isPdf && <iframe title={`Receipt for ${title}`} src={url} className="h-full w-full max-w-4xl rounded-sm bg-white" />}
        {url && !isImage && !isPdf && <p className="text-sm text-white/80">This file can't be shown here. Use download to open it.</p>}
      </div>
      <div className="absolute right-3 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] flex items-center gap-2">
        {isImage && (
          <>
            <Tool label="Zoom out" onClick={() => step(1 / STEP)} disabled={view.scale <= MIN_ZOOM}><MinusIcon width={16} height={16} /></Tool>
            <Tool label="Zoom in" onClick={() => step(STEP)} disabled={view.scale >= MAX_ZOOM}><PlusIcon width={16} height={16} /></Tool>
          </>
        )}
        <Tool label="Download" onClick={() => saveBlob(file.blob, file.filename ?? 'receipt')}><DownloadIcon width={16} height={16} /></Tool>
        <Tool label="Close" onClick={onClose}><CloseIcon width={16} height={16} /></Tool>
      </div>
    </div>,
    document.body,
  );
}
