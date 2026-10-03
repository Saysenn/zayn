/**
 * A two-value filter, as a SWITCH.
 *
 * It was a switch, then a checkbox, and it is a switch again on the user's
 * call. The argument against was that a filter has no meaningful "off"
 * state to look at, only an unticked box. In practice the tick was a 16px
 * outline that read as decoration in a row of buttons, and a switch is the
 * one control shape nobody has to interpret.
 *
 * TICKED MEANS "NARROW TO THIS", never "show the opposite". Off is no
 * filter at all, so the default view is everything. A control that meant
 * "ended only" when cleared would silently hide half the list on a page
 * nobody had touched. That rule is why `onChange` sends `undefined` rather
 * than `false`: the filter has to disappear, not invert.
 *
 * Lives beside the search box rather than inside the filter panel: it is
 * one click with no menu behind it, and hiding a one click control behind a
 * disclosure icon is what the icon is for avoiding.
 */
export default function FilterCheckbox({ label, value, onChange }) {
  const on = value === 'true' || value === true;

  return (
    <label className="inline-flex h-8 cursor-pointer select-none items-center gap-2 whitespace-nowrap px-1 text-sm">
      {/* A real checkbox, visually hidden rather than removed — it keeps
          the keyboard behaviour, the focus ring and the screen reader
          announcement that a styled <span> would have thrown away. */}
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked ? 'true' : undefined)}
        className="peer sr-only"
      />

      {/* The track. `peer-focus-visible` puts the ring on this rather than
          on the hidden input, which is where a keyboard user is looking. */}
      <span
        aria-hidden="true"
        className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent-strong peer-focus-visible:outline-offset-2 ${
          on ? 'bg-accent' : 'bg-border-strong'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-surface shadow-sm transition-transform ${
            on ? 'translate-x-[1.05rem]' : 'translate-x-0.5'
          }`}
        />
      </span>

      <span className={on ? 'font-semibold text-text' : 'text-text-muted'}>{label}</span>
    </label>
  );
}
