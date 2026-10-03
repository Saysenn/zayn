import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNotifications } from './useNotifications';
import { toastFor } from '../helpers/toastMessage';

/**
 * A write that refetches what it changed, AND SAYS SO.
 *
 * EVERY WRITE REPORTS ITSELF, and the report belongs HERE rather than at
 * the call site. A toast written into an `onSuccess` at the point of use
 * means the next call site gets silence by default, which is how People and
 * Companies ended up with fourteen hand-written toasts across two pages
 * while their own hooks said nothing at all.
 *
 * It lived inside useMasterSheet.js and was therefore reachable by exactly
 * one feature. Same code, one directory up.
 *
 * ---- `invalidates` is a parameter, and that is the important bit ----
 * The master sheet drops UPLOAD_TOUCHES on every write, because People,
 * Companies and every filter are readings of the same table. People and
 * Companies need their own, shorter lists. Hardcoding one list here would
 * either over-invalidate every page on every write or leave one of them
 * stale, and stale is the failure nobody notices.
 *
 * The wording is in helpers/toastMessage.js, which has no imports and is
 * under test.
 */
export function useReportingMutation(mutationFn, {
  describe,
  verb = 'saved',
  icon = 'check',
  detail,
  // Query keys to drop on success. Always a list of keys, never one key:
  // "which caches did this change" has more than one answer for almost
  // every write in this CRM.
  invalidates = [],
  /**
   * SAYS NOTHING AT ALL, success or failure.
   *
   * Different from omitting `describe`, which silences only the success:
   * that is for a write with nothing worth announcing, and its failures
   * still speak. `silent` is for a caller running SEVERAL of these and
   * reporting the batch itself, where the hook speaking too would mean
   * seven toasts and a summary for one action.
   *
   * Only ever correct when the caller does report. A silent hook with a
   * caller that forgot is a button that does nothing.
   */
  silent = false,
} = {}) {
  const queryClient = useQueryClient();
  const { notify } = useNotifications();

  return useMutation({
    mutationFn,
    onSuccess: (data, variables) => {
      for (const key of resolveKeys(invalidates, variables)) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      if (silent) return;
      const toast = toastFor({ describe, verb, icon, detail, variables, data });
      if (toast) notify(toast);
    },
    onError: (err, variables) => {
      if (silent) return;
      notify(toastFor({ describe, verb, icon, variables, error: err }));
    },
  });
}

/**
 * `invalidates` may hold a function, so a key can name the row it touched.
 *
 * `['person', personId]` has to be built from the variables, and the
 * alternative was every caller writing its own onSuccess again — which is
 * the thing this hook exists to stop.
 */
function resolveKeys(invalidates, variables) {
  return invalidates.map((key) => (typeof key === 'function' ? key(variables) : key));
}
