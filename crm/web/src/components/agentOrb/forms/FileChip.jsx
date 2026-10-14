import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PaperclipIcon } from '../../icons';
import DocViewer, { liquidationDoc } from '../../display/DocViewer';
import { apiService } from '../../../configs/api.config';

/**
 * DOCUMENTS SHE HANDED BACK (2026-10-13), opened in the viewer (a PDF or
 * picture shown, a sheet as a table, text as text), Download inside. Her
 * tone, so it sits in V1 and V2 alike.
 *
 * A COMPANY'S DOCUMENT opens with the company's whole set beside it, at this
 * one, so the others are an arrow away (his call 2026-10-13). Fetched on
 * opening; until it comes, or if it fails, the files she gave.
 */
const asDoc = (file) => ({
  name: file.name,
  mime: file.mime,
  viewUrl: file.viewUrl ?? `${file.url}?inline=1`,
  textUrl: file.textUrl ?? `${file.url}/text`,
  downloadUrl: file.downloadUrl ?? file.url,
});

// A file from before 2026-10-13 has no ids: its own address says them.
function idsOf(file) {
  const fromUrl = String(file?.url ?? '').match(/\/liquidations\/(\d+)\/docs\/(\d+)/);
  return {
    rowId: file?.liquidationId ?? (fromUrl ? Number(fromUrl[1]) : null),
    docId: file?.docId ?? (fromUrl ? Number(fromUrl[2]) : null),
  };
}

/** The viewer over `files`, at `first`: the company's whole set when they are one company's. */
function SetViewer({ files, first, onClose }) {
  const { rowId, docId } = idsOf(first);
  const sameCompany = files.every((f) => idsOf(f).rowId === rowId);
  const { data } = useQuery({
    queryKey: ['liquidations', rowId],
    queryFn: () => apiService.liquidations.get(rowId),
    enabled: Boolean(rowId) && sameCompany,
  });
  const set = sameCompany && data?.docs?.length ? data.docs.map((d) => liquidationDoc(rowId, d)) : null;
  const docs = set ?? files.map(asDoc);
  const start = set
    ? Math.max(0, data.docs.findIndex((d) => d.id === docId))
    : Math.max(0, files.indexOf(first));
  return (
    // keyed by the set's arrival, so it opens at this document either way
    <DocViewer
      key={set ? 'set' : 'given'}
      docs={docs}
      start={start}
      title={set && data?.row?.company_name ? `${data.row.company_name} · documents` : undefined}
      // The command center's own frame when it is the one open (his call 2026-10-13).
      tone={typeof document !== 'undefined' && document.querySelector('.cc2:not(.hidden)') ? 'v2' : 'diane'}
      onClose={onClose}
    />
  );
}

/** One document, as a chip of its own (a reply with no card to sit in). */
export default function FileChip({ file }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="dm-file inline-flex min-h-0 max-w-full items-center gap-2 rounded-md border border-diane-line bg-transparent px-3 py-2 text-left text-sm text-diane-signal hover:border-diane-signal"
        title={`Open ${file.name}`}
      >
        <PaperclipIcon width={16} height={16} />
        <span className="truncate">{file.name}</span>
        <span className="shrink-0 text-xs opacity-70">Open</span>
      </button>
      {open && <SetViewer files={[file]} first={file} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * THE DOCUMENTS ON HER ANSWER CARD (his call 2026-10-13): five chips above
 * the card were "outside the card response". One small button inside it,
 * the way her sources sit, opening the viewer with every one.
 */
export function CardDocs({ files }) {
  const [open, setOpen] = useState(false);
  const one = files.length === 1;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="dm-chip inline-flex min-h-0 max-w-full items-center gap-1.5 rounded-full border border-diane-line/40 bg-transparent px-2 py-0.5 text-[10px] text-diane-dim hover:border-diane-signal/60 hover:text-diane-signal"
        title={files.map((f) => f.name).join(', ')}
      >
        <PaperclipIcon width={11} height={11} />
        <span className="truncate">{one ? `Open ${files[0].name}` : `View documents · ${files.length}`}</span>
      </button>
      {open && <SetViewer files={files} first={files[0]} onClose={() => setOpen(false)} />}
    </div>
  );
}
