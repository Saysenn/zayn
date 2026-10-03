import { useCallback, useEffect, useRef } from 'react';
import { BASE_URL } from '../../helpers/api.helper';

/**
 * SAVES THE CONVERSATION WHEN IT ENDS, never while it is happening.
 *
 * Deliberate UX call: nothing writes to the database as somebody talks to
 * Diane. The browser already holds the whole transcript (it posts it on
 * every turn anyway), so it sends it once at the end instead of a write
 * per message.
 *
 * ---- what counts as the end ----
 * Closing the orb is NOT one. DianeContext keeps the conversation alive
 * across a close and reopen on purpose, so closing is a SAVE POINT: the
 * transcript so far is written, and if they carry on it is written again
 * over the same row. Saves are idempotent on the id precisely so this is
 * free.
 *
 * A real end is one of:
 *   - the page unloading (tab closed, refreshed, navigated away)
 *   - thirty minutes of silence with the orb open, after which coming back
 *     is a new conversation rather than the same one continued
 *
 * Without the idle rule, leaving the orb open all day produces one
 * enormous conversation, and a summary covering eight unrelated topics is
 * useless to search.
 *
 * ---- the 64KB problem ----
 * `sendBeacon` and `fetch(keepalive)` are both capped at 64KB, and the
 * history budget is 200,000 characters. So a long conversation is SILENTLY
 * DROPPED on unload: no error, no request, nothing stored.
 *
 * Hence the checkpoint. Once the transcript passes CHECKPOINT_BYTES it is
 * saved with a normal request, and again at the end. That is two or three
 * writes across a long conversation rather than one per turn, and it
 * bounds what a crash can lose to the last stretch instead of everything.
 * Short conversations, which are most of them, still write exactly once.
 */

const IDLE_MS = 30 * 60 * 1000;
const CHECKPOINT_BYTES = 50_000;
const PATH = '/api/v1/conversations';

function newConversation() {
  return {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    checkpointed: false,
    rows: new Set(),
    people: new Set(),
    groups: new Set(),
    companies: new Set(),
  };
}

export function useConversationLog(history) {
  const convo = useRef(newConversation());
  // The latest transcript, readable from an event handler that was
  // registered once. Reading `history` there would close over whatever it
  // was when the listener was attached, which on unload is the worst
  // possible moment to be one render behind.
  const latest = useRef(history);
  const idleTimer = useRef(null);

  useEffect(() => { latest.current = history; }, [history]);

  const payload = useCallback((checkpoint) => {
    const c = convo.current;
    return JSON.stringify({
      id: c.id,
      startedAt: c.startedAt,
      checkpoint,
      // Cards, forms and lists are rendered from other fields; only the
      // words belong in a transcript.
      messages: (latest.current ?? [])
        .filter((m) => typeof m.content === 'string' && m.content.trim() !== '')
        .map((m) => ({ role: m.role, content: m.content })),
      touchedRows: [...c.rows],
      touchedPeople: [...c.people],
      touchedGroups: [...c.groups],
      touchedCompanies: [...c.companies],
    });
  }, []);

  const hasContent = useCallback(
    () => (latest.current ?? []).some((m) => typeof m.content === 'string' && m.content.trim()),
    [],
  );

  /** A normal request. Used everywhere except unload. */
  const save = useCallback(async (checkpoint = false) => {
    if (!hasContent()) return;
    try {
      await fetch(`${BASE_URL}${PATH}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: payload(checkpoint),
      });
    } catch {
      // Silent on purpose. The conversation already happened and there is
      // nothing the admin can do about a failed log write; the server's own
      // captureLog carries the detail.
    }
  }, [hasContent, payload]);

  /** Unload only. Cannot be awaited, cannot exceed 64KB. */
  const beacon = useCallback(() => {
    if (!hasContent()) return;
    const body = payload(false);
    // Over the cap the beacon is dropped without a word, so do not pretend
    // it was sent. The checkpoint is what makes this survivable.
    if (body.length > 60_000) return;
    try {
      navigator.sendBeacon(`${BASE_URL}${PATH}`, new Blob([body], { type: 'application/json' }));
    } catch {
      // Nothing to do during teardown.
    }
  }, [hasContent, payload]);

  /** What this turn acted on, from the tool results the overlay receives. */
  const noteTouched = useCallback(({ row, person, group, company } = {}) => {
    const c = convo.current;
    if (Number.isInteger(row)) c.rows.add(row);
    if (person) c.people.add(String(person).trim());
    if (group) c.groups.add(String(group).trim().toUpperCase());
    if (company) c.companies.add(String(company).trim());
  }, []);

  /**
   * ENDED BY HAND, from the reset button.
   *
   * A reset is a real end, not a save point: what follows is a different
   * conversation and must not be filed under the same id. So it saves what
   * happened first. The transcript is being cleared from the screen, not
   * from the log: nobody asked to unsay it.
   */
  const endConversation = useCallback(
    () => save().finally(() => { convo.current = newConversation(); }),
    [save],
  );

  // Thirty minutes of silence ends it: save, then the next message starts
  // a fresh conversation.
  useEffect(() => {
    if (!hasContent()) return undefined;
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(endConversation, IDLE_MS);
    return () => clearTimeout(idleTimer.current);
  }, [history, hasContent, endConversation]);

  // The checkpoint. Once, when the transcript first gets too big for a
  // beacon to carry.
  useEffect(() => {
    const c = convo.current;
    if (c.checkpointed) return;
    if (payload(true).length < CHECKPOINT_BYTES) return;
    c.checkpointed = true;
    save(true);
  }, [history, payload, save]);

  // `pagehide` rather than `beforeunload`: it fires on mobile and on
  // back/forward cache navigations, where beforeunload does not.
  useEffect(() => {
    const onHide = () => beacon();
    const onVisibility = () => { if (document.visibilityState === 'hidden') beacon(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [beacon]);

  return { save, noteTouched, endConversation };
}
