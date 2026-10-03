import { useState } from 'react';
import Select from '../forms/Select';
import CellInfo from '../display/CellInfo';

/**
 * ***************************************************
 * * The "Active company list" block, as a diff tab.
 * ***************************************************
 *
 * His per-group sheets carry a company table with a Status column. That
 * column is our `tier`: its values are Top Co, T2, TBC, Benched, In prep,
 * `T2 for Reliapay`. `status` is active/closed and is the Close button, a
 * different fact. The tab is called Active Companies, after the block in
 * his own file that it reads.
 *
 * EVERY COMPANY THE FILE LISTED, not only the ones needing a decision. The
 * tab used to show three buckets and hide the rest, so a name you wanted to
 * correct was only reachable if the diff had already called it a problem.
 *
 * TWO HALVES PER ROW:
 *   LEFT   which company this IS. A picker over every company the CRM
 *          holds, near-misses first, and you may type a new name.
 *   RIGHT  its tier and its old group. Both free text with suggestions,
 *          because a closed list would reject his own sheet.
 *
 * WRITTEN ON COMMIT, not on the click. Unlike the delete tabs, a tier
 * overwrites a value rather than destroying a row, so it stays pending with
 * everything else. Every edit here is local state, so it lands instantly
 * and no request is made until Confirm.
 */

// Section order. Flagged first: it is the only part that needs a decision.
const SECTIONS = [
  { state: 'flagged', title: 'Need a decision', tone: 'text-warning' },
  { state: 'changed', title: 'Tier changing' },
  { state: 'new', title: 'New companies' },
  { state: 'unchanged', title: 'Already matching' },
];

const asOptions = (values) => (values ?? []).map((v) => ({ value: v, label: v }));

/**
 * WHAT THE FLAG MEANS AND WHAT TO DO, keyed by the reason the server sends.
 *
 * The reason alone is a label; on its own beside a control it says what is
 * wrong and not what to do about it. An unknown key falls back to the raw
 * reason rather than showing nothing.
 */
const REASON_BODY = {
  'two tiers in this file': [
    'This file lists the company twice with a **different tier each time**, and a company holds one tier.',
    'Pick the one that is right. Nothing is written until you do.',
  ],
  'looks like a company we already have': [
    'The name closely resembles a company the CRM already holds, so this is probably the **same company spelled differently**.',
    'Pick the existing name to correct it, or leave it as typed to create a new company.',
  ],
  'this company is in more than one group': [
    'The company sits in **several groups**, so a single-group file cannot say which one it meant.',
    'Confirm the company before accepting the tier.',
  ],
};

/**
 * WHICH COMPANY THIS ROW IS.
 *
 * Near-misses are listed first and labelled, because they are the reason
 * the picker exists: "Umbrella Co UK" against "Umbrella company uk
 * holdings" is one company typed twice, and creating the second is how a
 * filter forks in half.
 */
function CompanyPicker({ row, value, onChange, allNames }) {
  const near = row.nameOptions ?? [];
  const rest = (allNames ?? []).filter((n) => !near.includes(n));
  return (
    <Select
      size="form"
      className="w-full"
      searchable
      allowCustom
      value={value}
      onChange={(v) => onChange(v ?? '')}
      options={[
        ...near.map((n) => ({ value: n, label: `${n}  (already in the CRM)` })),
        ...asOptions(rest),
      ]}
      placeholder="Company"
    />
  );
}

function Field({ label, value, options, onChange, placeholder }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-text-faint">{label}</span>
      <Select
        size="form"
        className="w-40"
        searchable
        allowCustom
        value={value}
        onChange={(v) => onChange(v ?? '')}
        options={asOptions(options)}
        placeholder={placeholder}
      />
    </label>
  );
}

