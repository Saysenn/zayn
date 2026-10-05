import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { useNotifications } from './useNotifications';
import { countOf, pluralNoun } from '../helpers/pluralNoun';

// ***************************************************
// * What the bulk bar's buttons actually do
// ***************************************************

/**
 * Everything a deal touches. A bulk write on deals changes People,
 * Companies, the Archive, the Review queue and every filter built from
 * them, the same list a single master sheet write drops.
 */
export const DEAL_TOUCHES = [
  ['master-sheet'], ['people'], ['person'], ['companies'], ['company'], ['groups'],
  ['people-filters'], ['company-names'], ['people-duplicates'], ['history'], ['export-count'],
  ['archive'], ['dead-people'], ['monthly-review'], ['dashboard'],
];

const plural = countOf;

/**
 * ONE WORDING FOR EVERY BULK TOAST: what happened, to how many, and what
 * was left alone and why. "Paid set on 1 deal · 2 already paid".
 */
export function bulkMessage(verb, done, noun, notes = []) {
  const extra = notes.filter(([n]) => n > 0).map(([n, why]) => `${n} ${why}`);
  return {
    message: done > 0 ? `${plural(done, noun)} ${verb}` : `No ${pluralNoun(noun, 0)} ${verb}`,
    detail: extra.length ? extra.join(' · ') : undefined,
  };
}

// ***************************************************
// * Patching every cached copy of a list at once
// ***************************************************

/**
 * The arrays a cached list keeps its rows in. Caches differ in shape: the
 * master sheet's is `{ rows, total }`, People's is a plain array, a detail
 * page nests its deals. One walker covers them, so a page only says WHICH
 * rows change and how, never where they live.
 */
const ROW_KEYS = ['rows', 'items', 'data', 'deals', 'people', 'companies', 'expenses', 'logs', 'threads', 'entries'];
const TOTAL_KEYS = ['total', 'count', 'totalCount'];

/**
 * (data, fn) → data with `fn(row)` applied to every row-like object found
 * in arrays at the top level or under ROW_KEYS (one level of nesting, plus
 * infinite-query `pages`). `fn` returns the row (kept), a new row
 * (replaced) or null (removed). A `total`/`count` beside a list shrinks by
 * however many rows were removed from it, so "1,204 deals" moves too.
 */
export function mapCachedRows(data, fn) {
  if (data == null) return data;
  if (Array.isArray(data)) {
    let changed = false;
    const out = [];
    for (const row of data) {
      if (row == null || typeof row !== 'object') { out.push(row); continue; }
      const next = fn(row);
      if (next !== row) changed = true;
      if (next != null) out.push(next);
    }
    return changed ? out : data;
  }
  if (typeof data !== 'object') return data;
  if (Array.isArray(data.pages)) {
    const pages = data.pages.map((p) => mapCachedRows(p, fn));
    return pages.some((p, i) => p !== data.pages[i]) ? { ...data, pages } : data;
  }
  let out = data;
  for (const k of ROW_KEYS) {
    const list = data[k];
    if (list == null || typeof list !== 'object') continue;
    const next = mapCachedRows(list, fn);
    if (next === list) continue;
    if (out === data) out = { ...data };
    out[k] = next;
    if (Array.isArray(list) && Array.isArray(next)) {
      const gone = list.length - next.length;
      for (const t of TOTAL_KEYS) {
        if (gone > 0 && typeof data[t] === 'number') out[t] = Math.max(0, data[t] - gone);
      }
    }
  }
  return out;
}

/**
 * Snapshot every query under each prefix, apply `update` to all of them,
 * and hand back the function that puts the snapshot back. Prefixes, not
 * exact keys: a list is cached once per filter, page and sort, and the
 * row you ticked may be sitting in several of them.
 */
export function patchQueries(queryClient, prefixes, update) {
  const snapshot = [];
  for (const prefix of prefixes) {
    // A refetch already in flight would land after this and paint the
    // pre-action rows back for a moment.
    queryClient.cancelQueries({ queryKey: prefix });
    for (const [key, data] of queryClient.getQueriesData({ queryKey: prefix })) {
      snapshot.push([key, data]);
      if (data === undefined) continue;
      const next = update(data, key);
      if (next !== data) queryClient.setQueryData(key, next);
    }
  }
  return () => snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
}

/**
 * The common case in one line: patch (or drop, by returning null) every
 * cached row whose `idOf(row)` is in `ids`, under every prefix.
 */
export function patchRows(queryClient, prefixes, ids, fn, idOf = (r) => r.id) {
  const want = new Set(ids.map(String));
  return patchQueries(queryClient, prefixes, (data) => mapCachedRows(data, (row) => (
    want.has(String(idOf(row))) ? fn(row) : row
  )));
}

/** Several rollbacks as one, undone in reverse. */
export function rollbackAll(...fns) {
  return () => fns.filter(Boolean).reverse().forEach((f) => f());
}

