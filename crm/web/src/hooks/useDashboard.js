import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { dashboardQueryParams, normalizeDashboard } from '../helpers/dashboard';
import { useSocketEvent } from './useSocket';

export function useDashboard(filters) {
  const queryClient = useQueryClient();
  const params = dashboardQueryParams(filters);
  const query = useQuery({
    queryKey: ['dashboard', params],
    queryFn: () => apiService.dashboard.get(params),
    select: normalizeDashboard,
    placeholderData: (previous) => previous,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  useSocketEvent('master-sheet:changed', refresh);
  useSocketEvent('people:changed', refresh);
  useSocketEvent('companies:changed', refresh);
  useSocketEvent('concern:new', refresh);
  useSocketEvent('concern:updated', refresh);
  return query;
}
