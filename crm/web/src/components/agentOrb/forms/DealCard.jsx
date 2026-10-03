import { useState } from 'react';
import CellInfo from '../../display/CellInfo';
import { formatDate } from '../../../helpers/formatDate';
import { CashIcon, BankIcon, CryptoIcon, ChevronIcon } from '../../icons';

/**
 * ONE DEAL, LAID OUT, so the next thing you say can be "change the preset".
 *
 * This replaced a thirty-one line `label: value` dump in a chat bubble.
 * That block treated a door number as equal in weight to the monthly
 * amount, printed "(not set)" a dozen times, and said nothing about what
 * kind of thing it was describing.
 *
 * COMPRESSED, because it lives in a 400px panel. The section headings were
 * padded tinted bars costing a row each; they are a small caps label with a
 * hairline now. Cells are one `label: value` line each, read top to bottom.
 * Contact and bank, the least scanned block and the biggest, is folded.
 *
 * NOT AN EDITOR, by default. You read it and tell her what to change, and
 * she writes it: one write path, whether you typed the instruction or
 * clicked. See CLICKABLE_CELLS.
 */

/**
 * Turn the cells into click-to-edit fields.
 *
 * OFF, deliberately. With it on the card becomes a third way to write a
 * row, alongside the form and the conversation, and three doors onto one
 * act is how they drift apart. It is also the slower way to make a single
 * change: saying "preset to August" beats finding the cell.
 */
const CLICKABLE_CELLS = false;

// The block that opens closed. Everything else on the card is what you came
// for; this is what you check once a month.
const FOLDED = 'Contact and bank';

// What the header's subtitle already says. Keyed on the edit fields, not
// the labels: those are the server's stable names for the same three cells.
const WHERE_FIELDS = new Set(['company', 'groupName', 'roleLabel']);

/**
 * A mark beside the payment method, because it is the one cell you look for
 * rather than read. Keyed on the value, matched loosely: the column is free
 * text on the sheet and comes back as "cash", "Cash", "bank transfer".
 *
 * INLINE SVG, not artwork. A generated set was tried and thrown away: it
 * came back filled rather than line art, with a glow baked in, at 1.3MB
 * each for something drawn at 20px, and it matched nothing else in the app.
 * These follow `currentColor`, weigh nothing and are already the house
 * stroke. See docs/state.md.
 */
const METHOD_MARK = [
  [/cash/i, CashIcon],
  [/bank|transfer/i, BankIcon],
  [/crypto|usdt|btc|eth/i, CryptoIcon],
];
const markFor = (value) => METHOD_MARK.find(([re]) => re.test(String(value ?? '')))?.[1] ?? null;

/**
 * ===============================
 * * THE EFFECTIVE ANSWER, and nothing else
 * ===============================
 *
 * `null` is nobody decided, and the queries resolve it to "should be paid
 * yes, paid no". This card USED to show that third state faded, so an
 * untouched row read grey. User's own call to flatten it: on a READ ONLY
 * surface the only question is what the row is being treated as.
 *
 * The distinction still exists where it decides something. DealForm keeps
 * `Not set` as a real position, because that is where you SET the value and
 * a plain yes/no there would record a payment decision every time somebody
 * opened the form to fix a typo.
 *
 * COLOURED BY MEANING, NOT BY TRUE/FALSE. Most rows are unpaid most of the
 * month, so red on "Paid: no" would make an ordinary sheet look like forty
 * alarms and leave the one pill that means "somebody must act" the same
 * colour as the noise.
 */
/**
 * ===============================
 * * TWO SWITCHES, TWO PILLS, AND THEY MEAN DIFFERENT THINGS
 * ===============================
 * This rendered ONE pill and hardcoded its words, so `Should be paid` was
 * filtered out of the row and could not have been drawn correctly even if
 * it had not been: every value read as "Payment received" or "Payment
 * outstanding". A card showed a deal was unpaid without ever saying whether
 * it was meant to be paid at all.
 *
 * The words and the colour now come from WHICH SWITCH it is:
 *
 *   Should be paid   green yes, RED no. His call 2026-09-09. It is the
 *                    decision, so both answers are stated plainly.
 *   Paid             green yes, AMBER no. Amber and not red, because most
 *                    rows are unpaid for most of the month and forty red
 *                    pills would leave the one that matters the same colour
 *                    as the noise.
 */
const PILL_WORDS = {
  overrideShouldBePaid: { yes: 'Should be paid', no: 'Not to be paid', noTone: 'alert' },
  overridePaid: { yes: 'Paid', no: 'Not paid', noTone: 'warn' },
};

const TONES = {
  signal: 'border-diane-signal/50 bg-diane-signal/10 text-diane-signal',
  warn: 'border-diane-warn/50 bg-diane-warn/10 text-diane-warn',
  alert: 'border-diane-alert/50 bg-diane-alert/10 text-diane-alert',
};

