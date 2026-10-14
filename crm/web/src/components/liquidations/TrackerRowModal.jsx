import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { saveBlob } from '../../helpers/api.helper';
import { useReportingMutation } from '../../hooks/useReportingMutation';
import { useNotifications } from '../../hooks/useNotifications';
import Modal from '../modals/Modal';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import Toggle from '../forms/Toggle';
import ConfirmDialog from '../modals/ConfirmDialog';
import DocViewer, { liquidationDoc, prefetchDoc } from '../display/DocViewer';
import { DownloadIcon } from '../icons';
import VideoJobs from './VideoJobs';
import { useVideoUploads } from './useVideoUploads';
import { isVideoFile } from './videoProgress';
import { Skeleton } from '../display/Skeleton';
import { formatMoney } from '../../helpers/formatMoney';
import { LIQ_STAGES, stageOf, deadlineTone, shortDate, todayIso } from '../../configs/liquidationStages';

/**
 * ONE COMPANY ON THE LIQUIDATION TRACKER: every field, the contact log, the
 * documents, and every stage change with who made it.
 *
 * THE FIELDS SAVE TOGETHER, with one button, so half an edit is never left
 * behind. The log and the documents save as they are added: each is its
 * own act, dated, and never edited after.
 *
 * The stage is the step the liquidation is at; it never moves the company
 * status (his call 2026-10-13). That is set on the company page.
 */
const KEY = ['liquidations'];
const INPUT = 'min-h-9 rounded border border-border-strong bg-surface px-2.5 text-sm outline-none focus:outline focus:outline-2 focus:outline-accent-strong focus:outline-offset-1';
const BOX = `w-full ${INPUT}`;
const AREA = `${BOX} py-2 leading-relaxed`;

const FIELDS = ['stage', 'instructions', 'deadline', 'nextAction', 'owner', 'blamed', 'liquidator', 'note'];
const fromRow = (r) => ({
  stage: r.stage ?? '',
  instructions: r.instructions ?? '',
  deadline: r.deadline ?? '',
  nextAction: r.next_action ?? '',
  owner: r.owner ?? '',
  blamed: Boolean(r.blamed),
  liquidator: r.liquidator ?? '',
  note: r.note ?? '',
});

