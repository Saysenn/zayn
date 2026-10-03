import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { AI_RECHECK_MS, AI_STATUS_KEY } from '../configs/aiLock';

// ***************************************************
// * Whether Diane can think, for everything that shows her
// ***************************************************
//
// `known` is false until the first answer: the welcome waits on it rather than
// flashing. A check that FAILED is not a lock; the server refuses her anyway.
export function useAiStatus() {
  const { data, isError } = useQuery({
    queryKey: AI_STATUS_KEY,
    queryFn: () => apiService.masterSheet.aiStatus(),
    staleTime: AI_RECHECK_MS,
    refetchOnWindowFocus: true,
    retry: false,
    // Asked again only while locked, so a top up unlocks her with no reload.
    refetchInterval: (query) => (query.state.data?.available === false ? AI_RECHECK_MS : false),
  });
  const known = data != null || isError;
  const locked = data?.available === false;
  const reason = data?.reason ?? null;
  // One object per ANSWER, not per render: the Diane context hands it to every page.
  return useMemo(() => ({ known, locked, reason }), [known, locked, reason]);
}

// After one of her calls fails: the lock it may have learned reaches the page now.
export function useRecheckAi() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: AI_STATUS_KEY }), [queryClient]);
}
