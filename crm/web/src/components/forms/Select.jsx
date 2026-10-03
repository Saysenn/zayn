import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SearchIcon, ChevronIcon, CheckCircleIcon } from '../icons';
import FloatingField from './FloatingField';

/**
 * The dropdown, for every form in the CRM.
 *
 * Replaces three different things that were all doing this badly: a native
 * <select> (can't search, can't be styled, and its popup ignores the
 * field's width), a bare <input list=…> datalist (browser-dependent, no
 * keyboard model, and Edge renders the popup wider than the input), and a
 * couple of hand-rolled menus.
 *
 * WHAT IT DOES THAT THE NATIVE ONES DON'T
 * - The panel is AT LEAST the width of the field, never narrower. Matching
 *   it exactly suits a form, and clipped every option to a few characters
 *   when the field was a 90px table cell. Options wrap rather than
 *   truncate: one you cannot read is one you cannot choose.
 * - `searchable` adds a filter box inside the panel. Turn it on for lists
 *   a human can't scan — 33 companies, 67 people, 21 roles. Leave it off
 *   for a closed set of three or four, where a search box is just one more
 *   thing to tab past.
 * - `multiple` selects several at once, which is how you assign one person
 *   to four companies without opening this dialog four times.
 * - `allowCustom` lets a value that isn't in the list through, and IMPLIES
 *   the search box, because typing is the only way to enter one. The
 *   company picker needs it (a genuinely new company has to be typeable);
 *   a payment-method picker must not have it.
 *
 * Keyboard: ↑ ↓ to move, Enter to pick, Escape to close, Tab to leave.
 * Type-ahead goes to the search box when there is one.
 */

// The preset rail's width, in pixels, in ONE place: it is both a class on
// the rail and a term in the panel's minimum width, and the two drifting
// apart is a list squeezed to a few characters.
const RAIL_W = 112;

function normalize(option) {
  return typeof option === 'string' ? { value: option, label: option } : option;
}

