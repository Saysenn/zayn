import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { useNotifications } from '../../hooks/useNotifications';
import { useMasterSheetCellEdit } from '../../hooks/useMasterSheet';
import Button from '../buttons/Button';
import {
  CheckCircleIcon, CheckIcon, ChevronIcon, CloseIcon, FitIcon, InfoIcon, MinusIcon, PlusIcon, ResetIcon,
} from '../icons';
import { Skeleton } from '../display/Skeleton';
import { ErrorState } from '../display/StateBlocks';
import usePanZoom from '../../hooks/usePanZoom';
import {
  UK_COAST, UK_CITIES, projectUk, MAP_W, MAP_H,
} from './ukMap';
import { runRegions } from './mapGeometry';

/**
 * ===============================
 * * THE DRIVERS TAB
 * ===============================
 * His call 2026-10-04. The month's money sorted by who delivers it, and the
 * rule that sorts it is set HERE, by hand, on a UK map: drag a location onto
 * a run (North run, To be posted, South run...) or into Outside UK, and its
 * dot moves to that run's colour. Saved for everyone, so next month opens
 * already sorted and only a new location waits in Unassigned.
 *
 * The export is held while a location has no run, because a person left
 * off the driver sheet is cash nobody delivers.
 */

const ABROAD_COLOR = '#a16207';
const UNSET_COLOR = '#7d8581';
const SHOW_FIRST = 5;
// A new run takes the first of these no run has yet. Data colours, not
// theme tokens: a run keeps its colour in every theme and in the export.
const RUN_COLORS = ['#2563eb', '#be185d', '#4d7c0f', '#0e7490', '#9333ea', '#b45309', '#475569'];
const placeKeyOf = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const SYMBOL = { GBP: '£', EURO: '€', EUR: '€' };
const money = (cur, n) => `${SYMBOL[cur] ?? `${cur} `}${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;

export default function DriversPanel({ group, onBlockingChange }) {
  const queryKey = ['export-drivers', group];
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () => apiService.exports.drivers(group ? { group } : {}),
    placeholderData: (prev) => prev,
  });

  // Moves land at once and roll back if the save fails.
  const save = useMutation({
    mutationFn: (places) => apiService.exports.saveDrivers({ places }),
    onMutate: async (places) => {
      await queryClient.cancelQueries({ queryKey });
      const before = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old) => old && {
        ...old,
        places: old.places.map((p) => ({ ...p, run: places[p.key] ?? null })),
      });
      return { before };
    },
    onError: (err, _v, ctx) => {
      queryClient.setQueryData(queryKey, ctx?.before);
      notify({ level: 'error', message: "Couldn't save that move", detail: err.message });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['export-count'] });
    },
  });

  // BACK TO THE MANUAL SHEET'S SPLIT, after an inline "are you sure".
  const [confirmReset, setConfirmReset] = useState(false);
  const reset = useMutation({
    mutationFn: () => apiService.exports.resetDrivers(),
    onSuccess: () => { setConfirmReset(false); notify({ level: 'success', message: "Back to the sheet's defaults" }); },
    onError: (err) => notify({ level: 'error', message: "Couldn't reset", detail: err.message }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['export-count'] });
    },
  });

  // RENAMING A RUN: its label is his to change, saved for everyone.
  // OPTIMISTIC, like the moves: the new name, the new run or the removed
  // one is on screen at once, and goes back if the save is refused.
  const rename = useMutation({
    mutationFn: (nextRuns) => apiService.exports.saveDrivers({ runs: nextRuns }),
    onMutate: async (nextRuns) => {
      await queryClient.cancelQueries({ queryKey });
      const before = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old) => old && { ...old, runs: nextRuns });
      return { before };
    },
    onError: (err, _v, ctx) => {
      queryClient.setQueryData(queryKey, ctx?.before);
      notify({ level: 'error', message: "Couldn't save the runs", detail: err.message });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  // ADDING AND REMOVING RUNS. The form offers the first colour no run has,
  // and any other; only an EMPTY run can go, so no location is ever left
  // without one.
  function addRun(label, picked) {
    const clean = String(label ?? '').trim();
    if (!clean || clean.length > 40) return;
    const current = data?.runs ?? [];
    const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'run';
    let id = base;
    for (let n = 2; current.some((r) => r.id === id) || id === 'abroad'; n += 1) id = `${base}-${n}`;
    const used = new Set(current.map((r) => r.color));
    const color = picked ?? RUN_COLORS.find((c) => !used.has(c)) ?? RUN_COLORS[current.length % RUN_COLORS.length];
    rename.mutate([...current, { id, label: clean, color }]);
  }
  function removeRun(id) {
    rename.mutate((data?.runs ?? []).filter((r) => r.id !== id));
  }

  function renameRun(id, label) {
    const clean = String(label ?? '').trim();
    if (!clean || clean.length > 40) return;
    rename.mutate((data?.runs ?? []).map((r) => (r.id === id ? { ...r, label: clean } : r)));
  }

  // FIXING A ROW FROM A CHECK: its location, written on the master sheet.
  const rowEdit = useMasterSheetCellEdit();
  function setLocation(item, location) {
    rowEdit.mutate(
      { id: item.id, fields: { location }, subject: item.name, label: 'location' },
      { onSettled: () => queryClient.invalidateQueries({ queryKey }) },
    );
  }

  const runs = data?.runs ?? [];
  const abroad = data?.abroad ?? { id: 'abroad', label: 'Outside UK' };
  const places = data?.places ?? [];
  const checks = data?.checks ?? [];
  const blocking = checks.some((c) => c.blocking);

  useEffect(() => { onBlockingChange?.(blocking); }, [blocking, onBlockingChange]);

  const zones = useMemo(() => [
    ...runs.map((r) => ({ id: r.id, label: r.label, color: r.color })),
    { id: abroad.id, label: abroad.label, color: ABROAD_COLOR },
  ], [runs, abroad.id, abroad.label]);
  const colorOf = (run) => zones.find((z) => z.id === run)?.color ?? UNSET_COLOR;

  function move(place, run) {
    const next = Object.fromEntries(places.filter((p) => p.run).map((p) => [p.key, p.run]));
    if (run) next[place.key] = run; else delete next[place.key];
    save.mutate(next);
  }

  const [popFor, setPopFor] = useState(null);

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]" aria-busy="true">
        <Skeleton className="h-[22rem] w-full rounded-lg md:h-[28rem]" />
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }
  if (isError) return <ErrorState error={error} title="Couldn't load the locations" onRetry={() => refetch()} />;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <UkMap
        places={places}
        zones={zones}
        colorOf={colorOf}
        abroadId={abroad.id}
        abroadLabel={abroad.label}
        popFor={popFor}
        onPop={setPopFor}
        onRename={renameRun}
      />
      <div className="min-w-0 space-y-1.5">
        {zones.map((z) => (
          <Zone
            key={z.id}
            zone={z}
            onRename={z.id === abroad.id ? null : (label) => renameRun(z.id, label)}
            onRemove={z.id === abroad.id || places.some((p) => p.run === z.id) ? null : () => removeRun(z.id)}
            places={places.filter((p) => p.run === z.id)}
            zones={zones}
            onDrop={(key) => { const p = places.find((x) => x.key === key); if (p) move(p, z.id); }}
            onMove={move}
            onOpen={setPopFor}
          />
        ))}
        <AddRun onAdd={addRun} used={runs.map((r) => r.color)} />
        <Zone
          zone={{ id: null, label: 'Unassigned', color: UNSET_COLOR }}
          places={places.filter((p) => !p.run)}
          zones={zones}
          hint="New this month: drag each one to a run, or to Outside UK"
          onDrop={(key) => { const p = places.find((x) => x.key === key); if (p) move(p, null); }}
          onMove={move}
          onOpen={setPopFor}
          hideWhenEmpty
        />
        <BeforeExport checks={checks} places={places} zones={zones} busy={rowEdit.isPending} onSetLocation={setLocation} />
        {/* SAID, so nobody wonders whether a move stuck. */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="text-text-muted" role="status" aria-live="polite">
            {save.isPending ? 'Saving…' : save.isError ? 'Not saved: try that move again.' : 'Every move is saved for everyone as you make it.'}
          </p>
          {confirmReset ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-text-muted">Put every location back as the sheet had it?</span>
              <Button size="xs" onClick={() => setConfirmReset(false)}>Keep</Button>
              {/* RED: it overwrites everyone's runs, and there is no undo. */}
              <Button size="xs" variant="danger" onClick={() => reset.mutate()} disabled={reset.isPending}>
                {reset.isPending ? 'Resetting…' : 'Reset'}
              </Button>
            </span>
          ) : (
            // AMBER, the CRM's "back to the default" colour: it is not a
            // delete, but it does undo everyone's moves.
            <Button size="xs" variant="warning" onClick={() => setConfirmReset(true)}>
              <ResetIcon width={13} height={13} />
              Reset to the sheet's defaults
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * BEFORE EXPORT, one short line per check: what is wrong and the names, each
 * with its own dropdown to fix it. What to do sits in the ⓘ; info-only notes fold
 * away; nothing left is one green line.
 */
function BeforeExport({ checks, places, zones, busy, onSetLocation }) {
  const [notesOpen, setNotesOpen] = useState(false);
  const lines = checks.filter((c) => !c.note);
  const notes = checks.filter((c) => c.note);
  if (lines.length === 0 && notes.length === 0) {
    return (
      <p className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold text-success-strong">
        <CheckCircleIcon width={14} height={14} />
        Ready to export
      </p>
    );
  }
  return (
    <div className="rounded-md border border-border px-2.5 py-2 text-xs">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">Before export</p>
      {lines.length === 0 && (
        <p className="mt-1 flex items-center gap-1.5 font-semibold text-success-strong">
          <CheckCircleIcon width={14} height={14} />
          Ready to export
        </p>
      )}
      <ul className="mt-1 space-y-1">
        {lines.map((c) => <CheckLine key={c.kind} check={c} places={places} zones={zones} busy={busy} onSetLocation={onSetLocation} />)}
      </ul>
      {notes.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen((v) => !v)}
            className="mt-1 inline-flex min-h-0 items-center gap-1 border-0 bg-transparent p-0 text-xs text-text-muted shadow-none hover:text-text"
          >
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
            <ChevronIcon width={12} height={12} className={`transition-transform ${notesOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
          </button>
          {notesOpen && (
            <ul className="mt-1 space-y-1">
              {notes.map((c) => <CheckLine key={c.kind} check={c} places={places} zones={zones} busy={busy} onSetLocation={onSetLocation} />)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function CheckLine({ check: c, places, zones, busy, onSetLocation }) {
  const dot = c.blocking ? 'bg-danger' : c.note ? 'bg-text-faint' : 'bg-warning';
  return (
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className={c.blocking ? 'text-danger' : c.note ? 'text-text-muted' : 'text-text'}>{c.short ?? c.text}</span>
      {c.items?.map((item) => (
        <span key={item.id} className="inline-flex items-center gap-1">
          <PickMenu
            label={`Set the location for ${item.name}`}
            value=""
            disabled={busy}
            title="Set location"
            onPick={(v) => { if (v) onSetLocation(item, v); }}
            triggerClassName="inline-flex min-h-0 items-center gap-0.5 rounded border-0 bg-transparent px-1 py-0 text-text transition-colors hover:bg-surface-sunken"
            heading={`Set ${item.name}'s location`}
            searchable
            options={places
              .filter((p) => p.key !== placeKeyOf(item.current))
              .sort((a, b) => (a.key === item.suggest ? -1 : b.key === item.suggest ? 1 : 0))
              .map((p) => {
                const run = zones.find((z) => z.id === p.run);
                return {
                  value: p.name,
                  label: p.name,
                  color: run?.color ?? UNSET_COLOR,
                  meta: `${run?.label ?? 'Unassigned'} · ${p.people}`,
                  suggested: p.key === item.suggest,
                };
              })}
          >
            {item.name}
            <ChevronIcon width={12} height={12} className="rotate-90 text-accent-strong" />
          </PickMenu>
          {item.detail && <span className="text-xs text-text-faint">({item.detail})</span>}
        </span>
      ))}
      {c.hint && (
        <span title={c.hint} aria-label={c.hint} className="inline-flex cursor-help text-text-faint">
          <InfoIcon width={13} height={13} />
        </span>
      )}
    </li>
  );
}

/** One run (or Unassigned): a drop target holding its location chips. */
function Zone({ zone, places, zones, hint, onDrop, onMove, onOpen, onRename, onRemove, hideWhenEmpty = false }) {
  const [over, setOver] = useState(false);
  if (hideWhenEmpty && places.length === 0) return null;
  const people = places.reduce((n, p) => n + p.people, 0);
  return (
    <section
      aria-label={zone.label}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDrop(e.dataTransfer.getData('text/plain')); }}
      className={`rounded-lg border px-2.5 py-1.5 transition-colors ${over ? 'bg-surface-sunken' : 'border-border'}`}
      style={{ borderColor: over ? zone.color : undefined }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: zone.color }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: zone.color }} aria-hidden="true" />
          {onRename ? <RunName label={zone.label} color={zone.color} onRename={onRename} /> : zone.label}
        </h3>
        <span className="flex items-center gap-1.5 text-xs tabular-nums text-text-faint">
          {people} {people === 1 ? 'person' : 'people'}
          {onRemove && (
            <Button size="icon" className="text-text-faint hover:text-danger" aria-label={`Remove ${zone.label}`} title="Remove this empty run" onClick={onRemove}>
              <CloseIcon width={14} height={14} />
            </Button>
          )}
        </span>
      </div>
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
      <div className="mt-1 flex flex-wrap gap-1">
        {places.length === 0 && <span className="text-xs text-text-faint">Drop a location here</span>}
        {places.map((p) => (
          <Chip key={p.key} place={p} zones={zones} onMove={onMove} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

/**
 * A run's name, renamed in place: click it, type, Enter (Esc or clicking
 * away keeps the old one).
 */
function RunName({ label, color, onRename, className = '' }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  useEffect(() => { setValue(label); }, [label]);
  if (!editing) {
    return (
      <button
        type="button"
        title="Rename this run"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        className={`min-h-0 border-0 bg-transparent p-0 font-semibold shadow-none transition-opacity hover:opacity-75 ${className}`}
        style={{ color }}
      >
        {label}
      </button>
    );
  }
  const done = (save) => {
    setEditing(false);
    if (save && value.trim() && value.trim() !== label) onRename(value.trim());
    else setValue(label);
  };
  return (
    <input
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      aria-label="Run name"
      value={value}
      maxLength={40}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => done(true)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); done(true); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      }}
      className="min-h-0 w-36 rounded-sm border border-border bg-surface px-1 py-0 text-xs font-semibold text-text"
    />
  );
}

/**
 * ADD A RUN: a small card shaped like the run it will become. The dot is
 * the colour it gets (the first one no run has, or any other you tap), the
 * name is one line, Enter adds and Esc leaves.
 */
function AddRun({ onAdd, used }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const free = RUN_COLORS.find((c) => !used.includes(c)) ?? RUN_COLORS[0];
  const [color, setColor] = useState(free);
  const [picking, setPicking] = useState(false);
  useEffect(() => { if (open) setColor(free); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) {
    return (
      <Button size="xs" variant="accent" onClick={() => setOpen(true)}>
        <PlusIcon width={13} height={13} />
        Add a run
      </Button>
    );
  }
  const done = (save) => {
    if (save && value.trim()) onAdd(value.trim(), color);
    setValue('');
    setPicking(false);
    setOpen(false);
  };
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5" style={{ borderColor: color }}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button
            size="icon"
            className="shrink-0"
            aria-label="Pick the run's colour"
            aria-expanded={picking}
            title="Colour"
            onClick={() => setPicking((p) => !p)}
          >
            <span className="block h-4 w-4 rounded-full ring-1 ring-border" style={{ background: color }} />
          </Button>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            aria-label="New run name"
            placeholder="Run name, e.g. Midlands run"
            value={value}
            maxLength={40}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); done(true); }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
            }}
            className="form-control h-9 min-h-0 w-full min-w-0 text-sm"
          />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <Button size="form" onClick={() => done(false)}>Cancel</Button>
          <Button size="form" variant="primary" disabled={!value.trim()} onClick={() => done(true)}>
            <PlusIcon width={15} height={15} />
            Add
          </Button>
        </div>
      </div>
      {picking && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Run colour">
          {RUN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === color}
              aria-label={c}
              onClick={() => { setColor(c); setPicking(false); }}
              className={`h-6 w-6 min-h-0 rounded-full border-0 p-0 transition-transform hover:scale-110 ${c === color ? 'outline outline-1 outline-offset-2' : ''}`}
              style={{ background: c, outlineColor: c }}
            />
          ))}
        </div>
      )}
      <p className="mt-1.5 text-xs text-text-faint">Enter to add · Esc to cancel</p>
    </div>
  );
}