export default function CompanyTiersTab({ diff, value, onChange }) {
  const {
    rows = [], companyNames = [], tierSuggestions = [], oldGroupSuggestions = [],
    oldGroups = [],
  } = diff ?? {};
  const [collapsed, setCollapsed] = useState(() => new Set(['unchanged']));

  // Keyed on the row's ORIGINAL name, which never changes, so retyping the
  // company does not orphan its own entry.
  const byKey = new Map(value.map((v) => [v.key, v]));

  function set(row, patch) {
    const current = byKey.get(row.company) ?? {
      key: row.company,
      // What will be WRITTEN. The matched CRM name wins over the file's
      // spelling, so accepting a near-miss corrects it rather than
      // creating a second company under the file's wording.
      company: row.matchedName ?? row.company,
      tier: row.tierOptions ? '' : row.tier,
      oldGroup: row.oldGroup ?? '',
      accepted: true,
    };
    const next = { ...current, ...patch, accepted: true };
    onChange([...value.filter((v) => v.key !== row.company), next]);
  }

  function toggle(row, on) {
    if (!on) { onChange(value.filter((v) => v.key !== row.company)); return; }
    set(row, {});
  }

  function toggleSection(state) {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(state)) next.delete(state); else next.add(state);
      return next;
    });
  }

  const actionable = rows.filter((r) => r.state !== 'unchanged');

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{value.length}</span>
          {` of ${rows.length} accepted`}
        </p>
        <button
          type="button"
          className="btn-quiet min-h-0 px-2 py-1 text-xs"
          // A flagged row is a QUESTION, so it is never bulk-accepted: the
          // whole reason it is flagged is that nobody has answered it.
          onClick={() => onChange(
            rows.filter((r) => r.state === 'changed' || r.state === 'new').map((r) => ({
              key: r.company,
              company: r.matchedName ?? r.company,
              tier: r.tier,
              oldGroup: r.oldGroup ?? '',
              accepted: true,
            })),
          )}
        >
          Accept all that are not flagged
        </button>
      </div>

      {/* THE OLD GROUPS THIS FILE MENTIONS. His own earlier naming (Milky,
          Wallaby 1, V3), never one of our groups, so it is stated rather
          than matched against anything. */}
      {oldGroups.length > 0 && (
        <p className="border-b border-border px-3 py-1.5 text-[11px] text-text-muted">
          {`Old groups in this file: ${oldGroups.join(', ')}`}
        </p>
      )}

      {SECTIONS.map(({ state, title, tone }) => {
        const section = rows.filter((r) => r.state === state);
        if (section.length === 0) return null;
        const shut = collapsed.has(state);
        return (
          <div key={state} className="border-b border-border last:border-b-0">
            <button
              type="button"
              className={`btn-quiet min-h-0 w-full justify-start px-3 py-2 text-[11px] font-semibold uppercase tracking-wide ${tone ?? 'text-text-faint'}`}
              onClick={() => toggleSection(state)}
            >
              {title} <span className="tabular-nums">({section.length})</span>
            </button>

            {!shut && section.map((row) => {
              const picked = byKey.get(row.company);
              const on = Boolean(picked);
              return (
                <div
                  key={row.company}
                  className="flex flex-wrap items-end gap-3 border-t border-border px-3 py-2"
                >
                  <input
                    type="checkbox"
                    className="mb-2.5"
                    checked={on}
                    onChange={(e) => toggle(row, e.target.checked)}
                    aria-label={`Accept ${row.company}`}
                  />

                  <div className="min-w-56 flex-1">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-text-faint">
                      Company
                    </span>
                    {/* THE REASON IS AN ICON, NEVER INLINE TEXT. Under the
                        field it added a second line to one row in ten and
                        pushed that row's controls out of step with every
                        other. Beside the picker it is the column the flag
                        is ABOUT, and every row stays one line high. */}
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0 flex-1">
                        <CompanyPicker
                          row={row}
                          allNames={companyNames}
                          value={picked?.company ?? row.matchedName ?? row.company}
                          onChange={(v) => set(row, { company: v })}
                        />
                      </div>
                      {row.reason && (
                        <CellInfo tone="warning" label={row.reason} body={REASON_BODY[row.reason] ?? row.reason} />
                      )}
                    </div>
                  </div>

                  <Field
                    label="Tier"
                    // A CONFLICTED ROW STARTS EMPTY. The file gave two
                    // tiers, so preselecting either would answer the
                    // question the flag exists to ask.
                    value={picked?.tier ?? (row.tierOptions ? '' : row.tier)}
                    options={row.tierOptions ?? tierSuggestions}
                    onChange={(v) => set(row, { tier: v })}
                    placeholder={row.tierOptions ? 'Pick one' : 'Tier'}
                  />

                  <Field
                    label="Old group"
                    value={picked?.oldGroup ?? row.oldGroup ?? ''}
                    options={oldGroupSuggestions}
                    onChange={(v) => set(row, { oldGroup: v })}
                    placeholder="Old group"
                  />

                  {row.currentTier && row.currentTier !== row.tier && (
                    <span className="mb-2.5 text-[11px] text-text-muted">
                      {`was ${row.currentTier}`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {rows.length === 0 && (
        <p className="px-3 py-6 text-center text-sm text-text-muted">
          This file carries no Active company list.
        </p>
      )}
      {rows.length > 0 && actionable.length === 0 && (
        <p className="px-3 py-4 text-center text-sm text-text-muted">
          The company list in this file matches what the CRM already holds.
        </p>
      )}
    </div>
  );
}
