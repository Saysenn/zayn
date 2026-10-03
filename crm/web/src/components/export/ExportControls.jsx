// ***************************************************
// * The controls both export modals are built from
// ***************************************************
//
// They lived inside MasterSheetExportModal and BreakdownPicker, which meant
// the expenses modal either imported from a 1000 line component or drew
// lookalikes. Two export modals drawing the same decision two ways is the
// fault SettingRow was written to fix in the first place, one level up.

/**
 * ONE SETTING: its name on the left, its control on the right.
 *
 * The block was three settings that all answer "how does the file come
 * out", drawn three different ways: a toggle, a bordered button with loose
 * text beside it, and a pair of format buttons. Only one of them had a
 * caption. Three idioms stacked read as three unrelated things, so this
 * gives every one of them the same shape and puts every control on one
 * axis.
 */
export function SettingRow({ label, children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * A two-state choice that NAMES BOTH STATES.
 *
 * Replaces a toggle whose meaning lived behind an info icon: you had to
 * hover to find out what "on" did, and hover is not available on the phone
 * this is also used from. Both positions are visible words instead.
 */
export function Choice({ value, onChange, options, disabled = false }) {
  return (
    <div className="inline-flex rounded border border-border bg-surface-sunken p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`min-h-0 rounded border-0 px-2.5 py-1 text-xs ${
              active
                ? 'bg-surface font-semibold text-accent-strong shadow-sm'
                : 'bg-transparent text-text-muted hover:text-text'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * FIVE SWATCHES, NOT A COLOUR WHEEL.
 *
 * Any hex means somebody can produce a total nobody can read on a document
 * people are paid from. Each dot shows the PAIR rather than a colour that
 * is only half of what gets used.
 */
export function Swatches({ label, colors, value, onChange }) {
  return (
    <div className="flex items-center gap-1.5">
      {label && (
        <span className="text-[10px] uppercase tracking-wide text-text-faint">{label}</span>
      )}
      {colors.map((c) => {
        const active = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            title={c.label}
            aria-label={label ? `${label}: ${c.label}` : c.label}
            aria-pressed={active}
            onClick={() => onChange(c.id)}
            className={`min-h-0 h-5 w-5 rounded-full border p-0 ${
              active ? 'border-text ring-1 ring-text' : 'border-border hover:border-text-faint'
            }`}
            // A PALE COLOUR NEEDS AN OUTLINE, or it is a white disc among
            // five coloured ones and reads as the empty option. The border
            // is the type that will sit on the band, which is the same
            // thing that makes it legible in the file. Data driven off
            // `headText`, so a second light colour needs nothing here.
            style={{
              background: `linear-gradient(135deg, ${c.strong} 50%, ${c.soft} 50%)`,
              ...(c.headText === '#000000' ? { borderColor: c.headText } : {}),
            }}
          />
        );
      })}
    </div>
  );
}