function Pill({ value, fallback, editField }) {
  const words = PILL_WORDS[editField];
  if (!words) return null;
  const shown = value === null || value === undefined ? Boolean(fallback) : Boolean(value);

  return (
    <span className={`rounded-full border px-2 py-px text-[9px] font-semibold ${
      shown ? TONES.signal : TONES[words.noTone]
    }`}
    >
      {shown ? words.yes : words.no}
    </span>
  );
}

function PayablePill({ payable }) {
  const tone = payable
    ? 'border-diane-signal/50 bg-diane-signal/10 text-diane-signal'
    : 'border-diane-dim/40 bg-diane-dim/10 text-diane-dim';
  return (
    <span className={`rounded-full border px-2 py-px text-[9px] font-semibold ${tone}`}>
      {payable ? 'Payable this month' : 'Not payable this month'}
    </span>
  );
}

// The label column. Fixed, so every value in a group starts at the same x
// and a section reads as a list rather than as ragged prose. Narrow enough
// that two of these fit across her 34rem panel.
const LABEL_WIDTH = 'w-[6.5rem]';
// THE SHEET CHECK'S FORMAT, his call 2026-09-30: no hairline boxes, rows on
// the conversation's own ground, lined up by the grid they share.
const ROW = 'flex items-baseline gap-2 px-0.5 py-0.5';

function Cell({ cell, onEdit, disabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cell.value ?? '');

  const label = (
    <span className={`${LABEL_WIDTH} shrink-0 text-[10px] leading-snug text-white/40`}>
      {cell.label}:
    </span>
  );

  if (editing) {
    return (
      <div className={ROW}>
        {label}
        <input
          autoFocus
          type={cell.input}
          className="min-w-0 flex-1 rounded-sm border border-diane-line/40 bg-diane-void px-1 py-0.5 text-[11px] text-white"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false);
            if (e.key === 'Enter') { setEditing(false); onEdit(cell.editField, draft); }
          }}
        />
      </div>
    );
  }

  const clickable = CLICKABLE_CELLS && !disabled && cell.editField;
  // Only the method cell carries one. Keyed on the label because that is
  // what the server sends; a cell with no mark renders exactly as before.
  const Mark = cell.label === 'Method' ? markFor(cell.value) : null;

  /**
   * DATES READ AS DATES. `2026-08-05` is four numbers a person has to
   * decode, and it is the same eight characters whether it means 5 August
   * or 8 May. This is read by people paying other people.
   *
   * DISPLAY ONLY. `cell.value` stays the ISO string the editor above needs
   * for `<input type="date">`, and `formatDate` returns the ORIGINAL TEXT
   * for anything unparseable, so the sheet's own "Ongoing" survives.
   */
  const shown = cell.input === 'date' && cell.value ? formatDate(cell.value) : cell.value;

  return (
    <div className={ROW}>
      {label}
      {clickable ? (
        <button
          type="button"
          onClick={() => { setDraft(cell.value ?? ''); setEditing(true); }}
          className="min-h-0 min-w-0 flex-1 justify-start border-0 border-b border-dashed border-white/15 bg-transparent p-0 text-left text-[11px] leading-snug text-white/90 hover:border-diane-signal"
        >
          {shown ?? <span className="text-white/25">not set</span>}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1 text-[11px] leading-snug text-white/90">
          {Mark && <Mark width={11} height={11} className="shrink-0 text-diane-dim" />}
          {shown ?? <span className="text-white/25">not set</span>}
        </span>
      )}
    </div>
  );
}

// A heading that costs one line instead of a padded bar. The rule runs to
// the right edge so the label still reads as a section break.
// The sheet check's section label: a word with no rule under it.
function Band({ title }) {
  return (
    <div className="px-0.5 pt-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-diane-signal/80">
        {title}
      </span>
    </div>
  );
}

// TWO UP, in her panel as well as in the modal. Twenty cells one under the
// other is a card you scroll three times. One column below `sm`, where the
// phone has no room for a second.
const COLUMNS = 'grid-cols-1 sm:grid-cols-2';
// What `COLUMNS` says, for the filler below. Two statements of one number,
// because Tailwind cannot scan a class it never sees written out.
const COLUMN_COUNT = 2;

// ONE LINE PER CELL, hairline divided. It was four up, which gave each
// value a dozen characters in a 400px panel: "handled internally, not held
// here" under a caption, four times across, is a wall rather than a card.
// The gap IS the hairline, so a short group does not draw a box around two
// items.
function Cells({ cells, onEdit, disabled }) {
  // No hairline grid any more (2026-09-30), so an odd group has no hole to
  // fill: the grid just leaves the last half row empty.
  return (
    <div className={`grid gap-x-4 ${COLUMNS}`} data-columns={COLUMN_COUNT}>
      {cells.map((c) => (
        <div key={c.label}>
          <Cell cell={c} onEdit={onEdit} disabled={disabled} />
        </div>
      ))}
    </div>
  );
}

