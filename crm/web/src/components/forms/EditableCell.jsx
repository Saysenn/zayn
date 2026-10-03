import { useEffect, useRef, useState } from 'react';
import TruncatedText from '../display/TruncatedText';
import Select from './Select';

/**
 * One table cell that turns into an input on click.
 *
 * Deliberately not a modal: these are single-value corrections made
 * mid-review ("that payable amount is wrong"), and a dialog per cell would
 * make a pass over twenty rows unbearable.
 *
 * Lifted out of CalculatorPage.jsx, where it only served the calculator,
 * so the master sheet and all three calculator tabs share one
 * implementation. The behaviour it already had is kept exactly: click to
 * edit, Enter commits, Escape cancels, blur commits, and an unchanged
 * value never fires a request.
 */

// Money renders as "1,234.00 AED" and dates as "31 Dec 2024". Editing has
// to start from the RAW value or the first keystroke lands in the middle
// of formatting and corrupts it — you'd be typing into "1,234.00".
function toEditValue(raw, type) {
  if (raw === null || raw === undefined) return '';
  if (type === 'date') {
    // <input type="date"> accepts YYYY-MM-DD and nothing else. pg sends
    // an ISO timestamp; slicing is safer than new Date(), which shifts the
    // calendar day across timezones.
    const s = String(raw);
    const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s)?.[1];
    if (iso) return iso;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
  return String(raw);
}

/**
 * Checked BEFORE the optimistic write, never after.
 *
 * That ordering is the whole point: with optimistic UI an invalid value
 * would appear to save, sit there looking correct, then silently revert
 * when the server rejected it. Catching it here means it never appears to
 * have worked in the first place.
 */
// A `select` takes either plain strings ('cash', 'GBP' — the value IS the
// word you'd show) or { value, label } pairs, for a column stored as a slug
// that no admin should have to read as one ('not_received' -> 'Not
// received'). Normalized once here so validate/render never care which
// form the caller used.
// `disabled` carries through for a DERIVED value a human may not set: the
// payment period can read "not yet paying", which is true and must show,
// but is not one of the two an override writes.
function toOptions(options) {
  return (options ?? []).map((o) => (
    typeof o === 'object' && o !== null ? { value: String(o.value), label: o.label ?? String(o.value), disabled: Boolean(o.disabled) } : { value: String(o), label: String(o) }
  ));
}

function validate(value, type, options) {
  const v = String(value ?? '').trim();
  if (v === '') return null; // clearing a field is legitimate for every type here

  if (type === 'number') {
    if (!Number.isFinite(Number(v))) return 'must be a number';
    if (Number(v) < 0) return "can't be negative";
  }
  if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'must be a real date';
  if (type === 'select' && options) {
    const allowed = toOptions(options);
    if (!allowed.some((o) => o.value === v)) {
      return `must be one of ${allowed.map((o) => o.label).join(', ')}`;
    }
  }
  return null;
}

function coerce(value, type) {
  const v = String(value ?? '').trim();
  if (v === '') return type === 'number' ? 0 : null;
  return type === 'number' ? Number(v) : v;
}

