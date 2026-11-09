import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { useReportingMutation } from '../../hooks/useReportingMutation';
import Button, { FileButton } from '../buttons/Button';
import UnderlineTabs from '../layout/UnderlineTabs';
import ConfirmDialog from '../modals/ConfirmDialog';
import { stageLabel, stageOf } from '../../configs/liquidationStages';

/**
 * THE BOSS'S CLOSURE SHEET IMPORT (his call 2026-11-04).
 *
 * HIDDEN BY DEFAULT: one button opens it. Upload → a preview where nothing
 * is written → ticks → one import, which can be undone as a whole. Every
 * change it makes is on each company's History, marked "via import" with
 * the file's name.
 *
 * Companies not in the CRM are ALL saved (his call), tagged "No deals".
 * A CRM value wins on a conflict unless its tick is on. A dissolve that
 * would stop live deals is never ticked for him.
 */
const HISTORY = ['closure-imports'];
const TOUCHED = [['liquidations'], ['companies'], HISTORY];
const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const FIELD = {
  stage: 'Stage', stageKind: 'Stage kind', stageDate: 'Stage date', instructions: 'Current instructions', deadline: 'Deadline',
  nextAction: 'Next action', owner: 'Owner', liquidator: 'Liquidators', note: 'Note', officialReceiver: 'Official receiver',
  lastAction: 'Last action', unresolved: 'Unresolved matters', play: 'Current play', prompts: 'Prompts',
};
const STATUS = { active: 'Active', liquidation: 'Winding down', closed: 'Dissolved', review: 'Review', going_concern: 'Going concern' };
const TABS = [
  { key: 'winding', label: 'Already winding down' },
  { key: 'other', label: 'In the CRM, not winding down' },
  { key: 'new', label: 'Not in the CRM (No deals)' },
  { key: 'problems', label: 'Problems' },
];
const clip = (s, n = 90) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

export default function ClosureImport() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Open the closure import</Button>
    );
  }
  return <Importer onClose={() => setOpen(false)} />;
}

