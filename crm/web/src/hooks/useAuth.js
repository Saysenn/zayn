import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../helpers/api.helper';
import { apiService } from '../configs/api.config';

// Polls + refetches on focus because a session can end outside this tab —
// a logout in another tab revokes it, or it expires (see
// api/configs/sessionStore.js) — and this is how that tab finds out and
// drops back to the login screen.
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api.get('/api/v1/auth/session'),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
}

// Set here, not in LoginForm's own onSuccess — React Query runs THIS
// hook-level onSuccess before the per-call one, and setting loggedIn below
// immediately re-renders RedirectIfAuthed, which navigates to "/" and
// mounts Layout. Layout reads this flag on mount, so anything set after
// setQueryData arrives too late and the welcome silently never plays.
// See Layout.jsx's JUST_LOGGED_IN_KEY.
const JUST_LOGGED_IN_KEY = 'diane-just-logged-in';

// How long Diane's sign-in pulse gets before the page turns over.
//
// Flipping the session is what unmounts the login screen (RedirectIfAuthed
// navigates the instant it goes true), so the delay HAS to live here — a
// timeout inside LoginForm would be running on an already-unmounted
// component and the transition would never be seen. LoginForm animates for
// exactly this long; the two are one sequence, so they share one number.
export const LOGIN_TRANSITION_MS = 850;

// The password half. Returns a pending ticket and NOTHING else — no
// session, no cookie, nothing to redirect on. Getting this far only earns
// the right to try the secret code.
export function useLogin() {
  return useMutation({ mutationFn: apiService.auth.login });
}

// The secret code half, and the only one that ends with a session. The
// welcome flag and the transition delay live here rather than in useLogin
// because this is the moment the page actually turns over.
export function useVerifyCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: apiService.auth.verify,
    onSuccess: () => {
      // Set immediately, not with the session below: Layout reads this on
      // mount, and mount happens the moment the session flips.
      sessionStorage.setItem(JUST_LOGGED_IN_KEY, '1');
      setTimeout(() => {
        queryClient.setQueryData(['session'], { loggedIn: true });
      }, LOGIN_TRANSITION_MS);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: apiService.auth.logout,
    onSuccess: () => queryClient.setQueryData(['session'], { loggedIn: false }),
  });
}