export default function Select({
  value,
  onChange,
  options = [],
  placeholder = 'Pick one',
  searchable = false,
  /**
   * WHOLE ANSWERS, as a fixed rail beside the options. Each is
   * { id, label, columns, method }, and clicking one REPLACES the value
   * rather than adding to it: it is an answer, not another tick.
   *
   * Served by whoever owns the options, never written here: a list of keys
   * living in this component would be a second place for them, and a key
   * that stopped matching would select nothing and say nothing.
   *
   * `onChange` gets the preset as a SECOND ARGUMENT when the rail fired
   * it, so an owner whose preset carries more than columns can apply the
   * rest. Every other caller ignores it, and a hand tick sends nothing.
   */
  presets = [],
  /**
   * Which preset's filter is currently applied, from the owner. A preset
   * that FILTERS is identified by its filter, not by its columns: untick
   * a column inside the Bank document and it is still the Bank document,
   * so the rail must stay lit or nothing on screen says the rows are
   * narrowed. Presets without one are still matched on columns.
   */
  activeMethod = null,
  multiple = false,
  allowCustom = false,
  disabled = false,
  emptyLabel = 'Nothing to pick from',
  className = '',
  id,
  // Opens on mount. For a field that only becomes a Select once you click
  // it — the inline editors on the person page — the click that revealed
  // it should also have opened it, not needed a second one.
  // 'md' matches a real <input> and is right inside a form. 'sm' matches
  // `input-inline`, which is what every filter control on the Master
  // Sheet page uses — so a filter row lines up with the filter icon
  // button beside it instead of towering over it.
  size = 'md',
  // Turns this into a floating-label field: the label sits where the
  // placeholder would and floats onto the top border once something is
  // picked. A filled dropdown reading "EURO" otherwise has nothing at all
  // saying it is the Currency. Omit it and the control is unchanged.
  label,
  required,
  // An info icon beside the floated label, words on hover and on click.
  // Only rendered when there is a label to hang it on.
  hint,
  autoOpen = false,
  // Fired whenever the panel opens or closes, INCLUDING when it closes
  // without a pick. An inline editor needs that: without it, clicking
  // away from an opened picker left the field sitting in edit mode
  // forever, while a plain text input beside it collapsed on blur.
  onOpenChange,
}) {
  const [open, setOpen] = useState(autoOpen);
  // Whole answers only make sense where a whole set can be set at once.
  const hasRail = multiple && presets.length > 0;
  // Where the portalled panel goes. Measured from the trigger, in viewport
  // coordinates, because the panel is rendered into <body> and knows
  // nothing about the field it belongs to.
  const [panelBox, setPanelBox] = useState(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const panelRef = useRef(null);
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  /**
   * Every path that opens or closes the panel goes through here, so the
   * callback can't be missed by a new one.
   *
   * THROUGH A REF, and that is not incidental. The outside-click effect
   * below has deps `[open]`, so its handler captures whatever
   * `onOpenChange` was current when the panel OPENED. A caller that
   * rebuilds the callback on every pick — the multi-select cell, which
   * closes over its own draft — then had its picks silently thrown away:
   * closing the panel called the very first closure, which still saw an
   * empty draft. The ref always holds the latest.
   */
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const setOpenAndReport = (next) => {
    setOpen((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      if (value !== prev) onOpenChangeRef.current?.(value);
      return value;
    });
  };

  /**
   * THE PANEL IS RENDERED INTO <body>, NOT INTO THE FIELD.
   *
   * Inside the field it was a child of the modal's scroll box, so a long
   * list was clipped at the modal's edge and the bottom options could not
   * be reached at all. Raising z-index does not help: clipping is
   * `overflow`, not stacking. A portal with fixed coordinates is outside
   * that box entirely, which is the same fix CellInfo already uses for
   * exactly the same reason.
   *
   * It also flips above the trigger when there is no room below, which is
   * the case that makes a picker near the bottom of a modal unusable.
   */
  useLayoutEffect(() => {
    if (!open || !rootRef.current) { setPanelBox(null); return undefined; }

    /**
     * AT LEAST WIDE ENOUGH TO READ, never merely as wide as the trigger.
     *
     * Matching the field exactly is right for a form, where the field is
     * already a sensible width. It is wrong for a narrow table cell: the
     * Role column is about 90px, so the panel was 90px and every option
     * was clipped to a few characters. The list has to be readable even
     * when the thing that opened it is not.
     *
     * So: the trigger's width is a FLOOR, not the answer. It grows to
     * MIN_W when the trigger is narrower, and is then pulled back on
     * screen if that would push it off the right edge.
     */
    // THE RAIL IS ADDED TO THE FLOOR, not taken out of it. Without this a
    // 224px panel gave the options 112px and clipped every one of them.
    const MIN_W = 224 + (hasRail ? RAIL_W : 0);
    const MAX_H = 288; // matches the list's own max-height below

    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;

      const width = Math.min(Math.max(r.width, MIN_W), window.innerWidth - 16);
      // Left-aligned with the field, unless that hangs it off the right.
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));

      const below = window.innerHeight - r.bottom;
      const flip = below < MAX_H && r.top > below;

      setPanelBox({
        left,
        width,
        top: flip ? undefined : r.bottom + 4,
        bottom: flip ? window.innerHeight - r.top + 4 : undefined,
        maxHeight: Math.max(160, (flip ? r.top : below) - 12),
      });
    };

    place();
    // A modal can scroll under an open panel, and the window can resize.
    // Capture phase so a scroll on any ancestor is seen, not just window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, hasRail]);

  const items = useMemo(() => options.map(normalize).filter(Boolean), [options]);
  const selected = multiple ? (Array.isArray(value) ? value : []) : value;

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const needle = query.trim().toLowerCase();
    return items.filter((o) => String(o.label).toLowerCase().includes(needle));
  }, [items, query]);

  // A typed value that matches nothing gets offered as itself, so the
  // company picker can accept a company nobody has entered before without
  // a separate "add new" affordance.
  const custom =
    allowCustom && query.trim() && !items.some((o) => o.label.toLowerCase() === query.trim().toLowerCase())
      ? { value: query.trim(), label: query.trim(), isCustom: true }
      : null;

  const visible = custom ? [custom, ...filtered] : filtered;

  // Close on a click anywhere else. Pointerdown rather than click so the
  // panel is gone before the other element's own handler runs.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      // The panel lives in <body> now, so "inside the field" is no longer
      // enough: a click on an option would otherwise close the panel
      // before the option's own handler ran.
      if (rootRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpenAndReport(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (open && (searchable || allowCustom)) searchRef.current?.focus();
    if (!open) {
      setQuery('');
      setActive(0);
    }
  }, [open, searchable, allowCustom]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function pick(option) {
    if (multiple) {
      const next = selected.includes(option.value)
        ? selected.filter((v) => v !== option.value)
        : [...selected, option.value];
      onChange(next);
      setQuery('');
      // Panel stays open: picking several is the whole point of multiple.
    } else {
      // Clicking the value that is already picked CLEARS it. Without this
      // there was no way back to "nothing selected" once anything had been
      // chosen: the only escape was reloading the form. Multi-select has
      // always toggled; single now matches it.
      onChange(option.value === value ? '' : option.value);
      setOpenAndReport(false);
    }
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setOpenAndReport(true);
      return;
    }
    if (!open) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      setOpenAndReport(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (visible[active]) pick(visible[active]);
    } else if (e.key === 'Tab') {
      setOpenAndReport(false);
    }
  }

  // The TEXT SHOWN on the trigger. Renamed off `label`, which is now the
  // floating-label prop.
  const shown = multiple
    ? selected.length === 0
      ? placeholder
      : selected.length === 1
        ? items.find((o) => o.value === selected[0])?.label ?? selected[0]
        : `${selected.length} selected`
    : (items.find((o) => o.value === value)?.label ?? value) || placeholder;

  const isPlaceholder = multiple ? selected.length === 0 : !value;

  const field = (
    // The open panel has to out-rank the table below it, and raising the
    // panel alone is not enough: `absolute` is resolved against this
    // element, so this is the box whose z-index the browser compares. It
    // only lifts while open, or every closed Select on the page would sit
    // above the table for no reason.
    <div ref={rootRef} className={`relative ${open ? 'z-40' : ''} ${label ? '' : className}`}>
      <button
        type="button"
        id={fieldId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpenAndReport((o) => !o)}
        onKeyDown={onKeyDown}
        // THREE SIZES, EACH MATCHING SOMETHING.
        //   sm   `input-inline`, the Master Sheet filter row's height (32).
        //   form `.form-control`, every control inside a modal form (36).
        //        A form of 40px/16px controls reads as a settings page;
        //        36/14 is dense enough that eight fields still fit without
        //        the modal scrolling.
        //   md   a bare <input>'s own height (40), for controls that sit
        //        beside page content rather than inside a form.
        // An explicit h- on each, never padding alone: the base `input`
        // and `button` rules also set min-h, and which one wins depends on
        // Tailwind's generated source order rather than the class list.
        className={`w-full justify-between gap-2 border border-border-strong bg-surface text-left font-normal shadow-sm transition-shadow hover:shadow-md ${
          size === 'sm' ? 'h-8 min-h-0 px-2 py-0 text-sm'
            : size === 'form' ? 'h-9 min-h-0 px-2.5 py-0 text-sm'
              : size === 'detail' ? 'min-h-10 px-3 py-2 text-xs'
                : 'min-h-10 px-3 py-2 text-base'
        }`}
      >
        {/* Hidden only while a RESTING label is sitting on top of it, which
            is the label-without-placeholder case. A filter's placeholder is
            a real default ("All") and its label floats from the
            start, so there is nothing covering it and it stays visible. */}
        <span className={`truncate ${isPlaceholder ? 'text-text-faint' : ''} ${
          label && !placeholder && isPlaceholder && !open ? 'opacity-0' : ''
        }`}>{shown}</span>
        <ChevronIcon
          width={14}
          height={14}
          className={`shrink-0 text-text-faint transition-transform ${open ? '-rotate-90' : 'rotate-90'}`}
        />
      </button>

      {open && (
        // Exactly the trigger's width, measured rather than inherited now
        // that the panel is a child of <body>, so it still can never
        // overhang the field that opened it.
        createPortal(
        <div
          ref={panelRef}
          style={{
            left: panelBox?.left,
            width: panelBox?.width,
            top: panelBox?.top,
            bottom: panelBox?.bottom,
            maxHeight: panelBox?.maxHeight,
            // Hidden until measured, or it paints once at 0,0 first.
            visibility: panelBox ? 'visible' : 'hidden',
          }}
          // z-[55]: above a modal (50), because a picker inside a modal has
          // to clear it. Below the toaster (60).
          // text-text explicitly: portalled into <body>, so nothing about
          // the surface this was written on reaches it any more. Stating
          // the colour is what makes it readable wherever it is opened
          // from, including Diane's dark overlay.
          // Marks this as a panel that LIVES IN <body> but BELONGS to a
          // control elsewhere. useDismissable reads it, so opening this
          // dropdown inside a popover no longer counts as clicking outside
          // the popover and closing it.
          data-portal-panel=""
          className="fixed z-[55] overflow-auto rounded-lg border border-border-strong bg-surface text-text shadow-lg"
        >
          {/* ALLOWCUSTOM IMPLIES A TEXT BOX. Typing is the only way to
              enter a value that is not in the list, and this box is the
              only place to type: without it, a field like Phone number
              (which suggests "Handled internally" but must accept any
              number) offered the one suggestion and no way past it.
              Forced here rather than fixed per field, because every
              allowCustom field has the same problem. */}
          {(searchable || allowCustom) && (
            <div className="relative border-b border-border">
              <SearchIcon
                width={14}
                height={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint"
              />
              <input
                ref={searchRef}
                type="text"
                value={query}
                placeholder={allowCustom ? "Type to filter, or type a new one…" : "Type to filter…"}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                className="w-full min-h-0 border-0 bg-transparent py-2 pl-8 pr-2
                           text-[16px] text-text placeholder:text-text-muted sm:text-sm"
              />
            </div>
          )}

            <div className="flex min-h-0">
            {/* ===============================
                * A FIXED RAIL OF WHOLE ANSWERS, beside the options
                * ===============================
                His call 2026-09-22: he picks the same eleven columns out of
                twenty one, every month, to make the same four documents. The
                rail names those documents so one click is the answer.

                IT DOES NOT SCROLL WITH THE LIST. The options scroll behind
                it; the answers stay put, because they are what you came to
                the control for and hunting for them down a scrolled list is
                the thing this removes.

                MULTI SELECT ONLY, and only when a caller passes presets. It
                sets the whole value at once, which means nothing on a
                control that holds one. */}
            {hasRail && (
              <div
                style={{ width: RAIL_W }}
                className="shrink-0 space-y-0.5 border-r border-border bg-surface-sunken p-1"
              >
                {presets.map((preset) => {
                  // LIT WHEN IT IS WHAT YOU HAVE, so the rail says which
                  // document is on screen rather than only offering one.
                  // A filtering preset answers on its filter; an unfiltered
                  // one only while no filter is on, or Standard would light
                  // inside the Bank document the moment the columns matched.
                  const on = preset.method
                    ? preset.method === activeMethod
                    : !activeMethod
                      && preset.columns.length === selected.length
                      && preset.columns.every((k) => selected.includes(k));
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onChange(preset.columns, preset)}
                      className={`block w-full rounded px-2 py-1 text-left text-xs transition min-h-0 border-0
                        ${on
                          ? 'bg-accent-tint font-semibold text-accent-strong'
                          : 'bg-transparent text-text-muted hover:bg-surface'}`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            )}
            <ul ref={listRef} role="listbox" className="max-h-60 flex-1 overflow-y-auto p-1">
              {visible.length === 0 && (
                <li className="px-3 py-2 text-sm text-text-muted">{query ? 'No matches' : emptyLabel}</li>
              )}
              {visible.map((option, i) => {
                const isSelected = multiple ? selected.includes(option.value) : option.value === value;
                return (
                  <li key={`${option.value}-${i}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-active={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(option)}
                      // whitespace-normal and items-start override the base
                      // button rule in index.css, which forces nowrap and
                      // centring on every button in the app. Without both, a
                      // long option still refuses to wrap and the check icon
                      // sits vertically centred against a two line label.
                      // Rounded, and inset by the list's own padding, so the
                      // highlight is a pill inside the menu rather than a
                      // band running edge to edge across it.
                      className={`w-full min-h-0 items-start justify-between gap-2 whitespace-normal rounded-md border-0 px-3 py-2 text-left text-text ${
                        i === active ? 'bg-surface-sunken' : 'bg-transparent'
                      } ${size === 'detail' ? 'text-xs' : 'text-sm'} ${isSelected ? 'bg-accent-tint-strong font-semibold text-accent-strong' : ''}`}
                    >
                      {/* WRAPS, never truncates. The trigger truncates
                          because a cell has a fixed width, but an option you
                          cannot read is an option you cannot choose, and the
                          real sheet has companies 90 characters long. */}
                      <span className="min-w-0 break-words text-left">
                        {option.isCustom ? `Add "${option.label}"` : option.label}
                      </span>
                      {isSelected && <CheckCircleIcon width={14} height={14} className="shrink-0 text-accent" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {multiple && selected.length > 0 && (
            <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-surface px-3 py-2 text-xs">
              <span className="text-text-muted">{selected.length} selected</span>
              {/* Red and solid, not grey underlined text. This is the only
                  way out of a wrong multi-selection, and as muted text at
                  the bottom of a scrolling list it read as a caption and
                  went unnoticed. */}
              <button
                type="button"
                className="min-h-0 border border-transparent bg-danger-tint px-2 py-0.5 text-xs
                           font-semibold text-danger hover:bg-danger hover:text-white"
                onClick={() => onChange([])}
              >
                Clear all
              </button>
            </div>
          )}
        </div>,
        document.body,
      ))}
    </div>
  );

  // Unlabelled: exactly what this component always was.
  if (!label) return field;

  /**
   * TWO KINDS OF LABELLED SELECT, told apart by whether a placeholder was
   * given as well.
   *
   *   label, no placeholder — a form field. The label rests where a
   *     placeholder would and lifts onto the border once something is
   *     picked, so an empty field is not labelled twice.
   *
   *   label AND placeholder — a filter, where the placeholder is a
   *     meaningful default ("All" means no filter, not "empty").
   *     That text has to stay readable, so the label floats from the
   *     start and never covers it.
   */
  const alwaysFloat = Boolean(placeholder);

  return (
    <FloatingField
      label={label}
      required={required}
      hint={hint}
      filled={alwaysFloat || !isPlaceholder || open}
      className={className}
    >
      {field}
    </FloatingField>
  );
}

/**
 * A labelled form field. One label size, one gap, one required marker,
 * so every form in the CRM looks the same.
 *
 * It used to print a line of helper text under each input. That made
 * every form twice as tall and turned a six field dialog into an essay,
 * so the text is gone. Anything genuinely worth saying goes in the
 * placeholder, where it is read at the moment it matters.
 *
 * `hint` is still accepted and ignored, so a caller passing one is not a
 * crash. It renders nothing.
 */
export function Field({ label, required, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
