import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { useReportingMutation } from '../../hooks/useReportingMutation';
import { useGroups } from '../../hooks/useChat';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import Toggle from '../forms/Toggle';
import { Skeleton } from '../display/Skeleton';

/**
 * WHO MAY SEND EXPENSES TO WHATBOT, AND ON WHICH GROUP'S NUMBER.
 *
 * His plan 2026-10-07: each group's WhatBot number takes expenses only from
 * the admins registered on it here. Anyone else gets nothing from the
 * expense side: no reply, nothing read, nothing saved. The group of every
 * expense comes from the number it was sent to, so an admin on MANBAT can
 * never save or see INDIGO's spending.
 *
 * Off keeps the row and shuts the door, for someone away for a while.
 */
const KEY = ['expense-admins'];
const BOX = 'min-h-9 rounded border border-border-strong bg-surface px-2.5 text-sm outline-none focus:outline focus:outline-2 focus:outline-accent-strong focus:outline-offset-1';

export default function ExpenseAdmins() {
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => apiService.expenseAdmins.list() });
  const { data: groups = [] } = useGroups();
  const [draft, setDraft] = useState({ groupName: '', name: '', phone: '' });
  const [removing, setRemoving] = useState(null);

  const add = useReportingMutation((body) => apiService.expenseAdmins.add(body), {
    describe: (v) => `${v.name} on ${v.groupName}`, verb: 'added', invalidates: [KEY],
  });
  const change = useReportingMutation(({ id, ...fields }) => apiService.expenseAdmins.update(id, fields), {
    describe: (v) => (v.active === false ? 'Access turned off,' : 'Access turned on,'), verb: 'saved', invalidates: [KEY],
  });
  const remove = useReportingMutation((id) => apiService.expenseAdmins.remove(id), {
    describe: () => 'Admin', verb: 'removed', invalidates: [KEY],
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  const admins = data?.admins ?? [];
  const ready = draft.groupName && draft.name.trim() && /\d{7,}/.test(draft.phone.replace(/\D/g, ''));

  function submit(e) {
    e.preventDefault();
    if (!ready) return;
    add.mutate(draft, { onSuccess: () => setDraft({ groupName: draft.groupName, name: '', phone: '' }) });
  }

  return (
    <div className="space-y-4">
      {admins.length === 0 ? (
        <p className="text-sm text-text-muted">Nobody is registered yet, so no one can send expenses to WhatBot.</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="w-24 shrink-0 text-xs font-semibold text-text-muted">{a.group_name}</span>
              <span className="min-w-0 flex-1 text-sm">
                <span className={a.active ? '' : 'text-text-faint line-through'}>{a.name}</span>
                <span className="ml-2 text-xs tabular-nums text-text-muted">{a.phone}</span>
              </span>
              <Toggle
                checked={a.active}
                label={`Expenses from ${a.name}`}
                disabled={change.isPending}
                onChange={(v) => change.mutate({ id: a.id, active: v })}
              />
              {removing === a.id ? (
                <span className="flex items-center gap-2">
                  <Button variant="danger" size="sm" onClick={() => remove.mutate(a.id, { onSettled: () => setRemoving(null) })} disabled={remove.isPending}>
                    {remove.isPending ? 'Removing…' : 'Remove'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setRemoving(null)}>Keep</Button>
                </span>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setRemoving(a.id)}>Remove</Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="w-36">
          <Select
            value={draft.groupName}
            onChange={(v) => setDraft((d) => ({ ...d, groupName: v }))}
            options={groups.map((g) => ({ value: g, label: g }))}
            placeholder="Group"
          />
        </div>
        <input
          className={`${BOX} w-40`}
          placeholder="Name"
          aria-label="Admin name"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        <input
          className={`${BOX} w-44 tabular-nums`}
          placeholder="+447700900123"
          aria-label="WhatsApp number with country code"
          inputMode="tel"
          value={draft.phone}
          onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
        />
        <Button type="submit" variant="primary" size="sm" disabled={!ready || add.isPending}>
          {add.isPending ? 'Adding…' : 'Add admin'}
        </Button>
      </form>
    </div>
  );
}
