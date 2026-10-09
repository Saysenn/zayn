import { useCallback } from 'react';
import { payableFromDays, payableDaysFor, PAYABLE_INPUTS, DAY_COUNT_INPUTS } from '../helpers/payable';
import {
  startFromAppointment, endFromAppointment, stillTheFormulasAnswer, asColumnDate,
} from '../helpers/fromAppointment';
import { paymentPeriodOf, PERIOD_INPUTS } from '../helpers/paymentPeriod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { useSocketEvent } from './useSocket';
import { useNotifications } from './useNotifications';
import { useReportingMutation } from './useReportingMutation';
import { useOptimisticUpdate } from './useOptimisticUpdate';
import { useDeferredRefresh } from './useCellEditing';
import { useSettings } from './useSettings';
// Deal Status is a NAME for two columns. See configs/dealStatus.js.
import { DEAL_STATUS } from '../configs/dealStatus';
import { GOING_CONCERN } from '../configs/sheetValues';
// Setting it moves the monthly review, so the queue's count is stale.
import { REVIEW_KEY } from './useMonthlyReview';

// One key prefix for the whole feature — every mutation below invalidates
// it wholesale rather than trying to patch a single row into the cache.
// The list is one page of a small table, so a refetch is cheaper than the
// bookkeeping, and it also picks up server-derived fields (role/seat parsed
// out of the label, status derived from the end date) that an optimistic
// patch would show wrong until the next load.
const KEY = ['master-sheet'];

/**
 * EVERY cache a write to this table changes, not just this page's.
 *
 * People and Companies are groupings of these same rows, and every group,
 * role and company dropdown in the CRM is built from them. Dropping only
 * KEY is why a successful upload left those pages showing what they had
 * loaded before, and why deleting the last deal in a group left that group
 * still offered in every group filter.
 *
 * One list, because forgetting one of these in one call site is exactly how
 * a page ends up serving a stale cache after a write that changed it.
 */
const IMPORT_TOUCHES = [
  KEY, ['people'], ['person'], ['companies'], ['company'],
  ['groups'], ['people-filters'], ['company-names'], ['people-duplicates'], ['history'],
  // The export's row count AND its warnings panel are both readings of
  // these rows, so any write here has changed them. Without this, fixing
  // six presets from the panel left the panel still saying six.
  ['export-count'],
];

/**
 * THE WHOLE FILTER OBJECT, never a list of names.
 *
 * This used to destructure six params and rebuild them, so every filter
 * added afterwards (status, shouldBePaid, paid, missingPerson,
 * missingCompany) was dropped here before it ever reached the request.
 * Nothing failed, nothing logged, and the checkbox simply did nothing.
 *
 * The query key is built from the same object for the same reason: a key
 * that ignores a filter serves the cached result of a DIFFERENT filter,
 * so the list would not change even once the param did get through.
 */
export function useMasterSheet(filters = {}) {
  const { page = 1, pageSize = 50 } = filters;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...KEY, filters],
    queryFn: () => apiService.masterSheet.list(filters),
    placeholderData: (prev) => prev, // keep the current page visible while the next loads
  });

  // whatbot's month-start sync writes here too, and so does another admin
  // in a second tab — without this the table only changes on manual refresh.
  //
  // Held back while a cell is open, though. This fires on EVERY write to
  // the table, including Diane's and including the admin's own edit a
  // moment ago; a refetch landing while someone is mid-keystroke replaces
  // the row under them and their half-typed value vanishes. Deferred, not
  // dropped — it runs the moment the last cell closes.
  const requestRefresh = useDeferredRefresh(
    useCallback(() => queryClient.invalidateQueries({ queryKey: KEY }), [queryClient]),
  );
  useSocketEvent('master-sheet:changed', requestRefresh);

  return {
    ...query,
    data: query.data?.rows,
    total: query.data?.total ?? 0,
    counts: query.data?.counts ?? {},
  };
}

/**
 * A write that refetches rather than patching the cache, AND SAYS SO.
 *
 * It said nothing at all. A bulk delete of nine rows was nine rows quietly
 * gone and no confirmation anywhere, which is the one operation on this
 * page where silence is indistinguishable from a failed request. Cell
 * edits already announce themselves through useOptimisticUpdate; these did
 * not, so half the page confirmed its work and half did not depending on
 * which control you used.
 *
 * Same wording as useOptimisticUpdate on purpose ("X deleted", "Couldn't
 * delete X"), so the two paths are indistinguishable to the person reading
 * the toast — which is the point, since they cannot tell which one a
 * button uses.
 */
