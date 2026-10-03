import { useCallback, useEffect, useRef, useState } from 'react';

// ***************************************************
// * A filter you set once and find where you left it
// ***************************************************
//
// Every filtered page held its filters in plain `useState`, so walking to
// a person's page and back reset the lot. On the master sheet that is
// eleven controls to set again, and the commonest reason to leave the page
// is to look at one of the rows it just found you.
//
// sessionStorage, NOT localStorage. A filter is invisible state: come back
// to a list showing 6 of 96 rows with no memory of why and the CRM looks
// broken. Dying with the tab bounds that to one sitting, and within the
// sitting the filter panel's count and its Clear button already say a
// filter is on. localStorage would carry it to next week.
//
// ONE KEY PER PAGE, namespaced, so two pages with a `group` filter do not
// read each other's.

const PREFIX = 'crm.filters.';

/**
 * WRAPPED IN try/catch, EVERY TIME. Storage throws outright in a private
 * window and in some embedded browsers, and a filter that cannot be
 * remembered must never stop the page rendering.
 */
function read(key, fallback) {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    // `undefined` is a real filter state, meaning "not filtering on this",
    // and JSON.stringify turns it into the string "undefined" which parses
    // back as a crash. Removing the key is what round-trips.
    if (value === undefined) window.sessionStorage.removeItem(PREFIX + key);
    else window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Nothing to do and nothing worth saying: the page works either way.
  }
}

// ===============================
// * A LINK MAY ARRIVE WITH THE FILTER ALREADY CHOSEN
// ===============================
// Read in the initialiser, not in an effect, so the page's first request is
// already the filtered one. Strings only: a query string carries nothing
// else. PURE, because React calls an initialiser twice in development.
function readParam(param) {
  try {
    const value = new URLSearchParams(window.location.search).get(param);
    return value === null ? undefined : value;
  } catch {
    return undefined;
  }
}

// AND STRIPPED once the value is held. Left in the address bar, Clear would
// work until the next refresh put the filter straight back. replaceState
// rather than the router: no component reads the param, so there is nothing
// to re-render and nothing to navigate.
function stripParam(param) {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(param)) return;
    url.searchParams.delete(param);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // See above: the page works either way.
  }
}

/**
 * `useState`, remembered for this tab.
 *
 * @param {string} key namespaced per page, e.g. 'masterSheet.group'
 * @param {*} initial what it is before anybody has chosen
 * @param {string} [param] a query string key a link may seed this filter
 *   with, e.g. 'period'. See configs/linkFilters.js.
 */
export function useStickyState(key, initial, param) {
  // Read ONCE, lazily. Reading on every render would fight the setter, and
  // reading in an effect would flash the default first. A link beats what
  // the tab remembered: it is the more recent instruction.
  const [value, setValue] = useState(() => {
    const seeded = param ? readParam(param) : undefined;
    return seeded === undefined ? read(key, initial) : seeded;
  });

  // The key is captured so a caller can pass an inline string without the
  // effect re-running on every render.
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => { write(keyRef.current, value); }, [value]);
  useEffect(() => { if (param) stripParam(param); }, [param]);

  return [value, setValue];
}

/**
 * Forget everything this page remembered.
 *
 * The Clear button already resets the state; this stops the OLD values
 * coming back on the next visit, which is the half a plain reset misses.
 */
export function useClearSticky(prefix) {
  return useCallback(() => {
    try {
      const full = PREFIX + prefix;
      // Collected first: removing while iterating skips every other key.
      const keys = [];
      for (let i = 0; i < window.sessionStorage.length; i += 1) {
        const k = window.sessionStorage.key(i);
        if (k && k.startsWith(full)) keys.push(k);
      }
      for (const k of keys) window.sessionStorage.removeItem(k);
    } catch {
      // See above.
    }
  }, [prefix]);
}
