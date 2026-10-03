// A real on/off switch, not a checkbox — accent when on, red (danger) when
// off, always one or the other, never an ambiguous middle state.
//
// A PILL WITH A ROUND KNOB, now that the app has radii. It was square on
// both, which is the one shape that reads as a broken control rather than
// a switch: a track and a knob are the two things every OS draws round.
export default function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      // justify-start and gap-0 override the base `button` rule in
      // index.css, which centres its children so an icon and a label sit
      // together. That rule is right for every other button and wrong for
      // this one: centring parks the knob in the middle of the track, and
      // the translate-x below then pushes it out past the edge — which is
      // exactly what made these render as broken rectangles.
      className={`relative inline-flex h-5 w-9 min-h-0 shrink-0 items-center justify-start gap-0 rounded-full border-0 p-0 transition-colors ${
        checked ? 'bg-accent' : 'bg-danger'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[1.15rem]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}
