import { useQuery } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { useSocketEvent } from './useSocket';
import { useOptimisticUpdate } from './useOptimisticUpdate';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { REVIEW_ANSWER_LEAVES_LIST } from '../configs/monthlyReview';

/**
 * ***************************************************
 * * The monthly review: which deals are still running
 * ***************************************************
 *
 * NO MONTH ANYWHERE IN THIS FILE. The server reads it from the business
 * timezone; there is no picker and no param. See docs/closure.md section 9.
 */

// Exported because a write on ANOTHER page can move this queue: putting a
// company into liquidation puts every live deal on it into the review with
// no deal row changing. One key, imported, never a second array typed out.
export const REVIEW_KEY = ['monthly-review'];

const KEY = REVIEW_KEY;

// Answering writes `stopped_on`, so it changes the master sheet, People,
// Companies and the export's count as surely as an edit does.
const TOUCHES = [
  ['master-sheet'], ['people'], ['person'], ['companies'], ['company'], ['export-count'], ['history'],
];

export function useMonthlyReview(filters = {}, { enabled = true } = {}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...KEY, filters],
    queryFn: () => apiService.monthlyReview.list(filters),
    enabled,
    placeholderData: (prev) => prev,
  });

  // Another tab answering, or Diane answering in this one, both land here.
  useSocketEvent('master-sheet:changed', useCallback(
    () => queryClient.invalidateQueries({ queryKey: KEY }),
    [queryClient],
  ));

  return {
    ...query,
    data: query.data?.rows,
    period: query.data?.period,
    pending: query.data?.pending ?? { count: 0, amount: 0 },
  };
}

/**
 * Just the count and the money, for the header button and ExportWarnings.
 *
 * ITS OWN QUERY, so a badge on every master sheet render is not the whole
 * queue fetched to count it.
 */
export function useReviewPending() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...KEY, 'pending'],
    queryFn: () => apiService.monthlyReview.pending(),
  });
  useSocketEvent('master-sheet:changed', useCallback(
    () => queryClient.invalidateQueries({ queryKey: [...KEY, 'pending'] }),
    [queryClient],
  ));
  return query.data ?? { count: 0, amount: 0 };
}

// Paints the ANSWER, then drops whatever that answer takes off the list. The
// stop date is the server's, and the panel never prints it, so nothing is
// guessed. Without the drop an "already ended" row sat there until the
// refetch landed and then vanished under the pointer.
// The pending query has no rows and is left alone.
function paintAnswer(old, { dealIds, answer }) {
  if (!old?.rows) return old;
  const ids = new Set(dealIds);
  return {
    ...old,
    rows: old.rows
      .map((row) => (ids.has(row.id) ? { ...row, answer } : row))
      .filter((row) => !REVIEW_ANSWER_LEAVES_LIST.includes(row.answer)),
  };
}

// THE COUNT IS THE CONFIRMATION. Twelve rows answered with no number
// anywhere is indistinguishable from a request that failed.
const countOf = ({ dealIds }) => `${dealIds.length} ${dealIds.length === 1 ? 'deal' : 'deals'}`;

/** One door. Undoing an answer is History's job, not this hook's. */
export function useAnswerReview() {
  return useOptimisticUpdate({
    queryKey: KEY,
    mutationFn: ({ dealIds, answer }) => apiService.monthlyReview.answer(dealIds, answer),
    applyToCache: paintAnswer,
    describe: countOf,
    verb: () => 'answered',
    failVerb: () => 'answer',
    alsoInvalidate: TOUCHES,
    successKey: 'monthly-review',
  });
}
