import { useEffect, useMemo, useRef, useState } from 'react';
import CompanyTiersTab from './CompanyTiersTab';
import Modal from '../modals/Modal';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import CellInfo from '../display/CellInfo';
import { popup } from '../../configs/popups.config';
import ImportColumnsNote from './ImportColumnsNote';
import ConfirmDialog from '../modals/ConfirmDialog';
import { confirm } from '../../configs/confirms.config';
import { ImportIcon, ChevronIcon } from '../icons';
import { usePeopleFilters } from '../../hooks/usePeople';
import { unionOptions } from '../../helpers/optionList';

/**
 * WHAT THE FILE WOULD DO, before it does any of it.
 *
 * The upload used to be one act: parse, write, report. Everything it got
 * wrong was therefore found afterwards, on a table that had already
 * changed — a renamed column that wiped every end date, a one-group
 * extract that deleted ninety rows, a file with no Group column that
 * duplicated every deal it named. All three were visible in the data
 * before a single write.
 *
 * TWO WORDS ONLY: INCOMING and EXISTING. Incoming is what the file says,
 * existing is what the CRM holds. Every heading, every column and every
 * count on this screen is one or the other, because "current / new / not
 * in this file" was three vocabularies for two things and nobody could
 * tell which side of a comparison they were reading.
 *
 * ONLY WHAT MOVES IS SHOWN. On a normal month most of a sheet is identical
 * to what is stored — re-uploading master.xlsx unchanged gives 96 rows and
 * nothing to review — and a list of ninety unchanged rows is a list nobody
 * reads. Identical rows are a number.
 */

// The two kinds of change, kept apart on purpose. A sheet whose column
// exists but is mostly blank would otherwise turn Accept all into a mass
// wipe that reads like an ordinary batch of edits.
const CLEARED = 'cleared';

/**
 * NAMED FROM THE CRM'S POINT OF VIEW, not the file's.
 *
 * "In this file" and "Not in this file" describe the document. Standing on
 * the CRM looking at its own rows, the question is what the file's silence
 * MEANS: a row it does not mention is most often a deal that has ended,
 * and a row it does mention is one still running. Same two lists, named
 * for what the reader is deciding rather than for the file's contents.
 *
 * "Potentially ended" comes before "Similar". It answers the question an
 * upload actually raises — what does the CRM hold that this sheet has
 * stopped listing — and it is where somebody lands after reading the two
 * write tabs. Similar is the deliberate tool: upload a sheet of what has
 * ENDED and delete exactly those, which is a thing you go looking for
 * rather than something the file confronts you with.
 */
const TABS = [
  { key: 'changed', label: 'Existing to update' },
  { key: 'new', label: 'New incoming deals' },
  /**
   * POTENTIALLY, and the word is doing real work.
   *
   * These are the CRM's rows the file did not mention, and the commonest
   * reason for that is the deal being over. It is not the only one: a
   * partial sheet, a trimmed export or a renamed person all land here too,
   * which is exactly why the tab deletes nothing on its own.
   *
   * Red, alone among the four, because it is the only tab whose button
   * destroys something. The other three write or read.
   */
  { key: 'notInFile', label: 'Potentially ended deals', tone: 'danger' },
  // COMPANY STATUS SITS BEFORE Similar deals, when the file carries one.
  // The first four tabs are the upload's own decisions and this is a fifth;
  // Similar deals is a reading you go to last, so appending the tab that
  // writes something after it put a decision behind a reference.
  { key: 'companies', label: 'Active Companies', optional: true },
  /**
   * HIDDEN 2026-09-14, his call, and hidden rather than removed.
   *
   * The tab is a reading, not a decision: it deletes nothing on its own and
   * the file never writes through it. Everything behind it still works, so
   * dropping `hidden` brings it back with no other change.
   */
  { key: 'inFile', label: 'Similar deals', hidden: true },
];

// What a tab's select-all DOES. Only the first is an acceptance: the rest
// pick rows for something else, and "Accept all" over a list of deals you
// are about to delete reads as agreeing to the file.
const SELECT_LABELS = { on: 'Select all', off: 'Deselect all' };
const ACCEPT_LABELS = { on: 'Accept all', off: 'Reject all' };

// The two tabs that pick rows to delete. Both read only as far as the
// upload is concerned: the file writes nothing on either.
const DELETE_TABS = ['notInFile', 'inFile'];

/**
 * One column: what it is, what the CRM holds, what the file says.
 *
 * ONE HEADER ROW PER CARD, not per line. Two ticks facing each other only
 * read once the columns are named, and naming them on every line would be
 * EXISTING and INCOMING repeated twenty times down a list. The type still
 * carries the direction on its own — the losing value is struck through and
 * faint, the winning one is solid — so a card scrolled past its heading is
 * still readable.
 *
 * The headings sit over the TICK, not over the value. Indenting them past
 * the mark lined them up with the text and left the two ticks hanging
 * outside the columns they belong to.
 *
 * THREE COLUMNS FROM sm UP, STACKED BELOW IT. A phone modal is a bottom
 * sheet about 343px wide inside its padding: a label plus two value columns
 * leaves each value under 100px, and every date and company name truncates.
 * Stacked they are three short lines that all read.
 *
 * `minmax(0, 1fr)` on both value columns, not `1fr`. A grid track's minimum
 * is auto, so a long company name would push its column wider than its
 * share and shunt the other side out of alignment with every row above it.
 */
const ROW_GRID = 'flex flex-col gap-1 sm:grid sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-x-4 sm:gap-y-0';

// THE TICK'S FOOTPRINT, IN ONE PLACE, so a heading and the mark under it
// cannot drift apart when the mark changes size.
const TICK = 'h-4 w-4';

/**
 * THE INCOMING VALUE IS EDITABLE, when the column is one that can be set.
 *
 * This is the value somebody actually clicks: it is the one the file wants
 * to write, and the commonest correction there is is "no, not that, this"
 * across every row at once — a sheet whose preset still says last month.
 * It used to be plain text, so clicking it did nothing except tick the row.
 *
 * Editing here beats the file's own cell (see importDefaults.js) and comes
 * back through a fresh parse, so what you typed reappears as the incoming
 * value and still has to be accepted before anything is written.
 */