function Importer({ onClose }) {
  const [plan, setPlan] = useState(null);
  const [choices, setChoices] = useState({});
  const [tab, setTab] = useState('winding');
  const [percent, setPercent] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [undoing, setUndoing] = useState(null);
  const [result, setResult] = useState(null);
  const history = useQuery({ queryKey: HISTORY, queryFn: () => apiService.liquidations.importHistory() });

  // No toast on a preview: the preview itself is the answer.
  const preview = useReportingMutation((file) => apiService.liquidations.importPreview(file, setPercent), {});
  const commit = useReportingMutation(() => apiService.liquidations.importCommit(plan.previewId, choices), {
    describe: () => 'Closure sheet', verb: 'imported', invalidates: TOUCHED,
  });
  const undo = useReportingMutation((id) => apiService.liquidations.importUndo(id), {
    describe: () => 'Import', verb: 'undone', invalidates: TOUCHED,
  });

  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setResult(null);
    setPercent(0);
    preview.mutate(file, {
      onSuccess: (p) => {
        setPlan(p);
        // The server's default ticks: every company, every dissolve that stops nothing.
        setChoices(Object.fromEntries(p.entries.map((x) => [x.key, { include: x.include, dissolve: x.dissolve, overwrite: [] }])));
        setTab(p.counts.winding ? 'winding' : p.counts.other || p.counts.closed ? 'other' : 'new');
      },
    });
  };
  const setChoice = (key, patch) => setChoices((c) => ({ ...c, [key]: { ...c[key], ...patch } }));

  const groups = useMemo(() => {
    const by = { winding: [], other: [], new: [] };
    for (const x of plan?.entries ?? []) (by[x.category === 'closed' ? 'other' : x.category] ?? by.new).push(x);
    return by;
  }, [plan]);
  const ticked = plan ? plan.entries.filter((x) => choices[x.key]?.include) : [];
  const created = ticked.filter((x) => x.category === 'new').length;
  const dissolving = ticked.filter((x) => x.dissolves && choices[x.key]?.dissolve).length;
  const imports = history.data?.imports ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <FileButton variant="primary" phase={preview.isPending ? 'uploading' : 'idle'} percent={percent} onChange={pick}>
          {preview.isPending ? 'Reading…' : plan ? 'Upload another file' : 'Upload the closure sheet'}
        </FileButton>
        <Button variant="secondary" size="sm" onClick={onClose}>Hide</Button>
        {preview.error && <p className="text-sm text-danger">{preview.error.message}</p>}
      </div>

      {result && (
        <p className="text-sm font-semibold text-success-strong">
          Imported {result.done?.companies ?? 0} companies from {result.fileName ?? 'the file'}. It can be undone below.
        </p>
      )}

      {plan && !result && (
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            <span className="font-semibold text-text">{plan.fileName}</span>: {plan.entries.length} companies.
            Nothing is written until you import. {plan.skipped?.length ? `Left out: ${plan.skipped.map((s) => (s.row ? `${s.name} (${s.tab})` : s.tab)).join(', ')}.` : ''}
          </p>
          <UnderlineTabs
            tabs={TABS.map((t) => ({ ...t, count: t.key === 'problems' ? plan.problems.length : groups[t.key].length }))}
            active={tab}
            onChange={setTab}
          />
          {tab === 'problems' ? (
            plan.problems.length === 0 ? <p className="text-sm text-text-muted">None.</p> : (
              <ul className="divide-y divide-border rounded border border-border text-sm">
                {plan.problems.map((p, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={i} className="px-3 py-2"><span className="badge badge-in_progress mr-2">{p.kind}</span>{p.text}</li>
                ))}
              </ul>
            )
          ) : (
            <Entries list={groups[tab]} choices={choices} setChoice={setChoice} />
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <span className="text-sm text-text-muted">
              {ticked.length} ticked{created ? ` · ${created} new, tagged No deals` : ''}{dissolving ? ` · ${dissolving} closed as dissolved` : ''}
            </span>
            <span className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPlan(null)}>Cancel</Button>
              <Button variant="primary" size="sm" disabled={!ticked.length || commit.isPending} onClick={() => setConfirming(true)}>
                Import {ticked.length} {ticked.length === 1 ? 'company' : 'companies'}
              </Button>
            </span>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Past imports</h3>
        {imports.length === 0 ? <p className="text-sm text-text-muted">None yet.</p> : (
          <ul className="divide-y divide-border rounded border border-border text-sm">
            {imports.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{m.file_name}</span>
                  <span className="text-text-muted"> · {m.summary?.companies ?? 0} companies · {m.by_user ?? 'someone'} · {when(m.created_at)}</span>
                  {m.undone_at && <span className="text-text-muted"> · undone by {m.undone_by ?? 'someone'} {when(m.undone_at)}</span>}
                </span>
                {m.undone_at ? <span className="badge badge-closed">Undone</span> : (
                  <Button variant="danger" size="sm" onClick={() => setUndoing(m)}>Undo</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={`Import ${ticked.length} ${ticked.length === 1 ? 'company' : 'companies'}?`}
          subject={plan.fileName}
          detail={[
            created ? `${created} new companies are saved, tagged No deals.` : null,
            dissolving ? `${dissolving} are closed as dissolved and go to the Archive.` : null,
            'Every change goes on each company\'s History. The whole import can be undone from here.',
          ].filter(Boolean)}
          confirmLabel="Import"
          confirmVariant="primary"
          busy={commit.isPending}
          busyLabel="Importing…"
          onCancel={() => setConfirming(false)}
          onConfirm={() => commit.mutate(undefined, { onSuccess: (r) => { setResult({ ...r, fileName: plan.fileName }); setConfirming(false); setPlan(null); }, onError: () => setConfirming(false) })}
        />
      )}
      {undoing && (
        <ConfirmDialog
          title="Undo this import?"
          subject={`${undoing.file_name} · ${when(undoing.created_at)}`}
          detail="Statuses and fields go back to what they were, its parties and log lines come off, and the companies it created are removed when they still have no deals. The History keeps all of it."
          confirmLabel="Undo"
          busy={undo.isPending}
          onCancel={() => setUndoing(null)}
          onConfirm={() => undo.mutate(undoing.id, { onSettled: () => setUndoing(null) })}
        />
      )}
    </div>
  );
}

/** One tab's companies: a tick each, what it will do, and a tick per conflict. */
function Entries({ list, choices, setChoice }) {
  if (!list.length) return <p className="text-sm text-text-muted">None.</p>;
  const allOn = list.every((x) => choices[x.key]?.include);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-text-muted">
        <input type="checkbox" className="accent-accent-strong" checked={allOn}
          onChange={(e) => list.forEach((x) => setChoice(x.key, { include: e.target.checked }))} />
        All in this tab
      </label>
      <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto rounded border border-border text-sm">
        {list.map((x) => {
          const c = choices[x.key] ?? {};
          return (
            <li key={x.key} className={`space-y-1.5 px-3 py-2 ${c.include ? '' : 'opacity-60'}`}>
              <label className="flex flex-wrap items-center gap-2">
                <input type="checkbox" className="accent-accent-strong" checked={Boolean(c.include)} onChange={(e) => setChoice(x.key, { include: e.target.checked })} />
                <span className="font-semibold">{x.name}</span>
                {x.fileName !== x.name && <span className="text-text-muted">(“{x.fileName}” in the file)</span>}
                <span className="text-xs text-text-faint">{x.tab} row {x.row}</span>
                {x.stage ? <span className={stageOf(x.stage).badge}>{stageLabel(x.stage, x.stageKind)}</span> : <span className="text-xs text-text-faint">no stage</span>}
                {x.noDeals && <span className="badge badge-no_deals">No deals</span>}
                {x.crmStatus && <span className="text-xs text-text-muted">now {STATUS[x.crmStatus] ?? x.crmStatus}{x.liveDeals ? ` · ${x.liveDeals} live deals` : ''}</span>}
              </label>
              <p className="pl-6 text-xs text-text-muted">
                {[
                  x.fills.length ? `fills ${x.fills.map((f) => FIELD[f.field] ?? f.field).join(', ')}` : null,
                  x.parties.length ? `${x.parties.length} ${x.parties.length === 1 ? 'party' : 'parties'}` : null,
                  x.comms.length ? `${x.comms.length} log ${x.comms.length === 1 ? 'line' : 'lines'}` : null,
                ].filter(Boolean).join(' · ') || 'Nothing new to fill'}
              </p>
              {x.dissolves && x.category !== 'closed' && (
                <label className="flex items-center gap-2 pl-6 text-xs">
                  <input type="checkbox" className="accent-accent-strong" checked={Boolean(c.dissolve)} disabled={!c.include}
                    onChange={(e) => setChoice(x.key, { dissolve: e.target.checked })} />
                  <span className={x.stopsDeals ? 'font-semibold text-danger' : 'text-text-muted'}>
                    Close it as dissolved{x.stopsDeals ? `: this stops its ${x.liveDeals} live deals` : ''}
                  </span>
                </label>
              )}
              {x.conflicts.length > 0 && (
                <div className="space-y-1 pl-6">
                  <p className="text-xs font-semibold text-warning">The CRM already has these. Kept unless ticked:</p>
                  {x.conflicts.map((f) => (
                    <label key={f.field} className="flex items-start gap-2 text-xs">
                      <input type="checkbox" className="mt-0.5 accent-accent-strong" disabled={!c.include}
                        checked={(c.overwrite ?? []).includes(f.field)}
                        onChange={(e) => setChoice(x.key, {
                          overwrite: e.target.checked ? [...(c.overwrite ?? []), f.field] : (c.overwrite ?? []).filter((k) => k !== f.field),
                        })} />
                      <span><span className="font-semibold">{FIELD[f.field] ?? f.field}</span>: <span className="text-text-muted">{clip(f.from)}</span> → {clip(f.to)}</span>
                    </label>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
