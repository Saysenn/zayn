import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { useSocketEvent } from './useSocket';
import { useOptimisticUpdate } from './useOptimisticUpdate';
import { useReportingMutation } from './useReportingMutation';
import { patchRow as withColumns } from '../helpers/patchRow';
import { patchedDeals, columnsOnly } from '../helpers/companyCascade';
import { useSettings } from './useSettings';
// A status change can move the monthly review queue: liquidation puts every
// live deal on the company into it. See useMonthlyReview.js.
import { REVIEW_KEY } from './useMonthlyReview';

/**
 * The Companies page — one row per company, aggregated from its deals.
 *
 * Mirror image of usePeople.js, and for the same reason: People and
 * Companies are two groupings of tb_mastersheet, so an edit on either side
 * (or on the Master Sheet page) has to refresh all three.
 *
 * A company is keyed by its NORMALIZED name, not an id. A company that so
 * far only exists in the deals has no tb_companies row and therefore no
 * id, and the page still has to open, rename and annotate it.
 */

function useCrossPageRefresh(queryKey) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  useSocketEvent('companies:changed', invalidate);
  useSocketEvent('master-sheet:changed', invalidate);
  useSocketEvent('people:changed', invalidate);
}

// The whole filter object, never a list of names: an allowlist here
// silently drops any filter added later, and a query key that ignores one
// serves another filter's cached result. Both already happened on the
// master sheet.
export function useCompanies(filters = {}) {
  const { page = 1, pageSize = 25 } = filters;
  const query = useQuery({
    queryKey: ['companies', filters],
    queryFn: () => apiService.companies.list(filters),
    select: (data) => ({
      rows: data.companies, total: data.total,
      tiers: data.tiers ?? [],
      // His own earlier group names, for the filter. Derived from the data,
      // never a fixed list: the values are free text he typed.
      oldGroups: data.oldGroups ?? [],
    }),
    placeholderData: (prev) => prev,
  });

  useCrossPageRefresh(['companies']);

  return {
    ...query,
    data: query.data?.rows,
    total: query.data?.total ?? 0,
    tiers: query.data?.tiers ?? [],
    oldGroups: query.data?.oldGroups ?? [],
  };
}

/**
 * One field on one company, changed from the LIST and applied on screen
 * immediately.
 *
 * Separate from useUpdateCompany, which the manage modal uses: a modal has
 * its own pending state and a Save button, so optimism buys it nothing. An
 * inline cell has neither, and a pause after every commit is what makes a
 * pass down a column of thirty companies feel broken. Same reasoning as
 * useMasterSheetCellEdit, and the same shared hook.
 *
 * `['company']` goes too: the list and the detail page are two views of the
 * same row, so the one you did not edit would keep the old value.
 */
/**
 * ===============================
 * * THE API IS camelCase, THE CACHE IS snake_case
 * ===============================
 * A row in the cache came out of Postgres, so it says `old_group`; the
 * PATCH body is camelCase, so it says `oldGroup`. Spreading the fields onto
 * the row (`{ ...c, ...fields }`) therefore added a key nothing renders and
 * left the visible one stale, so an optimistic edit LOOKED like it failed
 * and then corrected itself on the refetch.
 *
 * ONE MAP, here, the same shape `COLUMN_FOR` has on the server. Anything
 * absent is already the same word in both.
 */
const COLUMN_FOR = {
  oldGroup: 'old_group',
  liquidationTotal: 'liquidation_total',
  closedOn: 'closed_on',
};

// The map is this file's; the walk is shared. See helpers/patchRow.js.
const patchRow = (row, fields) => withColumns(row, fields, COLUMN_FOR);

/**
 * THE STATUS IS A COLUMN. THE TWO ID LISTS ARE INSTRUCTIONS.
 *
 * `reviewMonthlyDealIds` and `stopDealIds` tell the server what to do to
 * the deals underneath. The cascade they describe is painted by
 * helpers/companyCascade.js, which is where it can be tested for real.
 */
function patchedCompany(company, fields, useEndDate) {
  return {
    ...patchRow(company, columnsOnly(fields)),
    deals: patchedDeals(company.deals, fields, useEndDate),
  };
}

