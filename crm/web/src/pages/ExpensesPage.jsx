import { useState } from 'react';
import PageHeader, { Toolbar, SearchInput } from '../components/layout/PageHeader';
import Button, { FileButton } from '../components/buttons/Button';
import Select from '../components/forms/Select';
import EditableCell from '../components/forms/EditableCell';
import CellInfo from '../components/display/CellInfo';
import Pagination from '../components/layout/Pagination';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import AddExpense from '../components/modals/AddExpense';
import ExpensesDiffModal from '../components/import/ExpensesDiffModal';
import ExpensesExportModal from '../components/export/ExpensesExportModal';
import NumberRangeFilter from '../components/filters/NumberRangeFilter';
import { TableSkeleton } from '../components/display/Skeleton';
import {
  ReceiptIcon, SearchIcon, PlusIcon, TrashIcon, EditIcon, ImportIcon, DownloadIcon,
} from '../components/icons';
import {
  useExpenses, useExpenseOptions, useCreateExpense, useExpenseCellEdit,
  useDeleteExpense, useImportExpenses, useExportExpenses, useExpenseExportOptions,
} from '../hooks/useExpenses';
import { useStickyState, useClearSticky } from '../hooks/useStickyState';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
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
// A standalone ledger, one month at a time. There is no month picker: the
// server decides which month from the business's clock, so two people in
// two zones read the same ledger at a boundary.
//
// Every row's AED comes from its own stored rate, so nothing here reads the
// Settings rates panel. See docs/expense.md.

const STICKY = 'expenses';

// One row of the table, so the column list is written once.
const asList = (values) => values.map((v) => ({ value: v, label: v }));

