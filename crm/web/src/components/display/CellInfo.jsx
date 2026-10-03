import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WarningIcon, InfoIcon } from '../icons';
import usePopoverPosition from '../../hooks/usePopoverPosition';

// One definition. The positioning maths has to agree with the box's actual
// width to keep it on screen, and these were two separate numbers.
const PANEL = { width: 256, height: 96 };

/**
 * The words, from `popups.config.js`, which holds no JSX on purpose.
 *
 * A string is one paragraph, an array is several, and `**bold**` is the
 * only markup. That is everything the CRM's popups ever used, and keeping
 * it to that is what lets the config stay content rather than becoming a
 * component file with a config's name.
 *
 * The paragraph spacing lives HERE, once, rather than being retyped as a
 * className in whichever entry happened to need it.
 *
 * EXPORTED because forms/CellSuggestion renders the same config shape. It
 * is the popup body format, so this file owns it and nobody rewrites it.
 */
/**
 * ===============================
 * * A SUM IS A TABLE, NOT A SENTENCE
 * ===============================
 * `{ rows: [[label, value], ...], total: [label, value] }` draws the two
 * aligned columns somebody would write on paper: names down the left,
 * figures right aligned down the right, a rule above the answer.
 *
 * It was three sentences with the figure bolded mid line, so the numbers
 * sat at three different places and nothing lined up to be added.
 *
 * STILL NO JSX IN THE CONFIG. The entry is data, the shape is owned here,
 * which is the same arrangement the string form already had.
 */
function renderRows({ rows = [], total }, key) {
  return (
    <span key={key} className="mt-2 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <span>{label}</span>
          {/* tabular-nums so the digits line up column by column, which is
              the whole reason this is a table. */}
          <span className="text-right tabular-nums">{value}</span>
        </Fragment>
      ))}
      {total && (
        <Fragment key="total">
          <strong className="mt-1 border-t border-border pt-1">{total[0]}</strong>
          <strong className="mt-1 border-t border-border pt-1 text-right tabular-nums">
            {total[1]}
          </strong>
        </Fragment>
      )}
    </span>
  );
}

export function renderPopupBody(body) {
  return (Array.isArray(body) ? body : [body]).map((para, i) => {
    if (para && typeof para === 'object') return renderRows(para, i);
    return (
      // eslint-disable-next-line react/no-array-index-key
      <span key={i} className={i > 0 ? 'mt-2 block' : 'block'}>
        {/* A capturing split puts the bold runs on the odd indices. */}
        {String(para).split(/\*\*(.+?)\*\*/g).map((part, j) => (
          // eslint-disable-next-line react/no-array-index-key
          j % 2 ? <strong key={j}>{part}</strong> : part
        ))}
      </span>
    );
  });
}

/**
 * THE RULE FOR EXTRA INFORMATION IN A TABLE CELL.
 *
 * When a cell needs to say something beyond its own value, it gets an
 * ICON, and the words appear on hover or on click. Never inline text.
 *
 * Two reasons, both learned the hard way here:
 *
 *   Inline text changes the column's width, so one row with a note makes
 *   every other row's value shift. The master sheet had the sheet's own
 *   "Handled Internally" printed in grey beside a switch, and it pushed
 *   the switches out of line down the whole column.
 *
 *   Unlabelled text next to a control reads as part of the control.
 *   Nobody could tell what that grey text was, which is what prompted
 *   this component.
 *
 * TONE says which kind of thing it is, and they are not interchangeable:
 *
 *   warning   somebody has to act. A value could not be worked out, a
 *             column was not recognised. Yellow.
 *   info      here is what this is. Context that needs no action. Grey,
 *             so a table full of them does not look like a table full of
 *             problems.
 *
 * Hover AND click, always. A hover-only tooltip is unreadable on a touch
 * screen and unreachable from a keyboard, and this is the only place some
 * of these explanations exist.
 */
/**
 * `body` and `children` are the same slot, two ways in.
 *
 * `body` is the config's shape (a string or an array, with `**bold**`) and
 * is what every popup should use. `children` still works untouched, so the
 * three pass-through callers that hand in content of their own —
 * ReviewFlag, RecordCard, Select's `hint` — need no config entry and no
 * change.
 */
/**
 * `className` overrides the ICON's colour only, and exists for one caller:
 * Diane's deal card. Her panel is near black, and `text-warning` is the
 * CRM's dark amber, which is invisible on it. Appended last so it wins.
 * The popup keeps its own styling either way; it floats above everything.
 */
export default function CellInfo({ children, body, tone = 'info', size = 14, label, className = '' }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const Icon = tone === 'warning' ? WarningIcon : InfoIcon;
  const showing = open || hovered;

  /**
   * The panel is rendered into <body>, not into the cell.
   *
   * Inside the cell it was absolutely positioned within a container that
   * has `overflow: auto` (.table-wrap), so on the last row it either got
   * clipped or grew the table's scrollable area and shifted the layout.
   * A portal with fixed coordinates is outside that box entirely, so a
   * tooltip can never change the size of the thing it is describing.
   *
   * Where it lands is hooks/usePopoverPosition, shared with CellSuggestion
   * so the clamping and the flip are not written out twice.
   */
  const pos = usePopoverPosition(ref, showing, PANEL);

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label ?? (tone === 'warning' ? 'Needs a check' : 'More information')}
        aria-expanded={open}
        onClick={(e) => {
          // The cell underneath opens an editor on click. This is a
          // question about the cell, not an edit of it.
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        /**
         * FINDABLE, and the tone still means what it meant.
         *
         * `info` was text-faint (#8a988f), then accent DEFAULT (#8ce3b1),
         * which is the PALE FILL: 1.6:1 on white, and the theme's own
         * comment says it is too pale to be text. It was a smudge in a
         * table and invisible beside a form label. `accent-strong` is the
         * step meant for icons on white and clears 4.5:1.
         *
         * `warning` keeps amber, and amber alone. It is the one that says
         * somebody has to act, so it must never be confused with the
         * ordinary one. `warning-strong` for the same reason as above: the
         * DEFAULT doubles as a button fill and cannot be darkened alone.
         */
        className={`min-h-0 border-0 bg-transparent p-0 transition-colors ${
          tone === 'warning'
            ? 'text-warning-strong hover:text-danger'
            : 'text-accent-strong hover:text-accent-strong-deep'
        } ${className}`}
      >
        <Icon width={size} height={size} />
      </button>

      {showing && pos && createPortal(
        // z-58, ABOVE a modal (50) and above an open Select panel (55).
        //
        // It was 45, which read as sensible for a table and was wrong the
        // moment a form used one: every icon inside a dialog painted its
        // tooltip BEHIND the dialog. A tooltip explains the thing you are
        // looking at, so it has to clear whatever that thing is sitting on
        // — there is no surface it should ever be under except a toast.
        <span
          role="tooltip"
          style={{ top: pos.top, left: pos.left, width: PANEL.width }}
          className="fixed z-[58] whitespace-normal border border-border-strong bg-surface px-3 py-2 text-left text-xs font-normal normal-case tracking-normal text-text shadow-lg"
        >
          {tone === 'warning' && (
            <span className="mb-1 block font-semibold text-warning">Needs a check</span>
          )}
          {body === undefined ? children : renderPopupBody(body)}
        </span>,
        document.body,
      )}
    </span>
  );
}
