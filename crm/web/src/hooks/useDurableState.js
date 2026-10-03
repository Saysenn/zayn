import { useEffect, useRef, useState } from 'react';

/**
 * ***************************************************
 * * A PREFERENCE, remembered past the tab
 * ***************************************************
 *
 * `useStickyState` is sessionStorage on purpose: a FILTER is invisible
 * state, and coming back next week to a list showing 6 of 96 rows with no
 * memory of why makes the CRM look broken.
 *
 * A PREFERENCE is not that. The dashboard's raw/converted toggle shows its
 * own state on the control and labels every figure with its currency, so
 * finding it where you left it is the whole point and nothing is hidden by
 * remembering it. Different question, different shelf.
 *
 * Same try/catch doctrine: storage throws outright in a private window, and
 * a preference that cannot be remembered must never stop the page painting.
 */
const PREFERENCE_PREFIX = 'crm.prefs.';

export function useDurableState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(PREFERENCE_PREFIX + key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });

  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    try {
      if (value === undefined) window.localStorage.removeItem(PREFERENCE_PREFIX + keyRef.current);
      else window.localStorage.setItem(PREFERENCE_PREFIX + keyRef.current, JSON.stringify(value));
    } catch {
      // See above.
    }
  }, [value]);

  return [value, setValue];
}