function CellRow({
  cell, editable, input = 'text', busy, keptHere, onChoose, onSaveRow, onApplyAll,
}) {
  const cleared = cell.kind === CLEARED;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cell.to ?? '');

  function commit(next) {
    const text = String(next ?? '').trim();
    setEditing(false);
    if (text === (cell.to ?? '')) return;
    onSaveRow(cell.column, text);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1 text-xs sm:grid sm:grid-cols-[7rem_1fr] sm:items-start sm:gap-2">
        <span className="truncate font-medium text-text-muted sm:pt-1.5">{cell.field}</span>
        <span className="flex flex-wrap items-center gap-2">
          <input
            // 'select' is not an input type. Group, currency and method are
            // pickers in the fill row below, but here they are typed: a
            // diff cell is correcting a value the file already carried, and
            // that value is as likely to be a new one as an existing one.
            type={input === 'select' ? 'text' : input}
            className="h-8 min-h-0 w-full px-2 py-0 text-sm sm:w-44"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(draft);
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          {/* onMouseDown, not onClick: blur fires first and would commit the
              row-only value, unmounting this before the click landed. */}
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !String(draft).trim()}
            onMouseDown={(e) => {
              e.preventDefault();
              setEditing(false);
              onApplyAll(cell.column, String(draft).trim());
            }}
          >
            Apply to all
          </Button>
        </span>
      </div>
    );
  }

  // WHICH SIDE IS WINNING. The parent owns it: the choice has to survive
  // this component unmounting when a filter or the column mask changes.
  const keep = Boolean(keptHere);

  return (
    <div className={`${ROW_GRID} py-0.5 text-xs`}>
      <span className="flex min-w-0 items-center gap-1 font-medium text-text-muted">
        <span className="truncate">{cell.field}</span>
        {/* WHY THE CRM DISAGREES WITH THE SHEET. Only on a field somebody
            typed in: it is the fact that turns "which of these two" into a
            decision they can actually make. */}
        {cell.byHand && <CellInfo {...popup.changedByHand(cell)} />}
      </span>

      {/* THE CURRENT VALUE, AND A WAY TO KEEP IT. Struck through only while
          it is losing: a value that is staying is not being removed, and
          showing it struck through said the opposite of what the tick
          beside it meant. */}
      <Side chosen={keep} onChoose={() => onChoose(cell.column, true)} label={`Keep the existing ${cell.field}`}>
        <span className={`block truncate ${keep ? 'font-semibold text-text' : 'text-text-faint line-through'}`}>
          {cell.from || 'empty'}
        </span>
      </Side>

      <Side chosen={!keep} onChoose={() => onChoose(cell.column, false)} label={`Take the incoming ${cell.field}`}>
        <span className={`flex min-w-0 items-center gap-1 ${!keep ? 'font-semibold' : 'text-text-faint'} ${cleared && !keep ? 'text-warning' : ''}`}>
          {editable ? (
            <button
              type="button"
              className="min-h-0 min-w-0 justify-start truncate border-0 border-b border-dashed border-border-strong bg-transparent p-0 text-left text-xs font-semibold hover:border-accent"
              onClick={() => { setDraft(cell.to ?? ''); setEditing(true); }}
            >
              {cell.to || 'empty'}
            </button>
          ) : <span className="truncate">{cell.to || 'empty'}</span>}
          {cleared && <CellInfo {...popup.clearingACell()} />}
        </span>
      </Side>
    </div>
  );
}

/**
 * ONE SIDE OF A COMPARISON, and the tick that picks it.
 *
 * A checkbox per cell would have asked "accept this?", which reads as one
 * question with a yes and a silence. Two ticks facing each other ask "which
 * of these two", which is the question actually being answered, and one of
 * them is always on so there is no state meaning nothing.
 *
 * The whole side is the target, not just the mark: a 14px circle is a hard
 * thing to hit twenty times down a list.
 */
function Side({ chosen, onChoose, label, children }) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      aria-label={label}
      onClick={onChoose}
      className="group flex min-h-0 w-full min-w-0 items-center justify-start gap-2 border-0 bg-transparent p-0 text-left text-xs"
    >
      <span
        aria-hidden
        className={`${TICK} flex shrink-0 items-center justify-center border-2 text-[10px] leading-none ${
          chosen
            ? 'border-accent bg-accent text-accent-ink'
            : 'border-text-faint bg-surface text-transparent group-hover:border-accent'
        }`}
      >
        ✓
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/**
 * ***************************************************
 * * Accept all, and the count that says where you are
 * ***************************************************
 *
 * A TRI-STATE CHECKBOX HERE, AND THE HOUSE RULE SAYS SO: a select-all is a
 * checkbox because it has an INDETERMINATE state, which is where you sit
 * most of the time and no button can express.
 *
 * THIS SCREEN IS THE EXCEPTION, and only because it now has ticks inside
 * every card choosing between two values. A third checkbox above them, with
 * a third meaning, was the confusing part rather than the count. The rows
 * lost theirs (see RowCard) and this follows them.
 *
 * WHAT REPLACES THE THIRD STATE IS THE COUNT, not a second button. "42 of
 * 69 accepted" says partial better than a half-filled box ever did, and the
 * one button flips to Reject all only when everything is in, so there is
 * never a pair to choose between.
 *
 * The Master Sheet's own bulk select keeps the checkbox. It has one level
 * of selection and no reason to change.
 */
function SelectAll({
  total, accepted, onChange, verb = 'accepted', labels = ACCEPT_LABELS,
}) {
  const all = total > 0 && accepted === total;

  return (
    <span className="flex items-center gap-2 whitespace-nowrap text-xs text-text-muted">
      <Button size="sm" variant={all ? 'danger' : 'primary'} onClick={() => onChange(!all)}>
        {all ? labels.off : labels.on}
      </Button>
      <span className="tabular-nums">{accepted} of {total} {verb}</span>
    </span>
  );
}

/**
 * A COLUMN THIS UPLOAD PUTS IN PLAY, and what to set it to.
 *
 * The row reads like any other, so the eye does not have to learn a second
 * shape: the field, what the CRM would otherwise get, and the value. The
 * difference is that the value is clickable.
 *
 * PER ROW, OR APPLIED TO ALL. Both are offered because both are real: a
 * preset still set to last month is wrong on every row and wants one value
 * across the lot, while a single company typed into one row is not.
 *
 * A TYPED VALUE BEATS THE FILE'S OWN CELL. It used to only fill a blank,
 * which meant the diff could not correct anything the sheet got wrong. It
 * is still safe because nothing is written unaccepted: the value comes back
 * through a fresh parse and lands in the diff as an ordinary change.
 *
 * `group_name` is the one that matters most and the reason this exists:
 * "August send for nexus Unpaid.xlsx" with no NEXUS deals left in the CRM
 * had nothing to match its own filename against, so six deals imported as
 * UNKNOWN and would have duplicated the moment NEXUS came back.
 */
