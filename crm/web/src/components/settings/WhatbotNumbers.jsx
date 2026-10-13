import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { apiService } from '../../configs/api.config';
import { useReportingMutation } from '../../hooks/useReportingMutation';
import { useGroups } from '../../hooks/useChat';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import Toggle from '../forms/Toggle';
import Modal from '../modals/Modal';
import ConfirmDialog from '../modals/ConfirmDialog';
import { Skeleton } from '../display/Skeleton';

/**
 * EACH GROUP'S WHATBOT NUMBER (his call 2026-10-12, migration 083).
 *
 * Add a number here and WhatBot's worker connects it within seconds, no
 * restart. Link shows the QR (or an 8 character code) to scan on that
 * group's phone; it is never stored, and goes stale within a minute.
 * Off disconnects it but keeps its link, so on again needs no scan.
 * Relink logs it out and starts a fresh link.
 */
const KEY = ['whatbot-numbers'];
const BOX = 'min-h-9 rounded border border-border-strong bg-surface px-2.5 text-sm outline-none focus:outline focus:outline-2 focus:outline-accent-strong focus:outline-offset-1';

// Literal class names, so Tailwind's scan sees every one (badgeKinds.js).
const STATE = {
  connected: { cls: 'badge badge-active', label: 'Connected' },
  waiting: { cls: 'badge badge-in_progress', label: 'Waiting for scan' },
  offline: { cls: 'badge badge-closed', label: 'Offline' },
  logged_out: { cls: 'badge badge-open', label: 'Unlinked on the phone' },
  unknown: { cls: 'badge badge-closed', label: 'Not known' },
  off: { cls: 'badge badge-closed', label: 'Off' },
};