/** What a region is: its run, how many places and people, and its name to change. */
function RegionPopover({ zone, places, onRename, onClose }) {
  const mine = places.filter((p) => p.run === zone.id);
  const people = mine.reduce((n, p) => n + p.people, 0);
  return (
    <div className="absolute inset-x-2 bottom-2 z-20 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg [animation:bulk-in_.2s_cubic-bezier(.22,1,.36,1)_both] md:inset-x-auto md:bottom-auto md:right-2 md:top-2 md:w-60" role="dialog" aria-label={`${zone.label} region`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: zone.color }} aria-hidden="true" />
            {onRename ? <RunName label={zone.label} color={zone.color} onRename={onRename} /> : <span className="font-semibold" style={{ color: zone.color }}>{zone.label}</span>}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            {mine.length} {mine.length === 1 ? 'place' : 'places'} · {people} {people === 1 ? 'person' : 'people'}
          </p>
        </div>
        <Button size="icon" className="shrink-0" aria-label="Close" onClick={onClose}>
          <CloseIcon width={16} height={16} />
        </Button>
      </div>
      <p className="mt-2 text-xs text-text">{mine.map((p) => p.name).join(', ') || 'No places yet'}</p>
      {onRename && <p className="mt-1 text-xs text-text-faint">Click the name to rename it.</p>}
    </div>
  );
}