function FillRow({ column, field, value, source, input, options, onSaveRow, onApplyAll, busy }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const boxRef = useRef(null);
  // THE DROPDOWN IS PORTALLED, so clicking an option moves focus to
  // <body> and not into this row. The blur handler below saw focus leave
  // and closed the editor before anything could be picked, which read as
  // the dropdown refusing to open at all. `onOpenChange` is what tells us
  // the panel is up, so a blur while it is can be ignored.
  const panelOpen = useRef(false);

  // NO SAVE BUTTON. Leaving the field saves it, the same as every editable
  // cell on the Master Sheet page: a Save beside a value you have already
  // typed is a second confirmation of a decision you clearly made, and the
  // one button left is the one that does something different.
  function commit(next) {
    const text = String(next ?? '').trim();
    if (text === (value ?? '')) return;
    onSaveRow(column, text);
  }

  if (!editing) {
    return (
      <div className={`${ROW_GRID} text-xs`}>
        <span className="truncate font-medium text-text-muted">{field}</span>
        <span className="truncate text-text-faint">
          {source === 'all' ? 'applied to all' : source === 'row' ? 'set on this row' : 'not in this file'}
        </span>
        <button
          type="button"
          className="min-h-0 justify-start border-0 border-b border-dashed border-border-strong bg-transparent p-0 text-left text-xs hover:border-accent"
          onClick={(e) => { e.preventDefault(); setDraft(value ?? ''); setEditing(true); }}
        >
          {value
            ? <span className="font-semibold text-accent-strong">{value}</span>
            : <span className="text-text-faint">–</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-xs sm:grid sm:grid-cols-[7rem_1fr] sm:items-start sm:gap-2">
      <span className="truncate font-medium text-text-muted sm:pt-1.5">{field}</span>
      {/* CLOSES ON LEAVING THE WHOLE THING, not on choosing a value.
          Picking from the dropdown used to close the editor, so Apply to
          all was gone before it could be pressed and the value had to be
          re-opened to reach it. `relatedTarget` is where focus went: still
          inside means the button, so it stays open. */}
      <span
        ref={boxRef}
        tabIndex={-1}
        className="flex flex-wrap items-center gap-2 outline-none"
        onBlur={(e) => {
          if (panelOpen.current) return;
          if (e.currentTarget.contains(e.relatedTarget)) return;
          setEditing(false);
          commit(draft);
        }}
      >
        {input === 'select' ? (
          <Select
            size="sm"
            className="w-full sm:w-44"
            // Focus comes back here when the panel closes, so the NEXT
            // click outside blurs this row and closes it. Without it the
            // row stays open forever after a pick, because focus is on
            // <body> and there is nothing left to blur.
            onOpenChange={(open) => {
              panelOpen.current = open;
              if (!open) boxRef.current?.focus();
            }}
            // A GROUP CAN BE TYPED, not only picked. The list is what the
            // CRM already has, and a sheet for a group it has never seen
            // is exactly the case this whole feature exists for: with no
            // NEXUS deals left, NEXUS was not on any list to pick.
            searchable={options.length > 6 || column === 'group_name'}
            allowCustom={column === 'group_name'}
            value={draft}
            onChange={(v) => { setDraft(v ?? ''); commit(v); }}
            options={options.map((o) => ({ value: o, label: o }))}
            placeholder="Pick or type"
          />
        ) : (
          <input
            // A real date picker for a date column, and it hands back
            // YYYY-MM-DD, which is exactly what the parser wants. Typing
            // one by hand was the only option and any other format was
            // silently dropped.
            type={input}
            className="h-8 min-h-0 w-full px-2 py-0 text-sm sm:w-44"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commit(draft); setEditing(false); }
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        )}
        {/* The only button, because it is the only thing leaving the field
            does not already do. `onMouseDown` rather than `onClick`: blur
            fires first and would commit the row-only value, then unmount
            this before the click ever landed. */}
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !String(draft).trim()}
          onMouseDown={(e) => {
            e.preventDefault();
            setEditing(false);
            onApplyAll(column, String(draft).trim());
          }}
        >
          Apply to all
        </Button>
      </span>
    </div>
  );
}

/**
 * THE LABEL COVERS THE NAME, NOT THE WHOLE CARD.
 *
 * It used to be a `<label>` wrapped around everything, so a click anywhere
 * inside the card toggled the checkbox — including on a value you were
 * trying to read or edit. Ticking a row and editing a cell in it are two
 * different acts and they cannot share one click target.
 *
 * So the label is the identity line only, which is the part that means
 * "this row". Everything below it — the changed cells, the fill controls —
 * is outside the label and clicks normally.
 */
/**
 * ***************************************************
 * * The CARD says whether it is in, not a checkbox
 * ***************************************************
 *
 * TWO LEVELS OF TICK ON ONE SCREEN IS ONE TOO MANY. Each changed field now
 * carries its own pair, and a third box on the card meant two marks with
 * two different meanings sitting inches apart: one choosing between two
 * values, one including a whole row. The row-level one loses, because the
 * card can say it without a control at all.
 *
 * IN is tinted and solid, OUT is drained. The header is the toggle, so the
 * target is a whole line rather than a 16px box.
 *
 * The heading stays a `button` and keeps `aria-pressed`, so the state is
 * still announced. Only the visible checkbox goes.
 */
function RowCard({ row, accepted, onToggle, children }) {
  return (
    <div
      className={`border p-3 transition-colors ${
        accepted
          ? 'border-accent/40 bg-accent-tint'
          : 'border-border bg-surface-sunken opacity-60'
      }`}
    >
      <button
        type="button"
        aria-pressed={accepted}
        onClick={onToggle}
        className="block min-h-0 w-full justify-start border-0 bg-transparent p-0 text-left text-sm font-semibold"
      >
        {row.personName || '(no handler)'}
        <span className="ml-2 font-normal text-text-muted">
          {row.company || '(no company)'} · {row.groupName} · {row.roleLabel}
        </span>
      </button>
      {children}
    </div>
  );
}

/**
 * "Is this file the whole sheet, or a slice of it?"
 *
 * One line, with the breakdown by group behind the icon. It was a tab
 * listing all ninety deals the file does not mention, none of which can be
 * acted on here: an upload deletes nothing, so there was nothing to decide
 * and the list only buried the diff.
 *
 * Still said out loud, because it is the signal that a one-group extract
 * is a one-group extract — the case that used to silently delete the other
 * ninety rows.
 */
function NotInFileNote({ rows }) {
  if (rows.length === 0) return null;
  // The sentence only. Which groups they are in used to sit behind an icon
  // here and is now the "Potentially ended deals" tab's own headings, and the same
  // fact in two places is the drift this codebase keeps paying for.
  return (
    <p className="text-text-muted">
      <span className="font-semibold">{rows.length}</span> existing{' '}
      {rows.length === 1 ? 'deal is' : 'deals are'} not in this file, all kept.
      See the <span className="font-semibold">Potentially ended deals</span> tab.
    </p>
  );
}

/**
 * The deals the CRM holds that this file never mentions.
 *
 * READ ONLY, and it says so once at the top rather than on every line. An
 * upload deletes nothing: a one-group extract used to remove every deal it
 * did not mention, which is the bug this whole two-step flow exists to stop.
 * Removing a finished deal is the admin's own act, on the table, in front of
 * a confirm that names what goes.
 *
 * ONE LINE PER DEAL, grouped by group. See TABS for why this is not the
 * RowCard the other two tabs use.
 */