export default function WhatbotNumbers() {
  const [linking, setLinking] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: () => apiService.whatbotNumbers.list(),
    // the worker reports every 10 seconds; faster while a QR is open
    refetchInterval: linking ? 3000 : 10000,
  });
  const { data: groups = [] } = useGroups();
  const [draft, setDraft] = useState({ groupName: '', phone: '' });
  const [removing, setRemoving] = useState(null);
  const [relinking, setRelinking] = useState(null);
  const closeLink = useCallback(() => setLinking(null), []);

  const add = useReportingMutation((body) => apiService.whatbotNumbers.add(body), {
    describe: (v) => `${v.groupName}'s number`, verb: 'added', invalidates: [KEY],
  });
  const change = useReportingMutation(({ id, ...fields }) => apiService.whatbotNumbers.update(id, fields), {
    describe: (v) => {
      if (v.linkWith) return v.linkWith === 'code' ? 'Linking by code' : 'Linking by QR';
      return v.active === false ? 'Number turned off,' : 'Number turned on,';
    },
    verb: 'saved',
    invalidates: [KEY],
  });
  const relink = useReportingMutation((id) => apiService.whatbotNumbers.relink(id), {
    describe: () => 'Relink', verb: 'started', invalidates: [KEY],
  });
  const remove = useReportingMutation((id) => apiService.whatbotNumbers.remove(id), {
    describe: () => 'Number', verb: 'removed', invalidates: [KEY],
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  const numbers = data?.numbers ?? [];
  const taken = new Set(numbers.map((n) => n.group_name.toUpperCase()));
  // "ALL GROUPS" is the filters' choice, never a group with a phone
  const free = groups.filter((g) => g !== 'ALL GROUPS' && !taken.has(String(g).toUpperCase()));
  const ready = draft.groupName && /\d{7,}/.test(draft.phone.replace(/\D/g, ''));
  const open = linking && numbers.find((n) => n.id === linking);

  function submit(e) {
    e.preventDefault();
    if (!ready) return;
    add.mutate(draft, { onSuccess: () => setDraft({ groupName: '', phone: '' }) });
  }

  return (
    <div className="space-y-4">
      {data && !data.worker && (
        <p className="rounded border border-warning/40 bg-warning-tint px-3 py-2 text-sm text-warning">
          WhatBot's worker has not checked in, so the status below is not known. Start it with <code>npm run dev:worker</code>: new numbers connect as soon as it runs.
        </p>
      )}

      {numbers.length === 0 ? (
        <p className="text-sm text-text-muted">No WhatBot numbers yet. Add each group's number below, then link it from that group's phone.</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {numbers.map((n) => {
            const s = STATE[n.active ? n.state : 'off'] ?? STATE.unknown;
            const linked = n.state === 'connected';
            return (
              <li key={n.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="w-24 shrink-0 text-xs font-semibold text-text-muted">{n.group_name}</span>
                <span className={`flex-1 whitespace-nowrap text-sm tabular-nums ${n.active ? '' : 'text-text-faint line-through'}`}>{n.phone}</span>
                <span className={s.cls}>{s.label}</span>
                <Toggle
                  checked={n.active}
                  label={`WhatBot on ${n.group_name}`}
                  disabled={change.isPending}
                  onChange={(v) => change.mutate({ id: n.id, active: v })}
                />
                {removing === n.id ? (
                  <span className="flex items-center gap-2">
                    <Button variant="danger" size="sm" onClick={() => remove.mutate(n.id, { onSettled: () => setRemoving(null) })} disabled={remove.isPending}>
                      {remove.isPending ? 'Removing…' : 'Remove'}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setRemoving(null)}>Keep</Button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    {n.active && !linked && n.state !== 'logged_out' && (
                      <Button variant="primary" size="sm" onClick={() => setLinking(n.id)}>Link</Button>
                    )}
                    {n.active && (linked || n.state === 'logged_out') && (
                      <Button variant="secondary" size="sm" onClick={() => setRelinking(n)}>Relink</Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => setRemoving(n.id)}>Remove</Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="w-36">
          <Select
            value={draft.groupName}
            onChange={(v) => setDraft((d) => ({ ...d, groupName: v }))}
            options={free.map((g) => ({ value: g, label: g }))}
            placeholder="Group"
          />
        </div>
        <input
          className={`${BOX} w-44 tabular-nums`}
          placeholder="+447700900123"
          aria-label="WhatBot's WhatsApp number with country code"
          inputMode="tel"
          value={draft.phone}
          onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
        />
        <Button type="submit" variant="primary" size="sm" disabled={!ready || add.isPending}>
          {add.isPending ? 'Adding…' : 'Add number'}
        </Button>
      </form>

      {open && (
        <LinkDialog
          number={open}
          onCodeChange={(linkWith) => change.mutate({ id: open.id, linkWith })}
          onClose={closeLink}
        />
      )}

      {relinking && (
        <ConfirmDialog
          title="Relink this number?"
          subject={`${relinking.group_name} · ${relinking.phone}`}
          detail="WhatBot logs this number out and sets its old link aside. It stops answering until you scan the new QR on that group's phone."
          confirmLabel="Relink"
          busyLabel="Starting…"
          busy={relink.isPending}
          onConfirm={() => relink.mutate(relinking.id, {
            onSuccess: () => { setLinking(relinking.id); setRelinking(null); },
            onError: () => setRelinking(null),
          })}
          onCancel={() => setRelinking(null)}
        />
      )}
    </div>
  );
}

/** The QR (or code) to scan, refreshed as WhatsApp replaces it. Closes itself once linked. */
function LinkDialog({ number, onCodeChange, onClose }) {
  const { data } = useQuery({
    queryKey: ['whatbot-link', number.id],
    queryFn: () => apiService.whatbotNumbers.link(number.id),
    refetchInterval: 2000,
    gcTime: 0,
  });
  const [image, setImage] = useState(null);
  const qr = data?.qr;
  const linked = data?.state === 'connected';
  const byCode = data?.linkWith === 'code';

  useEffect(() => {
    let live = true;
    if (!qr) { setImage(null); return undefined; }
    QRCode.toDataURL(qr, { margin: 1, width: 264 }).then((url) => live && setImage(url)).catch(() => live && setImage(null));
    return () => { live = false; };
  }, [qr]);

  useEffect(() => {
    if (!linked) return undefined;
    const t = setTimeout(onClose, 1500);
    return () => clearTimeout(t);
  }, [linked, onClose]);

  return (
    <Modal title={`Link ${number.group_name}'s WhatBot`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        {linked ? (
          <p className="rounded bg-success-tint px-3 py-2 font-semibold text-success-strong">Linked. {number.group_name}'s WhatBot is connected.</p>
        ) : (
          <>
            <p className="text-text-muted">
              On the phone for <span className="font-semibold text-text tabular-nums">{number.phone}</span>, open WhatsApp → Settings → Linked devices → Link a device
              {byCode ? ', tap "Link with phone number instead", and type this code.' : ', and scan this.'}
            </p>
            <div className="flex min-h-[264px] items-center justify-center rounded border border-border bg-white">
              {byCode ? (
                data?.code
                  ? <span className="font-mono text-3xl font-semibold tracking-widest text-black">{data.code}</span>
                  : <span className="text-text-muted">Waiting for a code from WhatBot…</span>
              ) : image ? (
                <img src={image} alt={`QR to link ${number.group_name}'s WhatBot`} width={264} height={264} />
              ) : (
                <span className="text-text-muted">{data?.state === 'unknown' ? "WhatBot's worker is not running." : 'Waiting for a QR from WhatBot…'}</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-text-faint">{byCode ? 'The code works until WhatBot restarts.' : 'The QR changes every 20 seconds or so; this keeps up.'}</span>
              <Button variant="secondary" size="sm" onClick={() => onCodeChange(byCode ? 'qr' : 'code')}>
                {byCode ? 'Use a QR instead' : 'Use a code instead'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
