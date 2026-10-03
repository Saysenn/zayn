import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { useOptimisticUpdate } from './useOptimisticUpdate';
import { useSocketEvent } from './useSocket';

// The overview: one row per (person, group), not per concern. from/to
// filter which underlying concerns count toward that grouping — "this
// month" being the point of the page (monthly checking).
export function useConcerns({ status, from, to, group, q, page = 1, pageSize = 20 } = {}) {
  const queryClient = useQueryClient();
  const queryKey = ['concerns', status ?? 'all', from ?? null, to ?? null, group ?? 'all', q ?? '', page, pageSize];

  const query = useQuery({
    queryKey,
    queryFn: () => apiService.concerns.list({ status, from, to, group, q, page, pageSize }),
    select: (data) => ({ rows: data.concerns, total: data.total }),
    placeholderData: (prev) => prev,
  });

  // New concerns arrive from whatbot (an escalation) at any time, not just
  // after something this tab did — invalidate on both events so a concern
  // raised from a WhatsApp message shows up without a manual refresh.
  useSocketEvent('concern:new', () => {
    queryClient.invalidateQueries({ queryKey: ['concerns'] });
  });
  useSocketEvent('concern:updated', () => {
    queryClient.invalidateQueries({ queryKey: ['concerns'] });
  });

  return { ...query, data: query.data?.rows, total: query.data?.total ?? 0 };
}

// The detail modal: every concern one person has ever raised in one group,
// unfiltered by date on purpose — once you're looking at someone
// specifically, their older history is exactly the context worth having.
export function useConcernsForPerson(group, personId) {
  const queryClient = useQueryClient();
  const queryKey = ['concerns', 'person', group, personId];

  const query = useQuery({
    queryKey,
    queryFn: () => apiService.concerns.forPerson(group, personId),
    select: (data) => data.concerns,
    enabled: Boolean(group && personId),
  });

  const belongsHere = (c) => c.group_name === group && c.person_id === personId;

  useSocketEvent('concern:new', (concern) => {
    if (belongsHere(concern)) queryClient.invalidateQueries({ queryKey });
  });
  useSocketEvent('concern:updated', (concern) => {
    if (belongsHere(concern)) queryClient.invalidateQueries({ queryKey });
  });

  return query;
}

/**
 * Changing a flag's status, on screen before the server answers.
 *
 * It waited for the round trip and then invalidated, so picking "resolved"
 * left the dropdown showing "open" until the refetch landed. On a queue
 * you work through one after another that reads as the click not having
 * registered, and the usual response is to pick it again.
 *
 * ONLY THE MODAL'S LIST IS PATCHED, not the grid behind it. A card is a
 * PERSON, and its status is derived from all their flags (open beats
 * in_progress beats resolved), so one flag changing cannot be resolved
 * from the card's own row: resolving one of somebody's three flags may
 * leave the card open, or may not. The grid's rows carry no `id`, so they
 * fall through the patch untouched and the invalidate in `onSettled`
 * refetches the real answer a moment later.
 */
export function useUpdateConcernStatus() {
  return useOptimisticUpdate({
    queryKey: ['concerns'],
    mutationFn: ({ id, status }) => apiService.concerns.updateStatus(id, status),
    // The stamp moves with the status, and only when the status actually
    // moves — the same rule the UPDATE uses, so the optimistic row and the
    // one that comes back cannot disagree about whether anything happened.
    applyToCache: (old, { id, status }) => (
      Array.isArray(old?.concerns)
        ? {
          ...old,
          concerns: old.concerns.map((c) => (
            c.id === id && c.status !== status
              ? { ...c, status, status_changed_at: new Date().toISOString() }
              : c
          )),
        }
        : old
    ),
    describe: () => 'this flag',
    verb: ({ status }) => `marked ${status.replace('_', ' ')}`,
  });
}
