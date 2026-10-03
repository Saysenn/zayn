// ***************************************************
// * Write camelCase fields onto a snake_case cached row
// ***************************************************
//
// A cached row came out of Postgres, so it says `old_group`; the PATCH body
// is camelCase, so it says `oldGroup`. `{ ...row, ...fields }` then writes a
// key nothing renders and leaves the visible one stale, so an optimistic
// edit LOOKS like it failed and corrects itself on the refetch.
//
// ONE COPY. It was written out in useCompanies, in usePeople and a third
// time inside optimisticPatch.test.js, which meant the test exercised its
// own restatement: break either hook's version and it stayed green.
//
// The MAP stays per hook file, which is the duplication that is deliberate:
// each page's columns are its own.

export function patchRow(row, fields, map = {}) {
  const out = { ...row };
  for (const [field, value] of Object.entries(fields ?? {})) {
    out[map[field] ?? field] = value;
  }
  return out;
}

export default patchRow;