/**
 * The master sheet's writes, reported and invalidated.
 *
 * The generator moved to hooks/useReportingMutation.js so People and
 * Companies could use it too; this is now just that hook with one list
 * bound to it.
 *
 * EVERY DEPENDENT CACHE, not just this page's. It dropped only KEY once, so
 * deleting the last deal in a group left that group still offered in every
 * group dropdown in the CRM: the options are built from the deals
 * themselves, and nothing told them the deals had changed.
 */
function useInvalidatingMutation(mutationFn, options = {}) {
  return useReportingMutation(mutationFn, { ...options, invalidates: IMPORT_TOUCHES });
}

/**
 * ===============================
 * * WHAT THIS PERSON'S OTHER DEALS ALREADY KNOW ABOUT THEM
 * ===============================
 * Phone, address and banking are facts about the PERSON, so the deal being
 * edited can fill its blanks from one they already hold. Two answers, a
 * live deal and an archived one, and the form offers whichever would
 * actually fill something.
 *
 * READ ONLY AND OFF BY DEFAULT. Disabled without a person, so the Add form
 * asks nothing until a name is chosen. `staleTime` because a person's
 * postcode does not move while a dialog is open, and refetching it on every
 * focus would put a request behind every alt-tab to look a value up.
 */
export function usePersonFill(personId, excludeId) {
  return useQuery({
    queryKey: [...KEY, 'person-fill', personId ?? null, excludeId ?? null],
    queryFn: () => apiService.masterSheet.personFill(personId, excludeId),
    enabled: Boolean(personId),
    staleTime: 60_000,
  });
}

export function useCreateMasterSheetRow() {
  return useInvalidatingMutation((fields) => apiService.masterSheet.create(fields), {
    // Named, not "Row added": the sheet is 96 rows and which one it was is
    // the only part worth reading.
    describe: (f) => `${f?.personName || 'That deal'} on ${f?.company || f?.groupName || 'the sheet'}`,
    verb: 'added',
  });
}

/**
 * `silent` is for a caller writing SEVERAL rows and reporting the batch.
 *
 * Person detail writes one field across every company somebody handles,
 * which for the busiest person in the real sheet is seven PATCHes. Each
 * announcing "That row updated" gave eight toasts for one action, and the
 * useful one — "Phone updated on all 7 companies" — arrived last, behind
 * seven that said less. On failure it was the same eight again.
 *
 * Only correct because that caller reports both outcomes itself.
 */
export function useUpdateMasterSheetRow({ silent = false } = {}) {
  return useInvalidatingMutation(({ id, fields }) => apiService.masterSheet.update(id, fields), {
    describe: ({ fields }) => fields?.personName || 'That row',
    verb: 'updated',
    silent,
  });
}

/**
 * One cell edit, applied on screen immediately.
 *
 * Separate from useUpdateMasterSheetRow above, which the full-row modal
 * still uses — a modal already has its own visible pending state and a
 * Save button, so optimism buys it nothing. An inline cell has neither,
 * and a 450ms pause after every keystroke-and-Enter is exactly what makes
 * a pass over twenty rows feel broken.
 *
 * `alsoInvalidate: [['people'], ['companies']]` is not incidental. Those
 * two pages are GROUPINGS of this same table — a person's monthly total
 * and a company's team both come from these rows — so an edit here has
 * genuinely just changed what they show. Without it they would keep
 * displaying the old figure until something unrelated forced a refetch.
 *
 * (This used to invalidate `assignments`, a separate table the edit was
 * mirrored into. That table is gone; there is one table now, and three
 * ways of looking at it.)
 */