export default function DealCard({ card, onEdit, disabled, expanded = false }) {
  // OPEN. Contact and bank is a phone number and where to send the money,
  // and it opened closed everywhere, so reading it was a click every time.
  // The fold stays, so it can still be put away.
  const [showFolded, setShowFolded] = useState(true);
  // `expanded` is the modal: an empty cell is worth a line when the whole
  // screen is the card, and is noise in the panel.
  const [showEmpty, setShowEmpty] = useState(expanded);

  const groups = card.groups ?? [];
  const folded = groups.filter((g) => g.title === FOLDED);
  const open = groups.filter((g) => g.title !== FOLDED);
  const emptyCount = groups.flatMap((g) => g.cells).filter((c) => c.value === null).length;

  const visible = (g) => (showEmpty ? g.cells : g.cells.filter((c) => c.value !== null));

  // The subtitle is company, group and role, which The deal says in full
  // three lines below it. Kept for the NARROWED card, where those cells are
  // filtered out and it is the only thing saying where the deal is.
  const saysWhere = groups.some((g) => g.cells.some((c) => WHERE_FIELDS.has(c.editField)));

  return (
    // NO PANEL AROUND IT: it sits on the conversation's own ground, like the
    // sheet check. His call 2026-09-30.
    <div>
      <div className="px-0.5">
        {/* ONE ROW: who, what state they are in, and the money. The pills
            had a row of their own under the name and were the only thing
            on it. `ml-auto` keeps the money at the far edge however many
            pills there are. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-xs font-semibold text-diane-signal">{card.name}</p>

          {typeof card.payableThisMonth === 'boolean' && (
            <PayablePill payable={card.payableThisMonth} />
          )}
          {/* BOTH SWITCHES, should-be-paid first. It used to filter to
              `overridePaid` alone, so the card said a deal was unpaid
              without ever saying whether it was meant to be paid.

              GUARDED. Not every card is a deal: the active companies card
              has no switches, and a bare .map threw the whole overlay.
              `Pill` returns null for anything that is not one of the two,
              so a switch added server side cannot draw a blank pill.

              Still behind payableThisMonth. On a row owed nothing this
              month, "Not paid" is not a fact anybody has to act on. */}
          {card.payableThisMonth && (card.switches ?? [])
            .map((item) => <Pill key={item.editField} {...item} />)}
          {card.needsReview && (
            /* THE REASON IS ON HOVER, not printed after the label. Inline
               it ran the pill to three times the width of the others, on
               the one row where the width was already the problem. */
            <span className="inline-flex items-center gap-1 rounded-full border border-diane-alert/50 bg-diane-alert/10 px-2 py-px text-[9px] font-semibold text-diane-alert">
              Needs a check
              {card.reviewReason && (
                <CellInfo
                  tone="warning"
                  size={11}
                  label="Why this needs a check"
                  className="!text-diane-alert hover:!text-diane-warn"
                >
                  {card.reviewReason}
                </CellInfo>
              )}
            </span>
          )}

          {/* THE MONEY, once. It is what the row is for. */}
          {card.headline && (
            <p className="ml-auto text-[13px] font-bold tabular-nums text-white">{card.headline}</p>
          )}
        </div>
        {!saysWhere && <p className="mt-0.5 text-[9px] text-white/45">{card.subtitle}</p>}
      </div>

      {open.map((g) => {
        const cells = visible(g);
        if (cells.length === 0) return null;
        return (
          <div key={g.title}>
            <Band title={g.title} />
            <div className="mt-1.5">
              <Cells cells={cells} onEdit={onEdit} disabled={disabled} />
            </div>
          </div>
        );
      })}

      {/* CONTACT AND BANK, folded. It is six fields you check once a month,
          and open it costs more height than everything above it. */}
      {folded.map((g) => (
        <div key={g.title}>
          {showFolded ? (
            <>
              <Band title={g.title} />
              <div className="mt-1.5">
                <Cells cells={visible(g)} onEdit={onEdit} disabled={disabled} />
              </div>
            </>
          ) : null}
        </div>
      ))}

      {card.notes && (
        <p className="m-0 px-0.5 pt-2 text-[10px] text-white/60">
          {card.notes}
        </p>
      )}

      {/* One row carrying both folds, so neither costs a line of its own. */}
      {(folded.length > 0 || emptyCount > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 px-0.5 pt-2">
          {folded.length > 0 && (
            <Fold
              open={showFolded}
              onClick={() => setShowFolded((v) => !v)}
              label={`${FOLDED} | ${folded[0].cells.length}`}
            />
          )}
          {emptyCount > 0 && (
            <Fold
              open={showEmpty}
              onClick={() => setShowEmpty((v) => !v)}
              label={`${emptyCount} not set`}
            />
          )}
        </div>
      )}
    </div>
  );
}

// A real chevron, pointing DOWN when there is something to open and up
// once it is. The `▸ ▾` text characters it replaced sat on the baseline at
// a different weight to everything else and read as a bullet.
function Fold({ open, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex min-h-0 items-center gap-1 border-0 bg-transparent p-0 text-[9px] uppercase tracking-wide text-white/35 hover:text-diane-signal"
    >
      <ChevronIcon
        width={10}
        height={10}
        className={`shrink-0 transition-transform ${open ? '-rotate-90' : 'rotate-90'}`}
      />
      {label}
    </button>
  );
}
