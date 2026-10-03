import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { useSocketEvent } from './useSocket';
import { useReportingMutation } from './useReportingMutation';
import { patchRow as withColumns } from '../helpers/patchRow';
import { useOptimisticUpdate } from './useOptimisticUpdate';

/**
 * The People page — one row per human, aggregated from their deals.
 *
 * Every query here invalidates on BOTH `people:changed` and
 * `master-sheet:changed`, because they are two views of one table: editing
 * a deal on the Master Sheet page changes what a person's row shows, and
 * an edit here changes the master sheet. Listening to only one event is
 * the bug this codebase already hit once, where a change refreshed the
 * page it came from and nothing else.
 */

// Exported for the dead list, which is the same table read one more way.
export function useCrossPageRefresh(queryKey) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  useSocketEvent('people:changed', invalidate);
  useSocketEvent('master-sheet:changed', invalidate);
  useSocketEvent('companies:changed', invalidate);
}

export function usePeople(filters = {}) {
  const { page = 1, pageSize = 25 } = filters;
  const query = useQuery({
    queryKey: ['people', filters],
    queryFn: () => apiService.people.list(filters),
    select: (data) => ({ rows: data.people, total: data.total }),
    placeholderData: (prev) => prev, // keep the old page visible while the next loads
  });

  useCrossPageRefresh(['people']);

  return { ...query, data: query.data?.rows, total: query.data?.total ?? 0, page, pageSize };
}

export function usePerson(personId) {
  const query = useQuery({
    queryKey: ['person', personId],
    queryFn: () => apiService.people.get(personId),
    select: (data) => data.person,
    enabled: Boolean(personId),
  });

  useCrossPageRefresh(['person', personId]);

  return query;
}

// Roles, groups, companies, methods and currencies as they actually appear
// in the uploaded sheet. Cached longer than the lists themselves: these
// only change when a new sheet lands, not when a single deal is edited.
export function usePeopleFilters() {
  return useQuery({
    queryKey: ['people-filters'],
    queryFn: () => apiService.people.filters(),
    staleTime: 60_000,
  });
}

// Shown as a banner. Never acted on automatically — a person legitimately
// holds many deals, so duplicates are surfaced for a human to read, not
// merged.
export function useDuplicates() {
  return useQuery({
    queryKey: ['people-duplicates'],
    queryFn: () => apiService.people.duplicates(),
    select: (data) => data.duplicates,
    staleTime: 60_000,
  });
}

/**
 * ===============================
 * * THE API IS camelCase, THE CACHE IS snake_case
 * ===============================
 * A cached row came out of Postgres (`display_name`, `addon_percent`); the
 * PATCH body is camelCase. Spreading the fields straight onto the row adds
 * a key nothing renders and leaves the visible one stale, so the edit looks
 * like it failed and then corrects itself on the refetch.
 *
 * ONE MAP, the same shape `COLUMN_FOR` has on the server. Anything absent
 * is already the same word on both sides.
 */
const COLUMN_FOR = {
  displayName: 'display_name', feePercent: 'fee_percent', addonPercent: 'addon_percent',
};

// The map is this file's; the walk is shared. See helpers/patchRow.js.
const patchRow = (row, fields) => withColumns(row, fields, COLUMN_FOR);

/**
 * OPTIMISTIC, like every other write in the CRM. The detail page edits one
 * profile field at a time with no Save button, so a pause after each one
 * reads as a control that did not take.
 */
export function useUpdatePerson() {
  return useOptimisticUpdate({
    queryKey: ['person'],
    mutationFn: ({ personId, fields }) => apiService.people.update(personId, fields),
    applyToCache: (old, { personId, fields }) => (
      // A prefix key, so this fires for every cached person. Only the one
      // being edited may change.
      old?.person && (!personId || old.person.person_id === personId)
        ? { ...old, person: patchRow(old.person, fields) }
        : old
    ),
    // TWO CALLERS, TWO SENTENCES. The detail page edits one field and
    // passes its `label`, so it reads "Drew's email updated". The manage
    // modal saves the whole record and passes none, so it reads "Drew
    // saved". Same idiom the master sheet's cell edit uses.
    describe: ({ name, label, fields }) => {
      const who = name ?? fields?.displayName ?? 'That person';
      return label ? `${who}'s ${label.toLowerCase()}` : who;
    },
    verb: ({ label }) => (label ? 'updated' : 'saved'),
    successKey: 'person-update',
    // A RATE CHANGES WHAT THE MASTER SHEET SHOWS. Every deal row carries
    // the person's add on and fee so the cell can warn that the two stack,
    // so a rate edited here leaves that warning stale on a page this hook
    // knows nothing about. Only for the two rate fields: notes and an
    // email change nothing over there.
    alsoInvalidate: ({ fields }) => (
      fields?.addonPercent !== undefined || fields?.feePercent !== undefined
        ? [['people'], ['master-sheet'], ['company']]
        : [['people']]
    ),
  });
}

/**
 * Assigning a person to a company IS creating a deal — the same row the
 * Companies page creates from the other direction, and the same row the
 * Master Sheet page shows. So all three caches drop.
 */
/**
 * SILENT, because both callers report better than this hook could.
 *
 * AddDealModal is a cross product: two companies across two groups is four
 * calls and one sensible sentence ("Drew added to 4 companies"). A toast
 * per call would bury it under four that each said less. It also treats a
 * 409 as a CHOICE rather than a failure — the duplicate rows come back and
 * the admin picks — so a hook shouting "Couldn't add" over that would be
 * wrong as well as noisy.
 *
 * ManagePersonModal adds one at a time and shows failures inline, beside
 * the form, which is where a form error belongs.
 *
 * The invalidation is still the hook's job. See useAddHandlers, same shape
 * for the same reason on the company side.
 */
export function useAddDeal() {
  return useReportingMutation(
    ({ personId, deal }) => apiService.people.addDeal(personId, deal),
    {
      silent: true,
      invalidates: [
        ['people'], ({ personId }) => ['person', personId], ['companies'], ['master-sheet'],
      ],
    },
  );
}
