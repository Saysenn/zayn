import CellInfo from '../display/CellInfo';
/**
 * A label that lives inside the field and floats onto its top border once
 * the field has focus or a value.
 *
 * WHY NOT A CAPTION ABOVE. A caption is always there, doubling the height
 * of every form. A placeholder alone disappears the moment you type, so a
 * filled dropdown reading "EURO" had nothing saying it was the Currency.
 * This is the only arrangement that labels a filled field without costing
 * a row of height per field.
 *
 * NOTCHED, not stacked. The label sits ON the border rather than above the
 * box, so floating it changes nothing about the layout: no field grows, no
 * row reflows, and the grid stays exactly as tall as it was.
 *
 * `filled` is passed rather than read from the DOM because half the fields
 * here are `Select`, which renders a <button> and has no value for
 * :placeholder-shown to look at. One mechanism for both beats two that
 * drift.
 */
export default function FloatingField({
  label, filled, required, hint, textarea = false, className = '', labelClassName = '', children,
}) {
  return (
    <label className={`floating-field ${filled ? 'is-filled' : ''} ${className}`}>
      {children}
      {/* The asterisk inherits the label's colour rather than going red.
          A required field is not an error, and a form of red asterisks
          reads as a form full of problems before anything is typed. */}
      <span className={`floating-field-label ${textarea ? 'is-textarea' : ''} ${labelClassName}`}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {/* An ICON, not a line of helper text under the field. Helper text
            was removed from every form here for making them twice as tall;
            this says the same thing at the moment it is asked for, and
            costs no height at all. Sits in the floated label so it is
            unmistakably about THIS field. See components/CellInfo.jsx for
            the rule it follows. */}
        {hint && (
          <span className="pointer-events-auto ml-1 inline-flex align-middle normal-case tracking-normal">
            <CellInfo label={`About ${label}`}>{hint}</CellInfo>
          </span>
        )}
      </span>
    </label>
  );
}
