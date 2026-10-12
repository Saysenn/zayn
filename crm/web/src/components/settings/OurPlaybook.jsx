import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { BASE_URL } from '../../helpers/api.helper';
import { useReportingMutation } from '../../hooks/useReportingMutation';
import Button from '../buttons/Button';
import { Skeleton } from '../display/Skeleton';

/**
 * OUR PLAYBOOK: HOW THIS BUSINESS DOES THINGS (his call 2026-10-12).
 *
 * Read FIRST on every lawyer-mode answer. Added here, or through Diane in
 * lawyer mode ("save this as our process for…", or a document sent to her),
 * where she always asks before saving. Every change is listed with who made
 * it and when, and any of them can be put back. The whole playbook downloads
 * as one document.
 */
const ENTRIES = ['playbook'];
const HISTORY = ['playbook-history'];
const BOX = 'w-full rounded border border-border-strong bg-surface px-2.5 py-2 text-sm outline-none focus:outline focus:outline-2 focus:outline-accent-strong focus:outline-offset-1';
const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const ACTION = { add: 'Added', edit: 'Changed', remove: 'Removed', undo: 'Put back' };
const EMPTY = { section: '', title: '', body: '' };

export default function OurPlaybook() {
  const entries = useQuery({ queryKey: ENTRIES, queryFn: () => apiService.hmrc.playbook() });
  const history = useQuery({ queryKey: HISTORY, queryFn: () => apiService.hmrc.playbookHistory() });
  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  const both = [ENTRIES, HISTORY];
  const add = useReportingMutation((body) => apiService.hmrc.addPlaybook(body), { describe: (v) => `"${v.title}"`, verb: 'saved', invalidates: both });
  const save = useReportingMutation(({ id, ...fields }) => apiService.hmrc.updatePlaybook(id, fields), { describe: () => 'Entry', verb: 'saved', invalidates: both });
  const remove = useReportingMutation((id) => apiService.hmrc.removePlaybook(id), { describe: () => 'Entry', verb: 'removed', invalidates: both });
  const undo = useReportingMutation((id) => apiService.hmrc.undoPlaybook(id), { describe: () => 'Change', verb: 'put back', invalidates: both });

  if (entries.isLoading) return <Skeleton className="h-32 w-full" />;
  const list = entries.data?.entries ?? [];
  const sections = [...new Set(list.map((e) => e.section || 'General'))];
  const ready = draft.title.trim() && draft.body.trim();
  const changes = history.data?.changes ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span><span className="font-semibold tabular-nums">{list.length}</span> <span className="text-text-muted">{list.length === 1 ? 'entry' : 'entries'} in {sections.length} {sections.length === 1 ? 'section' : 'sections'}</span></span>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setShowHistory((v) => !v)}>{showHistory ? 'Hide changes' : 'Changes'}</Button>
          <a
            href={`${BASE_URL}${apiService.hmrc.playbookExportUrl()}`}
            className="inline-flex h-8 items-center rounded border border-border-strong px-3 text-sm font-semibold text-text hover:border-accent-strong hover:text-accent-strong"
          >
            Download
          </a>
        </span>
      </div>

      {showHistory && (
        <div>
          <p className="field-label mb-2">Changes, newest first</p>
          {changes.length === 0 ? <p className="text-sm text-text-muted">No changes yet.</p> : (
            <ul className="divide-y divide-border rounded border border-border">
              {changes.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <span className="font-semibold">{ACTION[c.action] ?? c.action}</span>
                  <span className="min-w-0 flex-1 truncate text-text-muted">{c.section ? `${c.section} · ` : ''}{c.title ?? c.after?.title ?? c.before?.title ?? `#${c.source_id}`}</span>
                  <span className="text-xs text-text-faint">{c.by_user ? `${c.by_user} · ` : ''}{when(c.at)}</span>
                  {c.action !== 'undo' && !c.undone_at && (
                    <Button size="sm" variant="secondary" disabled={undo.isPending} onClick={() => undo.mutate(c.id)}>Put back</Button>
                  )}
                  {c.undone_at && <span className="text-xs text-text-faint">put back</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing yet. Add how you do things below, or in lawyer mode tell Diane "save this as our process for…", or send her a document. She asks before saving.</p>
      ) : sections.map((section) => (
        <div key={section}>
          <p className="field-label mb-2">{section}</p>
          <ul className="divide-y divide-border rounded border border-border">
            {list.filter((e) => (e.section || 'General') === section).map((e) => (
              <li key={e.id} className="px-3 py-2">
                {editing?.id === e.id ? (
                  <div className="space-y-2">
                    <input className={BOX} aria-label="Section" value={editing.section} onChange={(ev) => setEditing((d) => ({ ...d, section: ev.target.value }))} />
                    <input className={BOX} aria-label="Title" value={editing.title} onChange={(ev) => setEditing((d) => ({ ...d, title: ev.target.value }))} />
                    <textarea className={`${BOX} min-h-40`} aria-label="What we do" value={editing.body} onChange={(ev) => setEditing((d) => ({ ...d, body: ev.target.value }))} />
                    <span className="flex gap-2">
                      <Button size="sm" variant="primary" disabled={save.isPending || !editing.title.trim() || !editing.body.trim()}
                        onClick={() => save.mutate({ id: e.id, section: editing.section, title: editing.title, body: editing.body }, { onSuccess: () => setEditing(null) })}>
                        {save.isPending ? 'Saving…' : 'Save'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start gap-3">
                    <details className="min-w-0 flex-1">
                      <summary className="cursor-pointer text-sm font-semibold">{e.title}</summary>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">{e.body}</p>
                    </details>
                    <span className="text-xs text-text-faint">{e.added_by ? `${e.added_by} · ` : ''}{when(e.updated_at)}</span>
                    {removing === e.id ? (
                      <span className="flex items-center gap-2">
                        <Button variant="danger" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(e.id, { onSettled: () => setRemoving(null) })}>
                          {remove.isPending ? 'Removing…' : 'Remove'}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setRemoving(null)}>Keep</Button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setEditing({ id: e.id, section: e.section ?? '', title: e.title, body: e.body })}>Edit</Button>
                        <Button variant="secondary" size="sm" onClick={() => setRemoving(e.id)}>Remove</Button>
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <form
        className="space-y-2"
        onSubmit={(ev) => { ev.preventDefault(); if (ready) add.mutate(draft, { onSuccess: () => setDraft(EMPTY) }); }}
      >
        <p className="field-label">Add to the playbook</p>
        <input className={BOX} list="playbook-sections" placeholder="Section, like: Payroll, Onboarding, CIS, Contracts" aria-label="Section" value={draft.section} onChange={(ev) => setDraft((d) => ({ ...d, section: ev.target.value }))} />
        <datalist id="playbook-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
        <input className={BOX} placeholder="Title, like: How we onboard a new subcontractor" aria-label="Title" value={draft.title} onChange={(ev) => setDraft((d) => ({ ...d, title: ev.target.value }))} />
        <textarea className={`${BOX} min-h-32`} placeholder="What we do, step by step, in plain words. As long as it needs to be: nothing is cut. Diane reads it first, and says so if it ever clashes with the law." aria-label="What we do" value={draft.body} onChange={(ev) => setDraft((d) => ({ ...d, body: ev.target.value }))} />
        <Button type="submit" variant="primary" size="sm" disabled={!ready || add.isPending}>{add.isPending ? 'Saving…' : 'Save to the playbook'}</Button>
      </form>
    </div>
  );
}
