import { useMemo, useState } from 'react';
import PageHeader, { Toolbar, SearchInput } from '../components/layout/PageHeader';
import Button, { FileButton } from '../components/buttons/Button';
import Select from '../components/forms/Select';
import EditableCell from '../components/forms/EditableCell';
import CellInfo from '../components/display/CellInfo';
import Pagination from '../components/layout/Pagination';
import BulkBar, { BulkAction } from '../components/layout/BulkBar';
import SelectAll from '../components/forms/SelectAll';
import Modal from '../components/modals/Modal';
import { EmptyState, ErrorState } from '../components/display/StateBlocks';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import AddExpense from '../components/modals/AddExpense';
import ReceiptViewer from '../components/modals/ReceiptViewer';
import ExpensesDiffModal from '../components/import/ExpensesDiffModal';
import ExpensesExportModal from '../components/export/ExpensesExportModal';
import NumberRangeFilter from '../components/filters/NumberRangeFilter';
import { TableSkeleton } from '../components/display/Skeleton';
import {
  ReceiptIcon, SearchIcon, PlusIcon, TrashIcon, EditIcon, ImportIcon, DownloadIcon,
} from '../components/icons';
import {
  useExpenses, useExpenseOptions, useCreateExpense, useExpenseCellEdit,
  useImportExpenses, useExportExpenses, useExpenseExportOptions,
  useExpensePeople, useExpenseMonths,
} from '../hooks/useExpenses';
import { useStickyState, useClearSticky } from '../hooks/useStickyState';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import useRowSelection from '../hooks/useRowSelection';
import { useStickyColumns } from '../hooks/useStickyColumns';
import useBulkActions, { bulkMessage, patchQueries } from '../hooks/useBulkActions';
import { countOf } from '../helpers/pluralNoun';
import { apiService } from '../configs/api.config';
import { unionOptions } from '../helpers/optionList';
import { formatMoney, formatNumber, NO_VALUE } from '../helpers/formatMoney';
import { formatDate } from '../helpers/formatDate';
import { monthLabel } from '../helpers/monthLabel';
import { EXPENSE_SEARCH_FIELDS, SEARCH_ANY, searchPlaceholder } from '../configs/searchFields';
import {
  AED, SEED_CURRENCIES, PAGE_SIZE, AMOUNT_FIELDS,
} from '../configs/expenses.config';

// ***************************************************
// * Expenses, THIS MONTH AND NOTHING ELSE
// ***************************************************
//
// A standalone ledger, one month at a time. THIS month by default (the
// server decides which month that is, from the business's clock); an
// earlier one only when picked in the month filter, his call 2026-10-07.
// Never sticky: the page always opens on this month.
//
// Every row's AED comes from its own stored rate, so nothing here reads the
// Settings rates panel. See docs/expense.md.

const STICKY = 'expenses';

// One row of the table, so the column list is written once.
const asList = (values) => values.map((v) => ({ value: v, label: v }));

/**
 * THE RECEIPT, OPENED ON THE PAGE in a zoomable window (his call
 * 2026-10-07; it was a new tab). Kept for the current month and the two
 * before (expenses/bot/receipts.js); older says so rather than linking to
 * nothing. Fetched with the sign-in cookie, so it is never a public link.
 */
function ReceiptLink({ row }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [file, setFile] = useState(null);
  if (!row.receipt_path) {
    return row.receipt_cleared_at
      ? <span className="text-[11px] text-text-faint" title="Receipts are kept for 3 months">receipt cleared</span>
      : null;
  }
  const open = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const { blob, filename } = await apiService.expenseReceipt.get(row.id);
      setFile({ blob, filename });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        title={failed ? 'Receipt unavailable' : 'View the receipt'}
        aria-label={`View the receipt for ${row.description}`}
        className="btn-quiet inline-flex h-6 min-h-0 items-center gap-1 rounded border border-border bg-surface px-1.5 py-0 text-[11px] font-medium text-accent-strong hover:border-accent disabled:opacity-50"
      >
        <ReceiptIcon width={12} height={12} />
        {failed ? 'Unavailable' : busy ? '…' : 'Receipt'}
      </button>
      {file && (
        <ReceiptViewer
          file={file}
          title={`${row.description} · ${formatMoney(row.raw_amount, row.currency)} · ${formatDate(row.spent_on)}`}
          onClose={() => setFile(null)}
        />
      )}
    </>
  );
}

