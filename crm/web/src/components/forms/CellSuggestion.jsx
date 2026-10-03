import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WarningIcon, InfoIcon, AlertCircleIcon } from '../icons';
import Button from '../buttons/Button';
import Toggle from './Toggle';
import { renderPopupBody } from '../display/CellInfo';
import usePopoverPosition from '../../hooks/usePopoverPosition';

/**
 * ***************************************************
 * * A cell marker that PROPOSES a value and can write it
 * ***************************************************
 *
 * ONLY THE THREE DATE COLUMNS use this: appointment, payment start, end
 * date. They are the one place in the CRM where an empty cell has a right
 * answer the system already knows, because his own sheet computes two of
 * them from the third. Everywhere else an empty cell is a question for a
 * human and gets a CellInfo, which says things and decides nothing.
 *
 * ===============================
 * * WHY THIS IS NOT A PROP ON CellInfo
 * ===============================
 * CellInfo portals its panel to <body> while its dismiss handler tests only
 * the ANCHOR, so a pointerdown anywhere in the panel closes it before the
 * click lands. A button in there would never fire. This owns both refs and
 * tests both, which is the whole difference and is not something CellInfo
 * can gain without changing what it is for its other twenty-two callers.
 *
 * It lives in forms/ for the same reason EditableCell does: it writes.
 *
 * CLICK ONLY, no hover. CellInfo opens on hover because it is a tooltip and
 * you never have to reach it. A panel you have to put the pointer inside
 * closes on the way there, so this one waits to be asked.
 */

// Wider than CellInfo's 256: this one carries two dates and a button.
const PANEL = { width: 288, height: 148 };
// The ruled switch row, when there is one. Named so the height and the
// markup cannot drift: both read this.
const SWITCH_ROW = 36;

/**
 * THREE MARKS, AND THE SHAPE CARRIES AS MUCH AS THE COLOUR.
 *
 *   warning  gold triangle      something is wrong, or the date is a guess
 *   action   gold ALERT CIRCLE  the cell is empty and one press fills it
 *   info     green info circle  here is what this is, nothing to do
 *
 * Gold for both of the first two: an empty date somebody can fill is work,
 * not context, and it was being scrolled past in green. Round rather than
 * triangular because nothing is actually wrong with the row.
 */
const MARKS = {
  warning: { Icon: WarningIcon, className: 'text-warning-strong hover:text-danger' },
  action: { Icon: AlertCircleIcon, className: 'text-warning-strong hover:text-danger' },
  info: { Icon: InfoIcon, className: 'text-accent-strong hover:text-accent-strong-deep' },
};

/**
 * ===============================
 * * A SWITCH IN THE POPUP, UNDER THE REASON THAT EXPLAINS IT
 * ===============================
 * `switchLabel` / `switchOn` / `onSwitch`, his call 2026-09-23, for
 * `special_case_deal`. The fault and its cure belong in one place: you see a
 * red payment start cell, you click the icon to ask why, and the answer
 * and the switch that changes it are the same panel.
 *
 * NOT A COLUMN, and not in the edit form. A column where ninety one rows
 * out of ninety two say the same thing is a column of noise, and nobody
 * opens a form to change a colour.
 *
 * THIS PANEL AND NOT CellInfo's. That one also opens on HOVER, so a
 * control in it would vanish as the pointer crossed into it, and its
 * outside-click test does not know about its own portalled panel.
 */
export default function CellSuggestion({
  tone = 'info', label, body, accept, busy = false, onAccept,
  switchLabel, switchOn = false, onSwitch,
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const panel = useRef(null);
  // The switch adds a ruled row, so the box is taller and the flip has to
  // know: positioned against the old height it opens downward off screen
  // on the last rows of the table.
  const pos = usePopoverPosition(
    anchor,
    open,
    onSwitch ? { ...PANEL, height: PANEL.height + SWITCH_ROW } : PANEL,
  );

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      // BOTH, and the panel is the one CellInfo misses. It is portalled out
      // of the anchor, so DOM containment says it is somewhere else.
      if (anchor.current?.contains(e.target)) return;
      if (panel.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const { Icon, className } = MARKS[tone] ?? MARKS.info;

  return (
    <span ref={anchor} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          // The cell underneath opens an editor on click. This is a
          // question about the cell, not an edit of it.
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        // Colour comes from MARKS above, and both gold tones use the
        // `strong` step, the one meant for an icon on white.
        className={`min-h-0 border-0 bg-transparent p-0 transition-colors ${className}`}
      >
        <Icon width={14} height={14} />
      </button>

      {open && pos && createPortal(
        // z-58, the CellInfo layer. Same kind of thing: a portalled panel
        // explaining the cell under it, so it clears whatever that sits on.
        <span
          ref={panel}
          role="dialog"
          aria-label={label}
          style={{ top: pos.top, left: pos.left, width: PANEL.width }}
          className="fixed z-[58] block whitespace-normal border border-border-strong bg-surface px-3 py-2 text-left text-xs font-normal normal-case tracking-normal text-text shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <span className={`mb-1 block font-semibold ${tone === 'info' ? 'text-text' : 'text-warning-strong'}`}>
            {label}
          </span>
          {renderPopupBody(body)}

          {/* A TOGGLE, never a checkbox, and never a button pair: it is a
              two state setting that takes effect on the spot, which is
              what Toggle is for everywhere else in the CRM. Ruled off,
              because the text above it is the reason and this is the act.
              The panel stays open, so the colour changing underneath is
              the confirmation. */}
          {onSwitch && (
            <span className="mt-2 flex items-center gap-2 border-t border-border pt-2">
              <Toggle checked={switchOn} onChange={onSwitch} label={switchLabel} disabled={busy} />
              <span className="text-xs">{switchLabel}</span>
            </span>
          )}

          {onAccept && (
            <span className="mt-2 flex items-center justify-end gap-2">
              <Button size="xs" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                size="xs"
                variant="primary"
                disabled={busy}
                onClick={() => { onAccept(); setOpen(false); }}
              >
                {accept}
              </Button>
            </span>
          )}
        </span>,
        document.body,
      )}
    </span>
  );
}
