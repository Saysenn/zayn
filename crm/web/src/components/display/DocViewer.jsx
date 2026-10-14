import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { api, saveBlob } from '../../helpers/api.helper';
import Modal from '../modals/Modal';
import Button from '../buttons/Button';
import { Skeleton } from './Skeleton';
import { ChevronIcon, DownloadIcon, ExpandIcon, ShrinkIcon } from '../icons';

/**
 * ***************************************************
 * * A COMPANY'S DOCUMENTS, BROWSED WHERE YOU ARE (his call 2026-10-13)
 * ***************************************************
 *
 * One viewer for the Liquidations page and Diane's chat, V1 and V2 alike
 * (`tone`): a PDF or a picture shown as it is, a spreadsheet or CSV as a
 * table, anything else with text in it as that text, and a file with no
 * readable text says so and offers the download.
 *
 * THE WHOLE SET, NOT ONE FILE (his call 2026-10-13): closing it and
 * clicking the next document to see the others was the hard part. Every
 * document of the company is in the side list (a strip on a phone), ← and →
 * move between them, a swipe does on a phone, and the next one is loaded
 * before it is asked for, so moving is instant.
 *
 * `docs`: [{ name, mime, viewUrl, textUrl, downloadUrl }], `start` the one
 * opened. `doc` alone still works: a set of one.
 */
const PICTURE = /^image\/(png|jpe?g|gif|webp)$/i;
const PICTURE_NAME = /\.(png|jpe?g|gif|webp)$/i;

const kindOf = (d) => (/pdf/i.test(d.mime ?? '') || /\.pdf$/i.test(d.name) ? 'pdf'
  : PICTURE.test(d.mime ?? '') || PICTURE_NAME.test(d.name) ? 'picture'
    : 'text');
const extOf = (name) => (String(name).match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? 'file').toUpperCase();
const STILL_READING = new Set(['waiting', 'reading']);
// ONE ZIP FOR THE SET when every document is one company's (his call
// 2026-10-13): a browser keeps only the first of several downloads.
function zipOf(list) {
  const ids = list.map((d) => String(d.downloadUrl ?? '').match(/^(.*\/liquidations\/(\d+)\/docs)\/(\d+)$/));
  if (list.length < 2 || ids.some((m) => !m) || new Set(ids.map((m) => m[2])).size !== 1) return null;
  return `${ids[0][1]}/zip?ids=${ids.map((m) => m[3]).join(',')}`;
}
// A swipe shorter than this is a tap or a scroll.
const SWIPE_PX = 50;