function DeletableList({
  rows, note, group, onGroup, marked, onToggle, onToggleGroup, selectedCount, onDelete, deleting,
}) {
  const groups = useMemo(
    () => [...new Set(rows.map((r) => r.group_name || '(no group)'))].sort(),
    [rows],
  );

  const byGroup = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const g = row.group_name || '(no group)';
      if (group && g !== group) continue;
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(row);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rows, group]);

  return (
    <div className="space-y-3">
      {/* WHAT AN IMPORT DOES AND WHAT YOU ARE DOING, kept apart. The file
          still deletes nothing; pressing Delete is the admin deleting, and
          it happens on its own, before and independently of whatever the
          sheet is proposing. Said once at the top rather than on every
          line. */}
      <p className="bg-surface-sunken px-3 py-2 text-sm text-text-muted">{note}</p>

      {/* THE LIST'S OWN TOOLBAR: what you are looking at on the left, what
          you can do with it on the right. The action lived up in the tab
          strip, which put a destructive button in a row of navigation and
          nowhere near the checkboxes that fill it. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* One control, only once there is enough to hunt through. Below a
            handful of groups the list is already the filter. */}
        {groups.length > 1 && (
          <Select
            size="sm"
            searchable={groups.length > 8}
            className="w-full sm:w-56"
            value={group}
            onChange={onGroup}
            options={[{ value: '', label: `All (${rows.length})` },
              ...groups.map((g) => ({
                value: g,
                label: `${g} (${rows.filter((r) => (r.group_name || '(no group)') === g).length})`,
              }))]}
            placeholder="All"
          />
        )}
        {selectedCount > 0 && (
          <Button variant="danger" size="sm" className="ml-auto" disabled={deleting} onClick={onDelete}>
            {deleting ? 'Deleting…' : `Delete ${selectedCount} selected`}
          </Button>
        )}
      </div>

      {byGroup.map(([name, deals]) => {
        const ids = deals.map((d) => d.id).filter((id) => id != null);
        const on = ids.filter((id) => marked.has(id)).length;
        return (
          <div key={name} className="border border-border">
            {/* INSIDE the box and on the same px-2.5 as the rows. It sat
                outside with no padding, so its checkbox was eleven pixels
                left of every checkbox beneath it. */}
            <div className="flex items-center gap-2 border-b border-border bg-surface-sunken px-2.5 py-1.5">
              <SelectAll
                total={ids.length}
                accepted={on}
                verb="selected"
                labels={SELECT_LABELS}
                onChange={(checked) => onToggleGroup(ids, checked)}
              />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                {name} <span className="tabular-nums">({deals.length})</span>
              </span>
            </div>
            <div>
              {deals.map((d) => (
                <label
                  key={d.id ?? `${d.person_name}-${d.company}-${d.role_label}`}
                  className={`flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-sm last:border-b-0 ${
                    marked.has(d.id) ? 'bg-danger-tint' : ''
                  }`}
                >
                  {/* UNTICKED BY DEFAULT, unlike the other two tabs. There
                      the common case is agreeing with a newer file; here the
                      common case is a partial sheet, and the right answer is
                      to delete nothing. */}
                  <input
                    type="checkbox"
                    checked={marked.has(d.id)}
                    disabled={d.id == null}
                    onChange={() => onToggle(d.id)}
                  />
                  <span className="font-medium">{d.person_name || '(no handler)'}</span>
                  <span className="text-text-muted">{d.company || '(no company)'}</span>
                  <span className="ml-auto text-xs text-text-faint">{d.role_label}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// A default is only worth offering where the parser will honour it, and
// only where a value can be picked rather than typed. Everything else is
// free text, which is what a partial sheet's missing columns mostly are.
const FILL_OPTIONS = {
  payment_method: ['bank', 'cash', 'crypto'],
  currency: ['GBP', 'AED', 'EURO'],
};

/**
 * The control each column gets. A date column needs a date picker, not a
 * text box somebody has to spell YYYY-MM-DD into by hand: any other format
 * was dropped by the parser without a word, because `toDate` refuses
 * strings on purpose so a sheet cell reading "tbc" never becomes a date.
 */
const withValue = (options, value) => (
  value && !options.includes(value) ? [...options, value] : options
);

const FILL_INPUT = {
  group_name: 'select',
  currency: 'select',
  payment_method: 'select',
  assigned_on: 'date',
  payment_start_on: 'date',
  preset_on: 'date',
  end_on: 'date',
  monthly_amount: 'number',
};

// A column's name in words. The diff's own cells carry a label from the
// server, but a column the file does not have has no cell to carry one.
const FIELD_LABELS = {
  group_name: 'Group',
  company: 'Company',
  role_label: 'Role',
  assigned_on: 'Appointment date',
  payment_start_on: 'Payment start',
  preset_on: 'Preset date',
  end_on: 'End date',
  monthly_amount: 'Monthly amount',
  currency: 'Currency',
  payment_method: 'Method',
  location: 'Location',
  door_number: 'Door number',
  postcode: 'Postcode',
  phone: 'Phone',
  accepting_postals: 'Accepting postals',
  label: 'Label',
  should_be_paid: 'Should be paid',
  paid: 'Paid',
  notes: 'Notes',
  bank_details: 'Bank',
  account_number: 'Account number',
  sort_code: 'Sort code',
};

export default function ImportDiffModal({
  preview, onCancel, onCommit, onApplyDefaults, onDeleteRows, committing, rereading, deleting,
}) {
  const { diff, columns, rows, filename } = preview;
  // The currencies the deals actually carry, for a column the file left
  // out. Cached by React Query and already fetched by the page behind this
  // modal, so it costs no request. See fillOptionsFor.
  const { data: filterOptions } = usePeopleFilters();
  const changed = diff?.changed ?? [];
  const incoming = diff?.new ?? [];
  const notInFile = diff?.notInFile ?? [];
  const inFile = diff?.inFile ?? [];

  const [tab, setTab] = useState(changed.length > 0 ? 'changed' : 'new');
  // Accepted by default. The common case is a file that is simply newer
  // than the CRM, and making somebody tick ninety boxes to agree with it
  // would push them straight to Accept all without reading any of it.
  const [rejected, setRejected] = useState(() => new Set());
  // A SET, NOT ONE COLUMN. "Apply only the end dates" is a real ask and so
  // is "only the end dates and the amounts": a sheet is usually right about
  // two or three things and stale on the rest. This was a single column, so
  // picking a second silently dropped the first.
  const [columnMask, setColumnMask] = useState(() => new Set());

  /**
   * CELLS WHERE THE CRM'S VALUE WINS, as `syncKey:column`.
   *
   * Seeded from the diff, which marks a field somebody typed in: their
   * correction is not replaced by a file they have not read yet. Every
   * other cell defaults to the file, which is what an upload is for.
   *
   * Only the exceptions are held, so a fresh preview of the same file
   * cannot resurrect a choice about a cell that no longer differs.
   */
  const [kept, setKept] = useState(() => new Set());
  const keptRef = `${preview?.filename ?? ''}:${changed.length}`;
  useEffect(() => {
    setKept(new Set(
      changed.flatMap((r) => (r.cells ?? [])
        .filter((c) => c.keep)
        .map((c) => `${r.syncKey}:${c.column}`)),
    ));
    // Re-seeded per parse, not per render: a re-read after a fill must not
    // throw away choices, but a different file must not inherit them.
  }, [keptRef]);

  const choose = (syncKey, column, keep) => setKept((prev) => {
    const next = new Set(prev);
    const id = `${syncKey}:${column}`;
    if (keep) next.add(id); else next.delete(id);
    return next;
  });

  // Accepted company tiers. Local until Confirm: nothing here writes.
  const [tiers, setTiers] = useState([]);
  const companyDiff = preview?.companies ?? null;

  const counts = {
    changed: changed.length, new: incoming.length,
    notInFile: notInFile.length, inFile: inFile.length,
    companies: companyDiff?.actionable ?? 0,
  };

  // Every column that moves anywhere, so "take the end dates from this
  // file and nothing else" is reachable without hunting through rows.
  const movedColumns = useMemo(() => {
    const seen = new Map();
    for (const row of changed) {
      for (const cell of row.cells) {
        seen.set(cell.column, { field: cell.field, count: (seen.get(cell.column)?.count ?? 0) + 1 });
      }
    }
    return [...seen.entries()]
      .map(([column, v]) => ({ column, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [changed]);

  const clearedRows = changed.filter((r) => r.clearedCount > 0).length;

  /**
   * HOW MANY NOTES ARE FOLDED AWAY.
   *
   * Counted, not "Notes": the number is what tells you whether opening it
   * is worth a click. Every sentinel warning is its own line, which is what
   * made the block grow to nine rows on a real file and push the tabs below
   * the fold.
   */
  const [notesOpen, setNotesOpen] = useState(false);
  const noteCount = (diff?.unchanged > 0 ? 1 : 0)
    + (notInFile.length > 0 ? 1 : 0)
    + (clearedRows > 0 ? 1 : 0)
    + (preview.sentinelWarnings?.length ?? 0)
    + (preview.unknownColumns?.length > 0 ? 1 : 0)
    + (preview.untouchedColumns?.length > 0 ? 1 : 0)
    + (preview.groupFromName ? 1 : 0)
    + (preview.ungrouped ? 1 : 0);

  /**
   * OPTIMISTIC, because a re-parse is a round trip and the value has to
   * appear the moment it is typed.
   *
   * The server is still the authority: `applyDefaults` re-reads the whole
   * file, and when that lands `preview.defaults` replaces this. Until then
   * the local copy is what the rows render from, so nothing sits blank
   * while the file is read again.
   */
  const [pending, setPending] = useState(null);
  const defaults = pending?.defaults ?? preview.defaults ?? {};
  const overrides = pending?.overrides ?? preview.overrides ?? {};

  /**
   * CONFIRM NEVER WAITS AND NEVER GREYS OUT.
   *
   * It used to disable itself while the file was read again, so filling a
   * value in made the button flicker into "Reading again…" every time. The
   * re-read is the machinery, not the work, and it has no business
   * appearing in the one control somebody is trying to press.
   *
   * The hazard it was guarding is real though: type a value, go straight
   * for Confirm, and blur fires on mousedown while the click lands a
   * moment later, so Confirm would commit the rows from BEFORE the fill.
   * So the press is REMEMBERED instead of refused, and fires the moment
   * the fresh parse arrives. Same guarantee, no waiting.
   */
  const [commitOnArrival, setCommitOnArrival] = useState(false);

  // The columns worth offering to fill: ones the parser accepts a default
  // for, that this file does not carry. A column already filled in stays
  // on the list so the value can be changed or cleared.
  // A column filled on ANY row stays on the list. Without this it vanished
  // the moment it was filled: filling it makes it writable, writable means
  // it is no longer "untouched", and the row it was typed into disappeared
  // a second later when the server's answer replaced the optimistic copy.
  const filledSomewhere = new Set(Object.values(overrides).flatMap((f) => Object.keys(f)));
  /**
   * WHICH COLUMNS THE CARD LETS YOU SET.
   *
   * Was: only columns the file LEFT OUT. So on a full sheet like
   * master.xlsx, which carries all of them, there was nothing to edit at
   * all — and the commonest thing anybody wants to override is a value the
   * file DOES carry and got wrong, a preset still set to last month on
   * sixty rows being the standing example.
   *
   * Now: what the file LEFT OUT, still. A column the file DOES carry is
   * edited on its own diff cell instead — see CellRow — because listing it
   * here as well put "Preset date · not in this file · –" directly under
   * "presetOn 2026-08-01 → 2026-07-01", two rows for one column, and the
   * editable one was the one that looked dead.
   */
  const fillableColumns = (preview.defaultable ?? []).filter((c) => (
    (preview.untouchedColumns ?? []).includes(c)
    || defaults[c]
    || filledSomewhere.has(c)
  ));

  /**
   * ===============================
   * * A COLUMN THE FILE LEFT OUT IS FILLED FROM WHAT THE CRM ALREADY HAS
   * ===============================
   * Groups came from the data and currencies came from a list of three, so
   * a sheet arriving with no currency column could only be filled with GBP,
   * AED or EURO however many currencies the deals actually used. Both read
   * the data now; `FILL_OPTIONS` is the floor behind it, never the answer.
   */
  function fillOptionsFor(column) {
    if (column === 'group_name') return preview.knownGroups ?? [];
    if (column === 'currency') return unionOptions(filterOptions?.currencies, FILL_OPTIONS.currency);
    return FILL_OPTIONS[column] ?? [];
  }

  function fillableFor(row) {
    const own = overrides[row.uploadIndex] ?? {};
    return fillableColumns.map((c) => ({
      column: c,
      field: FIELD_LABELS[c] ?? c,
      // A value typed on this row beats the one applied to all, which is
      // the order the parser uses too.
      value: own[c] ?? defaults[c] ?? '',
      source: own[c] ? 'row' : (defaults[c] ? 'all' : null),
      input: FILL_INPUT[c] ?? 'text',
      // The current value is always in the list. A group typed in that the
      // CRM has never seen is not in `knownGroups`, and a Select whose
      // value is not among its options renders the placeholder instead:
      // the group would read as unset the moment it was set.
      options: withValue(fillOptionsFor(c), own[c] ?? defaults[c]),
    }));
  }

  function saveRow(index, column, value) {
    const next = { ...overrides, [index]: { ...(overrides[index] ?? {}) } };
    if (value) next[index][column] = value;
    else delete next[index][column];
    if (Object.keys(next[index]).length === 0) delete next[index];
    setPending({ defaults, overrides: next });
    onApplyDefaults({ defaults, overrides: next });
  }

  function applyAll(column, value) {
    const nextDefaults = { ...defaults };
    if (value) nextDefaults[column] = value;
    else delete nextDefaults[column];
    // Applying to all CLEARS this column's per-row values, or "all" would
    // quietly not mean all on the rows somebody had already typed into.
    const nextOverrides = {};
    for (const [index, fields] of Object.entries(overrides)) {
      const { [column]: _dropped, ...rest } = fields;
      if (Object.keys(rest).length > 0) nextOverrides[index] = rest;
    }
    setPending({ defaults: nextDefaults, overrides: nextOverrides });
    onApplyDefaults({ defaults: nextDefaults, overrides: nextOverrides });
  }

  function toggle(syncKey) {
    setRejected((r) => {
      const next = new Set(r);
      if (next.has(syncKey)) next.delete(syncKey);
      else next.add(syncKey);
      return next;
    });
  }

  function setAll(list, accept) {
    setRejected((r) => {
      const next = new Set(r);
      for (const row of list) {
        if (accept) next.delete(row.syncKey);
        else next.add(row.syncKey);
      }
      return next;
    });
  }

  // NOT A FILTER. It narrows what is shown AND what is written: rows that
  // do not touch this column are rejected outright, and the ones that do
  // are written for this column alone. That is what "take only the end
  // dates from this file" means, and it cannot be said by ticking rows.
  function setMask(columns) {
    const next = new Set(Array.isArray(columns) ? columns : []);
    setColumnMask(next);
    // A row is rejected when it touches NONE of the chosen columns. With
    // nothing chosen there is no mask at all and every row is back in.
    setRejected(next.size === 0 ? new Set() : new Set(
      changed
        .filter((r) => !r.cells.some((c) => next.has(c.column)))
        .map((r) => r.syncKey),
    ));
  }

  /**
   * ONE COLUMN LIST PER ROW, not one for the whole file.
   *
   * The route has always taken `{ syncKey, columns }` per row and grouped
   * by distinct mask; the modal sent every row the same global list, so
   * rejecting one bad cell meant rejecting the whole row and losing the
   * good ones beside it. That is why a hand-edited column had to be hidden
   * from the diff at all: there was no way to answer it.
   *
   * A row where EVERY cell is kept sends no columns and is dropped, because
   * writing nothing is not an update.
   */
  const accept = [...changed, ...incoming]
    .filter((r) => !rejected.has(r.syncKey))
    .map((r) => {
      const cells = (r.cells ?? [])
        .filter((c) => columnMask.size === 0 || columnMask.has(c.column))
        .filter((c) => !kept.has(`${r.syncKey}:${c.column}`))
        .map((c) => c.column);
      // A new row has no cells: it is the whole row or nothing.
      if (!r.cells) return { syncKey: r.syncKey };
      return { syncKey: r.syncKey, columns: cells };
    })
    .filter((e) => !('columns' in e) || e.columns.length > 0);

  // The third tab is a reading, not a decision: it has no accept/reject, so
  // it is deliberately NOT `list`. Everything keyed off `list` — select all,
  // the column mask, the accepted count, Confirm — stays about the two tabs
  // that write something.
  // Rows ticked for deletion on the third tab, by id, and the group filter
  // over it. Empty to start and it stays empty unless somebody ticks: the
  // common case for that tab is a partial sheet where the right answer is to
  // delete nothing.
  const [marked, setMarked] = useState(() => new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /**
   * WHICH GROUP THE FILE IS ABOUT, used to preselect the filter.
   *
   * "Potentially ended deals" on a MILKMAN sheet lists every INDIGO, NEXUS and
   * MANBAT deal too, and none of those mean anything: a MILKMAN sheet
   * saying nothing about INDIGO is expected. The rows worth reading are the
   * MILKMAN ones it left out. So the filter opens on the file's own group
   * and is changed like any other filter.
   *
   * Only when the file covers exactly ONE group. Two or more and there is no
   * single right answer, so it opens on all of them.
   */
  const fileGroup = useMemo(() => {
    const groups = [...new Set(rows.map((r) => r.groupName).filter(Boolean))];
    return groups.length === 1 ? groups[0] : '';
  }, [rows]);

  const [deleteGroup, setDeleteGroup] = useState(fileGroup);
  // A fresh parse is a different file, so the preselection is redone rather
  // than left showing the last upload's group.
  useEffect(() => { setDeleteGroup(fileGroup); }, [fileGroup]);

  function toggleMarked(id) {
    if (id == null) return;
    setMarked((m) => {
      const next = new Set(m);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleMarkedGroup(ids, checked) {
    setMarked((m) => {
      const next = new Set(m);
      for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
      return next;
    });
  }

  // The two delete tabs share everything but their source and their sentence.
  const reading = DELETE_TABS.includes(tab);
  const deletable = tab === 'inFile' ? inFile : (tab === 'notInFile' ? notInFile : []);
  // WHAT THE MASK HIDES. "Apply only presetOn" writes nothing on a row that
  // does not touch presetOn, so listing it unticked among the rows that DO
  // is sixty lines of noise around the two that matter. The count above the
  // list follows, so "63 of 63" becomes "61 of 61".
  const masked = columnMask.size === 0
    ? changed
    : changed.filter((r) => r.cells.some((c) => columnMask.has(c.column)));
  // The company tab draws its own pane and shares nothing with the deal
  // tabs, so it must not fall through to the incoming list.
  const onCompanies = tab === 'companies';
  const list = reading || onCompanies ? [] : (tab === 'changed' ? masked : incoming);
  const acceptedHere = list.filter((r) => !rejected.has(r.syncKey)).length;

  // Deletions no longer ride along: they are already written by the time
  // this runs. See deleteMarked below.
  function commit() {
    onCommit({ rows, columns, accept, companies: tiers });
  }

  /**
   * ===============================
   * * WHAT PRESSING IT ACTUALLY WRITES, ABOVE THE BUTTON RATHER THAN ON IT
   * ===============================
   * It was the label, and the label ran out of room: "Confirm 47 of 96 and
   * 3 company statuses" on one button.
   *
   * IT ALSO READ AS A CONTRADICTION. The toolbar says "81 of 81 accepted"
   * and the button said 47 of 96, because they count different things: the
   * toolbar counts rows nobody rejected, this counts rows that will WRITE,
   * and a row whose every cell is set to EXISTING writes nothing (see
   * `accept` above). That gap was the whole confusion and it is now the
   * thing the note says out loud.
   *
   * A line immediately above keeps the count in the same eye path, which is
   * what it was on the button for, with room to say why.
   */
  const totalDeals = counts.changed + counts.new;
  const ticked = [...changed, ...incoming].filter((r) => !rejected.has(r.syncKey)).length;
  const noOps = ticked - accept.length;
  const writeNote = [
    `${accept.length} of ${totalDeals} deals will change`,
    noOps > 0 ? `${noOps} ticked with nothing to write` : '',
    tiers.length > 0
      ? `${tiers.length} company ${tiers.length === 1 ? 'status' : 'statuses'}`
      : '',
  ].filter(Boolean).join(' · ');
  const nothingToWrite = accept.length === 0 && tiers.length === 0;

  /**
   * The deletion, on its own, now.
   *
   * `marked` is cleared immediately rather than in an onSuccess callback:
   * the re-read that follows returns a diff in which these rows no longer
   * exist, so a tick left behind would point at nothing and still be
   * counted by the toolbar.
   */
  function deleteMarked() {
    const ids = [...marked];
    setConfirmingDelete(false);
    setMarked(new Set());
    // Deleting a deal the file DOES mention moves it out of "Existing to
    // update" and into "New incoming deals", which only a fresh parse can
    // work out. Deleting one the file never mentions changes nothing else,
    // so that tab stays instant.
    onDeleteRows(ids, { rereadDiff: tab === 'inFile' });
  }

  // Runs after the fresh parse has rendered, so `rows`, `columns` and
  // `accept` here are the new ones rather than the ones the click saw.
  useEffect(() => {
    setPending(null);
    if (!commitOnArrival) return;
    setCommitOnArrival(false);
    commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  // IMPORT, matching the button that opens it. It said Upload, so the label
  // you pressed and the modal it produced used two words for one act, a
  // second apart. The files and routes keep `upload`.
  return (
    <Modal wide title={`Import · ${filename}`} onClose={onCancel}>
      <div className="space-y-4">
        {/* SHORT LINES, DETAIL BEHIND ICONS. The counts that matter are on
            the tabs, so repeating them here was a paragraph restating the
            two labels underneath it. What is left is only what the tabs
            cannot say: what the file did not carry, and what it would
            wipe. */}
        {/* ===============================
            * * FOLDED AWAY, BECAUSE IT GREW
            * ===============================
            A sheet with a repeated bank name or a repeated Yes/No produces
            a line per phrase, and a real file produced nine: the notes took
            more height than the diff they were introducing, and the tabs
            were below the fold.
            A COUNT AND A CHEVRON, open on nothing. The warnings still
            exist, they are one click rather than a wall, and the count says
            there is something to open. */}
        {noteCount > 0 && (
          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setNotesOpen((open) => !open)}
              aria-expanded={notesOpen}
              className="flex min-h-0 w-full items-center gap-2 rounded-lg border-0 bg-surface-sunken px-3 py-1.5 text-left text-xs"
            >
              <ChevronIcon
                width={12}
                height={12}
                className={`shrink-0 transition-transform ${notesOpen ? 'rotate-90' : ''}`}
              />
              <span className="font-semibold text-text">
                {noteCount} {noteCount === 1 ? 'note' : 'notes'} about this file
              </span>
              <span className="text-text-faint">{notesOpen ? 'Hide' : 'Show'}</span>
            </button>
            {notesOpen && (
              <div className="space-y-1 px-3 py-2 text-xs">
                {diff?.unchanged > 0 && (
                  <p className="text-text-muted">
                    <span className="font-semibold">{diff.unchanged}</span> incoming{' '}
                    {diff.unchanged === 1 ? 'deal is' : 'deals are'} already identical, nothing to do
                  </p>
                )}
                <NotInFileNote rows={notInFile} />
                <ImportColumnsNote
                  columns={preview.unknownColumns}
                  untouched={preview.untouchedColumns}
                  groupFromName={preview.groupFromName}
                  ungrouped={preview.ungrouped}
                  sentinelWarnings={preview.sentinelWarnings}
                />
                {clearedRows > 0 && (
                  <p className="flex flex-wrap items-center gap-1 text-warning">
                    <span className="font-semibold">
                      {clearedRows} {clearedRows === 1 ? 'deal has a value' : 'deals have values'} this file would CLEAR
                    </span>
                    <CellInfo {...popup.clearingSummary()} />
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1 self-start rounded-lg border border-border bg-surface-sunken p-1">
          {/* The optional tab drops out when the file carries no company
              block, rather than being appended when it does: its POSITION
              in the list is the thing being stated. */}
          {TABS.filter((t) => !t.hidden && (!t.optional || companyDiff)).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              // The danger tab keeps its red whether or not it is open, so
              // it reads as "this one removes things" from across the
              // strip rather than only once you land on it.
              // A filled pill rather than an accent underline. Same change
              // as the settings tabs and HandlerTabs: the weight comes from
              // a fill, so hover and active cannot read alike.
              className={`min-h-0 rounded-md border-0 px-4 py-1.5 text-sm transition-colors ${
                tab === t.key
                  ? (t.tone === 'danger'
                    ? 'bg-danger-tint font-semibold text-danger shadow-sm'
                    : 'bg-surface font-semibold text-text shadow-sm')
                  : (t.tone === 'danger'
                    ? 'text-danger/70 hover:bg-danger-tint'
                    : 'text-text-muted hover:bg-surface')
              }`}
            >
              {t.label} <span className="tabular-nums">({counts[t.key]})</span>
            </button>
          ))}

        </div>

        {/* The select-all sits at the head of this row rather than above a
            column heading, because it is the same kind of thing as the
            controls beside it: something you do to the list, not a label
            for it. */}
        {list.length > 0 && (
          // ALIGNED WITH THE CARDS BELOW IT, the same way the delete tabs
          // align their header with their rows. A card's content starts at
          // its 1px border plus p-3, so the transparent border here is not
          // decoration: it is the missing pixel.
          <div className="flex flex-wrap items-center gap-3 border border-transparent px-3">
            <SelectAll
              total={list.length}
              accepted={acceptedHere}
              // ONLY THE FIRST TAB ACCEPTS. The rest pick rows, and "Accept
              // all" over deals you are about to delete reads as agreeing
              // to the file rather than choosing what goes.
              labels={tab === 'changed' ? ACCEPT_LABELS : SELECT_LABELS}
              verb={tab === 'changed' ? 'accepted' : 'selected'}
              onChange={(checked) => setAll(list, checked)}
            />
            {tab === 'changed' && movedColumns.length > 1 && (
              <>
                {/* "Apply only", not "Only": it decides what is WRITTEN,
                    not just what is displayed.

                    ONE DROPDOWN, not a button per column. Six columns wrapped
                    onto two rows and pushed the list down the screen, and a
                    row of toggle buttons cannot say at a glance how many are
                    on. A multi-select shows the count in its own trigger and
                    takes one line however many columns moved. */}
                <span className="text-xs text-text-muted">Apply only:</span>
                <Select
                  multiple
                  size="sm"
                  searchable={movedColumns.length > 8}
                  className="w-full sm:w-64"
                  value={[...columnMask]}
                  onChange={setMask}
                  options={movedColumns.map((c) => ({
                    value: c.column,
                    label: `${c.field} (${c.count})`,
                  }))}
                  placeholder="Every column that moved"
                />
              </>
            )}
          </div>
        )}

        {/* ONE SCROLL AREA ON A PHONE, not two. The Modal is a full-height
            bottom sheet there and already scrolls its own body, so capping
            this list as well put a second scrollbar inside the first and
            squeezed the cards into 45% of an already short screen. The cap
            earns its place from sm up, where the modal is a centred box
            and the header, tabs and Confirm should stay put. */}
        <div className="space-y-2 sm:max-h-[45vh] sm:overflow-y-auto">
          {tab === 'companies' && companyDiff && (
            <CompanyTiersTab diff={companyDiff} value={tiers} onChange={setTiers} />
          )}
          {reading && deletable.length > 0 && (
            <DeletableList
              rows={deletable}
              note={tab === 'inFile'
                ? 'Deals found in the CRM that are also in the imported file. You can use this '
                  + 'to delete deals based on the imported file: import a file containing ended '
                  + 'deals and delete them here.'
                : 'The imported file does not mention these, which does not mean they are '
                  + 'finished. Nothing here goes unless you tick it. Decide whether to remove '
                  + 'them or not.'}
              group={deleteGroup}
              onGroup={setDeleteGroup}
              marked={marked}
              onToggle={toggleMarked}
              onToggleGroup={toggleMarkedGroup}
              selectedCount={marked.size}
              deleting={deleting}
              onDelete={() => setConfirmingDelete(true)}
            />
          )}
          {reading && deletable.length === 0 && (
            <p className="p-6 text-center text-sm text-text-muted">
              {tab === 'inFile'
                ? 'Every deal in this file is new to the CRM, so there is nothing here to remove.'
                : 'This file covers every deal the CRM holds. Nothing was left out.'}
            </p>
          )}

          {!reading && list.length === 0 && (
            <p className="p-6 text-center text-sm text-text-muted">
              {tab === 'changed'
                ? 'Nothing in this file changes a deal the CRM already holds.'
                : 'Every deal in this file is already in the CRM.'}
            </p>
          )}

          {list.map((row) => (
            <RowCard
              key={row.syncKey}
              row={row}
              accepted={!rejected.has(row.syncKey)}
              onToggle={() => toggle(row.syncKey)}
            >
              {row.cells ? (
                <span className="mt-1.5 block space-y-1">
                  {/* WHICH SIDE IS WHICH, said once per card rather than on
                      every line. Two ticks facing each other are only
                      obvious when the columns are named, and the alternative
                      is repeating "keep" and "take" down twenty rows. */}
                  <span className={`${ROW_GRID} pb-1 text-[10px] uppercase tracking-wide text-text-faint`}>
                    <span className="hidden sm:block" />
                    {/* EXISTING and INCOMING, the only two words an import
                        uses. "Keep this" and "Take from the file" were a
                        third vocabulary for the two things every other
                        heading, count and column on this screen already
                        names. */}
                    <span>Existing</span>
                    <span>Incoming</span>
                  </span>
                  {row.cells
                    .filter((c) => columnMask.size === 0 || columnMask.has(c.column))
                    .map((c) => (
                      <CellRow
                        key={c.column}
                        cell={c}
                        // Only columns the upload is allowed to set. A
                        // computed one (payable amount, payable days) is
                        // derived from the others and typing into it would
                        // be overwritten by the recompute.
                        editable={(preview.defaultable ?? []).includes(c.column)}
                        input={FILL_INPUT[c.column] ?? 'text'}
                        busy={rereading}
                        keptHere={kept.has(`${row.syncKey}:${c.column}`)}
                        onChoose={(column, keep) => choose(row.syncKey, column, keep)}
                        onSaveRow={(column, value) => saveRow(row.uploadIndex, column, value)}
                        onApplyAll={applyAll}
                      />
                    ))}
                </span>
              ) : (
                <span className="mt-1 block text-xs text-text-muted">
                  Not in the CRM. Accepting adds it.
                  {row.needsReview ? ` Flagged: ${row.reviewReason}` : ''}
                </span>
              )}

              {/* WHAT THIS FILE LEAVES OUT, on every card, because the
                  value is set once for all of them and this is where you
                  are looking when you notice it is missing. Separated by a
                  hairline: these are not changes, they are a blank waiting
                  for an answer. */}
              {fillableColumns.length > 0 && (
                <span className="mt-2 block space-y-1 border-t border-border pt-2">
                  {fillableFor(row).map((f) => (
                    <FillRow
                      key={f.column}
                      column={f.column}
                      field={f.field}
                      value={f.value}
                      source={f.source}
                      input={f.input}
                      options={f.options}
                      busy={rereading}
                      onSaveRow={(column, value) => saveRow(row.uploadIndex, column, value)}
                      onApplyAll={applyAll}
                    />
                  ))}
                </span>
              )}
            </RowCard>
          ))}
        </div>

        <div className="flex flex-col items-end gap-2 border-t border-border pt-4">
          {/* RIGHT ALIGNED WITH THE BUTTONS, not floated left across the
              footer: it is about the button under it, and a count at the
              far end of a wide modal belongs to nothing. */}
          <span className="text-xs tabular-nums text-text-muted">
            {nothingToWrite ? 'Nothing to write' : writeNote}
          </span>
          <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            // NOT disabled while the file is read again. See
            // commitOnArrival above: a press during a re-read is
            // remembered and fires on the fresh parse, so the button never
            // greys out and never has to be pressed twice.
            // ONLY THE UPLOAD'S OWN CHANGES. Deleting is finished by the
            // time anyone reaches this button, so it neither enables it nor
            // is counted on it. A sheet whose every change you reject is
            // still a useful upload if it told you six deals were over, but
            // that act is done on the tab, not here.
            // TWO DECISIONS ON ONE SCREEN, and either one alone is enough
            // to press it. It read `accept.length === 0`, so rejecting
            // every deal change and accepting only the company statuses
            // left the button dead with two ticked rows above it.
            disabled={committing || deleting || nothingToWrite}
            onClick={() => {
              if (pending || rereading) setCommitOnArrival(true);
              else commit();
            }}
          >
            <ImportIcon width={15} height={15} />
            {/* Confirm, not Apply. Everything on this screen is a decision
                already made by ticking; this is agreeing to it. "Apply"
                reads like the start of an action rather than the end of
                one. The COUNT moved above: it was the last chance to notice
                that 4 of 6 are ticked, and it still is, one line up with
                room to say why the two numbers differ. */}
            {committing ? 'Writing…' : 'Confirm'}
          </Button>
          </div>
        </div>
      </div>

      {/* NAMES WHAT GOES AND WHAT SURVIVES, not "this cannot be undone",
          which is true of everything and tells nobody anything. Deleting a
          DEAL removes the row outright — unlike deleting a person or a
          company, which detaches and leaves the deal flagged — so the
          difference has to be said.

          AND IT SAYS THIS ONE HAPPENS NOW. Everything else on this screen
          is undone by closing it; this is not, and that is the one thing
          somebody has to know before pressing it. */}
      {confirmingDelete && (
        <ConfirmDialog
          {...confirm.deleteFromDiff(marked.size)}
          busy={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={deleteMarked}
        />
      )}
    </Modal>
  );
}
