// ***************************************************
// * A derived list, with a seeded one behind it
// ***************************************************
//
// A UNION, NEVER A REPLACEMENT.
//
// Every currency, group, role and location the CRM knows is DERIVED from the
// deals, so a new one turns up on its own. Swapping a hardcoded list out for
// the derived one costs two things a control cannot afford: it is empty while
// the query is in flight or if it fails, and it silently drops any value
// nobody currently uses.
//
// So the seeded list stays as the floor. Nothing can be lost, only gained.

export function unionOptions(derived, seeded = []) {
  return [...new Set([...(derived ?? []), ...(seeded ?? [])])];
}

export default unionOptions;
