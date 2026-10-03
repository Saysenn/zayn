// One place page/pageSize query params turn into limit/offset — every
// paginated route (companies, assignments, concerns) reads through this so
// the defaults and the cap can't drift apart between them.
function parsePagination(query, { defaultPageSize = 50, maxPageSize = 200 } = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(maxPageSize, Math.max(1, Number(query.pageSize) || defaultPageSize));
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

module.exports = { parsePagination };
