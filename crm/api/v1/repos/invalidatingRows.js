// A write outside the rows repo that changes what its cache holds (the dead
// list reads profiles and snapshots too). Required late: the rows repo
// requires people.repo, which uses this.
function invalidatingRows(fn) {
  return async (...args) => {
    const out = await fn(...args);
    require('./masterSheetRows.repo').invalidateCache();
    return out;
  };
}

module.exports = { invalidatingRows };