export function useMasterSheetCellEdit() {
  // WHETHER THE END DATE TAKES PART. One setting, read here so the badge
  // this patch recomputes agrees with the one the server derives.
  const { data: settings } = useSettings();
  const useEndDate = Boolean(settings?.colorUsesEndDate);

  return useOptimisticUpdate({
    // THREE CACHES, because the same row is in all three. People and
    // Companies are GROUPINGS of these rows, so an edit made from either
    // page patched nothing it could see and the row only moved when the
    // socket refetch landed: every inline cell there behaved as though it
    // had failed for half a second.
    queryKey: [KEY, ['person'], ['company']],
    mutationFn: ({ id, fields }) => apiService.masterSheet.update(id, fields),
    // `vars` is one object for the whole mutation, so what the cascade
    // refused to overwrite is recorded on it here and read by the toast
    // below. A Set because applyToCache runs once per cache shape.
    applyToCache: (old, vars) => {
      vars.cascadeSkipped ??= new Set();
      return patchDeal(old, vars.id, vars.fields, useEndDate, vars.cascadeSkipped);
    },
    describe: ({ subject, label }) => (subject ? `${subject}'s ${label}` : label ?? 'that change'),
    // Toggles say enabled/disabled; everything else says updated.
    verb: ({ verb: v }) => v ?? 'updated',
    // A WRITE THAT DID LESS THAN YOU ASKED HAS TO SAY SO. Moving the
    // appointment date normally moves the payment start and the end date
    // with it; when one of those was set by hand the cascade leaves it,
    // and without this the row simply does not move and reads as a bug.
    successDetail: ({ cascadeSkipped }) => {
      const left = [...(cascadeSkipped ?? [])].map((c) => SKIPPED_LABELS[c]).filter(Boolean);
      if (left.length === 0) return undefined;
      return `${listOf(left)} left as you set ${left.length === 1 ? 'it' : 'them'}`;
    },
    alsoInvalidate: [['people'], ['companies']],
  });
}

/**
 * Payable amount follows its inputs on screen, the moment they change.
 *
 * The server does the same on save (shared/recomputePayable.helper.js) and
 * its answer is the one that sticks; this only closes the gap between
 * pressing Enter and the refetch landing, where the row would otherwise
 * show a new monthly amount beside the old payable figure and read as a
 * failed edit.
 *
 * An explicit payable amount in the same edit is left alone — that is the
 * admin overriding the formula, not asking it to run.
 */
function withPayable(row, fields) {
  if (fields.payableAmount !== undefined) return row;
  if (!PAYABLE_INPUTS.some((k) => fields[k] !== undefined)) return row;

  // THE DAY COUNT FIRST, THEN THE AMOUNT FROM IT. This used to read
  // `row.payable_days`, the count from before the edit, so moving a
  // payment start painted the new date beside an amount worked out against
  // the old one until the refetch landed. `row` is already patched, so its
  // dates are the new ones.
  //
  // A rate edit leaves the days alone, including a count the admin set by
  // hand. Same order as the server's recomputePayable.
  const movedDates = DAY_COUNT_INPUTS.some((k) => fields[k] !== undefined);
  const payableDays = movedDates && fields.payableDays === undefined
    // The appointment travels: a first week deal is owed the whole of its
    // month 3 whatever its stored start says. `row` is already patched, so
    // the special case flag read here is the one being switched.
    ? payableDaysFor(row.payment_start_on, row.preset_on, {
      appointmentOn: row.assigned_on,
      specialCaseDeal: Boolean(row.special_case_deal),
    })
    : row.payable_days;

  return {
    ...row,
    payable_days: payableDays,
    payable_amount: payableFromDays({
      monthlyAmount: row.monthly_amount,
      presetOn: row.preset_on,
      payableDays,
    }),
  };
}

/**
 * The appointment date drives the payment start and the end date.
 *
 * His sheet: column F is `=E2+90` and column H is appointment plus a year,
 * so one typed date moves four cells. The CRM stored the appointment and
 * let it drive nothing, so an edit left the other four on their old values.
 *
 * Runs BEFORE withPayable, because the day count and the amount are worked
 * out from the payment start this produces.
 *
 * The guard is `stillTheFormulasAnswer`, never `manually_overridden_fields`:
 * the cascade writes these two columns, so the claim array would have it
 * blocked by its own output on the second edit. Mirrors the server exactly.
 */
// The two columns the cascade can decline to touch, said out loud. A toast
// must never print a database column name at somebody.
const SKIPPED_LABELS = {
  payment_start_on: 'the payment start',
  end_on: 'the end date',
};

/** "a", or "a and b". Two items at most, so no comma case to get wrong. */
function listOf(items) {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0];
}