export function useCompanyCellEdit() {
  return useOptimisticUpdate({
    queryKey: ['companies'],
    mutationFn: ({ key, fields }) => apiService.companies.update(key, fields),
    applyToCache: (old, { key, fields }) => ({
      ...old,
      companies: old.companies?.map((c) => (c.ckey === key ? patchRow(c, fields) : c)),
    }),
    describe: ({ name, label }) => (name ? `${name}'s ${label}` : label ?? 'that change'),
    verb: () => 'updated',
    successKey: 'company-cell-edit',
    alsoInvalidate: [['company']],
  });
}

export function useCompany(key) {
  const query = useQuery({
    queryKey: ['company', key],
    queryFn: () => apiService.companies.get(key),
    enabled: Boolean(key),
  });

  useCrossPageRefresh(['company', key]);

  // The tier list rides along with the company rather than being a second
  // request or a copy of the API's array typed out again here. Adding a
  // third tier stays one line in `shared/companyTiers.js`.
  return {
    ...query,
    data: query.data?.company,
    tiers: query.data?.tiers ?? [],
    oldGroups: query.data?.oldGroups ?? [],
  };
}

// For the assign-a-handler picker's search box.
export function useCompanyNames() {
  return useQuery({
    queryKey: ['company-names'],
    queryFn: () => apiService.companies.names(),
    select: (data) => data.companies,
    staleTime: 60_000,
  });
}

/**
 * Rename, status, notes.
 *
 * A rename rewrites the company on every deal naming it, which is the
 * page's whole cleanup job — "Relia PA" and "Relia Pa" become one company
 * because the grouping key is the normalized name. So the master sheet
 * and people caches drop too, not just companies.
 */
/**
 * OPTIMISTIC, like every other write in the CRM.
 *
 * It was a plain reporting mutation on the reasoning that a modal has its
 * own Save button and pending state, so optimism bought it nothing. That is
 * only true of the modal: the DETAIL PAGE calls this too, one field at a
 * time with no Save button at all, so every inline edit there sat unchanged
 * until the refetch landed and read as a control that had not taken.
 *
 * The value is put on the detail row immediately and rolled back on
 * failure. `['companies']` is invalidated rather than patched: the list
 * carries counts and totals this write does not know about.
 */
export function useUpdateCompany() {
  const { data: settings } = useSettings();
  const useEndDate = Boolean(settings?.colorUsesEndDate);

  return useOptimisticUpdate({
    queryKey: ['company'],
    mutationFn: ({ key, fields }) => apiService.companies.update(key, fields),
    applyToCache: (old, { key, fields }) => (
      // A prefix key, so this fires for every cached company. Only the one
      // being edited may change.
      old?.company && (!key || old.company.ckey === key)
        ? { ...old, company: patchedCompany(old.company, fields, useEndDate) }
        : old
    ),
    // Same two-caller split as useUpdatePerson: the detail page sends a
    // `label` and gets "Reliapay's tier updated", the manage modal sends
    // none and gets "Reliapay saved".
    describe: ({ name, label, fields }) => {
      const which = name ?? fields?.name ?? 'That company';
      return label ? `${which}'s ${label.toLowerCase()}` : which;
    },
    verb: ({ label }) => (label ? 'updated' : 'saved'),
    successKey: 'company-update',
    alsoInvalidate: [
      ['companies'], ['company-names'], ['people'], ['master-sheet'], REVIEW_KEY,
    ],
  });
}

/**
 * Attach one or many handlers to a company. Each becomes a deal with its
 * own monthly amount — 20 of the 28 multi-handler companies in the real
 * sheet pay their handlers different amounts, so there is no single
 * company-wide figure to apply.
 */
/**
 * THE ONE WRITE THAT STILL REPORTS FROM ITS CALL SITE, and deliberately.
 *
 * The batch route SKIPS anyone already on the company rather than failing,
 * so a 200 can carry `skipped` and mean "nothing happened". No `describe`
 * can tell that apart from a real add — the hook would cheerfully announce
 * "Drew on Reliapay added" for a request that added nobody.
 *
 * So it is `silent` and the caller decides, which it can: it routes a skip
 * into the editor's own inline failure rather than a toast.
 *
 * The invalidation still belongs here, which is why this uses the hook at
 * all rather than a bare useMutation.
 */
export function useAddHandlers() {
  return useReportingMutation(
    ({ key, handlers }) => apiService.companies.addHandlers(key, handlers),
    {
      silent: true,
      // REVIEW_KEY: a handler added to a company in liquidation is a deal
      // that is due for review the moment it exists.
      invalidates: [
        ['companies'], ({ key }) => ['company', key], ['people'], ['master-sheet'], REVIEW_KEY,
      ],
    },
  );
}
