import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { useReportingMutation } from '../../hooks/useReportingMutation';
import Button from '../buttons/Button';
import { Skeleton } from '../display/Skeleton';

/**
 * WHAT DIANE KNOWS IN HMRC & CIS MODE, AND OUR OWN NOTES.
 *
 * His call 2026-10-10: answers like a true HMRC / CIS adviser, grounded in
 * GOV.UK and HMRC's own manuals, and customisable: our notes ("how we do
 * it") are read FIRST. A refresh fetches GOV.UK again in the background;
 * pages that did not change are not indexed again.
 */
const STATUS = ['hmrc-status'];
const NOTES = ['hmrc-notes'];
const BOX = 'w-full rounded border border-border-strong bg-surface px-2.5 py-2 text-sm outline-none focus:outline focus:outline-2 focus:outline-accent-strong focus:outline-offset-1';
const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never');

export default function HmrcKnowledge() {
  const status = useQuery({
    queryKey: STATUS,
    queryFn: () => apiService.hmrc.status(),
    // while a refresh runs, its progress is followed
    refetchInterval: (q) => (q.state.data?.refresh?.running ? 3000 : false),
  });
  const notes = useQuery({ queryKey: NOTES, queryFn: () => apiService.hmrc.notes() });
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);

  const add = useReportingMutation((body) => apiService.hmrc.addNote(body), { describe: (v) => `"${v.title}"`, verb: 'saved', invalidates: [NOTES, STATUS] });
  const save = useReportingMutation(({ id, ...fields }) => apiService.hmrc.updateNote(id, fields), { describe: () => 'Note', verb: 'saved', invalidates: [NOTES, STATUS] });
  const remove = useReportingMutation((id) => apiService.hmrc.removeNote(id), { describe: () => 'Note', verb: 'removed', invalidates: [NOTES, STATUS] });
  const refresh = useReportingMutation(() => apiService.hmrc.refresh(), { describe: () => 'Refresh from GOV.UK', verb: 'started', invalidates: [STATUS] });

  if (status.isLoading || notes.isLoading) return <Skeleton className="h-32 w-full" />;
  const s = status.data ?? {};
  const run = s.refresh ?? {};
  const list = notes.data?.notes ?? [];
  const ready = draft.title.trim() && draft.body.trim();
  const progress = run.progress
    ? run.progress.stage === 'indexing' ? `indexing ${run.progress.done} of ${run.progress.of}`
      : run.progress.stage === 'guides' ? `reading guides ${run.progress.done} of ${run.progress.of}`
        : `reading ${String(run.progress.manual ?? '').split('/').pop()}`
    : 'starting';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span><span className="font-semibold tabular-nums">{s.govuk?.sources ?? 0}</span> <span className="text-text-muted">GOV.UK pages and HMRC manual sections</span></span>
        <span><span className="font-semibold tabular-nums">{s.notes?.sources ?? 0}</span> <span className="text-text-muted">of our notes</span></span>
        <span className="text-text-muted">Last fetched {when(s.govuk?.last)}</span>
        <Button size="sm" variant="secondary" className="ml-auto" disabled={run.running || refresh.isPending} onClick={() => refresh.mutate()}>
          {run.running ? `Refreshing… ${progress}` : 'Refresh from GOV.UK'}
        </Button>
      </div>
      {run.error && <p className="text-sm text-danger">The last refresh stopped: {run.error}</p>}
      <p className="text-xs text-text-muted">
        Kept current on its own: the pages an answer uses are checked on GOV.UK first, and everything is re-read once a day.
      </p>

      {(s.changes ?? []).length > 0 && (
        <div>
          <p className="field-label mb-2">Recent changes on GOV.UK</p>
          <ul className="divide-y divide-border rounded border border-border">
            {s.changes.map((c) => (
              <li key={c.id} className="px-3 py-2 text-sm">
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-strong hover:underline">{c.title}</a>
                <span className="ml-2 text-xs text-text-faint">{when(c.created_at)}{c.told_at ? '' : ' · not told yet'}</span>
                <p className="mt-0.5 text-text-muted">{c.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="field-label mb-2">Our notes, read first</p>
        {list.length === 0 ? (
          <p className="text-sm text-text-muted">No notes yet. Add how you do things here, or tell Diane "remember that…" in HMRC &amp; CIS mode.</p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {list.map((n) => (
              <li key={n.id} className="px-3 py-2">
                {editing?.id === n.id ? (
                  <div className="space-y-2">
                    <input className={BOX} aria-label="Note title" value={editing.title} onChange={(e) => setEditing((d) => ({ ...d, title: e.target.value }))} />
                    <textarea className={`${BOX} min-h-24`} aria-label="What the note says" value={editing.body} onChange={(e) => setEditing((d) => ({ ...d, body: e.target.value }))} />
                    <span className="flex gap-2">
                      <Button size="sm" variant="primary" disabled={save.isPending || !editing.title.trim() || !editing.body.trim()}
                        onClick={() => save.mutate({ id: n.id, title: editing.title, body: editing.body }, { onSuccess: () => setEditing(null) })}>
                        {save.isPending ? 'Saving…' : 'Save'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{n.title}</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-text-muted">{n.body}</p>
                      <p className="mt-1 text-xs text-text-faint">{n.added_by ? `${n.added_by} · ` : ''}{when(n.updated_at)}</p>
                    </div>
                    {removing === n.id ? (
                      <span className="flex items-center gap-2">
                        <Button variant="danger" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(n.id, { onSettled: () => setRemoving(null) })}>
                          {remove.isPending ? 'Removing…' : 'Remove'}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setRemoving(null)}>Keep</Button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setEditing({ id: n.id, title: n.title, body: n.body })}>Edit</Button>
                        <Button variant="secondary" size="sm" onClick={() => setRemoving(n.id)}>Remove</Button>
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="space-y-2"
        onSubmit={(e) => { e.preventDefault(); if (ready) add.mutate(draft, { onSuccess: () => setDraft({ title: '', body: '' }) }); }}
      >
        <p className="field-label">Add a note</p>
        <input className={BOX} placeholder="Title, like: How we verify new subcontractors" aria-label="Note title" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
        <textarea className={`${BOX} min-h-24`} placeholder="What we do, in plain words. Diane follows it, and says so if it ever clashes with the law." aria-label="What the note says" value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
        <Button type="submit" variant="primary" size="sm" disabled={!ready || add.isPending}>{add.isPending ? 'Saving…' : 'Save note'}</Button>
      </form>
    </div>
  );
}