export default function ExpensesPage() {
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [exporting, setExporting] = useState(false);

  const [q, setQ] = useStickyState(`${STICKY}.q`, '');
  const [searchField, setSearchField] = useStickyState(`${STICKY}.searchField`, SEARCH_ANY);
  const [groups, setGroups] = useStickyState(`${STICKY}.groups`, []);
  const [currencies, setCurrencies] = useStickyState(`${STICKY}.currencies`, []);
  const [amount, setAmount] = useStickyState(`${STICKY}.amount`, {});
  const [savedBy, setSavedBy] = useStickyState(`${STICKY}.savedBy`, []);
  const [linked, setLinked] = useStickyState(`${STICKY}.linked`, '');
  // '' is this month; not sticky, so a visit never opens on an old month
  const [viewMonth, setViewMonth] = useState('');
  const forget = useClearSticky(STICKY);

  // The box types faster than the server answers, so the request follows
  // the pause rather than the keystroke.
  const debouncedQ = useDebouncedValue(q, 300);

  const filters = {
    q: debouncedQ || undefined,
    searchField: searchField || undefined,
    groups,
    currencies,
    amountField: amount.field || undefined,
    amountMin: amount.min || undefined,
    amountMax: amount.max || undefined,
    savedBy,
    linked: linked || undefined,
    month: viewMonth || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const {
    data: rows, total, aedTotal, missingRate, month, isLoading, error, refetch,
  } = useExpenses(filters);
  const options = useExpenseOptions();
  const { people } = useExpensePeople();
  const { months } = useExpenseMonths();
  // "Spent by" offers the master sheet's people first, then names used before
  const peopleNames = useMemo(() => people.map((p) => p.name), [people]);
  const spenderOptions = useMemo(() => unionOptions(peopleNames, options.spentBy), [peopleNames, options.spentBy]);
  const create = useCreateExpense();
  const cellEdit = useExpenseCellEdit();
  const importer = useImportExpenses();
  const exporter = useExportExpenses();
  // Only fetched once the modal is open: nobody needs the palette list to
  // read the table.
  const exportOptions = useExpenseExportOptions(exporting);

  const when = month ? monthLabel(month) : null;

  const filterCount = [
    groups.length, currencies.length, amount.field ? 1 : 0, savedBy.length, linked ? 1 : 0, viewMonth ? 1 : 0,
  ].reduce((a, b) => a + (b ? 1 : 0), 0);

  // Clear FORGETS as well as resets, or the old values come back next visit.
  function clearFilters() {
    setGroups([]); setCurrencies([]); setSavedBy([]); setLinked(''); setViewMonth('');
    setAmount({}); setQ(''); setSearchField(SEARCH_ANY);
    setPage(1);
    forget();
  }

  const onFilter = (setter) => (value) => { setter(value); setPage(1); };

  // One label for every toast and confirm, so a row is named the same way
  // wherever it is mentioned.
  const labelFor = (row) => row.description || `expense #${row.id}`;

  function saveCell(row, field, value) {
    cellEdit.mutate({ id: row.id, fields: { [field]: value }, label: labelFor(row) });
  }

  const currencyOptions = unionOptions(options.currencies, SEED_CURRENCIES);

  // Ticked rows for the bulk bar. Only real rows: an optimistic one still
  // has a `pending-` id the server has never heard of.
  const visibleIds = useMemo(
    () => (rows ?? []).map((r) => r.id).filter((id) => !String(id).startsWith('pending-')),
    [rows],
  );
  const sel = useRowSelection(visibleIds);
  // THE TICK, DATE AND DESCRIPTION STAY PUT while the rest scrolls sideways
  // (his call 2026-10-07): the same freeze People and the Master Sheet use
  const tableRef = useStickyColumns(3, [rows, page]);
  const { run } = useBulkActions();
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // A ledger, not deals: nothing else reads an expense, so only its own
  // two caches move.
  const EXPENSE_KEYS = [['expenses'], ['expense-options']];

  /**
   * THE BAR NEVER WAITS. Both acts land on every cached page at once, the
   * toast says so straight away, and a failure puts the rows back.
   * `change(row)` returns the new row, or null to drop it; the page's
   * count and AED total follow whatever moved.
   */
  const patchExpenses = (ids, change) => (qc) => {
    const want = new Set(ids.map(String));
    const aedOf = (r) => Number(r?.aed_amount ?? 0) || 0;
    return patchQueries(qc, [['expenses']], (old) => {
      if (!Array.isArray(old?.rows)) return old;
      let gone = 0;
      let delta = 0;
      const rows = [];
      for (const r of old.rows) {
        if (!want.has(String(r.id))) { rows.push(r); continue; }
        const next = change(r);
        delta += aedOf(next) - aedOf(r);
        if (next) rows.push(next); else gone += 1;
      }
      return {
        ...old,
        rows,
        total: Math.max(0, Number(old.total ?? 0) - gone),
        aedTotal: Number(old.aedTotal ?? 0) + delta,
      };
    });
  };

  // The bulk fields, camelCase, onto the cached row's snake_case columns.
  const BULK_COLUMN = { groupName: 'group_name', spentBy: 'spent_by', currency: 'currency' };

  function bulkEdit(fields, label) {
    const ids = sel.ids;
    const cols = Object.fromEntries(Object.entries(fields).map(([k, v]) => [BULK_COLUMN[k] ?? k, v]));
    run({
      call: () => apiService.expenses.bulkUpdate(ids, fields),
      invalidates: EXPENSE_KEYS,
      optimistic: patchExpenses(ids, (r) => ({ ...r, ...cols })),
      toast: bulkMessage(`given a new ${label}`, ids.length, 'expense'),
      report: (data) => bulkMessage(`given a new ${label}`, data.updated.length, 'expense'),
      failure: `Couldn't update ${countOf(ids.length, 'expense')}`,
    });
    setBulkEditing(false);
    sel.clear();
  }

  function bulkDelete() {
    const ids = sel.ids;
    run({
      call: () => apiService.expenses.bulkDelete(ids),
      invalidates: EXPENSE_KEYS,
      optimistic: patchExpenses(ids, () => null),
      toast: bulkMessage('deleted', ids.length, 'expense'),
      report: (data) => bulkMessage('deleted', data.deleted.length, 'expense'),
      icon: 'trash',
      failure: `Couldn't delete ${countOf(ids.length, 'expense')}`,
    });
    setBulkDeleting(false);
    sel.clear();
  }

  // A ROW OPENS THE WHOLE FORM, the same one Add uses. The cells still
  // edit in place for a one word fix: they stop their own click. A row
  // still saving (`pending-`) has nothing on the server to edit yet.
  const openRow = (row) => {
    if (!String(row.id).startsWith('pending-')) setEditingRow(row);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Expenses"
        // NAMED, never "this month". A month the reader has to work out is a
        // month they can get wrong.
        subtitle={when ? `Money going out, ${when}` : 'Money going out, beside the money coming in'}
        // ONE GROUP, READ LEFT TO RIGHT: take a copy out, bring a file in,
        // add one by hand. The primary sits last, where the eye lands.
        actions={(
          <>
            {/* A modal, not a straight download: the file is columns,
                groups, one file or several, and a colour. A link cannot
                ask. */}
            <Button variant="quiet" disabled={isLoading} onClick={() => setExporting(true)}>
              <DownloadIcon width={15} height={15} />
              Export
            </Button>
            <FileButton
              phase={importer.phase.phase}
              percent={importer.phase.percent}
              onChange={importer.pick}
            >
              <ImportIcon width={15} height={15} />
              Import
            </FileButton>
            <Button variant="primary" onClick={() => setAdding(true)}>
              <PlusIcon width={15} height={15} />
              Add expense
            </Button>
          </>
        )}
      />

      <Toolbar
        storageKey={STICKY}
        // HOW MANY, beside the filter button that narrows it; WHAT THEY COME
        // TO, on the right where the eye ends (his call 2026-10-07)
        inline={!isLoading && (
          <span className="text-xs tabular-nums text-text-faint">{countOf(total, 'expense')}</span>
        )}
        actions={(
          <span className="inline-flex items-center gap-1.5 text-xs">
            {/* The total is of the LIVE, FILTERED set and says so, because
                a figure that ignores the filters reads as a bug. */}
            <span className="font-semibold tabular-nums text-text">{formatMoney(aedTotal, AED)}</span>
            <span className="text-text-muted">
              {when ?? 'this month'}
              {filterCount > 0 || q ? ', filtered' : ''}
            </span>
            {missingRate > 0 && (
              <CellInfo tone="warning" label="Rows with no rate">
                {missingRate} {missingRate === 1 ? 'row has' : 'rows have'} no exchange rate, so
                {missingRate === 1 ? ' it is' : ' they are'} not in this total. Set a rate on the row.
              </CellInfo>
            )}
          </span>
        )}
        filtersActive={filterCount > 0}
        filtersCount={filterCount}
        onClearFilters={clearFilters}
        search={(
          <>
            {/* The field picker sits with the box, so what is being searched
                is never a guess. People live here, not in the filters. */}
            <Select
              size="sm"
              className="w-36"
              value={searchField}
              onChange={(v) => { setSearchField(v ?? SEARCH_ANY); setPage(1); }}
              options={EXPENSE_SEARCH_FIELDS.map((f) => ({ value: f.value, label: f.label }))}
            />
            <SearchInput
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder={searchPlaceholder(searchField, EXPENSE_SEARCH_FIELDS)}
              icon={SearchIcon}
            />
          </>
        )}
        filters={(
          <>
            <Select
              size="sm"
              className="w-44"
              multiple
              searchable
              value={groups}
              onChange={onFilter(setGroups)}
              options={asList(options.groups)}
              placeholder="All groups"
            />
            <Select
              size="sm"
              className="w-40"
              multiple
              value={currencies}
              onChange={onFilter(setCurrencies)}
              options={asList(currencyOptions)}
              placeholder="All currencies"
            />
            <NumberRangeFilter
              fields={AMOUNT_FIELDS}
              value={amount}
              onChange={onFilter(setAmount)}
              placeholder="Any amount"
            />
            {/* AN EARLIER MONTH, only when picked: the page opens on this one */}
            <Select
              size="sm"
              className="w-40"
              value={viewMonth}
              onChange={(v) => { setViewMonth(v && v !== months[0] ? v : ''); setPage(1); }}
              options={months.map((m, i) => ({ value: i === 0 ? '' : m, label: i === 0 ? `This month (${monthLabel(m)})` : monthLabel(m, true) }))}
              placeholder="This month"
            />
            <Select
              size="sm"
              className="w-40"
              multiple
              value={savedBy}
              onChange={onFilter(setSavedBy)}
              options={[...asList(options.savedBy), { value: '(blank)', label: 'Not recorded' }]}
              placeholder="Saved by anyone"
            />
            <Select
              size="sm"
              className="w-40"
              value={linked}
              onChange={(v) => { setLinked(v ?? ''); setPage(1); }}
              options={[
                { value: '', label: 'Linked or not' },
                { value: 'yes', label: 'Linked to a person' },
                { value: 'no', label: 'Not linked' },
              ]}
              placeholder="Linked or not"
            />
          </>
        )}
      />

      <ErrorState error={error} title="Couldn't load expenses" onRetry={refetch} />

      <div className="table-wrap">
        <table ref={tableRef} className="w-full min-w-[900px] text-sm">
          <thead>
            <tr>
              <th className="th sticky-col w-8"><SelectAll count={sel.count} total={sel.total} onChange={sel.setAll} /></th>
              <th className="th sticky-col">Date</th>
              <th className="th sticky-col sticky-edge">Description</th>
              <th className="th">Payee</th>
              <th className="th">Category</th>
              <th className="th">Currency</th>
              <th className="th text-right tabular-nums">Raw amount</th>
              <th className="th text-right tabular-nums">Rate</th>
              <th className="th text-right tabular-nums">AED amount</th>
              <th className="th">Group</th>
              <th className="th">Spent by</th>
              <th className="th">Saved by</th>
              <th className="th">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableSkeleton columns={13} />
            ) : rows?.length ? rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                role="link"
                aria-label={`Edit ${labelFor(row)}`}
                onClick={() => openRow(row)}
                onKeyDown={(e) => {
                  // The row's own Enter only: a cell's Enter starts its
                  // inline edit, and must not throw the form over it.
                  if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); openRow(row); }
                }}
                className={`cursor-pointer hover:bg-surface-sunken ${sel.has(row.id) ? 'row-selected' : ''}`}
              >
                <td className="td sticky-col w-8" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={sel.has(row.id)}
                    onChange={() => sel.toggle(row.id)}
                    disabled={String(row.id).startsWith('pending-')}
                    aria-label={`Select ${labelFor(row)}`}
                  />
                </td>
                {/* EditableCell IS the <td>, so it takes the table's own
                    `.td` padding instead of sitting inside a second one. */}
                <EditableCell
                  className="sticky-col"
                  type="date"
                  value={row.spent_on}
                  display={formatDate(row.spent_on)}
                  onSave={(v) => saveCell(row, 'spentOn', v)}
                />
                <EditableCell
                  className="sticky-col sticky-edge font-medium text-text"
                  value={row.description}
                  onSave={(v) => saveCell(row, 'description', v)}
                />
                <EditableCell
                  type="suggest"
                  suggestions={options.payees}
                  value={row.payee}
                  onSave={(v) => saveCell(row, 'payee', v)}
                />
                {/* CATEGORY AND RECEIPT, one compact cell beside the payee:
                    two columns at the far end sat off screen (2026-10-07) */}
                <td className="td whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="capitalize text-text-muted">{row.category ?? NO_VALUE}</span>
                    <ReceiptLink row={row} />
                  </span>
                </td>
                <EditableCell
                  type="suggest"
                  suggestions={currencyOptions}
                  value={row.currency}
                  onSave={(v) => saveCell(row, 'currency', v)}
                />
                <EditableCell
                  className="text-right tabular-nums"
                  type="number"
                  value={row.raw_amount}
                  display={formatMoney(row.raw_amount, row.currency)}
                  onSave={(v) => saveCell(row, 'rawAmount', v)}
                />
                <td className="td text-right tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    {/* A div inside the td here, for the info icon beside
                        it, so its own `.td` padding and rule are dropped. */}
                    <EditableCell
                      as="div"
                      className="!border-0 !p-0"
                      type="number"
                      value={row.exchange_rate}
                      display={row.exchange_rate == null ? NO_VALUE : formatNumber(row.exchange_rate, 4)}
                      onSave={(v) => saveCell(row, 'exchangeRate', v)}
                    />
                    <CellInfo label="About this rate">
                      AED per 1 {row.currency}. This row&apos;s own, stored when it was entered:
                      changing the rates in Settings never moves it.
                    </CellInfo>
                  </span>
                </td>
                {/* NEVER EDITABLE. The database generates it from the two
                    cells to the left. */}
                <td className="td text-right font-semibold tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    {row.aed_amount == null ? NO_VALUE : formatMoney(row.aed_amount, AED)}
                    <CellInfo
                      tone={row.aed_amount == null ? 'warning' : 'info'}
                      label="About the AED amount"
                    >
                      {row.aed_amount == null
                        ? 'No rate on this row, so there is nothing to convert. Set the rate.'
                        : 'Raw amount times this row\'s rate. Change either one to change it.'}
                    </CellInfo>
                  </span>
                </td>
                <EditableCell
                  type="suggest"
                  suggestions={options.groups}
                  value={row.group_name}
                  onSave={(v) => saveCell(row, 'groupName', v)}
                />
                {/* WHO SPENT IT, and whether it is linked to a master sheet
                    person: only a linked one can be seen by them on WhatsApp */}
                <td className="td">
                  <span className="inline-flex items-center gap-1">
                    <EditableCell
                      as="div"
                      className="!border-0 !p-0"
                      type="suggest"
                      suggestions={spenderOptions}
                      value={row.spent_by}
                      onSave={(v) => saveCell(row, 'spentBy', v)}
                    />
                    {row.spent_by && !row.spent_by_person_id && !row.spent_by_phone && (
                      <CellInfo tone="warning" label="Not linked to a person">
                        Not matched to anyone on the master sheet, so nobody sees it on WhatsApp.
                        Pick their name from the list to link it.
                      </CellInfo>
                    )}
                  </span>
                </td>
                <td className="td whitespace-nowrap text-text-muted">{row.saved_by ?? NO_VALUE}</td>
                <td className="td text-text-faint">{formatDate(row.updated_at)}</td>
              </tr>
            )) : !error && (
              <EmptyState
                asRow
                colSpan={13}
                icon={ReceiptIcon}
                title={filterCount > 0 || q ? 'No expense matches these filters' : 'Nothing here yet'}
                hint={filterCount > 0 || q ? undefined : `Nothing recorded for ${when ?? 'this month'} yet.`}
              />
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      )}

      {(adding || editingRow) && (
        <AddExpense
          options={{ ...options, spentBy: spenderOptions, people: peopleNames }}
          expense={editingRow}
          busy={create.isPending || cellEdit.isPending}
          onClose={() => { setAdding(false); setEditingRow(null); }}
          onSave={(fields, opts) => {
            if (editingRow) {
              cellEdit.mutate(
                { id: editingRow.id, fields, label: labelFor(editingRow) },
                { onSuccess: () => setEditingRow(null) },
              );
              return;
            }
            create.mutate(fields, {
              // Save and add another leaves the modal up and hands the form
              // back its repeated fields.
              onSuccess: () => (opts?.keepOpen ? opts.onDone?.() : setAdding(false)),
            });
          }}
        />
      )}

      {exporting && (
        <ExpensesExportModal
          options={exportOptions.data}
          loading={exportOptions.isLoading}
          busy={exporter.busy}
          month={when}
          onClose={() => setExporting(false)}
          onExport={(choices) => exporter.download({ ...choices, month: viewMonth || undefined }).then(() => setExporting(false))}
        />
      )}

      {importer.preview && (
        <ExpensesDiffModal
          preview={importer.preview}
          busy={importer.committing}
          onCancel={importer.cancel}
          onConfirm={(accepted) => importer.commit(accepted)}
        />
      )}

      {bulkEditing && (
        <BulkEditExpenses
          count={sel.count}
          options={{ groups: options.groups, spentBy: spenderOptions, currencies: currencyOptions }}
          onClose={() => setBulkEditing(false)}
          onApply={bulkEdit}
        />
      )}

      {bulkDeleting && (
        <ConfirmDialog
          title={`Delete ${sel.count} ${sel.count === 1 ? 'expense' : 'expenses'}?`}
          subject={`${sel.count} selected on this page.`}
          detail={['The rows go for good, and nothing here brings them back.']}
          confirmLabel={`Delete ${sel.count}`}
          busyLabel="Deleting…"
          icon={<TrashIcon width={15} height={15} />}
          onCancel={() => setBulkDeleting(false)}
          onConfirm={bulkDelete}
        />
      )}

      <BulkBar count={sel.count} noun="expense" onClear={sel.clear}>
        <BulkAction icon={EditIcon} onClick={() => setBulkEditing(true)}>Edit</BulkAction>
        <BulkAction icon={TrashIcon} variant="danger" onClick={() => setBulkDeleting(true)}>
          Delete
        </BulkAction>
      </BulkBar>
    </div>
  );
}

