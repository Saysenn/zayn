import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Select from './Select';
import Button from '../buttons/Button';
import { ChevronIcon, CloseIcon, SearchIcon } from '../icons';

// ***************************************************
// * Pick several, and say how each one is meant
// ***************************************************

/**
 * A MULTI-PICK WITH A DETAIL SIDE. Tick as many as you like on the left;
 * the one you are on opens its details on the right (role, monthly amount,
 * group), so "A J Rayson as Director at 500, Competex pro as Mid 1" is one
 * pass through one dropdown rather than a row per company.
 *
 * The picks show as chips in the field, "A J Rayson · Director".
 *
 *   picks:    [{ value, label, roleLabel, monthlyAmount, groupName }]
 *   defaults: what a fresh pick starts with (the form's shared values)
 *
 * Esc and a click outside close only this panel, never the dialog behind
 * it, and a Select opened inside the side panel does not count as outside:
 * it lives in <body> and says so with data-portal-panel.
 */
export default function MultiPicker({
  label, options, picks, onChange, defaults = {}, roleOptions = [], groupOptions = [], placeholder = 'Search…',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [current, setCurrent] = useState(null);
  const [pos, setPos] = useState(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  // Bumped when the field itself moves (the dialog grows around it).
  const [pairsTick, setPairsTick] = useState(0);
  useEffect(() => {
    if (!open || !trigger.current) return undefined;
    let last = trigger.current.getBoundingClientRect().top;
    const ro = new ResizeObserver(() => {
      const top = trigger.current?.getBoundingClientRect().top;
      if (top != null && Math.abs(top - last) > 1) { last = top; setPairsTick((n) => n + 1); }
    });
    // The dialog body resizing is what moves the field.
    ro.observe(trigger.current.closest('[role="dialog"]') ?? document.body);
    return () => ro.disconnect();
  }, [open]);

  const picked = useMemo(() => new Map(picks.map((p) => [p.value, p])), [picks]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const focus = current && picked.get(current);

  function toggle(o) {
    if (picked.has(o.value)) {
      onChange(picks.filter((p) => p.value !== o.value));
      if (current === o.value) setCurrent(null);
      return;
    }
    onChange([...picks, { value: o.value, label: o.label, ...defaults }]);
    setCurrent(o.value);
  }
  const update = (value, key, v) => onChange(picks.map((p) => (p.value === value ? { ...p, [key]: v } : p)));

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const w = Math.min(560, window.innerWidth - 16);
    // WHICHEVER SIDE HAS MORE ROOM, and never taller than that room: on a
    // short window the panel ran off the bottom of the screen.
    const roomBelow = window.innerHeight - r.bottom - 14;
    const roomAbove = r.top - 14;
    const below = roomBelow >= 300 || roomBelow >= roomAbove;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
      width: w,
      maxHeight: Math.min(416, below ? roomBelow : roomAbove),
      ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }),
      transformOrigin: below ? 'top left' : 'bottom left',
    });
    // Re-measured as picks are added: the chips grow the field and the
    // dialog re-centres, and a panel left where it opened floats detached.
  }, [open, picks.length, pairsTick]);

  useEffect(() => {
    if (!open) return undefined;
    const inside = (t) => trigger.current?.contains(t) || panel.current?.contains(t)
      || t.closest?.('[data-portal-panel]');
    const onDown = (e) => { if (!inside(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // A Select open inside the side panel closes first, on its own.
      if (document.querySelector('[data-portal-panel]')) return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => { if (!open) setQ(''); }, [open]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute -top-2 left-2.5 z-[1] bg-surface px-1 text-xs font-semibold uppercase tracking-wide text-text-faint">
        {label} *
      </span>
      {/* The field: the picks as chips, and the way in. */}
      <div
        ref={trigger}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
        className={`flex min-h-[2.75rem] w-full cursor-pointer flex-wrap items-center gap-1.5 rounded border bg-surface px-2.5 py-2 text-sm transition-colors ${
          open ? 'border-accent-strong shadow-[0_0_0_3px_theme(colors.accent.tint-strong)]' : 'border-border hover:border-border-strong'
        }`}
      >
        {picks.length === 0 && <span className="text-text-faint">{placeholder}</span>}
        {picks.map((p) => (
          <span key={p.value} className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent-tint py-0.5 pl-2.5 pr-1 text-xs font-medium text-accent-strong">
            <span className="truncate">{p.label}{p.roleLabel ? ` · ${p.roleLabel}` : ''}</span>
            <button
              type="button"
              aria-label={`Remove ${p.label}`}
              onClick={(e) => { e.stopPropagation(); onChange(picks.filter((x) => x.value !== p.value)); }}
              className="grid h-4 w-4 min-h-0 place-items-center rounded-full border-0 bg-transparent p-0 text-accent-strong hover:bg-accent-tint-strong"
            >
              <CloseIcon width={10} height={10} />
            </button>
          </span>
        ))}
        <ChevronIcon width={14} height={14} className={`ml-auto shrink-0 text-text-muted transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
      </div>

      {open && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label={label}
          className="multi-pick"
          style={pos ?? { visibility: 'hidden' }}
        >
          <div className="border-b border-border p-2">
            <label className="flex items-center gap-2 rounded border border-border px-2.5">
              <SearchIcon width={15} height={15} className="text-text-faint" />
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                aria-label={`Search ${label.toLowerCase()}`}
                placeholder={placeholder}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-8 min-h-0 w-full border-0 bg-transparent p-0 text-sm shadow-none focus:shadow-none"
              />
            </label>
          </div>
          <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_15rem] md:overflow-hidden">
            {/* THE LIST: tick to pick, click a picked one to open its details. */}
            <ul className="max-h-64 min-h-0 overflow-y-auto p-1 md:max-h-none">
              {shown.length === 0 && <li className="px-3 py-2 text-xs text-text-faint">No match</li>}
              {shown.map((o) => {
                const on = picked.has(o.value);
                const here = current === o.value;
                return (
                  <li key={o.value}>
                    <div className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${here ? 'bg-accent-tint' : 'hover:bg-surface-sunken'}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(o)} aria-label={`Pick ${o.label}`} />
                      <button
                        type="button"
                        onClick={() => (on ? setCurrent(o.value) : toggle(o))}
                        className="min-h-0 flex-1 justify-start truncate border-0 bg-transparent p-0 text-left text-text"
                      >
                        {o.label}
                      </button>
                      {on && (
                        <span className="shrink-0 text-xs text-text-faint">{picked.get(o.value).roleLabel || 'no role'}</span>
                      )}
                      {on && <ChevronIcon width={12} height={12} className="shrink-0 text-text-faint" />}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* THE DETAIL SIDE: how the one you are on is meant. */}
            <div className="border-t border-border bg-surface-sunken/60 p-3 md:border-l md:border-t-0">
              {focus ? (
                <div className="space-y-3 [animation:pick-pop_.16s_cubic-bezier(.22,1,.36,1)_both]" key={focus.value}>
                  <p className="truncate text-xs font-semibold uppercase tracking-wide text-text-muted">{focus.label}</p>
                  <Select
                    size="form" searchable allowCustom
                    label="Role"
                    value={focus.roleLabel ?? ''}
                    onChange={(v) => update(focus.value, 'roleLabel', v ?? '')}
                    options={roleOptions}
                    placeholder="Pick or type"
                  />
                  <label className="block">
                    <span className="form-caption">Monthly</span>
                    <input
                      className="form-control mt-1 text-right tabular-nums" type="number" min="0" step="0.01"
                      value={focus.monthlyAmount ?? ''}
                      onChange={(e) => update(focus.value, 'monthlyAmount', e.target.value)}
                    />
                  </label>
                  <Select
                    size="form" searchable allowCustom
                    label="Group"
                    value={focus.groupName ?? ''}
                    onChange={(v) => update(focus.value, 'groupName', v ?? '')}
                    options={groupOptions}
                    placeholder=""
                  />
                  <Button size="xs" variant="quiet" onClick={() => toggle({ value: focus.value })}>
                    <CloseIcon width={12} height={12} />
                    Remove
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-text-muted">
                  Tick one to add it. Click a ticked one to set its role, amount and group.
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
            <span className="text-xs text-text-muted">{picks.length} picked</span>
            <Button size="sm" variant="primary" onClick={() => setOpen(false)}>Done</Button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
