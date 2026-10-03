import { useEffect, useState } from 'react';

/**
 * A DEAL, FILLED IN RATHER THAN DICTATED.
 *
 * Adding a deal used to mean Diane listing twenty field names in a chat
 * bubble and the admin typing the answers back as one sentence, which is
 * hard to read, easy to miss a field in, and impossible to correct without
 * retyping the lot. The fields were always structured on the server
 * (DEAL_CHECKLIST); they were only being flattened into prose on the way
 * out. This renders them as what they are.
 *
 * Same component for adding and editing. An edit arrives with `value`
 * already set on each field, so the only difference is what is in the
 * boxes and what the button says.
 *
 * SUBMITTING SENDS A MESSAGE, it does not write. The values go back to
 * Diane as an ordinary turn and she calls add_deal or
 * update_master_sheet_row herself, so there is ONE write path with one set
 * of validation and one entry in the change log. A form that wrote
 * directly would be a second door onto the same act, and the two would
 * drift.
 *
 * Styled against the overlay, not the CRM: this lives on Diane's dark
 * screen, where the app's own light form controls are unreadable.
 */
/**
 * THREE STATES, NOT TWO, and the third is the default.
 *
 * A payment switch is Yes, No, or nobody has decided. Untouched is null,
 * and the queries resolve that to "should be paid yes, paid no" — which
 * is NOT the same as somebody deciding no. A plain on/off toggle here
 * would mean opening a form to fix a typo and silently recording a
 * payment decision on save, the exact bug the CRM's faded-switch rule
 * exists to prevent.
 *
 * So "Not set" is a real, selectable position, and it is where every
 * untouched field sits.
 */
const TRISTATE = [
  { value: '', label: 'Not set' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

function Tristate({ value, onChange, disabled }) {
  const current = value === '' || value === null || value === undefined ? '' : String(value);
  return (
    <div className="mt-0.5 flex rounded-sm border border-diane-line/30 bg-diane-void p-0.5">
      {TRISTATE.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`min-h-0 flex-1 rounded-sm border-0 px-1 py-0.5 text-[10px] ${
            current === o.value
              ? 'bg-diane-signal font-semibold text-diane-void'
              : 'bg-transparent text-white/45 hover:text-white/80'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function DealForm({ form, onSubmit, disabled }) {
  const [values, setValues] = useState(() => {
    const seed = {};
    for (const f of form.fields) seed[f.field] = f.value ?? '';
    return seed;
  });
  const [sent, setSent] = useState(false);

  /**
   * DICTATED VALUES, ARRIVING AFTER MOUNT.
   *
   * The state above seeds once, which is right for an edit form opening
   * prefilled and wrong the moment Diane types into a form already on
   * screen. Keyed on `version`, bumped by AgentOverlay per fill, so this
   * runs on a NEW fill and not on every re-render.
   *
   * MERGED, not replaced. Anything already typed by hand survives unless
   * the fill names that same field, so dictating the amount does not wipe
   * a name somebody just corrected.
   */
  useEffect(() => {
    if (!form.version) return;
    setValues((v) => {
      const next = { ...v };
      for (const f of form.fields) {
        if (f.value !== '' && f.value !== undefined && f.value !== null) next[f.field] = f.value;
      }
      return next;
    });
    // A fill is a fresh chance to submit: an already-sent form that she
    // then corrects has to be sendable again.
    setSent(false);
  }, [form.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field, value) => setValues((v) => ({ ...v, [field]: value }));

  const missing = form.fields
    .filter((f) => f.required && !String(values[f.field] ?? '').trim())
    .map((f) => f.label);

  function submit() {
    if (missing.length > 0 || sent) return;
    // Only what was actually filled in. Sending empty strings for the
    // eighteen fields nobody touched would have her write blanks over
    // whatever the row already holds on an edit.
    const filled = Object.entries(values)
      .filter(([, v]) => String(v ?? '').trim() !== '')
      .map(([k, v]) => `${k}: ${String(v).trim()}`);
    setSent(true);
    onSubmit(filled, form);
  }

  return (
    <div className="px-0.5">
      <p className="mb-2 text-[11px] font-semibold text-diane-signal">{form.title}</p>

      <div className="grid gap-1.5 [@media(min-width:340px)]:grid-cols-2">
        {form.fields.map((f) => (
          <label key={f.field} className="block">
            <span className="block text-[9px] uppercase tracking-wide text-white/40">
              {f.label}
              {f.required && <span className="text-diane-signal"> *</span>}
            </span>

            {f.input === 'toggle' ? (
              <Tristate
                value={values[f.field]}
                disabled={disabled || sent}
                onChange={(v) => set(f.field, v)}
              />
            ) : f.input === 'select' && f.allowCustom ? (
              <>
                {/* A LIST THAT STILL TAKES A NEW ONE. The options are every
                    value already on the sheet, so picking one is how "Relia
                    PA" stops becoming "Relia Pa" — but a genuinely new
                    company has to be addable or people go and type it
                    somewhere else. `list` gives both in one control. */}
                <input
                  className="mt-0.5 w-full rounded border border-diane-line/30 bg-diane-void px-1.5 py-0.5 text-[11px] text-white placeholder:text-white/20"
                  list={`dl-${f.field}`}
                  value={values[f.field] ?? ''}
                  disabled={disabled || sent}
                  placeholder="Pick one or type a new one"
                  onChange={(e) => set(f.field, e.target.value)}
                />
                <datalist id={`dl-${f.field}`}>
                  {f.options.map((o) => <option key={o} value={o} />)}
                </datalist>
              </>
            ) : f.input === 'select' ? (
              // A CLOSED set (yes/no, active/ended). A real select, because
              // there is nothing to add and a free text box would invite it.
              <select
                className="mt-0.5 w-full rounded border border-diane-line/30 bg-diane-void px-1.5 py-0.5 text-[11px] text-white"
                value={values[f.field] ?? ''}
                disabled={disabled || sent}
                onChange={(e) => set(f.field, e.target.value)}
              >
                <option value="">—</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={f.input}
                className="mt-0.5 w-full rounded border border-diane-line/30 bg-diane-void px-1.5 py-0.5 text-[11px] text-white placeholder:text-white/20"
                value={values[f.field] ?? ''}
                disabled={disabled || sent}
                placeholder={f.note ?? ''}
                onChange={(e) => set(f.field, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>

      {/* NAMES WHAT IS MISSING, rather than grey out a button and leave
          somebody hunting for which of twenty five boxes it meant. */}
      {missing.length > 0 && (
        <p className="mt-2 text-[10px] text-diane-warn">
          Still needed: {missing.join(', ')}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={disabled || sent || missing.length > 0}
        className="mt-2.5 w-full rounded border-0 bg-diane-signal py-1.5 text-[11px] font-bold text-diane-void disabled:opacity-40"
      >
        {sent ? 'Sent' : form.submitLabel}
      </button>
    </div>
  );
}