/**
 * ===============================
 * * A SMALL PICKER THAT OPENS SMOOTHLY
 * ===============================
 * The browser's own <select> could not be animated or show a run's colour,
 * and opened as a jarring native sheet. This pops out under its trigger
 * (above it when there is no room), portalled so the modal's scroll cannot
 * clip it, and closes on a pick, a click outside or Esc (Esc closes only
 * the menu, not the export dialog behind it).
 */
function PickMenu({
  label, value, options, onPick, disabled = false, title, triggerClassName, heading, searchable = false, children,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [q, setQ] = useState('');
  const trigger = useRef(null);
  const menu = useRef(null);
  useEffect(() => { if (!open) setQ(''); }, [open]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const lead = shown.filter((o) => o.suggested);
  const rest = shown.filter((o) => !o.suggested);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const h = Math.min(320, options.length * 30 + (heading ? 34 : 0) + (searchable ? 44 : 0) + 12);
    const below = window.innerHeight - r.bottom > h + 8;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - (searchable ? 264 : 216))),
      ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
      origin: below ? 'top left' : 'bottom left',
    });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!trigger.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    const onScroll = (e) => { if (!menu.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title ?? label}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={triggerClassName ?? `min-h-0 rounded border-0 bg-transparent p-0.5 text-text-muted transition-colors hover:bg-surface hover:text-text ${open ? 'bg-surface text-text' : ''}`}
      >
        {children}
      </button>
      {open && createPortal(
        <div
          ref={menu}
          role="listbox"
          aria-label={label}
          className={`pick-menu ${searchable ? 'w-64' : ''}`}
          style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, transformOrigin: pos.origin } : { visibility: 'hidden' }}
        >
          {heading && <p className="px-3 pb-1 pt-0.5 text-xs font-semibold text-text-muted">{heading}</p>}
          {searchable && (
            <div className="px-2 pb-1.5">
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                aria-label="Search"
                placeholder="Search…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); setOpen(false); onPick(shown[0].value); } }}
                className="form-control h-8 text-sm"
              />
            </div>
          )}
          {shown.length === 0 && <p className="px-3 py-2 text-xs text-text-faint">No match</p>}
          {[lead, rest].map((group, gi) => group.length > 0 && (
            <div key={gi} className={gi === 1 && lead.length > 0 ? 'mt-1 border-t border-border pt-1' : ''}>
              {group.map((o) => {
                const on = o.value === value;
                return (
                  <button
                    key={o.value || '__none'}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => { setOpen(false); if (!on) onPick(o.value); }}
                    className={`bulk-menu-item gap-2 py-1 ${on ? 'font-semibold' : ''}`}
                  >
                    {o.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.color }} aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.suggested && <span className="badge shrink-0 bg-accent-tint px-1.5 py-0 text-accent-strong">Suggested</span>}
                    {o.meta && !o.suggested && <span className="shrink-0 text-xs text-text-faint">{o.meta}</span>}
                    {o.hint && <span className="text-xs text-text-faint">{o.hint}</span>}
                    {on && <CheckIcon width={13} height={13} className="shrink-0 text-accent-strong" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/** A location you can drag, or move with its dropdown. */
function Chip({ place, zones, onMove, onOpen }) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', place.key); e.dataTransfer.effectAllowed = 'move'; }}
      className="relative flex cursor-grab items-center gap-1 rounded-md border border-border bg-surface-sunken py-0.5 pl-1.5 pr-1 text-xs active:cursor-grabbing"
    >
      <button type="button" className="min-h-0 border-0 bg-transparent p-0 font-medium text-text shadow-none transition-colors hover:text-accent-strong" onClick={() => onOpen(place.key)}>
        {place.name}
      </button>
      <span className="tabular-nums text-text-faint">{place.people}</span>
      {place.suggest && !place.run && (
        <span className="rounded-sm bg-warning-tint px-1 text-xs font-semibold uppercase text-warning-strong">
          {place.suggest === 'abroad' ? 'abroad?' : 'UK?'}
        </span>
      )}
      {/* THE MOVE MENU, as a small down chevron: the box it sits in already says the
          run, so spelling it again on every chip was noise. Our own menu, not
          the browser's select, so it opens smoothly and shows the run colours. */}
      <PickMenu
        label={`Move ${place.name} to another run`}
        heading={`Move ${place.name} to`}
        value={place.run ?? ''}
        onPick={(v) => onMove(place, v || null)}
        options={[
          ...zones.map((z) => ({ value: z.id, label: z.label, color: z.color })),
          { value: '', label: 'Unassigned', color: UNSET_COLOR },
        ]}
      >
        <ChevronIcon width={12} height={12} className="rotate-90" />
      </PickMenu>
    </div>
  );
}

/**
 * THE MAP: each location by its postcodes, coloured by its run, over the
 * land shaded by run. Hold and drag to move it (it glides when you let
 * go), the wheel or a pinch to zoom, and the corner buttons to zoom or fit
 * it back. Clicking a dot or a shaded area says what is in it.
 *
 * Dots, labels and lines are drawn at 1/zoom so they stay the same size
 * on screen at every zoom: zooming in spreads the places out rather than
 * swelling them.
 */
const LABEL_PX = 10.5;
// How thick the land is, in map units: it thickens as you zoom, like a real slab.
const SLAB = 10;
const WALL_STEPS = 10;
// A pin's head grows a little with how many deals the place holds.
const PIN_STEM = 11;
const pinSize = (place) => 5.6 + Math.sqrt(place.deals.length) * 0.75;
function UkMap({ places, zones, colorOf, abroadId, abroadLabel, popFor, onPop, onRename }) {
  const [regionFor, setRegionFor] = useState(null);
  const svgRef = useRef(null);
  const pz = usePanZoom(svgRef, { width: MAP_W, height: MAP_H, minK: 1, maxK: 6 });
  const { x: tx, y: ty, k } = pz.view;
  const spots = useMemo(() => placeSpots(places, zones, abroadId), [places, zones, abroadId]);
  const regions = useMemo(
    () => runRegions(spots.map((sp) => ({ x: sp.x, y: sp.y, run: sp.place.run })), MAP_W, MAP_H),
    [spots],
  );
  const regionZone = zones.find((z) => z.id === regionFor);
  const abroad = places.filter((p) => p.run === abroadId);
  const open = places.find((p) => p.key === popFor);

  // EVERY LABEL SHOWS, placed where it fits. Biggest places first; each
  // tries the right of its pin, then the left, above and below, and takes
  // the first spot that lands on no other label and no pin head. With no
  // free spot it takes the one that overlaps least, rather than vanishing.
  // Measured on SCREEN, so zooming in spreads them back out.
  const labels = useMemo(() => {
    const heads = spots.map((sp) => {
      const size = pinSize(sp.place);
      const hx = sp.x * k + tx;
      const hy = sp.y * k + ty - PIN_STEM;
      return { x0: hx - size, x1: hx + size, y0: hy - size, y1: hy + size, key: sp.place.key };
    });
    const placed = [];
    const at = new Map();
    const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
      * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const order = [...spots].sort((a, b) => (b.place.key === popFor) - (a.place.key === popFor)
      || b.place.deals.length - a.place.deals.length);
    for (const sp of order) {
      const size = pinSize(sp.place);
      const hx = sp.x * k + tx;
      const hy = sp.y * k + ty - PIN_STEM;
      const w = sp.place.name.length * 6.1 + 4;
      const h = 13;
      const gap = size + 4;
      const options = [
        { side: 'right', x0: hx + gap, y0: hy - h / 2 },
        { side: 'left', x0: hx - gap - w, y0: hy - h / 2 },
        { side: 'above', x0: hx - w / 2, y0: hy - size - 3 - h },
        { side: 'below', x0: hx - w / 2, y0: sp.y * k + ty + 4 },
      ].map((o) => ({ ...o, x1: o.x0 + w, y1: o.y0 + h }));
      const cost = (o) => placed.reduce((n, b) => n + overlap(o, b), 0)
        + heads.filter((hd) => hd.key !== sp.place.key).reduce((n, hd) => n + overlap(o, hd), 0);
      const best = options.find((o) => cost(o) === 0)
        ?? options.reduce((m, o) => (cost(o) < cost(m) ? o : m));
      placed.push(best);
      at.set(sp.place.key, best);
    }
    return { at, boxes: placed };
  }, [spots, k, tx, ty, popFor]);

  useEffect(() => {
    if (!popFor && !regionFor) return undefined;
    // ESC CLOSES THE POPOVER, NOT THE DIALOG: caught first and kept from the
    // modal, which also closes on Esc.
    const close = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onPop(null);
      setRegionFor(null);
    };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [popFor, regionFor, onPop]);

  const r = (px) => px / k; // a screen size, in content units

  return (
    <div className="relative min-w-0 self-start overflow-hidden rounded-lg border border-border bg-surface-sunken md:sticky md:top-0">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        preserveAspectRatio="xMidYMid meet"
        className={`block h-[22rem] w-full touch-none select-none md:h-auto md:aspect-[460/560] ${pz.dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        role="img"
        aria-label="UK map of the locations by run. Drag to move, scroll to zoom."
        onClick={() => { onPop(null); setRegionFor(null); }}
        {...pz.handlers}
      >
        <defs>
          <clipPath id="uk-land"><path d={UK_COAST} /></clipPath>
          {/* THE SLAB'S SHADOW on the sea, soft and a little south. */}
          <filter id="uk-shadow" x="-15%" y="-15%" width="130%" height="135%">
            <feDropShadow dx="0" dy="11" stdDeviation="9" floodOpacity="0.24" />
          </filter>
          {/* Light from the top left, over the land AND its run colours. */}
          <linearGradient id="uk-light" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0.08" />
            <stop offset="1" stopColor="#000" stopOpacity="0.06" />
          </linearGradient>
          {/* A pin head's shine. */}
          <radialGradient id="pin-shine" cx="0.35" cy="0.3" r="0.7">
            <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0.15" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g transform={`translate(${tx} ${ty}) scale(${k})`} style={{ '--u': `${1 / k}px` }}>
          {/* A RAISED SLAB. The coast is stacked downwards in thin steps,
              deepest first: each step carries the run colours faintly and a
              shade that darkens towards the bottom, so the edge reads as a
              lit wall rather than a flat band. The shadow sits under the
              deepest step. A clipPath referenced inside a translated group
              moves with it, so each step clips its colours to its own coast. */}
          {Array.from({ length: WALL_STEPS }, (_, n) => WALL_STEPS - n).map((step) => {
            const dy = (SLAB * step) / WALL_STEPS;
            return (
              <g key={step} transform={`translate(0 ${dy})`} className="pointer-events-none">
                <path d={UK_COAST} className="fill-border-strong" filter={step === WALL_STEPS ? 'url(#uk-shadow)' : undefined} />
                <g clipPath="url(#uk-land)" opacity="0.45">
                  {regions.cells.map((c, i) => (
                    <polygon key={i} points={c.points.map((pt) => pt.join(',')).join(' ')} fill={colorOf(c.run)} />
                  ))}
                </g>
                <path d={UK_COAST} fill="#000" opacity={0.04 + (step / WALL_STEPS) * 0.22} />
              </g>
            );
          })}
          <path d={UK_COAST} className="fill-surface" />
          {/* THE RUNS AS AREAS, faded as one layer so nothing double-darkens. */}
          <g clipPath="url(#uk-land)">
            <g opacity="0.22">
              {regions.cells.map((c, i) => (
                <polygon
                  key={i}
                  points={c.points.map((pt) => pt.join(',')).join(' ')}
                  fill={colorOf(c.run)}
                  stroke={colorOf(c.run)}
                  strokeWidth={r(0.6)}
                  className="cursor-pointer transition-[fill] duration-300"
                  onClick={(e) => { e.stopPropagation(); onPop(null); setRegionFor(c.run); }}
                />
              ))}
            </g>
            {/* A thin light line only where two DIFFERENT runs meet. */}
            {regions.borders.map(([x1, y1, x2, y2], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-surface pointer-events-none" strokeWidth={r(1.5)} strokeLinecap="round" />
            ))}
          </g>
          <path d={UK_COAST} fill="url(#uk-light)" className="pointer-events-none" />
          {/* THE RIM: light catching the top edge of the plate. */}
          <path d={UK_COAST} fill="none" className="pointer-events-none" stroke="#fff" strokeOpacity="0.95" strokeWidth={r(1.8)} strokeLinejoin="round" />
          <path d={UK_COAST} fill="none" className="stroke-border-strong pointer-events-none" strokeOpacity="0.6" strokeWidth={r(0.6)} strokeLinejoin="round" />
          {UK_CITIES.map((c) => {
            const [x, y] = projectUk(c.lat, c.lon);
            const sx = x * k + tx;
            const sy = y * k + ty;
            // A city under a place's own label or dot is left out, not overlapped.
            if (labels.boxes.some((b) => sx + 3 < b.x1 && sx + 60 > b.x0 && sy - 9 < b.y1 && sy + 3 > b.y0)) return null;
            if (spots.some((sp) => Math.hypot(sp.x * k + tx - sx, sp.y * k + ty - sy) < 10)) return null;
            return (
              <g key={c.name} className="pointer-events-none">
                <circle cx={x} cy={y} r={r(1.6)} className="fill-text-faint" />
                <text x={x + r(4)} y={y - r(3)} fontSize={r(9)} className="fill-text-faint italic">{c.name}</text>
              </g>
            );
          })}
          {spots.map(({ place, x, y }) => {
            const selected = place.key === popFor;
            const size = pinSize(place);
            const stem = PIN_STEM;
            const color = colorOf(place.run);
            return (
              <g key={place.key}>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`${place.name}: who is in it`}
                  className={`map-dot cursor-pointer outline-none ${selected ? 'is-on' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setRegionFor(null); onPop(place.key); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPop(place.key); } }}
                >
                  <circle cx={x} cy={y - r(stem)} r={r(14)} fill="transparent" />
                  {/* Where the pin meets the ground: a small soft shadow. */}
                  <ellipse cx={x} cy={y} rx={r(size * 0.9)} ry={r(size * 0.35)} fill="#000" opacity="0.18" />
                  <g className="map-pin">
                    <line x1={x} y1={y} x2={x} y2={y - r(stem)} stroke={color} strokeWidth={r(1.6)} strokeLinecap="round" />
                    {/* The halo: on hover, and held while its card is open. */}
                    <circle cx={x} cy={y - r(stem)} r={r(size + 5)} fill={color} className="map-dot-halo" />
                    <circle cx={x} cy={y - r(stem)} r={r(size)} fill={color} className="stroke-surface" strokeWidth={r(1.4)} />
                    <circle cx={x} cy={y - r(stem)} r={r(size)} fill="url(#pin-shine)" className="pointer-events-none" />
                  </g>
                </g>
                {(() => {
                  const spot = labels.at.get(place.key);
                  if (!spot) return null;
                  // Back from screen to map units, anchored on the side it took.
                  const anchor = spot.side === 'left' ? 'end' : spot.side === 'right' ? 'start' : 'middle';
                  const sx = spot.side === 'left' ? spot.x1 : spot.side === 'right' ? spot.x0 : (spot.x0 + spot.x1) / 2;
                  return (
                    <text
                      x={(sx - tx) / k}
                      y={(spot.y1 - 3 - ty) / k}
                      textAnchor={anchor}
                      fontSize={r(LABEL_PX)}
                      className="pointer-events-none fill-text stroke-surface font-semibold"
                      style={{ paintOrder: 'stroke', strokeWidth: r(3), strokeLinejoin: 'round' }}
                    >
                      {place.name}
                    </text>
                  );
                })()}
              </g>
            );
          })}
        </g>
      </svg>

      {/* ZOOM, top left: big enough to tap, out of the way of the cards. */}
      <div className="absolute left-2 top-2 flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <Button size="icon" className="rounded-none border-0 p-2" aria-label="Zoom in" title="Zoom in" disabled={!pz.canZoomIn} onClick={pz.zoomIn}>
          <PlusIcon width={16} height={16} />
        </Button>
        <span className="h-px bg-border" aria-hidden="true" />
        <Button size="icon" className="rounded-none border-0 p-2" aria-label="Zoom out" title="Zoom out" disabled={!pz.canZoomOut} onClick={pz.zoomOut}>
          <MinusIcon width={16} height={16} />
        </Button>
        <span className="h-px bg-border" aria-hidden="true" />
        <Button size="icon" className="rounded-none border-0 p-2" aria-label="Fit the whole map" title="Fit the whole map" onClick={pz.fit}>
          <FitIcon width={16} height={16} />
        </Button>
      </div>

      {/* OUTSIDE UK, pinned to the top right of the frame, over the North
          Sea: never on the land, never slid off the edge by the zoom. */}
      <div
        className="absolute right-2 top-2 max-w-[11rem] rounded-lg border border-dashed bg-surface/95 px-2.5 py-1.5 text-xs shadow-sm"
        style={{ borderColor: ABROAD_COLOR }}
      >
        <p className="font-semibold" style={{ color: ABROAD_COLOR }}>{abroadLabel}</p>
        {abroad.length === 0 && <p className="text-text-faint">Nobody</p>}
        {abroad.map((p) => (
          <button
            key={p.key}
            type="button"
            className="block min-h-0 w-full truncate rounded border-0 bg-transparent p-0 text-left text-text-muted hover:text-text"
            onClick={(e) => { e.stopPropagation(); setRegionFor(null); onPop(p.key); }}
          >
            {p.name} · {p.people} {p.people === 1 ? 'person' : 'people'}
          </button>
        ))}
      </div>

      {open && <Popover place={open} zones={zones} onClose={() => onPop(null)} />}
      {!open && regionZone && (
        <RegionPopover
          zone={regionZone}
          places={places}
          onRename={regionZone.id === abroadId ? null : (label) => onRename(regionZone.id, label)}
          onClose={() => setRegionFor(null)}
        />
      )}
    </div>
  );
}

