import { useMemo, useState } from 'react';
import Modal from '../modals/Modal';
import Button from '../buttons/Button';
import CellInfo from '../display/CellInfo';
import UnderlineTabs from '../layout/UnderlineTabs';
import SelectAll from '../forms/SelectAll';
import { EmptyState } from '../display/StateBlocks';
import { formatMoney, formatNumber, NO_VALUE } from '../../helpers/formatMoney';
import { formatDate } from '../../helpers/formatDate';
import { aedAmount } from '../../helpers/expenseAed';
import { AED } from '../../configs/expenses.config';

/**
 * ***************************************************
 * * What an expenses file would do, before it does it
 * ***************************************************
 *
 * ITS OWN MODAL, not `ImportDiffModal`. That one is 1370 lines and deal
 * specific at module level, and generalising a working component that
 * decides money is the wrong risk. This one is smaller because a ledger
 * import asks fewer questions: append only, so there is no per cell
 * EXISTING versus INCOMING, no fills and no override guard.
 *
 * NOTHING IS WRITTEN UNTIL CONFIRM. The preview parsed and compared; this
 * sends back only the rows that are still ticked.
 */

const TABS = [
  {
    key: 'new',
    label: 'New',
    tone: 'ok',
    blurb: 'Nothing like these is recorded this month.',
  },
  {
    key: 'duplicate',
    label: 'Looks already recorded',
    tone: 'warn',
    blurb: 'Each of these matches a row already in the month. Two identical spends on one day '
      + 'are two real expenses, so nothing is merged and nothing is ticked: tick only what is genuinely new.',
  },
  {
    key: 'noRate',
    label: 'Needs a rate',
    tone: 'warn',
    blurb: 'The file gave no exchange rate for these. They import with no AED figure and stay out '
      + 'of the month\'s total until you set a rate on the row. Nothing here invents one.',
  },
];

const TONE = {
  ok: 'border-border bg-surface',
  warn: 'border-warning bg-warning-tint',
};

/** Rows start ticked everywhere except the tab that is a question. */
const startsTicked = (tab) => tab !== 'duplicate';

function rowKey(row) {
  return `${row.sheet}:${row.row}`;
}

export default function ExpensesDiffModal({ preview, busy, onConfirm, onCancel }) {
  const { diff, counts, filename, month } = preview;

  const [tab, setTab] = useState(() => TABS.find((t) => counts[t.key] > 0)?.key ?? 'new');
  const [ticked, setTicked] = useState(() => {
    const start = new Set();
    for (const t of TABS) {
      if (!startsTicked(t.key)) continue;
      for (const row of diff[t.key] ?? []) start.add(rowKey(row));
    }
    return start;
  });

  const toggle = (row) => setTicked((set) => {
    const next = new Set(set);
    const key = rowKey(row);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const rows = diff[tab] ?? [];
  const allRows = useMemo(() => TABS.flatMap((t) => diff[t.key] ?? []), [diff]);
  const accepted = useMemo(
    () => allRows.filter((row) => ticked.has(rowKey(row))),
    [allRows, ticked],
  );

  // The figure they are about to add, so the confirm is not a leap.
  const acceptedAed = accepted.reduce(
    (sum, row) => sum + (aedAmount(row.rawAmount, row.exchangeRate) ?? 0),
    0,
  );

  const tabTicked = rows.filter((row) => ticked.has(rowKey(row))).length;
  const allTicked = rows.length > 0 && tabTicked === rows.length;

  function toggleTab() {
    setTicked((set) => {
      const next = new Set(set);
      for (const row of rows) {
        if (allTicked) next.delete(rowKey(row)); else next.add(rowKey(row));
      }
      return next;
    });
  }

  return (
    <Modal title="Import expenses" onClose={busy ? () => {} : onCancel} wide>
      <div className="space-y-3">
        <p className="text-xs text-text-muted">
          <span className="font-semibold text-text">{filename}</span>
          {' · '}{preview.total} {preview.total === 1 ? 'row' : 'rows'} read
          {month ? ` · importing into ${month}` : ''}
        </p>

        <UnderlineTabs
          tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] ?? 0 }))}
          active={tab}
          onChange={setTab}
        />

        <p className="text-xs text-text-muted">{TABS.find((t) => t.key === tab)?.blurb}</p>

        {rows.length === 0 ? (
          <EmptyState title="Nothing on this tab" />
        ) : (
          <>
            {/* A SELECT ALL IS A CHECKBOX, never a pair of buttons. */}
            <div className="text-text-muted">
              <SelectAll
                count={tabTicked}
                total={rows.length}
                onChange={toggleTab}
                label={`${tabTicked} of ${rows.length} ticked on this tab`}
              />
            </div>

            <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-border">
              {rows.map((row) => {
                const aed = aedAmount(row.rawAmount, row.exchangeRate);
                return (
                  <label
                    key={rowKey(row)}
                    className={`flex items-start gap-3 border-b border-border p-2.5 text-xs last:border-0 ${
                      TONE[TABS.find((t) => t.key === tab)?.tone] ?? ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={ticked.has(rowKey(row))}
                      onChange={() => toggle(row)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-text">
                        {row.description || '(no description)'}
                      </span>
                      <span className="block text-text-muted">
                        {formatDate(row.spentOn)}
                        {row.payee ? ` · ${row.payee}` : ''}
                        {row.groupName ? ` · ${row.groupName}` : ''}
                        {row.spentBy ? ` · ${row.spentBy}` : ''}
                      </span>
                      {row.matches?.length > 0 && (
                        <span className="mt-1 block text-text-faint">
                          Already recorded: {row.matches.map((m) => (
                            `${formatDate(m.spentOn)} ${formatMoney(m.rawAmount, m.currency)}`
                          )).join('; ')}
                        </span>
                      )}
                      {row.alsoInFile > 0 && (
                        <span className="mt-1 block text-text-faint">
                          This file lists it {row.alsoInFile + 1} times.
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className="block font-semibold">
                        {formatMoney(row.rawAmount, row.currency)}
                      </span>
                      <span className="block text-text-faint">
                        {row.exchangeRate == null
                          ? 'no rate'
                          : `× ${formatNumber(row.exchangeRate, 4)}`}
                      </span>
                      <span className="block font-semibold text-text">
                        {aed == null ? NO_VALUE : formatMoney(aed, AED)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <span className="mr-auto text-xs text-text-muted">
            <span className="font-semibold text-text">{accepted.length}</span>
            {' '}of {preview.total} ticked
            {acceptedAed > 0 ? `, ${formatMoney(acceptedAed, AED)}` : ''}
          </span>
          <Button size="md" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button
            size="md"
            variant="primary"
            disabled={busy || accepted.length === 0}
            phase={busy ? 'working' : 'idle'}
            onClick={() => onConfirm(accepted)}
          >
            {busy ? 'Importing…' : `Import ${accepted.length}`}
          </Button>
        </div>

        <p className="text-xs text-text-faint">
          <CellInfo label="About importing">
            Nothing is written until you press Import, and only ticked rows are written. Importing
            never overwrites a row that is already here: an expense is a transaction, so a second
            file adds, it does not update.
          </CellInfo>
          {' '}Nothing has been written yet.
        </p>
      </div>
    </Modal>
  );
}
