import { useQuery } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { useCrossPageRefresh } from './usePeople';

// ***************************************************
// * The dead list: people whose every deal is stopped
// ***************************************************
// Read only, and refreshed by the same events as People: stopping or adding
// back a deal anywhere moves someone on or off it.

export function useDeadPeople(filters = {}) {
  const query = useQuery({
    queryKey: ['dead-people', filters],
    queryFn: () => apiService.deadPeople.list(filters),
    select: (data) => ({ rows: data.people, total: data.total }),
    placeholderData: (prev) => prev,
  });
  useCrossPageRefresh(['dead-people']);
  return { ...query, data: query.data?.rows, total: query.data?.total ?? 0 };
}

export function useDeadPerson(personId) {
  const query = useQuery({
    queryKey: ['dead-person', personId],
    queryFn: () => apiService.deadPeople.get(personId),
    select: (data) => data.person,
    enabled: Boolean(personId),
  });
  useCrossPageRefresh(['dead-person', personId]);
  return query;
}
