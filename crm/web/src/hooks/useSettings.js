import { useMutation, useQuery } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { useOptimisticUpdate } from './useOptimisticUpdate';

// ===============================
// * TWO CACHES, AND NEITHER IS A PREFIX OF THE OTHER
// ===============================
// The rates were `['settings', 'rates']`. `useOptimisticUpdate` patches and
// invalidates by PREFIX, so the moment the settings switches went through
// it, flipping one would have merged its booleans into the rates object and
// refetched the rates for nothing. Separate roots, one spelling each.
export const SETTINGS_KEY = ['settings'];
const RATES_KEY = ['fx-rates'];

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiService.settings.get(),
  });
}

/**
 * ERROR ONLY, no success toast.
 *
 * The switch moving IS the confirmation, and a toast for every flip of a
 * setting somebody is fiddling with is noise. A FAILURE has no such tell:
 * the switch simply does not move, which reads as an unresponsive control
 * rather than a request that was refused.
 */
export function useUpdateSettings() {
  /**
   * OPTIMISTIC, THROUGH THE ONE IMPLEMENTATION. A switch that waits on the
   * server before it moves reads as a switch that did not take, and these
   * are all booleans: nothing to reconcile, only something to put back.
   *
   * It hand rolled onMutate/onError/onSettled, which is the exact drift
   * `useOptimisticUpdate` exists to stop: it had no `cancelQueries` race
   * fix and no refetch, so a setting the server normalised sat wrong until
   * something else forced a reload. Converted 2026-09-29.
   */
  return useOptimisticUpdate({
    queryKey: SETTINGS_KEY,
    mutationFn: (fields) => apiService.settings.update(fields),
    applyToCache: (old, fields) => ({ ...(old ?? {}), ...fields }),
    silent: true,
    describe: () => 'that setting',
    failVerb: () => 'save',
  });
}

/**
 * ===============================
 * * THE ONE WIPE, AND IT REPORTS ITSELF IN PLACE
 * ===============================
 * Not optimistic, and that is the point: there is nothing to paint, and a
 * screen that emptied before the server agreed would be the worst possible
 * lie this app could tell. `DangerAction` on the Settings page holds the
 * typed phrase, the error and the done line, all beside the button.
 *
 * It broadcasts a socket event the affected pages already listen for
 * (sync:completed for Companies/People/Flagged, master-sheet:changed for
 * the Master Sheet), so there is nothing extra to invalidate here.
 *
 * `useResetMasterSheet` LIVED HERE AND NOTHING CALLED IT. The Danger zone
 * became one button on purpose ("Burn now clears the deals as well") and
 * the hook for the second one was left behind. Removed 2026-09-29; the
 * route is still on the server, see docs/todo.md.
 */
export function useBurnMonth() {
  return useMutation({
    mutationFn: (confirm) => apiService.settings.burnMonth(confirm),
  });
}

// ***************************************************
// * The rates we set ourselves
// ***************************************************
//
// See migrations/051_manual_fx_rates.sql. The feed answers when it can and
// these are the standby, so the screen shows BOTH what is saved and which
// source is actually converting today.

export function useFxRates() {
  return useQuery({
    queryKey: RATES_KEY,
    queryFn: () => apiService.settings.rates(),
  });
}


/**
 * ===============================
 * * OPTIMISTIC, THROUGH THE ONE IMPLEMENTATION
 * ===============================
 *
 * Written first as a plain mutation that waited for the server, on the
 * argument that a rate is a figure every conversion will use and is worth
 * waiting on. The user's call, overruled: a Save button that sits there
 * doing nothing reads as a Save button that did not work, and the rollback
 * is what makes waiting unnecessary.
 *
 * `useOptimisticUpdate` owns the three beats, so they cannot drift here:
 * paint and snapshot, restore and SAY what reverted, refetch. Hand rolling
 * them is what the helper exists to stop.
 *
 * `alsoInvalidate: dashboard` is not optional. Every USD figure on that
 * page was converted with the old rate, and none of them can be patched
 * from here: only the server knows what they become.
 */
export function useSetFxRate() {
  return useOptimisticUpdate({
    queryKey: RATES_KEY,
    mutationFn: ({ code, perUsd }) => apiService.settings.setRate(code, perUsd),
    applyToCache: (old, { code, perUsd }) => {
      const rates = old?.rates ?? [];
      // Painted with the moment it happened, because the row prints
      // "Saved <date>" and a blank one would read as never saved.
      const next = { code, perUsd, updatedAt: new Date().toISOString(), updatedBy: null };
      const known = rates.some((rate) => rate.code === code);
      return {
        ...old,
        rates: known
          ? rates.map((rate) => (rate.code === code ? { ...rate, ...next } : rate))
          : [...rates, next].sort((a, b) => a.code.localeCompare(b.code)),
      };
    },
    describe: ({ code }) => `the ${code} rate`,
    verb: () => 'saved',
    successKey: 'fx-rate-save',
    alsoInvalidate: [['dashboard']],
  });
}

export function useClearFxRate() {
  return useOptimisticUpdate({
    queryKey: RATES_KEY,
    mutationFn: (code) => apiService.settings.clearRate(code),
    applyToCache: (old, code) => ({
      ...old,
      rates: (old?.rates ?? []).filter((rate) => rate.code !== code),
    }),
    describe: (code) => `the ${code} rate`,
    verb: () => 'cleared',
    successIcon: 'trash',
    successKey: 'fx-rate-clear',
    alsoInvalidate: [['dashboard']],
  });
}
