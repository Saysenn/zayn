/**
 * Opening the printable export, in one place.
 *
 * Two callers build this URL: the People page's export modal and a
 * person's own Export button. Two copies would drift the first time a
 * param was added, and the layout you got would depend on which page you
 * pressed Export from.
 */

const PRINT_PATH = '/export/print';

/** The only preset either caller uses. The others are Master Sheet's. */
export const BREAKDOWN_PRESET = 'breakdown';

/** ?template= for the People page's card grid. See templates/pdf/index.js. */
export const PEOPLE_CARDS_TEMPLATE = 'people-cards';

export function printSearch(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * A new tab, never the current one: the print page immediately opens the
 * browser's print dialog, and doing that over the page somebody was
 * working on loses whatever they had open.
 */
export function openPrint(params) {
  window.open(`${PRINT_PATH}${printSearch(params)}`, '_blank', 'noopener');
}