/** Who is in a location, short: five lines, then "Show all". */
function Popover({ place, zones, onClose }) {
  const [all, setAll] = useState(false);
  useEffect(() => { setAll(false); }, [place.key]);
  const shown = all ? place.deals : place.deals.slice(0, SHOW_FIRST);
  const run = zones.find((z) => z.id === place.run);
  return (
    <div className="absolute inset-x-2 bottom-2 z-20 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg [animation:bulk-in_.2s_cubic-bezier(.22,1,.36,1)_both] md:inset-x-auto md:bottom-auto md:right-2 md:top-2 md:w-64" role="dialog" aria-label={`${place.name} deals`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-text">{place.name}</p>
          <p className="text-xs text-text-muted">
            {run ? run.label : 'Unassigned'}
            {place.areas?.length > 0 && ` · ${place.areas.slice(0, 3).join(', ')}`}
            {` · ${place.deals.length} ${place.deals.length === 1 ? 'deal' : 'deals'}`}
          </p>
        </div>
        <Button size="icon" className="shrink-0" aria-label="Close" onClick={onClose}>
          <CloseIcon width={16} height={16} />
        </Button>
      </div>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
        {shown.map((d, i) => (
          <li key={`${d.name}-${d.group}-${i}`} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate">
              {d.name} <span className="text-xs text-text-muted">{d.group}{d.method !== 'cash' ? ` · ${d.method}` : ''}</span>
            </span>
            <span className="shrink-0 text-xs tabular-nums">{money(d.currency, d.amount)}</span>
          </li>
        ))}
      </ul>
      {!all && place.deals.length > SHOW_FIRST && (
        <Button size="xs" variant="accent" className="mt-1.5" onClick={() => setAll(true)}>
          Show all {place.deals.length}
        </Button>
      )}
    </div>
  );
}

/**
 * Where each UK dot goes: its own postcode spot, or, with none, the middle
 * of the other locations on its run (the middle of the map if it is alone).
 * Outside UK and unassigned-without-a-spot live in the box and the tray.
 */
function placeSpots(places, zones, abroadId) {
  const centreOf = new Map();
  for (const z of zones) {
    const mine = places.filter((p) => p.run === z.id && p.lat != null);
    if (mine.length) {
      centreOf.set(z.id, {
        lat: mine.reduce((n, p) => n + p.lat, 0) / mine.length,
        lon: mine.reduce((n, p) => n + p.lon, 0) / mine.length,
      });
    }
  }
  return places
    .filter((p) => p.run !== abroadId)
    .map((p) => {
      const at = p.lat != null ? p : centreOf.get(p.run);
      if (!at) return null;
      const [x, y] = projectUk(at.lat, at.lon);
      return { place: p, x, y };
    })
    .filter(Boolean);
}