/**
 * Runs one bulk write WITHOUT MAKING ANYONE WAIT FOR IT.
 *
 *   run({
 *     call: () => apiService.masterSheet.bulkStop(ids),
 *     optimistic: (qc) => patchRows(qc, [['master-sheet']], ids, () => null), // returns rollback
 *     toast: bulkMessage('stopped', ids.length, 'deal'),   // shown at once
 *     report: (data) => bulkMessage('stopped', data.stopped.length, 'deal', …), // corrects it
 *     undoBatch: (data) => data.batchId,   // adds Undo to the toast at once
 *     failure: "Couldn't stop 3 deals",
 *   });
 *   sel.clear();   // straight away, not after an await
 *
 * The screen changes and the toast says so the instant you click. The
 * request runs behind it: success refetches the touched caches (the
 * server is the final word), a failure puts every patched cache back and
 * swaps the toast for an error. Nothing is ever disabled while it saves,
 * so the bar is ready for the next action immediately.
 *
 * Undo pressed before the server has answered puts the old rows back on
 * screen at once, waits for the write to land, then reverts its batch.
 *
 * The returned promise resolves to the server's answer, or null when it
 * failed (already reported). It never rejects, so nobody has to catch it.
 */
export default function useBulkActions() {
  const queryClient = useQueryClient();
  const { notify, dismissToast, updateToast } = useNotifications();
  // Writes still in the air. Only the last to settle refetches, or an
  // early refetch paints a later click's optimistic rows back to before.
  // What each of them touched is collected until then.
  const inFlight = useRef(0);
  const touched = useRef([]);

  const invalidate = useCallback((keys) => {
    for (const key of keys) queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient]);

  // `write` is { pending, batchId() }: the request may not have answered yet.
  const undo = useCallback(async (write, rollback, keys) => {
    rollback?.();
    const data = await write.pending;
    if (data == null) return; // the write itself failed and was already rolled back
    const batchId = write.batchId();
    try {
      if (!batchId) return;
      const { reverted, failed } = await apiService.history.revertMany({ batchId });
      notify({
        level: failed?.length ? 'warning' : 'success',
        icon: 'undo',
        message: `${plural(reverted, 'change')} undone`,
        detail: failed?.length ? `${failed.length} could not be put back` : undefined,
      });
    } catch (err) {
      notify({ level: 'error', message: "Couldn't undo that", detail: err?.message });
    } finally {
      invalidate(keys);
    }
  }, [invalidate, notify]);

  const run = useCallback(({
    call, invalidates = DEAL_TOUCHES, optimistic, toast, report, undoBatch,
    icon = 'check', failure = "Couldn't finish that",
  }) => {
    let rollback = null;
    try { rollback = optimistic?.(queryClient) ?? null; } catch { rollback = null; }

    let batchId = null;
    let undone = false;
    const write = { pending: null, batchId: () => batchId };
    const undoAction = undoBatch
      ? { label: 'Undo', onClick: () => { undone = true; undo(write, rollback, invalidates); } }
      : undefined;

    // The toast goes up NOW, with Undo already on it.
    const toastId = toast ? notify({ level: 'success', icon, ...toast, action: undoAction }) : null;

    inFlight.current += 1;
    touched.current.push(...invalidates);
    write.pending = Promise.resolve()
      .then(call)
      .then((data) => {
        batchId = undoBatch?.(data) ?? null;
        if (!undone && report) {
          // The optimistic line, corrected to what the server actually did
          // ("· 1 already stopped"). Without an optimistic toast, it is the toast.
          if (toastId != null) updateToast(toastId, report(data));
          else notify({ level: 'success', icon, ...report(data), action: batchId ? undoAction : undefined });
        }
        return data ?? true;
      }, (err) => {
        rollback?.();
        if (toastId != null) dismissToast(toastId);
        notify({ level: 'error', message: failure, detail: err?.message });
        return null;
      })
      .finally(() => {
        inFlight.current -= 1;
        // Undone already: the undo refetches once its revert has landed, and
        // a refetch now would flash the action's result back up first.
        if (inFlight.current > 0 || undone) return;
        const keys = touched.current;
        touched.current = [];
        invalidate(keys);
      });
    return write.pending;
  }, [queryClient, invalidate, notify, dismissToast, updateToast, undo]);

  // `busy` is kept so older call sites still read, but it is never set:
  // nothing waits for a bulk write any more.
  return { run, busy: null };
}

/**
 * "2 yes · 1 no" for a switch column across the ticked rows, the faint
 * line above Yes / No in the bar's menu. Undecided rows count by what
 * they show, the same as the toggle on the row.
 */
export function splitHint(rows, read) {
  let yes = 0;
  let no = 0;
  for (const r of rows) { if (read(r)) yes += 1; else no += 1; }
  if (!yes) return `All ${no} no`;
  if (!no) return `All ${yes} yes`;
  return `${yes} yes · ${no} no`;
}
