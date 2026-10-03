import { useState } from 'react';
import { GearIcon } from '../icons';
import Toggle from '../forms/Toggle';
import { BREAKDOWN_PREVIEWS, fillsFrom } from './breakdownPreviews';
import { Swatches } from './ExportControls';

/**
 * WHICH BREAKDOWN, AND WHAT IT WILL LOOK LIKE.
 *
 * This was a switch, "Include breakdown", on or off. There is more than
 * one shape of the block now, and two shapes cannot live behind one toggle
 * without a second control that only means something while the first is on
 * — a pair nobody can predict from looking at it. So OFF IS A CHOICE IN
 * THE LIST, and picking is picking.
 *
 * THE PREVIEW IS THE POINT. A breakdown is a block of figures at the foot
 * of a tab in a file that does not exist yet, so a name and a sentence
 * cannot tell anybody what they are about to generate. The preview is
 * built from the same fake group every time, so switching between designs
 * changes the LAYOUT on screen and nothing else, which is the only way to
 * see what the difference actually is.
 *
 * Deliberately not real data: fetching a real preview means running the
 * whole export to draw a thumbnail, and the numbers would move every time
 * anybody edited a row, which makes two designs impossible to compare.
 */
/**
 * FIVE SWATCHES, NOT A COLOUR WHEEL.
 *
 * Any hex means somebody can produce a total nobody can read on a document
 * people are paid from. The five are Excel's own accent tints, chosen so
 * every primary and secondary pairing stays legible: the secondary is
 * always the pale step, so black text sits on it whatever is picked.
 */
// Moved to ExportControls.jsx on 2026-09-14, when the expenses export
// modal needed the same swatches. Both steps stay in one dot, so a swatch
// shows the PAIR rather than a colour that is only half of what gets used.

/**
 * WHICH DESIGN THE PERCENTAGES TABLE BELONGS TO.
 *
 * It was a fourth design ("Converted to USD + Add ons table") that differed
 * from the advance one by a single option, so the list read as two near
 * identical choices. It is a toggle now, and it only means anything on the
 * design whose layout it changes.
 *
 * The id, not the label: labels are prose and this is a wire value.
 */
const PERCENTAGES_TABLE_DESIGN = 'with-usd';

