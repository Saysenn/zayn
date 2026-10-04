import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { useNotifications } from '../../hooks/useNotifications';
import { useMasterSheetCellEdit } from '../../hooks/useMasterSheet';
import {
  UK_COAST, UK_CITIES, projectUk, MAP_W, MAP_H,
} from './ukMap';

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
const placeKeyOf = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const SYMBOL = { GBP: '£', EURO: '€', EUR: '€' };
const money = (cur, n) => `${SYMBOL[cur] ?? `${cur} `}${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;

export default function DriversPanel({ group, onBlockingChange }) {
  const queryKey = ['export-drivers', group];
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  const { data, isLoading, isError } = useQuery({
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
  const rename = useMutation({
    mutationFn: (nextRuns) => apiService.exports.saveDrivers({ runs: nextRuns }),
    onError: (err) => notify({ level: 'error', message: "Couldn't rename that run", detail: err.message }),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
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

  if (isLoading) return <p className="text-sm text-text-muted">Loading the locations…</p>;
  if (isError) return <p className="text-sm text-danger">Couldn't load the locations. Close and open Export again.</p>;

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
            places={places.filter((p) => p.run === z.id)}
            zones={zones}
            onDrop={(key) => { const p = places.find((x) => x.key === key); if (p) move(p, z.id); }}
            onMove={move}
            onOpen={setPopFor}
          />
        ))}
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
        {/* SAID, so nobody wonders whether a move stuck. */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="text-text-muted" role="status" aria-live="polite">
            {save.isPending ? 'Saving…' : save.isError ? 'Not saved: try that move again.' : 'Every move is saved for everyone as you make it.'}
          </p>
          {confirmReset ? (
            <span className="flex items-center gap-2">
              <span className="text-text-muted">Put every location back as the sheet had it?</span>
              <button type="button" onClick={() => reset.mutate()} disabled={reset.isPending} className="min-h-0 rounded border border-danger bg-danger px-2 py-0.5 font-semibold text-white">
                {reset.isPending ? 'Resetting…' : 'Reset'}
              </button>
              <button type="button" onClick={() => setConfirmReset(false)} className="min-h-0 rounded border border-border bg-surface px-2 py-0.5 text-text">
                Keep
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmReset(true)} className="min-h-0 border-0 bg-transparent p-0 font-semibold text-accent-strong underline shadow-none">
              Reset to the sheet's defaults
            </button>
          )}
        </div>
        {checks.length > 0 && (
          <div className="rounded-lg border border-border px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Before export</p>
            <ul className="mt-1 space-y-2 text-sm">
              {checks.map((c) => (
                <li key={c.kind}>
                  <p className={c.blocking ? 'text-danger' : 'text-text'}>{c.text}</p>
                  {c.hint && <p className="text-xs text-text-muted">{c.hint}</p>}
                  {c.items?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.items.map((item) => (
                        <label key={item.id} className="flex items-center gap-1 rounded border border-border px-1.5 py-px text-xs">
                          <span className="text-text">{item.name}</span>
                          <select
                            aria-label={`Set the location for ${item.name}`}
                            defaultValue=""
                            disabled={rowEdit.isPending}
                            onChange={(e) => { if (e.target.value) setLocation(item, e.target.value); }}
                            className="min-h-0 rounded-sm border-0 bg-transparent p-0 text-xs text-accent-strong"
                          >
                            <option value="">Set location…</option>
                            {places
                              .filter((p) => p.key !== placeKeyOf(item.current))
                              .sort((a, b) => (a.key === item.suggest ? -1 : b.key === item.suggest ? 1 : 0))
                              .map((p) => (
                                <option key={p.key} value={p.name}>{p.name}{p.key === item.suggest ? ' (suggested)' : ''}</option>
                              ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** One run (or Unassigned): a drop target holding its location chips. */
function Zone({ zone, places, zones, hint, onDrop, onMove, onOpen, onRename, hideWhenEmpty = false }) {
  const [over, setOver] = useState(false);
  if (hideWhenEmpty && places.length === 0) return null;
  const people = places.reduce((n, p) => n + p.people, 0);
  return (
    <section
      aria-label={zone.label}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDrop(e.dataTransfer.getData('text/plain')); }}
      className={`rounded-md border px-2.5 py-1.5 transition-colors ${over ? 'bg-surface-sunken' : 'border-border'}`}
      style={{ borderColor: over ? zone.color : undefined }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: zone.color }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: zone.color }} aria-hidden="true" />
          {onRename ? <RunName label={zone.label} color={zone.color} onRename={onRename} /> : zone.label}
        </h3>
        <span className="text-[11px] tabular-nums text-text-faint">{people} ppl</span>
      </div>
      {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
      <div className="mt-1 flex flex-wrap gap-1">
        {places.length === 0 && <span className="text-[11px] text-text-faint">Drop a location here</span>}
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
        className={`min-h-0 border-0 bg-transparent p-0 font-semibold shadow-none hover:underline ${className}`}
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

/** What a region is: its run, how many places and people, and its name to change. */
function RegionPopover({ zone, places, onRename, onClose }) {
  const mine = places.filter((p) => p.run === zone.id);
  const people = mine.reduce((n, p) => n + p.people, 0);
  return (
    <div className="absolute right-2 top-2 z-10 w-60 max-w-[calc(100%-1rem)] rounded-lg border border-border bg-surface p-3 text-sm shadow-lg" role="dialog" aria-label={`${zone.label} region`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: zone.color }} aria-hidden="true" />
            {onRename ? <RunName label={zone.label} color={zone.color} onRename={onRename} /> : <span className="font-semibold" style={{ color: zone.color }}>{zone.label}</span>}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">{mine.length} {mine.length === 1 ? 'place' : 'places'} · {people} ppl</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="min-h-0 border-0 bg-transparent px-1 text-base leading-none text-text-muted shadow-none hover:text-text">×</button>
      </div>
      <p className="mt-2 text-xs text-text">{mine.map((p) => p.name).join(', ') || 'No places yet'}</p>
      {onRename && <p className="mt-1 text-[11px] text-text-faint">Click the name to rename it.</p>}
    </div>
  );
}

/** A location you can drag, or move with its dropdown. */
function Chip({ place, zones, onMove, onOpen }) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', place.key); e.dataTransfer.effectAllowed = 'move'; }}
      className="relative flex cursor-grab items-center gap-1 rounded border border-border bg-surface-sunken py-px pl-1.5 pr-0.5 text-xs active:cursor-grabbing"
    >
      <button type="button" className="min-h-0 border-0 bg-transparent p-0 font-medium text-text shadow-none hover:underline" onClick={() => onOpen(place.key)}>
        {place.name}
      </button>
      <span className="tabular-nums text-text-faint">{place.people}</span>
      {place.suggest && !place.run && (
        <span className="rounded-sm bg-warning-tint px-1 text-[10px] font-semibold uppercase text-warning-strong">
          {place.suggest === 'abroad' ? 'abroad?' : 'UK?'}
        </span>
      )}
      {/* THE MOVE MENU, as a small ▾: the box it sits in already says the
          run, so spelling it again on every chip was noise. */}
      <span className="pointer-events-none px-0.5 text-[10px] text-text-muted" aria-hidden="true">▾</span>
      <select
        aria-label={`Move ${place.name} to another run`}
        title="Move to another run"
        value={place.run ?? ''}
        onChange={(e) => onMove(place, e.target.value || null)}
        className="absolute inset-y-0 right-0 min-h-0 w-4 cursor-pointer appearance-none border-0 bg-transparent p-0 text-transparent"
      >
        <option value="">Unassigned</option>
        {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
      </select>
    </div>
  );
}

/**
 * THE MAP: each location by its postcodes, coloured by its run. A location
 * with no UK postcode sits at its run's centre; Outside UK is a box off the
 * coast. Clicking a dot (or a chip's name) shows who is in it, short.
 */
function UkMap({ places, zones, colorOf, abroadId, abroadLabel, popFor, onPop, onRename }) {
  const [regionFor, setRegionFor] = useState(null);
  const wrap = useRef(null);
  const spots = useMemo(() => placeSpots(places, zones, abroadId), [places, zones, abroadId]);
  // THE REGIONS: the land shaded by the run of its nearest location.
  const regions = useMemo(() => regionCells(spots, colorOf), [spots, colorOf]);
  const regionZone = zones.find((z) => z.id === regionFor);
  const abroad = places.filter((p) => p.run === abroadId);
  const open = places.find((p) => p.key === popFor);

  useEffect(() => {
    if (!popFor) return undefined;
    // ESC CLOSES THE POPOVER, NOT THE DIALOG: caught first and kept from the
    // modal, which also closes on Esc.
    const close = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onPop(null);
    };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [popFor, onPop]);

  return (
    <div ref={wrap} className="relative min-w-0 self-start rounded-lg border border-border bg-surface-sunken p-2 md:sticky md:top-0">
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="block h-auto w-full" role="img" aria-label="UK map of the locations by run" onClick={() => { onPop(null); setRegionFor(null); }}>
        <defs>
          <clipPath id="uk-land"><path d={UK_COAST} /></clipPath>
        </defs>
        <path d={UK_COAST} className="fill-surface" />
        {/* Faded as ONE layer, so where two rows overlap there is no darker line. */}
        <g clipPath="url(#uk-land)" opacity="0.2" shapeRendering="crispEdges" className="cursor-pointer">
          {regions.map((r) => (
            <rect
              key={`${r.x}-${r.y}`}
              x={r.x}
              y={r.y}
              width={r.w}
              height={CELL + 0.5}
              fill={r.color}
              onClick={(e) => { e.stopPropagation(); onPop(null); setRegionFor(r.run); }}
            />
          ))}
        </g>
        <path d={UK_COAST} fill="none" className="stroke-border" strokeWidth="1.2" strokeLinejoin="round" />
        {UK_CITIES.map((c) => {
          const [x, y] = projectUk(c.lat, c.lon);
          // A city right under a location's own label is left out, not overlapped.
          if (spots.some((s) => Math.abs(s.x - x) < 40 && Math.abs(s.y - y) < 12)) return null;
          return (
            <g key={c.name} className="pointer-events-none">
              <circle cx={x} cy={y} r="1.6" className="fill-text-faint" />
              <text x={x + 4} y={y - 3} className="fill-text-faint text-[9px] italic">{c.name}</text>
            </g>
          );
        })}
        {spots.map(({ place, x, y }) => (
          <g key={place.key}>
            <g
              role="button"
              tabIndex={0}
              aria-label={`${place.name}: who is in it`}
              className="cursor-pointer outline-none"
              onClick={(e) => { e.stopPropagation(); onPop(place.key); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPop(place.key); } }}
            >
              <circle cx={x} cy={y} r="12" fill="transparent" />
              <circle cx={x} cy={y} r={3 + Math.sqrt(place.deals.length) * 0.6} fill={colorOf(place.run)} className="stroke-surface" strokeWidth="1.5" />
            </g>
            <text x={x + 9} y={y + 3} className="pointer-events-none fill-text text-[10.5px] font-semibold" style={{ paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 3 }}>{place.name}</text>
          </g>
        ))}
        <g>
          <rect x="12" y={MAP_H - 30 - abroad.length * 15} width="138" height={22 + abroad.length * 15} rx="6" className="fill-surface" stroke={ABROAD_COLOR} strokeDasharray="4 3" />
          <text x="22" y={MAP_H - 14 - abroad.length * 15} className="text-[10.5px] font-semibold" fill={ABROAD_COLOR}>{abroadLabel}</text>
          {abroad.map((p, i) => (
            <text
              key={p.key}
              x="22"
              y={MAP_H - 1 - (abroad.length - 1 - i) * 15 - 12}
              role="button"
              tabIndex={0}
              className="cursor-pointer fill-text-muted text-[10px]"
              onClick={(e) => { e.stopPropagation(); onPop(p.key); }}
              onKeyDown={(e) => { if (e.key === 'Enter') onPop(p.key); }}
            >
              {p.name} · {p.people} ppl
            </text>
          ))}
        </g>
      </svg>
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
    <div className="absolute right-2 top-2 z-10 w-64 max-w-[calc(100%-1rem)] rounded-lg border border-border bg-surface p-3 text-sm shadow-lg" role="dialog" aria-label={`${place.name} deals`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-text">{place.name}</p>
          <p className="text-xs text-text-muted">
            {run ? run.label : 'Unassigned'}
            {place.areas?.length > 0 && ` · ${place.areas.slice(0, 3).join(', ')}`}
            {` · ${place.deals.length} ${place.deals.length === 1 ? 'deal' : 'deals'}`}
          </p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="min-h-0 border-0 bg-transparent px-1 text-base leading-none text-text-muted shadow-none hover:text-text">×</button>
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
        <button type="button" onClick={() => setAll(true)} className="mt-1.5 min-h-0 border-0 bg-transparent p-0 text-xs font-semibold text-accent-strong underline shadow-none">
          Show all {place.deals.length}
        </button>
      )}
    </div>
  );
}

/**
 * ===============================
 * * THE REGIONS, coloured by run
 * ===============================
 * Every bit of land takes the colour of the run of its NEAREST location, so
 * the map reads as areas (the Midlands and the north east are the North
 * run, the south east is the South run) rather than as dots. Drawn as
 * small cells, joined along each row, under a clip to the coast.
 */
const CELL = 3;
function regionCells(spots, colorOf) {
  if (spots.length === 0) return [];
  const out = [];
  for (let y = 0; y < MAP_H; y += CELL) {
    let run = null;
    for (let x = 0; x <= MAP_W; x += CELL) {
      let best = null;
      if (x < MAP_W) {
        let bestD = Infinity;
        for (const s of spots) {
          const d = (s.x - x - CELL / 2) ** 2 + (s.y - y - CELL / 2) ** 2;
          if (d < bestD) { bestD = d; best = s; }
        }
      }
      const color = best ? colorOf(best.place.run) : null;
      if (run && run.color === color) { run.w += CELL; continue; }
      if (run) out.push(run);
      run = color ? { x, y, w: CELL + 0.6, color, run: best.place.run } : null;
    }
    if (run) out.push(run);
  }
  return out;
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