export default function DocViewer({
  doc, docs, start = 0, title, tone = 'crm', onClose,
}) {
  const list = useMemo(() => (docs?.length ? docs : [doc].filter(Boolean)), [docs, doc]);
  const [at, setAt] = useState(() => Math.min(Math.max(0, start), Math.max(0, list.length - 1)));
  const current = list[Math.min(at, list.length - 1)];
  const many = list.length > 1;
  // 'v2' is the command center's own frame (his call 2026-10-13); 'diane' her V1 dark.
  const v2 = tone === 'v2';
  const dark = tone === 'diane' || v2;
  const cut = v2 ? 'v2-cut v2-glow' : '';

  // ONE LOAD PER DOCUMENT, kept while the viewer is open: back and forth costs nothing.
  const [loaded, setLoaded] = useState({});
  const asked = useRef(new Set());
  const blobs = useRef(new Set());
  const load = useCallback((d) => {
    if (!d) return;
    const key = d.downloadUrl;
    if (asked.current.has(key)) return;
    asked.current.add(key);
    const done = (value) => setLoaded((s) => ({ ...s, [key]: value }));
    const kind = kindOf(d);
    if (kind === 'text') {
      api.get(d.textUrl).then((read) => {
        // Still being read: asked again when it is next shown.
        if (STILL_READING.has(read?.status)) asked.current.delete(key);
        done({ read });
      }).catch((e) => { asked.current.delete(key); done({ error: e.message }); });
      return;
    }
    // A PDF OR A PICTURE IS FETCHED WITH THE SESSION and shown from a local
    // copy (a blob URL): framed straight from the API it was refused, rightly,
    // by the API's own headers whenever the page is on another origin (dev).
    api.download(d.downloadUrl).then(({ blob }) => {
      const typed = blob.type && blob.type !== 'application/octet-stream'
        ? blob : new Blob([blob], { type: kind === 'pdf' ? 'application/pdf' : (d.mime || 'image/png') });
      const url = URL.createObjectURL(typed);
      blobs.current.add(url);
      done({ blobUrl: url });
    }).catch((e) => { asked.current.delete(key); done({ error: e.message }); });
  }, []);
  useEffect(() => () => { for (const u of blobs.current) URL.revokeObjectURL(u); }, []);

  // This one, and the ones either side of it, so the next is already there.
  useEffect(() => {
    load(list[at]);
    load(list[at + 1]);
    load(list[at - 1]);
  }, [at, list, load]);

  const go = useCallback((step) => setAt((i) => Math.min(Math.max(0, i + step), list.length - 1)), [list.length]);

  // ← AND →, unless a field has the keys (a rename box behind it, say).
  useEffect(() => {
    if (!many) return undefined;
    const onKey = (e) => {
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [many, go]);

  // The one on screen stays in view in the list as you move.
  const itemRefs = useRef([]);
  useEffect(() => {
    itemRefs.current[at]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [at]);

  const touch = useRef(null);
  const onTouchStart = (e) => { touch.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e) => {
    if (touch.current == null || !many) return;
    const dx = (e.changedTouches[0]?.clientX ?? touch.current) - touch.current;
    touch.current = null;
    if (Math.abs(dx) >= SWIPE_PX) go(dx < 0 ? 1 : -1);
  };

  // FULL SCREEN (his call 2026-10-13): the dialog takes the whole window. F toggles it.
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setFull((v) => !v); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const zipUrl = useMemo(() => zipOf(list), [list]);
  const [zipping, setZipping] = useState(false);
  async function downloadAll() {
    setZipping(true);
    try {
      const { blob, filename } = await api.download(zipUrl);
      await saveBlob(blob, filename || 'documents.zip');
    } finally {
      setZipping(false);
    }
  }

  // ANY ONE, from its own row (his call 2026-10-13), or the one on screen.
  const [saving, setSaving] = useState(null);
  async function download(d = current) {
    setSaving(d.downloadUrl);
    try {
      const { blob, filename } = await api.download(d.downloadUrl);
      await saveBlob(blob, filename || d.name);
    } finally {
      setSaving(null);
    }
  }

  if (!current) return null;
  const kind = kindOf(current);
  const state = loaded[current.downloadUrl] ?? {};
  const prev = list[at - 1];
  const next = list[at + 1];

  const frame = `${full ? 'h-[calc(100vh-13rem)]' : 'h-[58vh] md:h-[70vh]'} w-full ${v2 ? 'v2-cut' : 'rounded'} ${dark ? 'border border-diane-line/30 bg-black/40' : 'border border-border bg-surface-sunken'}`;
  const textTone = dark ? 'text-white/85' : 'text-text';
  const muted = dark ? 'text-diane-dim' : 'text-text-muted';
  // In Diane's tone, her own outlined button (as FileChip): a white CRM button glared on her panel.
  const dianeButton = `border-diane-line bg-transparent !text-diane-signal hover:border-diane-signal hover:bg-transparent ${cut}`;
  const itemClass = (active) => (dark
    ? (active ? 'border-diane-signal !bg-diane-signal/10 !text-diane-signal' : 'border-diane-line/30 !bg-transparent !text-white/75 hover:border-diane-line')
    : (active ? 'border-accent !bg-accent-tint !text-accent-strong' : 'border-border bg-surface text-text hover:bg-surface-sunken'));
  const badgeClass = dark ? 'bg-diane-line/20 text-diane-dim' : 'bg-surface-sunken text-text-muted';

  return (
    <Modal title={title ?? current.name} onClose={onClose} size={full ? 'full' : 'table'} tone={tone}>
      <div className="flex flex-col gap-3 md:flex-row">
        {many && (
          <nav aria-label="Documents" className={`-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 md:mx-0 ${full ? 'md:max-h-[calc(100vh-13rem)]' : 'md:max-h-[70vh]'} md:w-60 md:shrink-0 md:flex-col md:overflow-y-auto md:overflow-x-visible md:px-0`}>
            {list.map((d, i) => (
              // THE ROW AND ITS OWN DOWNLOAD, side by side: a button cannot hold a button.
              <div
                key={d.downloadUrl}
                ref={(el) => { itemRefs.current[i] = el; }}
                className={`flex max-w-[16rem] shrink-0 snap-start items-center border md:max-w-none ${v2 ? 'v2-cut v2-glow text-[11.5px]' : 'rounded text-sm'} ${itemClass(i === at)}`}
                aria-current={i === at ? 'true' : undefined}
              >
                <button
                  type="button"
                  onClick={() => setAt(i)}
                  className="flex min-h-0 min-w-0 flex-1 items-center justify-start gap-2 border-0 !bg-transparent px-2 py-1.5 text-left text-inherit"
                  title={d.name}
                >
                  <span className={`w-10 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-semibold ${badgeClass}`}>{extOf(d.name)}</span>
                  <span className="min-w-0 truncate">{d.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => download(d)}
                  disabled={saving === d.downloadUrl}
                  aria-label={`Download ${d.name}`}
                  title={`Download ${d.name}`}
                  className={`mr-1 min-h-0 shrink-0 border-0 !bg-transparent p-1.5 opacity-70 hover:opacity-100 disabled:opacity-40 ${dark ? '!text-diane-signal' : '!text-text-muted hover:!text-accent-strong'}`}
                >
                  <DownloadIcon width={14} height={14} />
                </button>
              </div>
            ))}
          </nav>
        )}

        <div className="min-w-0 flex-1 space-y-3" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {many && (
                <Button variant="secondary" size="sm" className={dark ? dianeButton : ''} disabled={!prev}
                  onClick={() => go(-1)} aria-label="Previous document" title={prev ? `Previous: ${prev.name} (←)` : undefined}>
                  <ChevronIcon width={15} height={15} className="rotate-180" />
                </Button>
              )}
              <span className={`min-w-0 truncate text-xs ${muted}`}>
                {many && <span className="font-semibold tabular-nums">{at + 1} of {list.length}</span>}
                {many && ' · '}
                {title ? <span className={dark ? 'text-white/85' : 'text-text'}>{current.name}</span> : null}
                {title ? ' · ' : ''}
                {state.read?.how === 'none' ? 'Not readable as text' : state.read?.how ? `Read as ${state.read.how}` : kind === 'pdf' ? 'PDF' : kind === 'picture' ? 'Picture' : 'Text'}
              </span>
              {many && (
                <Button variant="secondary" size="sm" className={dark ? dianeButton : ''} disabled={!next}
                  onClick={() => go(1)} aria-label="Next document" title={next ? `Next: ${next.name} (→)` : undefined}>
                  <ChevronIcon width={15} height={15} />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* ONE FILE AND NO LIST: its download here, an icon as on the rows. */}
              {!many && (
                <Button variant="secondary" size="sm" className={dark ? dianeButton : ''} disabled={Boolean(saving)} onClick={() => download()}
                  aria-label={`Download ${current.name}`} title={`Download ${current.name}`}>
                  <DownloadIcon width={14} height={14} />
                </Button>
              )}
              {zipUrl && (
                <Button variant="secondary" size="sm" className={dark ? dianeButton : ''} disabled={zipping} onClick={downloadAll}
                  title={`All ${list.length} documents in one zip`}>
                  <DownloadIcon width={14} height={14} />
                  {zipping ? 'Zipping…' : `Download all (${list.length})`}
                </Button>
              )}
              <Button variant="secondary" size="sm" className={dark ? dianeButton : ''} onClick={() => setFull((v) => !v)}
                aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen (F)' : 'Full screen (F)'}>
                {full ? <ShrinkIcon width={14} height={14} /> : <ExpandIcon width={14} height={14} />}
              </Button>
            </div>
          </div>

          {kind !== 'text' && !state.blobUrl && !state.error && <Skeleton className={`${full ? 'h-[calc(100vh-13rem)]' : 'h-[58vh] md:h-[70vh]'} w-full`} />}
          {state.error && <p className={`text-sm ${muted}`}>{state.error}</p>}
          {/* keyed, so the frame is a new one per document and never shows the last */}
          {kind === 'pdf' && state.blobUrl && <iframe key={state.blobUrl} title={current.name} src={state.blobUrl} className={frame} />}
          {kind === 'picture' && state.blobUrl && (
            <div className={`${frame} flex items-center justify-center overflow-auto`}>
              <img src={state.blobUrl} alt={current.name} className="max-h-full max-w-full object-contain" />
            </div>
          )}
          {kind === 'text' && !state.error && (
            !state.read ? <Skeleton className="h-[50vh] w-full" />
              : state.read.tables?.length ? (
                <div className={`${frame} overflow-auto`}>
                  {state.read.tables.map((t, ti) => (
                    <table key={ti} className={`mb-4 w-full text-sm ${textTone}`}>
                      {t.sheet && <caption className={`py-1 text-left text-xs font-semibold ${muted}`}>{t.sheet}</caption>}
                      <thead>
                        <tr>{t.headers.map((h, i) => <th key={i} className={`sticky top-0 px-2 py-1.5 text-left text-xs font-semibold ${dark ? 'bg-diane-panel text-diane-signal' : 'bg-surface-sunken text-text-muted'}`}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {t.rows.map((r, ri) => (
                          <tr key={ri} className={dark ? 'border-t border-diane-line/15' : 'border-t border-border'}>
                            {r.map((c, ci) => <td key={ci} className="whitespace-nowrap px-2 py-1 tabular-nums">{c == null ? '' : String(c)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
                </div>
              ) : state.read.text ? (
                <pre className={`${frame} overflow-auto whitespace-pre-wrap break-words p-4 ${v2 ? 'font-mono text-[12px]' : 'font-sans text-sm'} leading-relaxed ${textTone}`}>{state.read.text}</pre>
              ) : (
                <div className={`${frame} flex flex-col items-center justify-center gap-2 p-6 text-center`}>
                  <p className={`text-sm ${textTone}`}>
                    {STILL_READING.has(state.read.status) ? 'Still being read. Come back to it in a moment.' : 'This file has no text that can be shown here.'}
                  </p>
                  {state.read.error && <p className={`text-xs ${muted}`}>{state.read.error}</p>}
                  <Button variant="primary" size="sm" className={dark ? `border-0 bg-diane-signal !text-diane-void hover:bg-diane-signal/90 ${cut}` : ''} disabled={Boolean(saving)} onClick={() => download()}>Download it</Button>
                </div>
              )
          )}

          {many && (
            <p className={`hidden text-xs md:block ${muted}`}>
              ← → to move between documents · F for full screen{next ? ` · next: ${next.name}` : ' · this is the last one'}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** The viewer's addresses for a document on a Liquidations row. */
export const liquidationDoc = (rowId, d) => ({
  name: d.file_name ?? d.name,
  mime: d.mime,
  viewUrl: `/api/v1/liquidations/${rowId}/docs/${d.id}?inline=1`,
  textUrl: `/api/v1/liquidations/${rowId}/docs/${d.id}/text`,
  downloadUrl: `/api/v1/liquidations/${rowId}/docs/${d.id}`,
});
