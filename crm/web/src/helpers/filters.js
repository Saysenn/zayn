// ***************************************************
// * How many filters are actually on
// ***************************************************
//
// `Object.keys(filters).length` COUNTS A CLEARED FILTER. Every toggle in
// this app clears itself by setting the key to `undefined`, deliberately:
// the filter has to disappear rather than become a filter for the opposite
// value, and `toQueryString` omits undefined so the request is right.
//
// The KEY survives that, so unticking "Active only" left the badge reading
// 1 and the Clear button on screen with nothing left to clear. Two pages
// counted keys and two counted values, which is the drift this stops.
//
// An empty string counts as cleared too: a Select set back to "All" writes
// one rather than removing itself.
export function countFilters(filters) {
  return Object.values(filters ?? {})
    .filter((v) => v !== undefined && v !== null && v !== '' && v !== false)
    .length;
}
