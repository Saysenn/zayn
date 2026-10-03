// ***************************************************
// * The query string keys a link may seed a filter with
// ***************************************************
//
// A link from the dashboard arrives with a filter already chosen. Named
// once, because the writer and the reader sit in different files and a typo
// between them fails silently: the page opens unfiltered and looks fine.
//
// `period`, never `status`: on the master sheet a deal's active/ended is the
// PAYMENT PERIOD. Status is the company's own, and nothing else.

export const LINK_FILTER = Object.freeze({
  group: 'group',
  period: 'period',
  // Rows the last import could not settle. The sticky behind it is called
  // `masterSheet.review`, which is NOT the monthly review: one is a row
  // needing a check, the other is a deal past its term. The param is named
  // for what it filters so the two cannot be confused in a link.
  needsReview: 'needsReview',
  // NO `reviewPanel`. It opened the monthly review as a modal over the
  // master sheet; the review is a page now, so a link to it is `/review`
  // and there is nothing to seed. Removed 2026-09-29.
});

export default LINK_FILTER;
