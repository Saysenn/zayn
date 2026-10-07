import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { useSocketEvent } from './useSocket';
import { useOptimisticUpdate } from './useOptimisticUpdate';
import { useNotifications } from './useNotifications';
import { patchRow as withColumns } from '../helpers/patchRow';
import { aedAmount } from '../helpers/expenseAed';
import { saveBlob } from '../helpers/api.helper';

/**
 * ***************************************************
 * * The expenses ledger
 * ***************************************************
 *
 * A STANDALONE LEDGER. It reads no deal and changes no payout figure, so
 * unlike People and Companies there is no cross page refresh to do: only
 * this page's own writes can move it. See docs/expense.md.
 */

const KEY = ['expenses'];
const OPTIONS_KEY = ['expense-options'];

// Postgres snake_case, API camelCase. Mirrors COLUMN_FOR in
// api/v1/repos/expenses.repo.js. Anything absent is the same word in both.
const COLUMN_FOR = {
  spentOn: 'spent_on',
  rawAmount: 'raw_amount',
  exchangeRate: 'exchange_rate',
  groupName: 'group_name',
  spentBy: 'spent_by',
};

const patchRow = (row, fields) => withColumns(row, fields, COLUMN_FOR);

/** What a row contributes to the page's total, as a number. */
const aedOf = (row) => Number(row?.aed_amount ?? 0) || 0;

/**
 * AED REPAINTS WITH THE CELL THAT CHANGED IT.
 *
 * The server's answer is the generated column; this keeps the row
 * consistent between the keystroke and the refetch landing.
 */
function withAed(row) {
  return { ...row, aed_amount: aedAmount(row.raw_amount, row.exchange_rate) };
}

/** One row changed in place, with the page's total following it. */
function replaceRow(old, id, change) {
  if (!old?.rows) return old;
  let delta = 0;
  const rows = old.rows.map((r) => {
    if (String(r.id) !== String(id)) return r;
    const next = change(r);
    delta = aedOf(next) - aedOf(r);
    return next;
  });
  return { ...old, rows, aedTotal: Number(old.aedTotal ?? 0) + delta };
}

/** One row gone, with the count and the total following it. */
function dropRow(old, id) {
  if (!old?.rows) return old;
  const going = old.rows.find((r) => String(r.id) === String(id));
  if (!going) return old;
  return {
    ...old,
    rows: old.rows.filter((r) => String(r.id) !== String(id)),
    total: Math.max(0, Number(old.total ?? 0) - 1),
    aedTotal: Number(old.aedTotal ?? 0) - aedOf(going),
  };
}

// The whole filter object as the key, never a list of names: an allowlist
// here silently drops any filter added later and serves another filter's
// cached result.
export function useExpenses(filters = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...KEY, filters],
    queryFn: () => apiService.expenses.list(filters),
    // The last answer stays on screen while a new one loads, so changing a
    // filter never blanks the table.
    placeholderData: (prev) => prev,
  });

  useSocketEvent('expenses:changed', () => queryClient.invalidateQueries({ queryKey: KEY }));

  return {
    ...query,
    data: query.data?.rows,
    total: query.data?.total ?? 0,
    aedTotal: query.data?.aedTotal ?? 0,
    // The server's month, never the browser's: the two disagree for ten
    // hours at every boundary.
    month: query.data?.month ?? null,
    // this month, so the page can say when it is showing another one
    current: query.data?.current ?? null,
    // How many rows in this view have no rate, so the page can say so
    // rather than showing a column of blanks with no explanation.
    missingRate: query.data?.missingRate ?? 0,
  };
}

/**
 * Dropdown values and the rate suggestion, in one call.
 *
 * `lastRateByCurrency` is read out of the expenses themselves. Expenses
 * never read tb_fx_rates: every row carries the rate it was entered with.
 */
export function useExpenseOptions() {
  const query = useQuery({
    queryKey: OPTIONS_KEY,
    queryFn: () => apiService.expenses.options(),
    staleTime: 60_000,
  });
  return {
    ...query,
    groups: query.data?.groups ?? [],
    currencies: query.data?.currencies ?? [],
    payees: query.data?.payees ?? [],
    spentBy: query.data?.spentBy ?? [],
    savedBy: query.data?.savedBy ?? [],
    lastRateByCurrency: query.data?.lastRateByCurrency ?? {},
  };
}

/**
 * WHO "SPENT BY" CAN BE: the master sheet's people. A name picked from here
 * is linked on save, so that person can see it on WhatsApp (his call
 * 2026-10-07); any other name is kept as typed and seen by nobody.
 */
export function useExpensePeople() {
  const query = useQuery({
    queryKey: ['expense-people'],
    queryFn: () => apiService.expenses.people(),
    staleTime: 5 * 60_000,
  });
  return { ...query, people: query.data?.people ?? [] };
}

/** The months there are expenses for, newest first, this month always in. */
export function useExpenseMonths() {
  const query = useQuery({
    queryKey: ['expense-months'],
    queryFn: () => apiService.expenses.months(),
    staleTime: 60_000,
  });
  return { ...query, months: query.data?.months ?? [], current: query.data?.current ?? null };
}

