import { useEffect, useMemo, useState } from 'react';
import Button from '../buttons/Button';
import ConfirmDialog from '../modals/ConfirmDialog';
import { confirm } from '../../configs/confirms.config';
import { DATE_FIELD_LABEL } from '../../helpers/dateNotices';
import { WarningIcon, InfoIcon, ChevronIcon } from '../icons';

/**
 * What will be wrong with this file, as ONE THIN LINE until asked.
 *
 * Collapsed by default. Three stacked amber banners in a modal that already
 * holds six controls pushed the count and Generate off the screen, so the
 * panel warning about the file was the reason nobody reached the file.
 */

// Above this many rows a bulk fix asks first. Six is a correction; eighty
// four is a decision one press away from a payment run.
const CONFIRM_ABOVE = 10;

/**
 * A SUGGESTION, NOT AN EDIT. One row, the dates it is missing, and Accept.
 *
 * The other scenarios edit one value, so they get a field. This one
 * proposes a whole patch: filling a missing appointment fills the payment
 * start and the end date with it, because both are worked out from it.
 *
 * FORWARD AND BACKWARD ARE NOT THE SAME OFFER and the row says which.
 * Forward restates his own formula, appointment + 90 and appointment + a
 * year. Backward INVENTS an appointment date from a payment date, and an
 * appointment is a real event: "the date of allocation, the day the person
 * was onboarded". That one is never applied by a rule, only accepted by a
 * person who knows.
 */
// The names of the three dates live in helpers/dateNotices.js, with the
// master sheet's own markers. They were written out twice and were going to
// drift the first time one of them was renamed.

function SuggestionRow({ row, busy, onAccept }) {
  const suggest = row.suggest;
  if (!suggest) return null;
  const invented = suggest.direction === 'backward';

  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs">
      <span className="truncate font-medium">{row.personName || '(no handler)'}</span>
      <span className="truncate text-text-muted">{row.company || '(no company)'}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {Object.entries(suggest.fields).map(([field, value]) => (
          <span key={field} className="tabular-nums text-text-muted">
            {DATE_FIELD_LABEL[field] ?? field} <span className="font-medium text-text">{value}</span>
          </span>
        ))}
        {/* WHERE THE DATE CAME FROM, and the verb is the whole message.
            "Based on" is his own formula restated. "Guessed from" is the
            CRM inventing an appointment date, which is a real day somebody
            was onboarded. Two different things to agree to. */}
        <span className={invented ? 'text-warning' : 'text-text-faint'}>
          {invented ? `Guessed from the ${suggest.from}` : `Based on the ${suggest.from}`}
        </span>
        <Button size="xs" variant="primary" disabled={busy} onClick={onAccept}>
          Accept
        </Button>
      </span>
    </div>
  );
}

function RowEditor({ row, input, busy, onSave }) {
  const [value, setValue] = useState(row.value ?? '');
  const dirty = String(value) !== String(row.value ?? '');

  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs">
      <span className="truncate font-medium">{row.personName || '(no handler)'}</span>
      <span className="truncate text-text-muted">{row.company || '(no company)'}</span>
      <span className="truncate text-text-faint">{row.roleLabel}</span>
      <input
        className="input-inline ml-auto h-6 w-24 shrink-0 text-xs"
        type={input === 'money' ? 'number' : 'text'}
        inputMode={input === 'money' ? 'decimal' : undefined}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && dirty) onSave(value); }}
      />
      <Button
        size="xs"
        variant={dirty ? 'primary' : 'quiet'}
        disabled={!dirty || busy}
        onClick={() => onSave(value)}
      >
        Save
      </Button>
    </div>
  );
}

/**
 * ===============================
 * * AN ACCEPTED ROW LEAVES THE LIST ON THE PRESS
 * ===============================
 * The write itself is already optimistic, but this panel is a reading of
 * `['export-count']`, a different query, so an accepted row sat there
 * looking unaccepted until a refetch landed and the header kept saying 8.
 *
 * Held HERE rather than by invalidating that query from the cell-edit hook:
 * that hook serves every inline cell on the master sheet, and refetching
 * the export count after each of those is work nobody asked for. The list
 * is this component's, so this component hides what was accepted.
 *
 * It is cleared whenever the server sends new warnings, which is the only
 * thing that can make these ids stale. A failed write puts the row back on
 * the next refresh and the error toast has already said so.
 */
