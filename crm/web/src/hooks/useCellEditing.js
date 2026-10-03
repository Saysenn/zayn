import { useCallback, useEffect, useState } from 'react';

/**
 * "Is a cell open for editing right now?", shared across pages.
 *
 * The problem it solves is specific and was going to bite immediately.
 * Both sheet pages refetch on a socket broadcast — `master-sheet:changed`
 * and `sync:completed` — and those fire on EVERY write to the table:
 * Diane's edits, whatbot's sync, another admin's tab, and the admin's own
 * save a moment earlier. If one lands while a cell is open, the row is
 * replaced underneath and whatever was half-typed disappears.
 *
 * So the refresh is DEFERRED rather than dropped. The broadcast sets a
 * flag, and the moment the last cell closes the refetch runs. Nothing is
 * lost, it just waits for a safe moment.
 *
 * Module-level rather than context because it is genuinely global — a
 * table on one page, a socket handler in a hook, and a cell component
 * three levels down all need the same answer, and threading a provider
 * through for one boolean would be more machinery than the fact deserves.
 * A counter, not a boolean, because Tab moves between cells and the new
 * one opens before the old one closes.
 */

let openCells = 0;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn());
}

// Passed straight to EditableCell's onEditingChange.
export function setCellEditing(isEditing) {
  openCells = Math.max(0, openCells + (isEditing ? 1 : -1));
  emit();
}

export function isAnyCellEditing() {
  return openCells > 0;
}

/**
 * Wraps a refetch so it waits for editing to finish.
 *
 * Returns `requestRefresh` — call it from the socket handler instead of
 * invalidating directly.
 */
export function useDeferredRefresh(refresh) {
  const [, setTick] = useState(0);
  const [pending, setPending] = useState(false);

  // Re-render this hook's owner whenever a cell opens or closes, so the
  // effect below gets a chance to flush.
  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    listeners.add(onChange);
    return () => listeners.delete(onChange);
  }, []);

  useEffect(() => {
    if (!pending || isAnyCellEditing()) return;
    setPending(false);
    refresh();
    // `refresh` is recreated each render by its caller; depending on it
    // would loop. The tick above is what actually drives re-evaluation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, openCells]);

  return useCallback(() => {
    if (isAnyCellEditing()) {
      setPending(true);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);
}
