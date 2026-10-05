import { useCallback, useEffect, useMemo, useState } from 'react';

// ***************************************************
// * Which rows are ticked, for the bulk bar
// ***************************************************

/**
 * One way every list ticks rows, so the Master Sheet, People, Expenses and
 * the rest cannot each grow their own Set-in-state with its own bugs.
 *
 * `visibleIds` is what is on screen now. The selection is cut back to it
 * whenever it changes, so a filter, a search or a page turn can never
 * leave a row ticked that you can no longer see and then act on it.
 */
export default function useRowSelection(visibleIds = []) {
  const [selected, setSelected] = useState(() => new Set());
  const key = visibleIds.join('|');

  useEffect(() => {
    setSelected((cur) => {
      if (cur.size === 0) return cur;
      const keep = new Set(visibleIds);
      const next = new Set([...cur].filter((id) => keep.has(id)));
      return next.size === cur.size ? cur : next;
    });
    // `key` is visibleIds, compared by value rather than by array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const toggle = useCallback((id) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const setAll = useCallback((on) => {
    setSelected(on ? new Set(visibleIds) : new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const clear = useCallback(() => setSelected(new Set()), []);

  return useMemo(() => ({
    selected,
    ids: [...selected],
    count: selected.size,
    total: visibleIds.length,
    has: (id) => selected.has(id),
    toggle,
    setAll,
    clear,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [selected, key, toggle, setAll, clear]);
}