export default function ExpensesPage() {
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const [q, setQ] = useStickyState(`${STICKY}.q`, '');
  const [searchField, setSearchField] = useStickyState(`${STICKY}.searchField`, SEARCH_ANY);
  const [groups, setGroups] = useStickyState(`${STICKY}.groups`, []);
  const [currencies, setCurrencies] = useStickyState(`${STICKY}.currencies`, []);
  const [amount, setAmount] = useStickyState(`${STICKY}.amount`, {});
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
    page,
    pageSize: PAGE_SIZE,
  };

  const {
    data: rows, total, aedTotal, missingRate, month, isLoading,
  } = useExpenses(filters);
  const options = useExpenseOptions();
  const create = useCreateExpense();
  const cellEdit = useExpenseCellEdit();
  const removeExpense = useDeleteExpense();
  const importer = useImportExpenses();
  const exporter = useExportExpenses();
  // Only fetched once the modal is open: nobody needs the palette list to
  // read the table.
  const exportOptions = useExpenseExportOptions(exporting);

  const when = month ? monthLabel(month) : null;

  const filterCount = [
    groups.length, currencies.length, amount.field ? 1 : 0,
  ].reduce((a, b) => a + (b ? 1 : 0), 0);

  // Clear FORGETS as well as resets, or the old values come back next visit.
  function clearFilters() {
    setGroups([]); setCurrencies([]);
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

  return (
    <div>
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
        count={isLoading ? undefined : total}
        countLabel="expenses"
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
              placeholder="Any group"
            />
            <Select
              size="sm"
              className="w-40"
              multiple
              value={currencies}
              onChange={onFilter(setCurrencies)}
              options={asList(currencyOptions)}
              placeholder="Any currency"
            />
            <NumberRangeFilter
              fields={AMOUNT_FIELDS}
              value={amount}
              onChange={onFilter(setAmount)}
              placeholder="Any amount"
            />
          </>
        )}
      />

      {/* The total is of the LIVE, FILTERED set and says so, because a
          figure that ignores the filters above it reads as a bug. */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span className="font-semibold text-text">
          {formatMoney(aedTotal, AED)}
        </span>
        <span>
          {when ?? 'this month'}
          {filterCount > 0 || q ? ', matching these filters' : ''}
        </span>
        {missingRate > 0 && (
          <CellInfo tone="warning" label="Rows with no rate">
            {missingRate} {missingRate === 1 ? 'row has' : 'rows have'} no exchange rate, so
            {missingRate === 1 ? ' it is' : ' they are'} not in this total. Set a rate on the row.
          </CellInfo>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-surface-sunken text-left text-text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 font-semibold">Description</th>
              <th className="px-3 py-2 font-semibold">Payee</th>
              <th className="px-3 py-2 font-semibold">Currency</th>
              <th className="px-3 py-2 text-right font-semibold">Raw amount</th>
              <th className="px-3 py-2 text-right font-semibold">Rate</th>
              <th className="px-3 py-2 text-right font-semibold">AED amount</th>
              <th className="px-3 py-2 font-semibold">Group</th>
              <th className="px-3 py-2 font-semibold">Spent by</th>
              <th className="px-3 py-2 font-semibold">Last updated</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableSkeleton columns={11} />
            ) : rows?.length ? rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <EditableCell
                    as="div"
                    type="date"
                    value={row.spent_on}
                    display={formatDate(row.spent_on)}
                    onSave={(v) => saveCell(row, 'spentOn', v)}
                  />
                </td>
                <td className="px-3 py-2">
                  <EditableCell
                    as="div"
                    value={row.description}
                    onSave={(v) => saveCell(row, 'description', v)}
                  />
                </td>
                <td className="px-3 py-2">
                  <EditableCell
                    as="div"
                    type="suggest"
                    suggestions={options.payees}
                    value={row.payee}
                    onSave={(v) => saveCell(row, 'payee', v)}
                  />
                </td>
                <td className="px-3 py-2">
                  <EditableCell
                    as="div"
                    type="suggest"
                    suggestions={currencyOptions}
                    value={row.currency}
                    onSave={(v) => saveCell(row, 'currency', v)}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <EditableCell
                    as="div"
                    type="number"
                    value={row.raw_amount}
                    display={formatMoney(row.raw_amount, row.currency)}
                    onSave={(v) => saveCell(row, 'rawAmount', v)}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    <EditableCell
                      as="div"
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
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
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
                <td className="px-3 py-2">
                  <EditableCell
                    as="div"
                    type="suggest"
                    suggestions={options.groups}
                    value={row.group_name}
                    onSave={(v) => saveCell(row, 'groupName', v)}
                  />
                </td>
                <td className="px-3 py-2">
                  <EditableCell
                    as="div"
                    type="suggest"
                    suggestions={options.spentBy}
                    value={row.spent_by}
                    onSave={(v) => saveCell(row, 'spentBy', v)}
                  />
                </td>
                <td className="px-3 py-2 text-text-faint">{formatDate(row.updated_at)}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    {/* The cells edit in place for a one word fix; this
                        opens the lot at once, which is what you want when
                        several are wrong. Same form as Add. */}
                    <Button
                      size="icon"
                      variant="quiet"
                      aria-label={`Edit ${labelFor(row)}`}
                      onClick={() => setEditingRow(row)}
                    >
                      <EditIcon width={14} height={14} />
                    </Button>
                    <Button
                      size="icon"
                      variant="danger"
                      aria-label={`Delete ${labelFor(row)}`}
                      onClick={() => setConfirming(row)}
                    >
                      <TrashIcon width={14} height={14} />
                    </Button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center">
                  <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-xl bg-accent-tint text-accent-strong">
                    <ReceiptIcon width={18} height={18} />
                  </span>
                  <p className="text-sm font-bold text-text">Nothing here yet</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {filterCount > 0 || q
                      ? 'No expense matches these filters.'
                      : `Nothing recorded for ${when ?? 'this month'} yet.`}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      )}

      {(adding || editingRow) && (
        <AddExpense
          options={options}
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
          onExport={(choices) => exporter.download(choices).then(() => setExporting(false))}
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

      {confirming && (
        <ConfirmDialog
          title={`Delete ${labelFor(confirming)}?`}
          subject={`${formatMoney(confirming.raw_amount, confirming.currency)} on ${formatDate(confirming.spent_on)}`}
          detail={['The row goes for good, and nothing here brings it back.']}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          icon={<TrashIcon width={15} height={15} />}
          busy={removeExpense.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            removeExpense.mutate({ id: confirming.id, label: labelFor(confirming) });
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}
