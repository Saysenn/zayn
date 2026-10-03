export function paginationPages(page, pageCount) {
  if (pageCount <= 10) return Array.from({ length: pageCount }, (_, i) => i + 1);

  if (page <= 4) return [1, 2, 3, 4, 5, 'end-gap', pageCount];
  if (page >= pageCount - 3) {
    return [1, 'start-gap', ...Array.from({ length: 5 }, (_, i) => pageCount - 4 + i)];
  }

  return [1, 'start-gap', page - 1, page, page + 1, 'end-gap', pageCount];
}
