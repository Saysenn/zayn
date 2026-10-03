import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { usePeopleFilters } from '../../hooks/usePeople';
import { openPrint, BREAKDOWN_PRESET, PEOPLE_CARDS_TEMPLATE } from '../../helpers/exportPrint';
import { METHOD_LABELS } from '../../templates/pdf/shared';
import Modal from '../modals/Modal';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import { DownloadIcon } from '../icons';

/**
 * The People page's export. One question: WHO.
 *
 * It used to be this page's modal and the Master Sheet's at once — five
 * payout presets, six narrowing dropdowns, three tabs and a format switch.
 * Four of those presets were whole-sheet documents the Master Sheet export
 * already builds, so People was a second door onto the same file.
 *
 * The two are different acts and now look it. The Master Sheet hands over
 * a SHEET. People hands over PEOPLE: one card each, in one PDF, which is
 * the only shape a person has. A person's own page skips this entirely and
 * prints just them.
 */

// Filters this modal shows. Anything else the People page was filtered by
// still applies (see SEEDED_LABELS) but is not editable here.
const OWN_FILTERS = ['group', 'q'];

// The rest of the People page's filters. Seeded, never edited here, and
// listed by name so an export narrowed by a filter you set on the page
// cannot be a surprise. Counting them ("3 filters apply") still makes you
// go and hunt for which.
const SEEDED_LABELS = {
  role: 'Role',
  company: 'Company',
  currency: 'Currency',
  method: 'Method',
  status: 'Status',
  needsReview: 'Needs review',
};

// METHOD_LABELS comes from the PDF templates because that is where it is
// defined; a second spelling of "Bank Transfer" here would let the modal
// and the document it produces disagree about the same filter.
const SEEDED_VALUES = {
  method: METHOD_LABELS,
  status: { active: 'Active', ended: 'Ended' },
  needsReview: { true: 'Flagged only', false: 'Not flagged' },
};

export default function PeopleExportModal({ filters: seed, onClose }) {
  // Seeded from whatever the page was already filtered to, so "export what
  // I'm looking at" needs no re-picking.
  const [filters, setFilters] = useState(() => ({ ...(seed ?? {}) }));
  const { data: options } = usePeopleFilters();

  const params = useMemo(() => ({
    preset: BREAKDOWN_PRESET,
    template: PEOPLE_CARDS_TEMPLATE,
    q: filters.q,
    role: filters.role,
    group: filters.group,
    company: filters.company,
    method: filters.method,
    currency: filters.currency,
    status: filters.status,
    needsReview: filters.needsReview,
  }), [filters]);

  const { data: count, isLoading, error: countError } = useQuery({
    queryKey: ['export-count', params],
    queryFn: () => apiService.exports.count(params),
    // The last figure stays while the next loads, so changing a filter does
    // not blank the box and grey out the button. Same reasoning, and same
    // fix, as the Master Sheet export modal.
    placeholderData: (prev) => prev,
  });

  function setFilter(key, value) {
    setFilters((f) => {
      const next = { ...f };
      if (!value) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  // Clears only what came from the page. Group and person are this modal's
  // own and clearing them here would undo the choice just made.
  function clearSeeded() {
    setFilters((f) => Object.fromEntries(
      Object.entries(f).filter(([k]) => OWN_FILTERS.includes(k)),
    ));
  }

  const seeded = Object.entries(filters)
    .filter(([k, v]) => v && SEEDED_LABELS[k])
    .map(([k, v]) => `${SEEDED_LABELS[k]}: ${SEEDED_VALUES[k]?.[v] ?? v}`);

  function download() {
    openPrint(params);
    onClose();
  }

  return (
    <Modal wide title="Export" onClose={onClose}>
      <div className="space-y-5">
        <Select
          size="form"
          value={filters.group ?? ''}
          onChange={(v) => setFilter('group', v)}
          options={[
            { value: '', label: 'All' },
            ...(options?.groups ?? []).map((g) => ({ value: g, label: g })),
          ]}
          label="Group" placeholder="All"
        />
        {/* Matches on name, which is what the export API's own search does.
            allowCustom so a partial name works too. */}
        <Select
          size="form"
          searchable
          allowCustom
          value={filters.q ?? ''}
          onChange={(v) => setFilter('q', v)}
          options={[
            { value: '', label: 'Everyone' },
            // By NAME here, not by id: this box feeds `q`, a text search,
            // and allowCustom lets a partial name through. The Master Sheet
            // export picks people by id instead, because it is narrowing a
            // payment run and a substring cannot be trusted with that.
            ...(options?.people ?? []).map((p) => ({ value: p.name, label: p.name })),
          ]}
          label="One person" placeholder="Everyone"
        />
        <p className="text-xs text-text-muted">
          Leave both empty to export everyone. A person's own page has an Export button
          that skips this entirely.
        </p>

        {filters.q && count?.people > 1 && (
          <p className="bg-warning-tint px-3 py-2 text-sm">
            &ldquo;{filters.q}&rdquo; matches {count.people} people. Names are matched as
            text, so a short one catches more than you might mean.
          </p>
        )}

        {seeded.length > 0 && (
          <p className="text-xs text-text-muted">
            {seeded.join(' · ')} also apply, from the page.{' '}
            <button
              type="button"
              className="min-h-0 border-0 bg-transparent p-0 text-xs underline hover:text-text"
              onClick={clearSeeded}
            >
              Clear
            </button>
          </p>
        )}

        <div className="border border-border bg-surface-sunken px-3 py-2 text-sm tabular-nums">
          {isLoading ? (
            <span className="text-text-faint">Counting…</span>
          ) : count?.rows ? (
            <span>
              <strong>{count.rows}</strong> {count.rows === 1 ? 'row' : 'rows'} ·{' '}
              <strong>{count.people}</strong> {count.people === 1 ? 'person' : 'people'} ·{' '}
              <strong>{count.groups}</strong> {count.groups === 1 ? 'group' : 'groups'}
            </span>
          ) : countError ? (
            <span className="text-danger">Couldn't count this: {countError.message}</span>
          ) : (
            <span className="text-text-faint">Nothing matches this selection.</span>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button onClick={onClose}>Cancel</Button>
          {/* Disabled only once the count has come back and said zero, never
              while it is still unknown. Waiting on a figure you did not ask
              for is the count blocking the export it exists to describe. */}
          <Button variant="primary" onClick={download} disabled={count?.rows === 0}>
            <DownloadIcon width={15} height={15} />
            Export PDF
          </Button>
        </div>
      </div>
    </Modal>
  );
}