function withDerivedDates(row, fields, oldRow, skipped) {
  if (fields.assignedOn === undefined) return row;
  // Clearing the appointment leaves the dates it drove alone: there is
  // nothing to derive from and the stored dates are the last thing known.
  if (!fields.assignedOn) return row;

  const out = { ...row };
  const pairs = [
    ['paymentStartOn', 'payment_start_on', 'start', startFromAppointment],
    ['endOn', 'end_on', 'end', endFromAppointment],
  ];
  for (const [key, column, kind, derive] of pairs) {
    if (fields[key] !== undefined) continue;
    if (!stillTheFormulasAnswer(oldRow[column], oldRow.assigned_on, kind)) { skipped?.add(column); continue; }
    out[column] = asColumnDate(derive(fields.assignedOn));
  }
  return out;
}

/**
 * The payment period badge follows its inputs too.
 *
 * `payment_period` is DERIVED IN SQL, so an optimistic patch that only
 * copied the edited column left the badge on the server's last answer: you
 * moved the preset to August and the row still read Ended until the
 * refetch landed. Same reasoning as withPayable above, and the server's
 * answer is still the one that sticks.
 */
function withPeriod(row, fields, useEndDate) {
  if (!PERIOD_INPUTS.some((k) => fields[k] !== undefined)) return row;
  return { ...row, payment_period: paymentPeriodOf(row, useEndDate) };
}

/**
 * A REAL DATE ENDS THE NOTE THAT EXPLAINED THE BLANK.
 *
 * `end_note` holds his words for why the end date cell is empty, and the
 * cell shows them in place of a date. The server drops the note the moment
 * somebody types a date (masterSheetRows.repo `end_note = NULL`), so a
 * patch that copies only `end_on` leaves the cache disagreeing with what
 * was just saved: 31 December 2026 stored, "AUGUST TBC" still on screen
 * until the refetch. Found 2026-09-21.
 *
 * CLEARING the date leaves the note alone, exactly as the server does. The
 * words still explain the blank it goes back to.
 *
 * A DERIVED DATE COUNTS TOO. `recomputePayable` adds `endOn` to the
 * server's own patch when the appointment cascade moves it, so the note
 * goes there as well: keying off `fields.endOn` alone would leave the same
 * disagreement behind an appointment edit instead of a typed date.
 */
function withEndNote(row, fields, oldRow) {
  const typed = Boolean(fields.endOn);
  const cascaded = Boolean(row.end_on) && row.end_on !== oldRow.end_on;
  if (!typed && !cascaded) return row;
  return { ...row, end_note: null };
}

/**
 * One edited deal, with everything that follows from it recomputed.
 *
 *   appointment -> payment start, end date   withDerivedDates
 *                  -> payable days, amount   withPayable
 *                  -> the period badge       withPeriod
 *   end date    -> his note for the blank    withEndNote
 *
 * `row` is the row before the edit, so it is what the two guards read.
 */
function editedDeal(row, fields, useEndDate, skipped) {
  const patched = withDerivedDates({ ...row, ...toColumns(fields) }, fields, row, skipped);
  const withNote = withEndNote(withPayable(patched, fields), fields, row);
  return withPeriod(withNote, fields, useEndDate);
}

/**
 * THREE CACHE SHAPES, ONE ROW.
 *
 * The master sheet holds `{ rows }`; a person holds `{ person: { deals } }`
 * and a company `{ company: { deals } }`. All three are the same deal, so
 * an edit made anywhere has to land in whichever of them is loaded.
 *
 * Anything else is returned untouched: `setQueriesData` runs this over
 * every query under the three prefixes, including ones with another shape.
 */
/**
 * THE SAME WALK, applying RAW COLUMNS.
 *
 * Deal Status writes `review_monthly` and `end_note`, neither of which is
 * in COLUMN_FOR: they are not hand editable fields, so they have no
 * camelCase name to map. `apply` lets the caller decide what one row
 * becomes, so there is one walk over the three cache shapes rather than a
 * second copy of it.
 */
function patchRowsWith(old, id, apply) {
  if (Array.isArray(old?.rows)) {
    return { ...old, rows: old.rows.map((r) => (r.id === id ? apply(r) : r)) };
  }
  for (const side of ['person', 'company']) {
    if (Array.isArray(old?.[side]?.deals)) {
      return {
        ...old,
        [side]: {
          ...old[side],
          deals: old[side].deals.map((d) => (d.id === id ? apply(d) : d)),
        },
      };
    }
  }
  return old;
}

