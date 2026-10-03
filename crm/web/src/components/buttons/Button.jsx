/**
 * The one button.
 *
 * Every toolbar in the CRM is icon + label, so the base `button` rule in
 * index.css already handles layout (inline-flex, gap, nowrap) — a label
 * can never wrap under its own icon. This adds colour and size on top.
 *
 * SIZE MATTERS FOR CONSISTENCY. `sm` is the toolbar size the Master Sheet
 * page established and every other page now matches: 15px icons, px-3
 * py-1.5, text-sm. Passing nothing gets you that, so a new toolbar looks
 * right without anyone measuring the old one.
 *
 * "Make it red" is a one-file change here rather than a grep across pages.
 */

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'bg-surface text-text-muted border-border-strong shadow-sm hover:bg-surface-sunken hover:text-text',
  quiet: 'btn-quiet',
  danger: 'bg-danger-tint text-danger border-transparent font-semibold hover:bg-danger hover:text-white',
  // For "something is on, this turns it off" — clearing filters, mostly.
  //
  // NOT `danger`. Red is what delete and Reset master sheet wear, and it
  // only keeps meaning "this destroys data" if nothing harmless wears it
  // too. Clearing a filter destroys nothing; it puts the default view
  // back. Yellow says the true thing instead: a filter is on and you are
  // looking at a subset.
  warning: 'bg-warning-tint text-warning border-transparent font-semibold hover:bg-warning hover:text-white',
  // The accent, SOFT. `primary` is the solid fill that starts something;
  // this is the same colour saying "this belongs to the app" without
  // claiming to be the main act on the screen. The Review page's History
  // is the case: it sits in the tab row beside three answers, and a second
  // solid green there would read as a fourth answer.
  accent: 'bg-accent-tint text-accent-strong border-transparent font-semibold hover:bg-accent-tint-strong',
};

const SIZES = {
  // For a control inside a dense strip rather than on a toolbar: the
  // export warnings line, which has to stay one thin row.
  xs: 'h-6 min-h-0 px-2 py-0 text-xs',
  // Sits beside a form control. 36px, the same as `.form-control` and
  // `Select size="form"`, so a button next to a dropdown shares its top
  // and bottom edge instead of floating 2px off it.
  form: 'h-9 min-h-0 px-3 py-0 text-sm',
  // The toolbar default. An explicit h-8 rather than padding alone: the
  // base `button {}` rule in index.css also sets px/py/min-h, and which
  // one wins depends on Tailwind's generated source order rather than the
  // class attribute, so buttons resolved to slightly different heights
  // depending on where they were used.
  sm: 'h-8 min-h-0 px-3 py-0 text-sm',
  md: 'px-4 py-2 min-h-10 text-sm',
  // Icon-only. Square, so a lone icon isn't sitting in a wide letterbox.
  icon: 'min-h-0 p-1.5',
};

/**
 * `phase` and `percent` make the button REPORT ITSELF, the same way
 * FileButton already does for uploads and for the same reason: a
 * percentage in a label is a number you stop and read, a filling button is
 * one you see without looking straight at it, and the feedback stays on
 * the control that started the work instead of in a bar somewhere else.
 *
 *   'working'   no honest number yet, so it sweeps rather than sitting at
 *               a percentage it invented
 *   'progress'  a real 0-100 fill
 */
export default function Button({
  variant = 'quiet',
  size = 'sm',
  className = '',
  type = 'button',
  phase = 'idle',
  percent = 0,
  children,
  ...props
}) {
  const busy = phase === 'working' || phase === 'progress';
  return (
    <button
      type={type}
      className={`${VARIANTS[variant] ?? VARIANTS.quiet} ${SIZES[size] ?? SIZES.sm} ${className}
        transition duration-150 hover:scale-[1.01] hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none
        ${busy ? 'relative overflow-hidden' : ''}`}
      {...props}
    >
      {phase === 'progress' && (
        <span className="btn-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      )}
      {phase === 'working' && <span className="btn-fill-indeterminate" />}
      {/* Above the fill, so the label stays readable at every width. */}
      {busy ? <span className="relative inline-flex items-center gap-1.5">{children}</span> : children}
    </button>
  );
}

/**
 * A link that looks and sits exactly like a Button.
 *
 * The base `button {}` rule in index.css does not apply to an <a>, so a
 * styled link has to restate padding, height, border and layout. Doing
 * that by hand is how the Master Sheet's Download link and the People
 * page's Export button ended up subtly different sizes despite both being
 * "the primary green one". They share VARIANTS and SIZES now, so they
 * cannot drift again.
 */
/**
 * `as` is for an INTERNAL route. A plain <a href> to a page inside the app
 * reloads the whole thing, so pass react-router's Link and it renders that
 * instead, wearing exactly these classes.
 */
export function LinkButton({
  as: As = 'a', variant = 'primary', size = 'sm', className = '', ...props
}) {
  return (
    <As
      className={`${VARIANTS[variant] ?? VARIANTS.primary} ${SIZES[size] ?? SIZES.sm} ${className}
        transition duration-150 hover:scale-[1.01] hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none
        inline-flex items-center justify-center gap-1.5 whitespace-nowrap border no-underline`}
      {...props}
    />
  );
}

/**
 * A file picker that looks and sits exactly like a Button.
 *
 * A file input can't be triggered from a <button> without a hidden input
 * and a ref, so this is a <label> wearing the same classes. It exists so
 * the Upload control on People and on Master Sheet are visibly the same
 * control, rather than two hand-styled labels that drift apart.
 *
 * IT REPORTS ITS OWN PROGRESS. Pass `phase` and `percent` and the button
 * fills left to right as the bytes go up. A percentage in the label is a
 * number you have to stop and read; a filling button is one you can see
 * without looking straight at it, and it keeps the feedback on the control
 * that started the work rather than in a bar somewhere else on the page.
 *
 *   phase 'uploading'  a real 0-100% fill, driven by XHR upload.onprogress
 *   phase 'saving'     bytes are up, the server is still parsing and
 *                      writing. Nothing measures that, so the fill sweeps
 *                      rather than sitting at a 100% that reads as done.
 */
export function FileButton({
  variant = 'quiet',
  size = 'sm',
  className = '',
  accept = '.xlsx',
  disabled = false,
  phase = 'idle',
  percent = 0,
  onChange,
  children,
}) {
  const busy = phase === 'uploading' || phase === 'saving';

  return (
    <label
      className={`${VARIANTS[variant] ?? VARIANTS.quiet} ${SIZES[size] ?? SIZES.sm} ${className}
        relative overflow-hidden inline-flex items-center justify-center gap-1.5 whitespace-nowrap
        border cursor-pointer transition duration-150 hover:scale-[1.01] hover:shadow-md
        motion-reduce:transform-none motion-reduce:transition-none ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      {phase === 'uploading' && (
        <span className="btn-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      )}
      {phase === 'saving' && <span className="btn-fill-indeterminate" />}

      {/* Above the fill, so the label stays readable at every width. */}
      <span className="relative inline-flex items-center gap-1.5">{children}</span>

      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled || busy}
        onChange={onChange}
      />
    </label>
  );
}
