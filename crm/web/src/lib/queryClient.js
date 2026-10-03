import { QueryClient } from '@tanstack/react-query';

/**
 * `staleTime` is the important line here.
 *
 * It was 0 — React Query's default — which means every query is stale the
 * instant it resolves. Navigating People -> Flagged -> People refetched
 * everything on the way back, seconds later, for data that hadn't changed.
 * At ~450ms per query to Supabase in ap-south-1 (network latency, not
 * query time, so no index helps), a three-query page cost ~1.5s on every
 * single visit.
 *
 * 30 seconds is safe here specifically because nothing relies on polling
 * to notice a change. Every real write broadcasts over Socket.IO and the
 * hooks call invalidateQueries on it, so a genuine change still lands
 * immediately — this only stops the pointless refetch of data that nobody
 * touched. Queries needing tighter freshness set their own
 * refetchInterval (useSession polls every 15s), which overrides this.
 *
 * gcTime keeps the data in memory after the last component unmounts, so
 * coming back to a page you left a minute ago renders from cache while any
 * refetch happens behind it.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});