function patchDeal(old, id, fields, useEndDate, skipped) {
  if (Array.isArray(old?.rows)) {
    return { ...old, rows: old.rows.map((r) => (r.id === id ? editedDeal(r, fields, useEndDate, skipped) : r)) };
  }
  for (const side of ['person', 'company']) {
    if (Array.isArray(old?.[side]?.deals)) {
      return {
        ...old,
        [side]: {
          ...old[side],
          deals: old[side].deals.map((d) => (d.id === id ? editedDeal(d, fields, useEndDate, skipped) : d)),
        },
      };
    }
  }
  return old;
}

// The API takes camelCase; the cached rows are raw snake_case database
// columns. The optimistic patch has to speak the CACHE's language or the
// table shows nothing change until the refetch lands — which would defeat
// the whole point.
const COLUMN_FOR = {
  personName: 'person_name', roleLabel: 'role_label', groupName: 'group_name',
  company: 'company', assignedOn: 'assigned_on', paymentStartOn: 'payment_start_on',
  presetOn: 'preset_on', endOn: 'end_on', payableDays: 'payable_days',
  paymentMethod: 'payment_method', monthlyAmount: 'monthly_amount',
  payableAmount: 'payable_amount', currency: 'currency', location: 'location',
  postcode: 'postcode', phone: 'phone', label: 'label',
  // The four columns master.xlsx always had and the importer used to drop.
  doorNumber: 'door_number', acceptingPostals: 'accepting_postals',
  accountNumber: 'account_number', sortCode: 'sort_code',
  shouldBePaid: 'should_be_paid', paid: 'paid', notes: 'notes',
  bankDetails: 'bank_details', status: 'status', needsReview: 'needs_review',
  // The should-be-paid/paid TOGGLES, distinct from the sheet's own text
  // columns just above. Missing here, the optimistic patch wrote a
  // camelCase key the row never reads, so the switch didn't move until the
  // refetch landed, which is the exact lag this path exists to remove.
  overrideShouldBePaid: 'override_should_be_paid', overridePaid: 'override_paid',
  paymentOutcome: 'payment_outcome',
  // THE TWO RATES, and missing here they were the same bug a second time.
  // The patch wrote `addonPercent` beside an untouched `addon_percent`, so
  // the cell kept reading its old value: the percentage stayed on screen as
  // "—" and, now the rates live on the Monthly amount, the money did not
  // move either. The toast said it had saved, and it had.
  addonPercent: 'addon_percent', feePercent: 'fee_percent',
  // THE SPECIAL CASE SWITCH, migration 064, and missing here it was the
  // SAME BUG A THIRD TIME: the patch wrote `specialCaseDeal` beside an
  // untouched `special_case_deal`, so the switch stayed where it was and the
  // red cell stayed red until the refetch landed.
  specialCaseDeal: 'special_case_deal',
};

function toColumns(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [COLUMN_FOR[k] ?? k, v]),
  );
}

/**
 * Removing one pairing, named by whoever asked for it.
 *
 * `subject` comes from the call site because only it knows which side of
 * the deal the reader is standing on: the person page says "Drew from
 * Workforce", the company page says "Drew from Reliapay". The hook said
 * "That deal deleted" and all three callers wrote a better toast on top of
 * it, so every removal produced two.
 *
 * REMOVED, not deleted: this is one pairing ending, and the CRM keeps those
 * two words apart everywhere else.
 */
export function useDeleteMasterSheetRow() {
  return useInvalidatingMutation(({ id }) => apiService.masterSheet.remove(id), {
    describe: ({ subject }) => subject ?? 'That deal',
    verb: 'removed',
    icon: 'trash',
  });
}

/**
 * One value onto many rows, from the export modal's warnings panel.
 *
 * NOT optimistic, unlike the cell edits. The panel it is pressed from is
 * rebuilt from `/export/count`, so the honest confirmation is the warning
 * disappearing once the server agrees — and the count IS the surprise here:
 * "84 presets set" is a number nobody can check any other way. An
 * optimistic version would show the warning vanish and then reappear on
 * failure, which reads as a glitch rather than as a refusal.
 */
