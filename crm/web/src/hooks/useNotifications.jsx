import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSocketEvent } from './useSocket';
import { beep } from '../lib/beep';

const NotificationContext = createContext(null);
let nextToastId = 1;

/**
 * Toasts — ephemeral, never persisted. Unread COUNTS are server-derived
 * (useChat.js's useUnreadChat, useConcerns), not tracked here, so they
 * survive a refresh and stay consistent across every admin's tab. This
 * provider reacts to the same socket events to pop a toast in the moment,
 * AND is now the thing every optimistic mutation reports through.
 *
 * Why that second job matters: with optimistic UI the screen already shows
 * the change before the server has agreed to it. If the save then fails
 * and the value silently reverts, the admin sees a number change back for
 * no visible reason. The toast is the only thing that says why.
 */

// Success is a confirmation you've already seen happen on screen, so it
// gets out of the way. An error is the opposite — it reports something you
// did NOT see, so it stays until acknowledged. User's own call.
// A warning is read and moved past, so it goes after 8s; only an error
// waits to be dismissed. A toast carrying Undo stays a little longer, so
// the button is still there when you reach for it.
const AUTO_DISMISS_MS = { success: 5000, info: 5000, warning: 8000, error: null };
const ACTION_DISMISS_MS = 8000;

// Beyond this the stack runs off the screen. Successes are dropped first
// and errors never automatically, because a lost error is the one thing
// this system exists to prevent.
const MAX_VISIBLE = 5;

export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismissTimers = useRef(new Map());

  const dismissToast = useCallback((id) => {
    clearTimeout(dismissTimers.current.get(id));
    dismissTimers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const scheduleDismiss = useCallback((id, level, hasAction = false) => {
    const ms = AUTO_DISMISS_MS[level] && (hasAction ? Math.max(ACTION_DISMISS_MS, AUTO_DISMISS_MS[level]) : AUTO_DISMISS_MS[level]);
    if (!ms) return; // errors wait to be dismissed
    clearTimeout(dismissTimers.current.get(id));
    dismissTimers.current.set(id, setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
      dismissTimers.current.delete(id);
    }, ms));
  }, []);

  /**
   * The one way anything raises a toast.
   *
   * @param level     'success' | 'error' | 'warning' | 'info'
   * @param message   the line shown. Short — this is a strip, not a dialog.
   * @param key       collapses repeats. Editing five cells should say
   *                  "Saved 5 changes", not stack five identical strips.
   * @param collapsed (count) => string, for the collapsed wording.
   * @param to        a route, if the toast has somewhere to go. Socket
   *                  toasts do; "Saved" does not.
   * @param action    { label, onClick }: one button on the strip, e.g. Undo.
   * @param sound     socket toasts beep; a beep per cell edit would be
   *                  unbearable, so it's opt-in rather than automatic.
   */
  const notify = useCallback(({
    level = 'info', message, detail, key, collapsed, to, icon, action, sound = false,
  }) => {
    if (sound) beep();

    // THE ID COMES BACK, so an optimistic toast can be corrected
    // (updateToast) or taken down (dismissToast) once the server answers.
    // Taken here, not inside the updater: React may run that later (or
    // twice). A repeat that collapses into an older strip keeps that
    // strip's id, so the one returned then simply matches nothing.
    const newId = nextToastId++;
    setToasts((current) => {
      // Errors are never collapsed. Two failed saves are two different
      // fields, and merging them hides which one actually broke.
      if (key && level !== 'error') {
        const existing = current.find((t) => t.key === key && t.level === level);
        if (existing) {
          const count = existing.count + 1;
          scheduleDismiss(existing.id, level); // restart the clock, it's fresh news again
          return current.map((t) => (t.id === existing.id
            ? { ...t, count, message: collapsed ? collapsed(count) : `${message} (${count})` }
            : t));
        }
      }

      const id = newId;
      scheduleDismiss(id, level, Boolean(action));
      const next = [...current, { id, level, message, detail, key, to, icon, action, count: 1 }];

      // Trim from the oldest, but only things that would have expired on
      // their own anyway.
      if (next.length <= MAX_VISIBLE) return next;
      const droppable = next.findIndex((t) => AUTO_DISMISS_MS[t.level]);
      if (droppable === -1) return next; // all errors — let them stack rather than lose one
      clearTimeout(dismissTimers.current.get(next[droppable].id));
      dismissTimers.current.delete(next[droppable].id);
      return next.filter((_, i) => i !== droppable);
    });
    return newId;
  }, [scheduleDismiss]);

  // Rewrites a strip already on screen: the optimistic "3 deals stopped"
  // gains the server's "1 already stopped" once it is known. Gone already
  // (dismissed, expired) is fine, there is nothing to correct then.
  const updateToast = useCallback((id, patch) => {
    if (id == null) return;
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  useSocketEvent('concern:new', (concern) => {
    notify({
      level: 'info',
      message: 'New concern flagged',
      detail: `${concern.category} · ${concern.group_name} · ${concern.person_id}`,
      to: '/flagged',
      sound: true,
    });
  });

  useSocketEvent('message:new', (message) => {
    if (message.direction !== 'inbound') return; // the admin's own sends echo back too
    notify({
      level: 'info',
      message: `New message · ${message.group_name}`,
      detail: message.body,
      to: '/chat',
      sound: true,
    });
  });

  // Every pending timer, cleared. Without this a toast scheduled just
  // before unmount fires into a dead component.
  useEffect(() => {
    const timers = dismissTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  return (
    <NotificationContext.Provider value={{ toasts, notify, dismissToast, updateToast }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}