const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const size = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((bytes ?? 0) / 1024))} KB`);

function Field({ label, children, wide = false }) {
  return (
    <label className={`block space-y-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-semibold text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, count, children }) {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {title}{count != null && <span className="ml-1.5 tabular-nums text-text-faint">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

export default function TrackerRowModal({ id, owners, onClose }) {
  const detailKey = ['liquidations', id];
  const { data, isLoading } = useQuery({ queryKey: detailKey, queryFn: () => apiService.liquidations.get(id) });
  const row = data?.row;
  const [draft, setDraft] = useState(null);
  useEffect(() => { if (row && !draft) setDraft(fromRow(row)); }, [row, draft]);

  const saved = row ? fromRow(row) : null;
  const dirty = Boolean(draft && saved && FIELDS.some((f) => draft[f] !== saved[f]));
  const set = (field) => (value) => setDraft((d) => ({ ...d, [field]: value }));

  const save = useReportingMutation((fields) => apiService.liquidations.update(id, fields), {
    describe: () => row?.company_name ?? 'Liquidation', verb: 'saved', invalidates: [KEY, detailKey],
  });
  function submit(e) {
    e.preventDefault();
    if (!dirty) return;
    const changed = Object.fromEntries(FIELDS.filter((f) => draft[f] !== saved[f]).map((f) => [f, draft[f]]));
    // the server re-reads its own row after; the form follows it
    save.mutate(changed, { onSuccess: (res) => setDraft(fromRow(res.row)) });
  }

  return (
    <Modal title={row?.company_name ?? 'Liquidation'} onClose={onClose} wide>
      {isLoading || !draft || !row ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <div className="space-y-5">
          <Summary row={row} />

          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                <Select size="form" value={draft.stage} onChange={(v) => set('stage')(v || '')} placeholder="Not set"
                  options={[{ value: '', label: 'Not set' }, ...LIQ_STAGES.map((s) => ({ value: s.value, label: s.label }))]} />
              </Field>
              <Field label="Deadline">
                <input type="date" className={BOX} value={draft.deadline} onChange={(e) => set('deadline')(e.target.value)} />
              </Field>
              <Field label="Owner">
                <Select size="form" value={draft.owner} onChange={(v) => set('owner')(v || '')} placeholder="No owner"
                  options={[{ value: '', label: 'No owner' }, ...owners.map((o) => ({ value: o, label: o }))]} />
              </Field>
              <Field label="Liquidator">
                <input className={BOX} value={draft.liquidator} onChange={(e) => set('liquidator')(e.target.value)} placeholder="Firm or person" />
              </Field>
              <Field label="Current instructions" wide>
                <textarea rows={2} className={AREA} value={draft.instructions} onChange={(e) => set('instructions')(e.target.value)} />
              </Field>
              <Field label="Next action" wide>
                <textarea rows={2} className={AREA} value={draft.nextAction} onChange={(e) => set('nextAction')(e.target.value)} />
              </Field>
              <Field label="Note" wide>
                <textarea rows={2} className={AREA} value={draft.note} onChange={(e) => set('note')(e.target.value)} />
              </Field>
              <div className="flex items-center gap-3">
                <Toggle checked={draft.blamed} onChange={set('blamed')} label="Blamed" />
                <span className="text-sm">Blamed?</span>
                <span className="text-sm text-text-muted">{draft.blamed ? 'Yes' : 'No'}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={!dirty || save.isPending} onClick={() => setDraft(saved)}>Undo changes</Button>
              <Button type="submit" variant="primary" size="sm" disabled={!dirty || save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>

          <Comms id={id} comms={data.comms} detailKey={detailKey} />
          <Docs id={id} docs={data.docs} detailKey={detailKey} company={row?.company_name} />
          <History history={data.history} />
        </div>
      )}
    </Modal>
  );
}

/** The company at a glance: who, where, pay status, settlement, deadline. */
function Summary({ row }) {
  const tone = deadlineTone(row.deadline, row.stage);
  const facts = [
    ['Director', row.director],
    ['Mid', row.mid],
    ['Group', (row.groups ?? []).join(', ')],
    ['Settlement', row.settlement != null ? `${formatMoney(row.settlement, row.currency)} · ${formatMoney(row.allocated ?? 0, row.currency)} allocated` : null],
    ['Deadline', row.deadline ? `${shortDate(row.deadline)}${tone === 'passed' ? ' · passed' : tone === 'soon' ? ' · due soon' : ''}` : null],
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={stageOf(row.stage).badge}>{stageOf(row.stage).label}</span>
        <Link to={`/companies/${encodeURIComponent(row.company_key)}`} className="text-sm font-semibold text-accent-strong hover:underline">
          Open company page →
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded border border-border bg-surface-sunken/60 p-3 text-sm sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-text-muted">{label}</dt>
            <dd className={`truncate ${value ? '' : 'text-text-faint'} ${label === 'Deadline' && tone === 'passed' ? 'font-semibold text-danger' : ''} ${label === 'Deadline' && tone === 'soon' ? 'font-semibold text-warning' : ''}`} title={value || undefined}>
              {value || '—'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The contact log: newest first, each dated. Added, never edited. */
function Comms({ id, comms, detailKey }) {
  const [body, setBody] = useState('');
  const [saidOn, setSaidOn] = useState(todayIso());
  const add = useReportingMutation((b) => apiService.liquidations.addComm(id, b), {
    describe: () => 'Contact', verb: 'logged', invalidates: [KEY, detailKey],
  });
  return (
    <Section title="Communication log" count={comms.length}>
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate({ body, saidOn }, { onSuccess: () => setBody('') }); }}
      >
        <input type="date" className={`${INPUT} w-40 shrink-0`} value={saidOn} onChange={(e) => setSaidOn(e.target.value)} aria-label="Date of contact" />
        <textarea rows={1} className={`${AREA} min-w-[12rem] flex-1`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Who said what, e.g. Liquidator emailed asking for bank statements" aria-label="What was said" />
        <Button type="submit" variant="primary" size="sm" disabled={!body.trim() || add.isPending}>{add.isPending ? 'Adding…' : 'Add'}</Button>
      </form>
      {comms.length === 0 ? (
        <p className="text-sm text-text-muted">No contact logged yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {comms.map((c) => (
            <li key={c.id} className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="w-24 shrink-0 tabular-nums text-text-muted">{shortDate(c.said_on)}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{c.body}</span>
              {c.by_user && <span className="text-xs text-text-faint">{c.by_user}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** What a document's reading says, short. */
const READ_LABEL = { waiting: 'Waiting to be read', reading: 'Reading…', read: 'Readable', unreadable: 'Kept, not readable' };
const READ_CLASS = { waiting: 'text-text-faint', reading: 'text-warning', read: 'text-success-strong', unreadable: 'text-text-muted' };
const extOf = (name) => (String(name).split('.').pop() || '').slice(0, 5).toUpperCase();

/**
 * SUPPORTING DOCUMENTS (his call 2026-10-13): any kind, several at once by
 * picking or dropping them. Each is read on arrival so Diane can answer from
 * it; its line says whether it was. Click a name to open it here; tick
 * several to download or remove them together (removed = moved aside).
 */
function Docs({ id, docs, detailKey, company }) {
  const input = useRef(null);
  const { notify } = useNotifications();
  const queryClient = useQueryClient();
  const [ticked, setTicked] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');
  const [over, setOver] = useState(false);
  const [viewing, setViewing] = useState(null);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: detailKey }); queryClient.invalidateQueries({ queryKey: KEY }); };

  // Still being read: look again until every one is done.
  const pending = docs.some((d) => d.read_status === 'waiting' || d.read_status === 'reading');
  useEffect(() => {
    if (!pending) return undefined;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const upload = useReportingMutation((files) => apiService.liquidations.addDocs(id, files), {
    describe: (files) => (files.length === 1 ? files[0].name : `${files.length} documents`), verb: 'uploaded', invalidates: [KEY, detailKey],
  });
  const remove = useReportingMutation((ids) => apiService.liquidations.removeDocs(id, ids), {
    describe: (ids) => (ids.length === 1 ? 'Document' : `${ids.length} documents`), verb: 'removed', invalidates: [KEY, detailKey],
  });
  const rename = useReportingMutation(({ docId, fileName }) => apiService.liquidations.renameDoc(id, docId, fileName), {
    describe: () => 'Document', verb: 'renamed', invalidates: [KEY, detailKey],
  });
  // VIDEOS GO ONE BY ONE, each with its own card; the rest together as before.
  const videos = useVideoUploads(id, detailKey, docs, setViewing);
  const send = (list) => {
    const files = [...list];
    const rest = files.filter((f) => !isVideoFile(f));
    if (rest.length) upload.mutate(rest);
    files.filter(isVideoFile).forEach(videos.start);
  };
  // A FAILED READING TRIED AGAIN (a network blip, the AI key down): read anew.
  const reread = useReportingMutation((docId) => apiService.liquidations.rereadDoc(id, docId), {
    describe: () => 'Document', verb: 'sent to be read again', invalidates: [KEY, detailKey],
  });

  // ONE FILE AS ITSELF, SEVERAL AS ONE ZIP: a browser keeps only the first
  // of several downloads from one click (his call 2026-10-13).
  const [zipping, setZipping] = useState(false);
  async function downloadMany(list) {
    setZipping(true);
    try {
      const { blob, filename } = list.length === 1
        ? await apiService.liquidations.downloadDoc(id, list[0].id)
        : await apiService.liquidations.downloadZip(id, list.length === docs.length ? [] : list.map((d) => d.id));
      await saveBlob(blob, filename || (list.length === 1 ? list[0].file_name : 'documents.zip'));
    } catch (err) {
      notify({ level: 'error', message: `Couldn't download ${list.length === 1 ? list[0].file_name : 'the documents'}`, detail: err.message });
    } finally {
      setZipping(false);
    }
  }
  const toggle = (docId) => setTicked((t) => { const n = new Set(t); if (n.has(docId)) n.delete(docId); else n.add(docId); return n; });
  const chosen = docs.filter((d) => ticked.has(d.id));

  return (
    <Section title="Supporting docs" count={docs.length}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed px-3 py-4 text-center transition-colors ${over ? 'border-accent-strong bg-accent-tint' : 'border-border-strong hover:border-accent-strong hover:bg-surface-sunken'}`}
      >
        <span className="text-sm font-semibold text-text">{upload.isPending ? 'Uploading…' : 'Drop files or videos here, or click to pick'}</span>
        <span className="text-xs text-text-faint">Any document: PDF, Word, Excel, CSV, pictures, text, email. Up to 20 at once, 25 MB each.</span>
        <span className="text-xs text-text-faint">A video (up to 500 MB) becomes a written transcript. The video itself is not kept.</span>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => { send(e.target.files); e.target.value = ''; }} />
      </div>

      <VideoJobs
        cards={videos.cards}
        onCancel={videos.cancel}
        onDismiss={videos.dismiss}
        onRetry={(card) => { videos.dismiss(card); input.current?.click(); }}
        onOpen={videos.open}
      />

      {docs.length > 0 && (
        <>
          {chosen.length === 0 && docs.length > 1 && (
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" disabled={zipping} onClick={() => downloadMany(docs)}>
                <DownloadIcon width={14} height={14} />
                {zipping ? 'Zipping…' : `Download all (${docs.length})`}
              </Button>
            </div>
          )}
          {chosen.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded bg-surface-sunken px-3 py-2 text-sm">
              <span className="font-semibold">{chosen.length} selected</span>
              <Button variant="secondary" size="sm" disabled={zipping} onClick={() => downloadMany(chosen)}>{zipping ? 'Zipping…' : chosen.length > 1 ? 'Download as zip' : 'Download'}</Button>
              <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>Remove</Button>
              <Button variant="secondary" size="sm" onClick={() => setTicked(new Set())}>Clear</Button>
            </div>
          )}
          <ul className="divide-y divide-border rounded border border-border">
            {docs.map((d) => (
              <li key={d.id} className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors duration-700 ${ticked.has(d.id) ? 'bg-accent-tint/40' : videos.fresh === d.id ? 'bg-success-tint' : ''}`}>
                <input type="checkbox" checked={ticked.has(d.id)} onChange={() => toggle(d.id)} aria-label={`Select ${d.file_name}`} />
                <span className="w-11 shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-center text-[10px] font-semibold text-text-muted">{extOf(d.file_name)}</span>
                {renaming === d.id ? (
                  <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) rename.mutate({ docId: d.id, fileName: name.trim() }, { onSettled: () => setRenaming(null) }); }}>
                    <input autoFocus className={`${BOX} min-w-[10rem] flex-1`} value={name} onChange={(e) => setName(e.target.value)} aria-label="New name" />
                    <Button type="submit" variant="primary" size="sm" disabled={!name.trim()}>Save</Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setRenaming(null)}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    {/* THE NAME ON ITS OWN LINE, what it is under it: on a phone
                        the name kept a few letters beside the status and size. */}
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => setViewing(d)} onMouseEnter={() => prefetchDoc(liquidationDoc(id, d))} onFocus={() => prefetchDoc(liquidationDoc(id, d))} className="block min-h-0 w-full justify-start truncate border-0 bg-transparent p-0 text-left font-medium text-text hover:text-accent-strong hover:underline" title={`Open ${d.file_name}`}>
                        {d.file_name}
                      </button>
                      <p className="mt-0.5 truncate text-xs text-text-muted">
                        <span className={READ_CLASS[d.read_status] ?? 'text-text-faint'} title={d.read_error || d.read_how || ''}>{READ_LABEL[d.read_status] ?? ''}</span>
                        <span className="tabular-nums"> · {size(d.size_bytes)} · {shortDate(d.uploaded_at)}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {d.read_status === 'unreadable' && (
                        <Button variant="secondary" size="sm" disabled={reread.isPending} onClick={() => reread.mutate(d.id)}>Read again</Button>
                      )}
                      <Button variant="secondary" size="sm" onClick={() => { setRenaming(d.id); setName(d.file_name); }}>Rename</Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title={chosen.length === 1 ? `Remove ${chosen[0].file_name}?` : `Remove ${chosen.length} documents?`}
          subject={chosen.map((d) => d.file_name).join(', ')}
          detail="They come off this company. The files are moved aside on this computer, not deleted."
          confirmLabel="Remove"
          onCancel={() => setConfirming(false)}
          onConfirm={() => { remove.mutate(chosen.map((d) => d.id)); setTicked(new Set()); setConfirming(false); }}
        />
      )}
      {/* THE WHOLE SET opens, at the one clicked: arrows between them. */}
      {viewing && (
        <DocViewer
          docs={docs.map((d) => liquidationDoc(id, d))}
          start={Math.max(0, docs.findIndex((d) => d.id === viewing.id))}
          title={company ? `${company} · documents` : undefined}
          onClose={() => setViewing(null)}
        />
      )}
    </Section>
  );
}

/** Every stage change: from, to, when, who. */
function History({ history }) {
  return (
    <Section title="Status history" count={history.length}>
      {history.length === 0 && <p className="text-sm text-text-muted">No changes yet.</p>}
      <ul className="space-y-1.5 text-sm">
        {history.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-2">
            {/* From "Not set" too: a company starts with no stage. */}
            <span className={stageOf(h.from_stage).badge}>{stageOf(h.from_stage).label}</span>
            <span className="text-text-faint">→</span>
            <span className={stageOf(h.to_stage).badge}>{stageOf(h.to_stage).label}</span>
            <span className="text-xs tabular-nums text-text-muted">{when(h.changed_at)}{h.by_user ? ` · ${h.by_user}` : ''}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