export default function EditableCell({
  value,                 // the raw stored value
  type = 'text',         // 'text' | 'number' | 'date' | 'select' | 'suggest' | 'combo'
  options,               // for 'select' — a genuinely closed set, as plain
                         // strings or { value, label } pairs
  clearable = true,      // whether 'select' offers the blank option. TRUE for
                         // a column that can legitimately hold nothing, which
                         // is most of them. FALSE where the set is total and
                         // every row is always one of the options: offering a
                         // blank there is offering a choice the server
                         // refuses. Deal Status is the first of those.
  suggestions,           // for 'suggest' — hints, but any value is allowed
  editable = true,
  display,               // formatted string shown when not editing
  className = '',
  title,
  onSave,                // (coercedValue) => void — fires only on a real change
  onEditingChange,       // told when this cell opens/closes; the page uses it
                         // to hold off socket-driven refetches mid-edit
  as = 'td',             // 'div' when the page already owns the <td>: a td
                         // inside a td is invalid and React says so
}) {
  const Cell = as;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const cellRef = useRef(null);
  // Committing on blur while ALSO committing on Enter double-fires,
  // because Enter blurs the input on its way out.
  const committed = useRef(false);

  useEffect(() => {
    onEditingChange?.(editing);
    // Told once on unmount too, or a page navigated away from mid-edit
    // leaves refetching suppressed forever.
    return () => { if (editing) onEditingChange?.(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function start() {
    if (!editable) return;
    setDraft(toEditValue(value, type));
    setError(null);
    committed.current = false;
    setEditing(true);
  }

  function cancel() {
    committed.current = true;
    setError(null);
    setEditing(false);
  }

  function commitValue(next) {
    if (committed.current) return;
    committed.current = true;
    setError(null);
    setEditing(false);
    if (String(value ?? '') !== String(next ?? '')) onSave?.(next);
  }

  function commit({ moveNext = false } = {}) {
    if (committed.current) return;

    const problem = validate(draft, type, options);
    if (problem) {
      // Stay open with the message rather than closing and reverting —
      // the admin's half-typed value is still there to fix.
      setError(problem);
      return;
    }

    committed.current = true;
    setEditing(false);

    const next = coerce(draft, type);
    // Compared as strings so 7000 and "7000" don't count as a change, and
    // an untouched cell never fires a needless request.
    if (String(value ?? '') !== String(next ?? '')) onSave?.(next);

    if (moveNext) focusNextCell(cellRef.current);
  }

  if (editing) {
    const shared = {
      autoFocus: true,
      className: `input-inline w-full min-w-20 ${error ? '!border-danger' : ''}`,
      value: draft,
      onChange: (e) => { setDraft(e.target.value); setError(null); },
      onBlur: () => commit(),
      onKeyDown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        if (e.key === 'Tab') { e.preventDefault(); commit({ moveNext: true }); }
      },
      'aria-label': title || 'Edit value',
      'aria-invalid': Boolean(error),
    };

    // A datalist id has to be unique on the page, but the list itself is
    // identical for every cell in the column — so it's keyed by content
    // rather than by row, and the browser reuses the same one.
    const listId = type === 'suggest' && suggestions?.length
      ? `suggest-${suggestions.length}-${suggestions[0]}`
      : undefined;

    return (
      // className carries through to the EDITING state too. Without it a
      // sticky column lost its `position: sticky` the moment a cell was
      // opened, so the cell jumped out of the frozen block mid-keystroke.
      <Cell className={`td ${className}`} ref={cellRef}>
        {/* 'combo' is a real dropdown that also accepts a new value.
            'suggest' used a native <input list=…> datalist, which only
            filters as you type and shows nothing at all on click in
            Chrome and Edge — which is why the group cell looked empty. */}
        {/* 'multi' is the company cell: several companies in ONE cell,
            comma separated, exactly as the real sheet writes
            "SG, CKA, CKU, Umbrella co". It commits on close rather than on
            every pick, because picking four companies would otherwise be
            four saves and four toasts.

            Group and role deliberately do NOT get this. Several groups is
            several ROWS in this sheet, not one comma-joined cell, and a
            cell edit that silently created rows is the wrong place for
            that: the row editor asks first and says how many. */}
        {type === 'multi' ? (
          <Select
            size="sm"
            autoOpen
            searchable
            allowCustom
            multiple
            value={String(draft ?? '').split(',').map((s) => s.trim()).filter(Boolean)}
            options={suggestions ?? options ?? []}
            placeholder="Pick or type"
            onChange={(list) => setDraft(list.join(', '))}
            onOpenChange={(isOpen) => { if (!isOpen) commitValue(draft); }}
          />
        ) : type === 'combo' ? (
          <Select
            size="sm"
            autoOpen
            searchable
            allowCustom
            value={draft}
            options={suggestions ?? options ?? []}
            placeholder="Pick or type"
            onChange={commitValue}
            onOpenChange={(isOpen) => { if (!isOpen && !committed.current) cancel(); }}
          />
        ) : type === 'select' ? (
          <select {...shared}>
            {clearable && <option value="">—</option>}
            {toOptions(options).map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
            ))}
          </select>
        ) : (
          <>
            <input
              type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
              list={listId}
              {...shared}
            />
            {/* Suggestions, not a whitelist. The set of groups is whatever
                is in the data today, and a brand new one has to be
                typeable — a <select> would make the first row of a new
                group impossible to enter. */}
            {listId && (
              <datalist id={listId}>
                {suggestions.map((s) => <option key={s} value={s} />)}
              </datalist>
            )}
          </>
        )}
        {error && <p className="text-[0.65rem] text-danger m-0 mt-0.5 leading-tight">{error}</p>}
      </Cell>
    );
  }

  return (
    <Cell
      ref={cellRef}
      data-editable-cell={editable ? 'true' : undefined}
      className={`td ${className} ${editable ? 'cursor-text hover:bg-accent-tint/40' : ''}`}
      title={title}
      // Stopped, because the row itself is clickable — it opens the
      // full-row editor. Without this, clicking a cell would start an
      // inline edit AND throw a modal over the top of it.
      onClick={(e) => { if (editable) e.stopPropagation(); start(); }}
      // Reachable and operable without a mouse, since the whole cell is
      // the control rather than a button inside it.
      tabIndex={editable ? 0 : undefined}
      role={editable ? 'button' : undefined}
      onKeyDown={editable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); }
      } : undefined}
    >
      {/* Every cell truncates and reveals on hover, rather than each
          column opting in. A long company, a long note and a long bank
          detail are the same problem, and a per-column list would be one
          more thing to forget when a column is added.

          `display` is passed through untouched when it is an element: a
          badge, a switch or a flag is not text to truncate, and wrapping
          one would break its layout. Only real text is measured. */}
      {display !== undefined && display !== null ? (
        typeof display === 'string' ? <TruncatedText>{display}</TruncatedText> : display
      ) : (value ?? '') === '' ? (
        '—'
      ) : (
        <TruncatedText>{String(value)}</TruncatedText>
      )}
    </Cell>
  );
}

// Tab moves along the row, then wraps to the next row's first editable
// cell — the order someone correcting a sheet actually works in.
function focusNextCell(cell) {
  if (!cell) return;
  const all = Array.from(document.querySelectorAll('[data-editable-cell="true"]'));
  const next = all[all.indexOf(cell) + 1];
  next?.click();
}