function useAccepted(warnings) {
  const [done, setDone] = useState(() => new Set());
  useEffect(() => { setDone(new Set()); }, [warnings]);
  const accept = (ids) => setDone((prev) => new Set([...prev, ...ids]));
  return [done, accept];
}

// Forward restates his own formula. Backward INVENTS an appointment date,
// a real day somebody was onboarded, so it is never applied in bulk.
const isForward = (r) => r.suggest?.direction === 'forward';

export default function ExportWarnings({ warnings, busy, onBulkFix, onRowFix }) {
  const [open, setOpen] = useState(false);
  const [openKind, setOpenKind] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [accepting, setAccepting] = useState(null);
  const [done, markAccepted] = useAccepted(warnings);

  // Every count on the panel is of what is LEFT, so the header, the group
  // line and the two buttons cannot disagree about how many rows there are.
  const left = useMemo(() => (warnings ?? []).map((w) => {
    const remaining = (w.rows ?? []).filter((r) => !done.has(r.id));
    // A scenario with no per-row list (a bulk fix) has nothing to hide, so
    // its count stands as the server sent it.
    const count = w.rows?.length ? remaining.length : w.count;
    return { ...w, rows: remaining, count };
  }).filter((w) => w.count > 0), [warnings, done]);

  if (!warnings || warnings.length === 0 || left.length === 0) return null;

  const rows = left.reduce((n, w) => n + w.count, 0);
  // Amber only when somebody has to act. An info-only strip is context.
  const acts = left.some((w) => w.severity === 'warning');
  // How many of them are the MONEY ones. The rest change no figure, so the
  // header must not claim they do.
  const owed = left
    .filter((w) => w.severity === 'warning')
    .reduce((n, w) => n + w.count, 0);
  const tone = acts
    ? 'border-warning/25 bg-warning-tint'
    : 'border-border bg-surface-sunken';

  function runFix(w) {
    if (w.ids.length > CONFIRM_ABOVE) return setConfirming(w);
    onBulkFix(w);
  }

  // One optimistic row fix per row, because each carries its OWN patch:
  // filling an end date and filling a payment start are different writes.
  // The success toasts collapse on one key, so a run of twelve says
  // "Saved 12 changes" rather than stacking twelve toasts.
  function acceptRows(list) {
    list.forEach((r) => onRowFix({ id: r.id, fields: r.suggest.fields }));
    markAccepted(list.map((r) => r.id));
  }

  function runAcceptAll(w) {
    const forward = w.rows.filter(isForward);
    if (forward.length === 0) return undefined;
    if (forward.length > CONFIRM_ABOVE) {
      return setAccepting({ group: w.group, forward, skipped: w.rows.length - forward.length });
    }
    return acceptRows(forward);
  }

  return (
    <div className={`border text-xs ${tone}`}>
      {/* h-7 min-h-0, not padding: the base `button` rule sets min-h-10. */}
      <button
        type="button"
        aria-expanded={open}
        className="flex h-7 w-full min-h-0 items-center gap-1.5 border-transparent bg-transparent px-2 py-0 text-left text-xs hover:bg-black/[0.03]"
        onClick={() => setOpen((o) => !o)}
      >
        {acts
          ? <WarningIcon width={13} height={13} className="shrink-0 text-warning" />
          : <InfoIcon width={13} height={13} className="shrink-0 text-text-faint" />}
        <span className={`font-semibold tabular-nums ${acts ? 'text-warning' : 'text-text'}`}>{rows}</span>
        {/* NOT "rows affect this total" any more, because they do not all.
            A derivable date changes no figure, and once that scenario
            started listing not-started rows too it was the majority of the
            strip claiming to move money it never touches. The money half
            is named separately, and each line below still says its own
            consequence ("so they add £0", "are NOT in the total"). */}
        <span className="truncate text-text-muted">
          {rows === 1 ? 'row needs a look' : 'rows need a look'}
          {owed > 0 && `, ${owed} on this total`}
          {', in '}
          {left.length} {left.length === 1 ? 'way' : 'ways'}
        </span>
        <ChevronIcon
          width={12}
          height={12}
          className={`ml-auto shrink-0 text-text-faint transition-transform ${open ? '-rotate-90' : 'rotate-90'}`}
        />
      </button>

      {open && left.map((w) => {
        const key = `${w.kind}-${w.group}`;
        const rowsOpen = openKind === key;
        const warn = w.severity === 'warning';
        const forward = w.input === 'dates' ? w.rows.filter(isForward) : [];
        return (
          <div key={key} className="border-t border-black/[0.06]">
            <div className="flex items-center gap-1.5 px-2 py-1">
              {warn
                ? <WarningIcon width={12} height={12} className="shrink-0 text-warning" />
                : <InfoIcon width={12} height={12} className="shrink-0 text-text-faint" />}
              <span className="shrink-0 font-semibold uppercase tracking-wide text-text-faint">{w.group}</span>
              <span className="truncate text-text-muted">{w.text}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {w.fix && (
                  <Button size="xs" variant="primary" disabled={busy} onClick={() => runFix(w)}>
                    {w.fix.label}
                  </Button>
                )}
                {w.field && (
                  <Button size="xs" onClick={() => setOpenKind(rowsOpen ? null : key)}>
                    {/* A suggestion is not a fix, and the word decides
                        whether somebody reads the dates before accepting. */}
                    {rowsOpen ? 'Hide' : `${w.input === 'dates' ? 'Review' : 'Fix'} ${w.count}`}
                  </Button>
                )}
                {/* ONLY WHILE THE LIST IS OPEN. Writing a date onto eight
                    rows from a collapsed strip is a batch nobody has read;
                    Review opens it, and the button appears next to what it
                    is about to change.

                    FORWARD ONLY, and the count says how many that is. A
                    guessed appointment is a real onboarding day the CRM
                    worked backwards, so it never goes in a batch: those
                    rows keep their own Accept inside. */}
                {rowsOpen && forward.length > 0 && (
                  <Button size="xs" variant="primary" disabled={busy} onClick={() => runAcceptAll(w)}>
                    Accept {forward.length}
                  </Button>
                )}
              </span>
            </div>

            {rowsOpen && w.field && (
              <div className="max-h-[30vh] divide-y divide-border/60 overflow-y-auto border-t border-black/[0.06] bg-surface">
                {/* THE INDEX IS IN THE KEY ON PURPOSE. `id` alone silently
                    dropped a sibling whenever two rows carried the same one
                    (or none): React keeps the first and the list renders
                    fewer rows than the header counts, which is a panel
                    quietly lying about how much work is left. The list is
                    server-ordered and never reordered here, so the index is
                    stable for as long as the rows are. */}
                {w.rows.map((row, i) => (w.input === 'dates' ? (
                  <SuggestionRow
                    key={`${row.id}-${i}`}
                    row={row}
                    busy={busy}
                    onAccept={() => acceptRows([row])}
                  />
                ) : (
                  <RowEditor
                    key={`${row.id}-${i}`}
                    row={row}
                    input={w.input}
                    busy={busy}
                    onSave={(value) => onRowFix({ id: row.id, field: w.field, value })}
                  />
                )))}
              </div>
            )}
          </div>
        );
      })}

      {confirming && (
        <ConfirmDialog
          {...confirm.bulkFixFromExport({
            label: confirming.fix.label,
            count: confirming.ids.length,
            group: confirming.group,
          })}
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => { const w = confirming; setConfirming(null); onBulkFix(w); }}
        />
      )}

      {accepting && (
        <ConfirmDialog
          {...confirm.acceptAllDates({
            count: accepting.forward.length,
            group: accepting.group,
            skipped: accepting.skipped,
          })}
          busy={busy}
          onCancel={() => setAccepting(null)}
          onConfirm={() => { const a = accepting; setAccepting(null); acceptRows(a.forward); }}
        />
      )}
    </div>
  );
}