/**
 * ONE FIELD ONTO EVERY TICKED EXPENSE: group, who spent it, or the
 * currency. Any value is allowed, the same as the cell itself, so the
 * dropdowns offer what exists and take what you type.
 */
const BULK_FIELDS = [
  { value: 'groupName', label: 'Group', from: 'groups' },
  { value: 'spentBy', label: 'Spent by', from: 'spentBy' },
  { value: 'currency', label: 'Currency', from: 'currencies' },
];

function BulkEditExpenses({ count, options, onApply, onClose }) {
  const [field, setField] = useState('groupName');
  const [value, setValue] = useState('');
  const spec = BULK_FIELDS.find((f) => f.value === field) ?? BULK_FIELDS[0];

  return (
    <Modal title={`Edit ${count} ${count === 1 ? 'expense' : 'expenses'}`} onClose={onClose}>
      <div className="space-y-3">
        <Select
          label="Field"
          size="form"
          value={field}
          onChange={(v) => { setField(v ?? 'groupName'); setValue(''); }}
          options={BULK_FIELDS.map(({ value: v, label }) => ({ value: v, label }))}
        />
        <Select
          key={field}
          label={spec.label}
          size="form"
          allowCustom
          value={value}
          onChange={(v) => setValue(v ?? '')}
          options={asList(options[spec.from] ?? [])}
          placeholder={`Pick or type a ${spec.label.toLowerCase()}`}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button size="md" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            size="md"
            variant="primary"
            disabled={!value}
            onClick={() => onApply({ [field]: value }, spec.label.toLowerCase())}
          >
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