export default function BreakdownPicker({
  designs, value, onChange,
  colors = [], primary, secondary, onPrimary, onSecondary,
  percentagesTable = false, onPercentagesTable,
}) {
  // CLOSED BY DEFAULT. The defaults are the document the boss wants, so
  // opening this is the exception rather than a step in the flow.
  const [open, setOpen] = useState(false);
  const Preview = BREAKDOWN_PREVIEWS[value];
  const palette = colors.length > 0 ? { colors, primary, secondary } : null;
  // The hex the sample paints with. Falls back inside the preview when the
  // palette has not loaded, so it never renders colourless.
  const fills = fillsFrom(colors, primary, secondary);

  const current = designs.find((d) => d.id === value);

  return (
    <div>
      {/* ONE LINE WHEN CLOSED, and it says what you will get.
          A picker, two colour rows and a sample is the right amount of
          control and the wrong amount of MODAL: it is settled once and
          then read past every time. So the whole thing folds behind a
          gear, and what stays is the answer rather than the machinery. */}
      {/* ONE CONTROL, NOT TWO. The name and the gear sit in a single
          bordered box on the same axis as the Files row above, so the
          thing chosen and the way to change it read as one setting rather
          than a button with a caption trailing after it. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
          Breakdown
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title="Template and colours"
          className={`flex items-center gap-2 rounded border py-1 pl-2.5 pr-2 text-xs ${
            open
              // `accent-soft` was never a colour in the palette, so this
              // open state has been drawing no fill at all. `tint` is the
              // pale one, and the one every other selected state uses.
              ? 'border-accent bg-accent-tint text-accent-strong'
              : 'border-border bg-surface text-text hover:border-text-faint'
          }`}
        >
          <span className="font-semibold">{current?.label ?? '—'}</span>
          <GearIcon className="h-3.5 w-3.5 opacity-60" />
        </button>
      </div>

      {open && (
        <Settings
          designs={designs}
          value={value}
          onChange={onChange}
          colors={colors}
          primary={primary}
          secondary={secondary}
          onPrimary={onPrimary}
          onSecondary={onSecondary}
          palette={palette}
          Preview={Preview}
          fills={fills}
          percentagesTable={percentagesTable}
          onPercentagesTable={onPercentagesTable}
        />
      )}
    </div>
  );
}

/** Everything behind the gear: the template, the colours, and the sample. */
function Settings({
  designs, value, onChange, colors, primary, secondary, onPrimary, onSecondary,
  palette, Preview, fills,
  // The switch and the sample both live in HERE, not in BreakdownPicker.
  // Added to the wrapper's signature alone once, which parses, passes every
  // source-text test and throws "percentagesTable is not defined" the
  // moment the panel opens.
  percentagesTable, onPercentagesTable,
}) {
  return (
    <div className="mt-2 rounded border border-border bg-surface-sunken p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* A SEGMENTED CONTROL, not a dropdown. Three options that each
            produce a different document are worth seeing at once, and a
            select would hide two of them behind a click. */}
        <div className="inline-flex rounded border border-border bg-surface p-0.5">
          {designs.map((d) => {
            const active = d.id === value;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onChange(d.id)}
                aria-pressed={active}
                // NAME ONLY. The descriptions were a sentence each and
                // three of them across a row overflowed into each other,
                // which is the one thing a picker must not do. The preview
                // says what the choice means far better than a sentence.
                title={d.description}
                className={`min-h-0 rounded border-0 px-2.5 py-1 text-xs ${
                  active
                    ? 'bg-surface font-semibold text-accent-strong shadow-sm'
                    : 'bg-transparent text-text-muted hover:text-text'
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* COLOURS ONLY WHERE THEY DO ANYTHING. "No breakdown" writes no
          block, so a palette beside it would be a control with nothing to
          act on. */}
      {palette && value !== 'none' && (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <Swatches label="Primary" colors={colors} value={primary} onChange={onPrimary} />
          <Swatches label="Secondary" colors={colors} value={secondary} onChange={onSecondary} />
        </div>
      )}

      {/* ITS OWN ROW UNDER THE COLOURS, with room around it. The colours
          are two controls on one axis; this is a sentence with a switch,
          and crowding it onto that line made it read as a third swatch. */}
      {value === PERCENTAGES_TABLE_DESIGN && onPercentagesTable && (
        <div className="mt-4 border-t border-border pt-3">
          {/* THE NAME IS VISIBLE, not only on `aria-label`. Toggle puts
              `label` on the element for screen readers and draws nothing,
              so this rendered as a bare switch over a sentence with no
              clue what it was called. Same shape as the modal's own
              SwitchRow: a `label` wrapper, so the words toggle it too. */}
          <label className="flex items-center gap-2.5">
            <Toggle
              checked={percentagesTable}
              onChange={onPercentagesTable}
              label="Include percentage table"
            />
            <span className="text-sm">Include percentage table</span>
          </label>
          {/* What it does, under the name rather than instead of it. Off,
              the rates are already inside every figure; on, each is named. */}
          <p className="mt-1 text-[11px] text-text-muted">
            Names every add on, crypto charge and fee in a block of its own above the
            totals. Off, they stay folded into the figures they belong to.
          </p>
        </div>
      )}

      {Preview && (
        <div className="mt-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-text-faint">
            Sample, at the foot of each group tab
          </p>
          {/* Its own scroll box. The converting design is two pivots side
              by side and is genuinely wider than the modal; the page body
              must never scroll sideways because of it. */}
          {/* The switch reaches the SAMPLE too. A preview showing a shape
              the generated file will not have is worse than no preview. */}
          <div className="overflow-x-auto rounded border border-border bg-surface p-2">
            <Preview fills={fills} adjustmentsInTable={percentagesTable} />
          </div>
        </div>
      )}
    </div>
  );
}
