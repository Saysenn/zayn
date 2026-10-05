import { useEffect, useRef } from 'react';

/**
 * ***************************************************
 * * ALL, NONE, OR SOME: a checkbox with three states
 * ***************************************************
 *
 * A SELECT ALL IS A CHECKBOX, NEVER A PAIR OF BUTTONS, and `indeterminate`
 * is a DOM PROPERTY rather than an attribute: React will not set it from
 * JSX, so it needs a ref and an effect. Four screens had written that
 * effect out by hand before this existed.
 *
 * The caller says how many are ticked and how many there are. Which of the
 * three states that is, is arithmetic nobody should repeat.
 */
export default function SelectAll({
  count,
  total,
  onChange,
  label,
  // The checkbox's own name when there is no visible label: a header box
  // with no words still has to say what it ticks to a screen reader.
  ariaLabel,
  disabled = false,
}) {
  const ref = useRef(null);
  const all = total > 0 && count === total;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && count < total;
  }, [count, total]);

  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        ref={ref}
        type="checkbox"
        checked={all}
        // The third state is a DISPLAY state. Clicking it means "all of
        // them": half ticked and pressing select all is never a request
        // for none.
        onChange={() => onChange(!all)}
        disabled={disabled || total === 0}
        aria-label={label ? undefined : (ariaLabel ?? 'Select all')}
      />
      {label && <span className="text-xs font-semibold">{label}</span>}
    </label>
  );
}
