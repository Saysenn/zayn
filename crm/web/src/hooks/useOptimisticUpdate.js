import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNotifications } from './useNotifications';

/**
 * One optimistic mutation, used by every editable sheet cell.
 *
 * The pattern is always the same three beats, and writing them out per
 * hook is how they drift apart:
 *
 *   onMutate   put the new value on screen NOW, keep a snapshot
 *   onError    put the snapshot back, and say what was reverted
 *   onSettled  refetch, so the server's version is the final word
 *
 * Deliberately thin. It owns cancel/snapshot/rollback/toast — the parts
 * that are identical and easy to get subtly wrong — and the caller passes
 * a one-line `applyToCache`, because the caches genuinely differ in shape
 * (the master sheet's is `{ rows, total }`, others are plain arrays).
 * Generalising over that would need a config object nobody could read.
 *
 * If this file starts growing flags, that's the signal it's the wrong
 * abstraction, not a reason to add another one.
 */

// "gloria's payable amount" -> "Gloria's payable amount". The description
// is composed lowercase so it reads correctly mid-sentence in an error
// ("Couldn't update gloria's..."), and only the success line starts with
// it — so the capital goes on here rather than into every caller.
function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// What went wrong, in words the admin can act on. A raw fetch failure
// reads as "Failed to fetch", which tells them nothing and looks like
// their edit broke something.
function describeFailure(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return "You're offline, the change wasn't saved";
  }
  if (err?.status === 429) return 'Too many changes at once, not saved';
  return err?.message || 'Not saved';
}

export function useOptimisticUpdate({
  // The query key PREFIX to patch and later invalidate. A prefix, not an
  // exact key, because the page's key includes its current filters and
  // page number — and the row being edited may be sitting in several
  // cached pages at once.
  queryKey,
  // (variables) => Promise. The actual request.
  mutationFn,
  // (cachedData, variables) => newCachedData. Pure, returns a new object.
  applyToCache,
  // (variables) => string. What actually changed, in words: "Gloria's
  // payable amount". Naming both the person AND the field is the point —
  // with optimistic UI the value visibly changes back on failure, and
  // "couldn't save" alone leaves you hunting for which row and which
  // column. It reads the same on success, so the confirmation is
  // genuinely informative rather than a bare "Saved".
  describe = () => 'that change',
  // (variables) => string, past tense: "updated", "deleted". Lets one
  // helper cover an edit and a removal without a second copy of all this.
  verb = () => 'updated',
  // The same act in the infinitive, for the failure line. A delete that
  // fails used to say "Couldn't update Gloria", which is the wrong word for
  // what was attempted; irregular past tenses mean it cannot be derived.
  failVerb = () => 'update',
  // A SECOND LINE, only when there is one. The failure toast has always
  // had a detail; the success toast had nowhere to say "and this other
  // thing deliberately did NOT change", which a write that quietly does
  // less than you asked has to say. Returns undefined for the ordinary
  // case, so nothing is added to the noise.
  successDetail = () => undefined,
  // Which icon the success toast shows. A bin says "deleted" faster than
  // any wording does.
  successIcon = 'check',
  // Extra caches invalidated on success. People, Companies and the Master
  // Sheet are three views of one table, so an edit made through any of
  // them has genuinely changed what the other two show — they would
  // otherwise hold the old value until something forced a refetch.
  alsoInvalidate = [],
  // Collapses repeated successes into "Saved 5 changes".
  successKey = 'optimistic-save',
  /**
   * NO SUCCESS TOAST, failures still speak.
   *
   * The same flag `useReportingMutation` carries, for the same reason and
   * with the same limit: for a write whose own control IS the confirmation.
   * Settings is the case. A switch moving says it took, and a toast per
   * flip of something somebody is fiddling with is noise.
   *
   * IT NEVER SILENCES A FAILURE. The switch not moving reads as an
   * unresponsive control rather than a request that was refused, which is
   * the whole reason this hook reports at all.
   */
  silent = false,
} = {}) {
  const queryClient = useQueryClient();
  const { notify } = useNotifications();

  // ONE KEY OR SEVERAL. The same row is cached under three prefixes: the
  // master sheet's own list, and the person and company pages, which are
  // groupings of these rows. Patching only the first meant every inline
  // edit on those two pages sat unchanged until the socket refetch landed.
  // A list of keys is discriminated by its first element being an array.
  const keys = Array.isArray(queryKey?.[0]) ? queryKey : [queryKey];
  const mutationKey = ['optimistic', keys];

  return useMutation({
    mutationKey,
    mutationFn,

    async onMutate(variables) {
      // Any refetch already in flight would land AFTER this and overwrite
      // the optimistic value with the pre-edit one — the row would flicker
      // back for a moment. Cancelling first is what prevents that.
      await Promise.all(keys.map((k) => queryClient.cancelQueries({ queryKey: k })));

      const snapshot = keys.flatMap((k) => queryClient.getQueriesData({ queryKey: k }));

      for (const k of keys) {
        queryClient.setQueriesData({ queryKey: k }, (old) => (
          old ? applyToCache(old, variables) : old
        ));
      }

      return { snapshot };
    },

    onError(err, variables, context) {
      // Every page that held this row goes back, not just the visible one.
      context?.snapshot?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      notify({
        level: 'error',
        message: `Couldn't ${failVerb(variables)} ${describe(variables)}`,
        detail: describeFailure(err),
      });
    },

    onSuccess(data, variables) {
      const detail = successDetail(variables);
      if (!silent) notify({
        level: 'success',
        icon: successIcon,
        message: `${capitalise(describe(variables))} ${verb(variables)}`,
        detail,
        // Keyed on WHAT changed, so editing the same cell twice collapses
        // into one line, while two different cells stay two lines. A
        // single "Saved 5 changes" would throw away exactly the detail
        // this message exists to carry.
        //
        // A detail makes it its own line: collapsing "and the payment
        // start was left alone" into a count would drop the only part
        // that was worth reading.
        key: detail ? undefined : `${successKey}:${describe(variables)}`,
        collapsed: (n) => `${capitalise(describe(variables))} ${verb(variables)} (${n}×)`,
      });
      // A FUNCTION when it depends on WHAT was edited. A person's add on
      // changes what the master sheet shows, a change to their notes does
      // not, and invalidating the whole sheet on every keystroke is a
      // refetch nobody asked for.
      const keys = typeof alsoInvalidate === 'function' ? alsoInvalidate(variables) : alsoInvalidate;
      (keys ?? []).forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
    },

    onSettled() {
      // Clicks can overlap now. Only the LAST to settle refetches, or an early
      // refetch paints the server's pre-click state over a later click. (Still counts itself here.)
      if (queryClient.isMutating({ mutationKey, exact: true }) > 1) return;
      // Always, success or failure — the server is the authority on what
      // the row now says, including anything it changed as a side effect
      // (status derived from a new end date, an updated_at stamp).
      for (const k of keys) queryClient.invalidateQueries({ queryKey: k });
    },
  });
}
