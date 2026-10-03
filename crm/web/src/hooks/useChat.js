import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { useSocketEvent } from './useSocket';
import { useNotifications } from './useNotifications';

export function useGroups() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['groups'],
    queryFn: () => apiService.people.groups(),
    select: (data) => data.groups,
    staleTime: 5 * 60_000, // the roster only changes on sync, no need to refetch often
  });

  // A sync can introduce a group nobody's seen before — without this it only
  // shows up after the staleTime window or a full reload.
  useSocketEvent('sync:completed', () => {
    queryClient.invalidateQueries({ queryKey: ['groups'] });
  });

  return query;
}

export function usePeopleInGroup(group) {
  return useQuery({
    queryKey: ['people', 'group', group],
    queryFn: () => apiService.people.inGroup(group),
    select: (data) => data.people,
    enabled: Boolean(group),
  });
}

export function useSearchPeople(q) {
  return useQuery({
    queryKey: ['people', 'search', q],
    queryFn: () => apiService.people.search(q),
    select: (data) => data.people,
    enabled: q.trim().length > 0,
  });
}

export function useThreads() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['threads'],
    queryFn: () => apiService.messages.threads(),
    select: (data) => data.threads,
  });

  useSocketEvent('message:new', () => {
    queryClient.invalidateQueries({ queryKey: ['threads'] });
  });
  useSocketEvent('message:updated', () => {
    queryClient.invalidateQueries({ queryKey: ['threads'] });
  });

  return query;
}

export function useThread(group, personId) {
  const queryClient = useQueryClient();
  const queryKey = ['thread', group, personId];

  const query = useQuery({
    queryKey,
    queryFn: () => apiService.messages.thread(group, personId),
    select: (data) => data.messages,
    enabled: Boolean(group && personId),
  });

  const belongsHere = (m) => m.group_name === group && m.person_id === personId;

  useSocketEvent('message:new', (message) => {
    if (belongsHere(message)) queryClient.invalidateQueries({ queryKey });
  });
  useSocketEvent('message:updated', (message) => {
    if (belongsHere(message)) queryClient.invalidateQueries({ queryKey });
  });

  return query;
}

// Server-persisted unread, per (group, person) — survives a refresh and
// stays consistent across every admin's tab, since "read" is shared state,
// not something tracked per browser session. Derived helpers below turn the
// flat list into "total", "per group", and "per person" without re-fetching.
export function useUnreadChat() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['unread-chat'],
    queryFn: () => apiService.messages.unread(),
    select: (data) => data.unread,
  });

  useSocketEvent('message:new', (message) => {
    if (message.direction === 'inbound') queryClient.invalidateQueries({ queryKey: ['unread-chat'] });
  });
  useSocketEvent('thread:read', () => {
    queryClient.invalidateQueries({ queryKey: ['unread-chat'] });
  });

  const rows = query.data ?? [];
  const total = rows.reduce((sum, r) => sum + r.unread, 0);
  const forGroup = (group) =>
    rows.filter((r) => r.group_name === group).reduce((sum, r) => sum + r.unread, 0);
  const forPerson = (group, personId) =>
    rows.find((r) => r.group_name === group && r.person_id === personId)?.unread ?? 0;

  return { ...query, total, forGroup, forPerson };
}

/**
 * SILENT ON SUCCESS, NEVER ON FAILURE. Marking a thread read is
 * bookkeeping and its result is already on screen, so a toast for it would
 * be noise. A FAILURE is not: the badge keeps a count the server never
 * cleared, and it comes back on the next refetch looking like new mail.
 *
 * Chat is disabled for now, so nothing calls this today. The handler stays
 * because the next thing to call it inherits whatever is here.
 */
export function useMarkThreadRead() {
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  return useMutation({
    mutationFn: ({ group, personId }) => apiService.messages.markRead(group, personId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['unread-chat'] }),
    onError: (err) => notify({
      level: 'error',
      message: "Couldn't mark that thread read",
      detail: err.message,
    }),
  });
}

/**
 * ERROR ONLY. The message appearing in the thread is the confirmation, and
 * a toast beside it would say the same thing twice.
 *
 * A FAILURE had no tell at all: nothing appeared, which is exactly what an
 * unsent message looks like while it is still sending. This one matters
 * more than most, because the far end is a real person on WhatsApp — the
 * send goes out through whatbot's worker, so it fails whenever that worker
 * is down or its socket has dropped, which is invisible from here.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  return useMutation({
    mutationFn: ({ groupName, personId, body }) => apiService.messages.send(groupName, personId, body),
    onSuccess: (_data, { groupName, personId }) => {
      queryClient.invalidateQueries({ queryKey: ['thread', groupName, personId] });
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
    onError: (err) => notify({
      level: 'error',
      message: "That message wasn't sent",
      detail: err.message,
    }),
  });
}
