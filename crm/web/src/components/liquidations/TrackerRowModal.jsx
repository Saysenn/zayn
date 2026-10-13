import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { saveBlob } from '../../helpers/api.helper';
import { useReportingMutation } from '../../hooks/useReportingMutation';
import { useNotifications } from '../../hooks/useNotifications';
import Modal from '../modals/Modal';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import Toggle from '../forms/Toggle';
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
          <Docs id={id} docs={data.docs} detailKey={detailKey} />
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

/** Supporting documents: kept on this machine. Removing one moves it aside. */
function Docs({ id, docs, detailKey }) {
  const input = useRef(null);
  const { notify } = useNotifications();
  const [removing, setRemoving] = useState(null);
  const upload = useReportingMutation((file) => apiService.liquidations.addDoc(id, file), {
    describe: (file) => file.name, verb: 'uploaded', invalidates: [KEY, detailKey],
  });
  const remove = useReportingMutation((docId) => apiService.liquidations.removeDoc(id, docId), {
    describe: () => 'Document', verb: 'removed', invalidates: [KEY, detailKey],
  });
  async function download(doc) {
    try {
      const { blob, filename } = await apiService.liquidations.downloadDoc(id, doc.id);
      await saveBlob(blob, filename || doc.file_name);
    } catch (err) {
      notify({ level: 'error', message: `Couldn't download ${doc.file_name}`, detail: err.message });
    }
  }
  return (
    <Section title="Supporting docs" count={docs.length}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt,.eml,.msg"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }}
        />
        <Button type="button" variant="secondary" size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
          {upload.isPending ? 'Uploading…' : 'Upload a document'}
        </Button>
        <span className="text-xs text-text-faint">PDF, pictures, Word, Excel, CSV, text or email, up to 20 MB.</span>
      </div>
      {docs.length > 0 && (
        <ul className="divide-y divide-border rounded border border-border">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium" title={d.file_name}>{d.file_name}</span>
              <span className="text-xs tabular-nums text-text-muted">{size(d.size_bytes)} · {shortDate(d.uploaded_at)}</span>
              {removing === d.id ? (
                <span className="flex items-center gap-2">
                  <Button variant="danger" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(d.id, { onSettled: () => setRemoving(null) })}>
                    {remove.isPending ? 'Removing…' : 'Remove'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setRemoving(null)}>Keep</Button>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => download(d)}>Download</Button>
                  <Button variant="secondary" size="sm" onClick={() => setRemoving(d.id)}>Remove</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
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
