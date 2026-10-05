import { useState } from 'react';
import Modal from './Modal';
import Button from '../buttons/Button';
import Select, { Field } from '../forms/Select';

// ***************************************************
// * One value onto many deals: the bulk bar's Edit
// ***************************************************
//
// The bar's Edit menu names the field; this asks for the value. One field
// at a time, on purpose: a form of every column across N deals is the
// 25-field editor again, and the one question here is "set X to what".
//
//   type 'pick'   a Select over `options` (allowCustom for free text)
//   type 'month'  a month picker, written as the 1st of that month
//   type 'text'   a plain input

export default function BulkFieldModal({
  title, label, type = 'pick', options = [], allowCustom = false, busy = false, onApply, onClose,
}) {
  const [value, setValue] = useState('');
  const ready = String(value ?? '').trim() !== '';

  function apply() {
    if (!ready || busy) return;
    onApply(type === 'month' ? `${value}-01` : value);
  }

  return (
    <Modal title={title} onClose={busy ? () => {} : onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <Field label={label}>
          {type === 'pick' ? (
            <Select
              size="form"
              searchable={options.length > 8}
              allowCustom={allowCustom}
              value={value}
              onChange={(v) => setValue(v ?? '')}
              options={options}
              placeholder="Pick one"
            />
          ) : (
            <input
              autoFocus
              type={type === 'month' ? 'month' : 'text'}
              className="form-control w-full"
              aria-label={label}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button size="md" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            size="md"
            type="submit"
            variant="primary"
            disabled={!ready || busy}
            phase={busy ? 'working' : 'idle'}
          >
            Apply
          </Button>
        </div>
      </form>
    </Modal>
  );
}