export function useBulkUpdateMasterSheetRows() {
  return useInvalidatingMutation(
    // `wholePerson`: onto every live deal of each person these ids belong to.
    ({ ids, fields, wholePerson }) => apiService.masterSheet.bulkUpdate(ids, fields, { wholePerson }),
    {
      describe: ({ ids, label }) => `${ids.length} ${ids.length === 1 ? 'row' : 'rows'}${label ? `: ${label}` : ''}`,
      verb: 'updated',
    },
  );
}

/**
 * Deleting a set of rows outright, from the table's bulk select or from the
 * upload diff's delete tabs.
 *
 * `via` is the only difference between the two, and it is not cosmetic: it
 * is what lets History say whether a deal went because somebody was working
 * through the table or because they were reading a sheet.
 *
 * `useInvalidatingMutation` already drops every IMPORT_TOUCHES key, which is
 * what a deletion from the diff needs: it changes People, Companies and the
 * export count exactly as a commit would.
 */
export function useBulkDeleteMasterSheetRows() {
  return useInvalidatingMutation(({ ids, via }) => apiService.masterSheet.bulkDelete({ ids, via }), {
    // The count IS the confirmation here. Selecting rows and pressing
    // delete gave no feedback at all, so "did that work" could only be
    // answered by counting the table.
    describe: ({ ids }) => `${ids.length} ${ids.length === 1 ? 'deal' : 'deals'}`,
    verb: 'deleted',
    icon: 'trash',
  });
}

/**
 * Deleting a row, reported as "Gloria from MILKMAN deleted".
 *
 * Optimistic like the cell edits, and for a stronger reason: a delete is
 * the one action where seeing the row vanish IS the confirmation. Waiting
 * ~450ms with the row still sitting there invites a second click.
 *
 * The row goes back if the server refuses, and the toast says so — which
 * matters more here than anywhere else, because a row silently
 * reappearing looks like the CRM undid your work on its own.
 */
export function useDeleteMasterSheetRowOptimistic() {
  return useOptimisticUpdate({
    queryKey: KEY,
    mutationFn: ({ id }) => apiService.masterSheet.remove(id),
    applyToCache: (old, { id }) => ({
      ...old,
      rows: old.rows?.filter((r) => r.id !== id),
      total: Math.max(0, (old.total ?? 1) - 1),
    }),
    describe: ({ subject, group }) => (group ? `${subject} from ${group}` : subject ?? 'that row'),
    verb: () => 'deleted',
    successIcon: 'trash',
    successKey: 'master-sheet-delete',
    alsoInvalidate: [['people'], ['companies']],
  });
}


/**
 * ===============================
 * * STOPPING A DEAL, AND PUTTING IT BACK
 * ===============================
 *
 * Optimistic for the same reason the delete is: the row leaving the list IS
 * the confirmation, and a row that sits there for half a second invites a
 * second press. It is not gone though, it has moved to the Archive, and the
 * toast says so rather than reading like a deletion.
 *
 * One shape for both, because they are the same act pointed two ways: the
 * row stops matching the list it is on and starts matching the other one.
 */
function useMoveBetweenSheets({ request, verb, detail, failVerb }) {
  return useOptimisticUpdate({
    queryKey: KEY,
    mutationFn: ({ id }) => request(id),
    applyToCache: (old, { id }) => ({
      ...old,
      rows: old.rows?.filter((r) => r.id !== id),
      total: Math.max(0, (old.total ?? 1) - 1),
    }),
    describe: ({ subject, group }) => (group ? `${subject} from ${group}` : subject ?? 'that deal'),
    verb: () => verb,
    failVerb: () => failVerb,
    successDetail: () => detail,
    successIcon: 'check',
    // People and Companies both count a person's live deals, and a stop
    // changes that count without touching any field they read.
    alsoInvalidate: [['people'], ['person'], ['companies'], ['company'], ['export-count']],
  });
}

export function useStopMasterSheetRow() {
  return useMoveBetweenSheets({
    request: (id) => apiService.masterSheet.stop(id),
    verb: 'stopped',
    failVerb: 'stop',
    detail: 'Moved to the archive, out of this month.',
  });
}

/**
 * The Archive's only write. It can be REFUSED: a deal a company closure
 * stopped stays stopped, and the server's message says to reopen the
 * company instead. That arrives as the failure detail, so the refusal
 * reads as an instruction rather than as a broken button.
 */