export function useCreateExpense() {
  return useOptimisticUpdate({
    queryKey: KEY,
    mutationFn: (fields) => apiService.expenses.create(fields),
    // Prepended rather than sorted in: the row is newest and the default
    // sort is by date, so the top is where it belongs on nearly every view.
    // The refetch puts it in its real place.
    applyToCache: (old, fields) => (old?.rows
      ? {
        ...old,
        rows: [withAed({ id: `pending-${Date.now()}`, ...toRow(fields) }), ...old.rows],
        total: Number(old.total ?? 0) + 1,
        aedTotal: Number(old.aedTotal ?? 0) + (aedAmount(fields.rawAmount, fields.exchangeRate) ?? 0),
      }
      : old),
    describe: (fields) => fields.description || 'that expense',
    verb: () => 'added',
    // A new currency or payee changes what the dropdowns offer.
    alsoInvalidate: [OPTIONS_KEY],
  });
}

/** camelCase in, a row shaped like the cache's out. */
function toRow(fields) {
  return patchRow({}, fields);
}

export function useExpenseCellEdit() {
  return useOptimisticUpdate({
    queryKey: KEY,
    mutationFn: ({ id, fields }) => apiService.expenses.update(id, fields),
    applyToCache: (old, { id, fields }) => replaceRow(old, id, (r) => withAed(patchRow(r, fields))),
    describe: ({ label }) => label ?? 'that expense',
    alsoInvalidate: [OPTIONS_KEY],
  });
}

/**
 * ===============================
 * * THE IMPORT, IN TWO HALVES
 * ===============================
 * Preview parses and compares and writes NOTHING; commit writes only what
 * came back accepted. The rows travel out and back rather than sitting in a
 * server cache, the same shape `useImportFlow` uses for the master sheet.
 *
 * NOT `useImportFlow` itself: that one is bound to the master sheet's three
 * mutations, and an expenses file reaching a deals parser would get far
 * enough to look like it worked.
 */
export function useImportExpenses() {
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  const [phase, setPhase] = useState({ phase: 'idle', percent: 0 });
  const [preview, setPreview] = useState(null);
  const [committing, setCommitting] = useState(false);

  function pick(event) {
    const file = event.target.files?.[0];
    // Reset immediately so picking the SAME file again still fires. Without
    // this, a re-upload after a failed parse silently does nothing.
    event.target.value = '';
    if (!file) return;

    setPhase({ phase: 'uploading', percent: 0 });
    apiService.expenses
      .importPreview(file, (percent) => setPhase({
        percent,
        // 100% means the bytes are gone, not that the work is done.
        phase: percent >= 100 ? 'saving' : 'uploading',
      }))
      .then((result) => {
        setPreview(result);
        setPhase({ phase: 'idle', percent: 0 });
      })
      .catch((err) => {
        setPhase({ phase: 'idle', percent: 0 });
        notify({ level: 'error', message: "Couldn't read that file", detail: err?.message });
      });
  }

  function commit(accepted) {
    setCommitting(true);
    return apiService.expenses
      .importCommit(accepted)
      .then((result) => {
        setPreview(null);
        queryClient.invalidateQueries({ queryKey: KEY });
        queryClient.invalidateQueries({ queryKey: OPTIONS_KEY });
        // THE COUNT IS THE CONFIRMATION, because the count is the surprise.
        notify({
          level: 'success',
          icon: 'check',
          message: `${result.imported} ${result.imported === 1 ? 'expense' : 'expenses'} imported`,
        });
        return result;
      })
      .catch((err) => {
        notify({ level: 'error', message: "Couldn't import those rows", detail: err?.message });
        throw err;
      })
      .finally(() => setCommitting(false));
  }

  return {
    phase, preview, committing, pick, commit, cancel: () => setPreview(null),
  };
}

/** What the export modal offers. Served, so no list is written twice. */
export function useExpenseExportOptions(enabled) {
  return useQuery({
    queryKey: ['expense-export-options'],
    queryFn: () => apiService.expenses.exportOptions(),
    enabled: Boolean(enabled),
    staleTime: 60_000,
  });
}

/** The month as a sheet, with progress, reported either way. */
export function useExportExpenses() {
  const { notify } = useNotifications();
  const [busy, setBusy] = useState(false);

  async function download(params = {}) {
    setBusy(true);
    try {
      const { blob, filename } = await apiService.expenses.download({
        ...params,
        // Arrays go over the wire as one comma list; the route splits them.
        columns: params.columns?.join(','),
        groups: params.groups?.join(','),
        perGroup: params.perGroup ? 'true' : undefined,
      });
      const saved = await saveBlob(blob, filename);
      // Only said once it is actually theirs: they can still cancel the
      // browser's own save dialogue.
      if (saved) notify({ level: 'success', icon: 'check', message: `${filename} saved` });
    } catch (err) {
      notify({ level: 'error', message: "Couldn't build that sheet", detail: err?.message });
    } finally {
      setBusy(false);
    }
  }

  return { busy, download };
}

export function useDeleteExpense() {
  return useOptimisticUpdate({
    queryKey: KEY,
    mutationFn: ({ id }) => apiService.expenses.remove(id),
    applyToCache: (old, { id }) => dropRow(old, id),
    describe: ({ label }) => label ?? 'that expense',
    verb: () => 'deleted',
    successIcon: 'trash',
    alsoInvalidate: [OPTIONS_KEY],
  });
}
