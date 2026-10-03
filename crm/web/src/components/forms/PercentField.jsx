import { useEffect, useState } from 'react';
import { MAX_PERCENT } from '../../configs/sheetValues';
import FloatingField from './FloatingField';

/**
 * ***************************************************
 * * A percentage, saved on blur
 * ***************************************************
 *
 * ONE COMPONENT, TWO LAYOUTS. It was written twice, once on the person page
 * and once in Settings, differing only in whether the label sits above the
 * box or beside it. Same range, same step, same commit on blur, same Escape
 * to revert.
 *
 * No Save button anywhere it is used: every other value on both pages
 * writes as you leave the field, and one button would be the odd one.
 */
export default function PercentField({
  label, hint, warning, value, disabled, onSave, inline = false,
}) {
  const [draft, setDraft] = useState(String(value ?? 0));

  // Resync when the write lands, or another page changes it. Without this
  // the box keeps whatever was typed, including a value the server rejected.
  useEffect(() => { setDraft(String(value ?? 0)); }, [value]);

  const revert = () => setDraft(String(value ?? 0));
  const commit = () => {
    const n = draft.trim() === '' ? 0 : Number(draft);
    if (!Number.isFinite(n) || n < 0 || n > MAX_PERCENT) return revert();
    if (n !== Number(value ?? 0)) onSave(n);
    return undefined;
  };

  const box = (
    <input
      className={`${inline ? 'w-24 text-sm' : 'w-full text-xs'} text-right tabular-nums`}
      type="number" min={0} max={MAX_PERCENT} step="0.01"
      aria-label={label} data-field={label} value={draft} disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
        if (next === '' || Number(next) >= 0) setDraft(next);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === '-' || e.key === 'Subtract') e.preventDefault();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { revert(); e.currentTarget.blur(); }
      }}
    />
  );

  // Beside the box in Settings, where rates stack in a list. Above it on a
  // profile, where it sits among other captioned fields.
  if (inline) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        {box}
        <span className="text-sm text-text-muted">%</span>
        <span className="text-sm">{label}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <FloatingField
          className="min-w-0 flex-1"
          labelClassName="whitespace-nowrap"
          label={label}
          hint={hint}
          filled={Boolean(draft)}
        >
          {box}
        </FloatingField>
        <span className="text-sm text-text-muted">%</span>
      </div>
      {/* The rates STACK, so a rate set on a row is not replaced by this
          one. Said on both cells, because either can be the one you open. */}
      {warning && <span className="mt-1 block text-[11px] text-warning">{warning}</span>}
    </div>
  );
}