export function useResumeMasterSheetRow() {
  return useMoveBetweenSheets({
    request: (id) => apiService.masterSheet.resume(id),
    verb: 'resumed',
    failVerb: 'resume',
    detail: 'Back on the master sheet.',
  });
}

/**
 * The first half of an upload: what the file WOULD do.
 *
 * Invalidates nothing, because it changes nothing. That is the entire
 * point of splitting the upload in two, and a cache drop here would make
 * merely looking at a file feel like it had already been applied.
 */
export function useImportPreview() {
  const { notify } = useNotifications();
  return useMutation({
    mutationFn: ({ file, onProgress, fills }) => (
      apiService.masterSheet.importPreview(file, onProgress, fills)
    ),
    onError: (err) => notify({
      level: 'error',
      message: "Couldn't read that sheet",
      detail: err.message,
    }),
  });
}

/** The second half: write only the rows that came back accepted. */
export function useCommitImport() {
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  return useMutation({
    mutationFn: (payload) => apiService.masterSheet.importCommit(payload),
    onSuccess: (result) => {
      for (const key of IMPORT_TOUCHES) queryClient.invalidateQueries({ queryKey: key });
      // No deleted count here any more. A commit deletes nothing: rows
      // picked off the diff's delete tabs are removed at the moment they
      // are confirmed, and useBulkDeleteMasterSheetRows reports that then,
      // which is where the feedback belongs.
      // BOTH HALVES OF THE COMMIT, and the tiers lead when they are the
      // only thing written. "0 rows written" was the whole confirmation for
      // an upload whose company statuses had just landed, which reads as
      // nothing having happened.
      const tiers = result.tiersWritten ?? 0;
      const rowPart = `${result.written} ${result.written === 1 ? 'row' : 'rows'} written`;
      const tierPart = `${tiers} company ${tiers === 1 ? 'status' : 'statuses'} updated`;
      notify({
        level: 'success',
        icon: 'import',
        // The number APPLIED, not the number in the file. Rejecting most
        // of a sheet and being told "96 rows read" is the confirmation
        // answering a question nobody asked.
        message: result.written === 0 && tiers > 0
          ? tierPart
          : [rowPart, tiers > 0 ? tierPart : ''].filter(Boolean).join(', '),
        detail: result.skipped > 0 ? `${result.skipped} left as they were.` : undefined,
      });
    },
    onError: (err) => notify({
      level: 'error',
      message: "Couldn't apply that import",
      detail: err.message,
    }),
  });
}

/**
 * ***************************************************
 * * ONE DEAL'S STATUS, from the master sheet cell
 * ***************************************************
 *
 * OPTIMISTIC, like every other write in the CRM. A dropdown in a dense
 * table that pauses before it moves reads as a control that did not take.
 *
 * IT WRITES TWO COLUMNS, so the cache patch sets both: `review_monthly`
 * and `end_note` are what Deal Status IS (configs/dealStatus.js), and a
 * patch that set one would make the column and the end date cell disagree
 * for as long as the refetch took.
 *
 * AND IT CAN CLEAR AN END DATE. "Going concern" means there is no end
 * date, so the optimistic row drops it too: leaving the old date on screen
 * beside the new word is the cell saying two things about one fact, which
 * is the thing the clear-on-type rule exists to stop.
 *
 * THREE CACHES, the same three the cell edit patches: People and Companies
 * are groupings of these rows, and the company's own checklist reads these
 * two columns back.
 */
export function useDealStatus() {
  return useOptimisticUpdate({
    queryKey: [KEY, ['person'], ['company']],
    mutationFn: ({ id, status }) => apiService.masterSheet.dealStatus(id, status),
    applyToCache: (old, { id, status }) => patchRowsWith(old, id, (row) => ({
      ...row,
      end_note: status === DEAL_STATUS.GOING_CONCERN ? GOING_CONCERN : null,
      review_monthly: status === DEAL_STATUS.REVIEW,
      ...(status === DEAL_STATUS.GOING_CONCERN ? { end_on: null } : {}),
    })),
    describe: ({ subject }) => (subject ? `${subject}'s deal status` : 'deal status'),
    verb: () => 'updated',
    successKey: 'deal-status',
    // The review queue's count moves with this, and the company page reads
    // the same two columns to seed its checklist.
    alsoInvalidate: [['people'], ['companies'], REVIEW_KEY],
  });
}
