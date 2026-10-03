const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * ***************************************************
 * * CONTRACT: a field is editable end to end, or not at all
 * ***************************************************
 *
 * FOUR LISTS HAVE TO AGREE FOR ONE CELL TO WORK, and nothing forced them
 * to. Two of them are in this codebase:
 *
 *   masterSheet.js  toFields()    which fields survive the request body
 *   repos/...       COLUMN_FOR    which fields reach a column
 *
 * The other two are web side (`MasterSheetPage`'s EDITABLE and
 * `useMasterSheet`'s COLUMN_FOR) and are pinned there, by
 * `web/src/hooks/columnFor.test.js`. NEITHER SIDE READS THE OTHER: the two
 * codebases share no file, so the field names are written twice on purpose
 * and each half is asserted where it lives.
 *
 * ===============================
 * * THE INCIDENT, 2026-09-12
 * ===============================
 * `addon_percent` was in the repo's map and editable on screen, and
 * `toFields` had no branch for it. A PATCH carrying `addonPercent` saved
 * every other field and DISCARDED the rate. The request succeeded, so the
 * toast said it had worked; the optimistic paint showed the new figure; the
 * refetch put the old one straight back.
 *
 * It cost nothing while rates only reached a block at the foot of an
 * export. It cost the MONEY the day the Monthly amount started being
 * computed from them.
 *
 * Source text, not a live request: the route needs express, a session and a
 * database to answer, and what goes wrong here is a missing branch.
 */
const ROUTE = fs.readFileSync(path.join(__dirname, '..', 'masterSheet.js'), 'utf8');
const REPO = fs.readFileSync(
  path.join(__dirname, '..', 'repos', 'masterSheetRows.repo.js'), 'utf8',
);

/** The camelCase fields `toFields` builds, whatever branch writes them. */
function parsedFields() {
  const from = ROUTE.indexOf('function toFields(');
  const to = ROUTE.indexOf('\n}', ROUTE.indexOf('return out;', from));
  assert.ok(from > 0 && to > from, 'toFields must be findable');
  const body = ROUTE.slice(from, to);
  const named = [...body.matchAll(/out\.(\w+)\s*=/g)].map((m) => m[1]);

  // ONLY the loop lists. Scanning every quoted word in the function also
  // collected `'cash'` (a default) and `'boolean'` (a typeof), and the test
  // then reported two fields that do not exist.
  const listed = [];
  for (const m of body.matchAll(/for \(const (?:key|\[key[^\]]*\]) of \[([\s\S]*?)\]\)/g)) {
    for (const f of m[1].matchAll(/'(\w+)'/g)) listed.push(f[1]);
  }
  return new Set([...named, ...listed]);
}

/** What the repo will write, from its own COLUMN_FOR. */
function writableFields() {
  const from = REPO.indexOf('const COLUMN_FOR = {');
  const to = REPO.indexOf('\n};', from);
  assert.ok(from > 0 && to > from, 'the repo COLUMN_FOR must be findable');
  return new Set([...REPO.slice(from, to).matchAll(/(\w+):\s*'/g)].map((m) => m[1]));
}

test('EVERY WRITABLE FIELD IS PARSED BY THE ROUTE', () => {
  // The half that bit. A column the repo can write and the route drops is a
  // cell that saves, reports success, and reverts on the next read.
  const parsed = parsedFields();
  const missing = [...writableFields()].filter((f) => !parsed.has(f));
  assert.deepEqual(
    missing, [],
    `the repo can write these and toFields never reads them, so a PATCH `
    + `carrying one is discarded silently: ${missing.join(', ')}`,
  );
});

test('AND EVERY PARSED FIELD REACHES A COLUMN', () => {
  // The mirror image, just as silent: the route validates it, builds it
  // into the patch, and the repo throws it away at the last step.
  const writable = writableFields();
  // Identity and control, resolved before the repo sees a field.
  const ROUTE_ONLY = new Set([
    'syncKey', 'source', 'personId', 'role', 'seat', 'allowDuplicate',
    'startUnknown', 'full',
  ]);
  const orphans = [...parsedFields()].filter((f) => !writable.has(f) && !ROUTE_ONLY.has(f));
  assert.deepEqual(orphans, [], `parsed but never written: ${orphans.join(', ')}`);
});

test('the two RATES in particular, because the money is computed from them', () => {
  const parsed = parsedFields();
  assert.ok(parsed.has('addonPercent'), 'addonPercent');
  assert.ok(parsed.has('feePercent'), 'feePercent');
});

test('and they are capped by the SHARED limit, not a second one', () => {
  // people.js validates the person's pair against MAX_PERCENT. A different
  // cap here would mean a rate the person route accepts the deal refuses.
  assert.match(ROUTE, /MAX_PERCENT/);
  assert.match(ROUTE, /require\('\.\/shared\/rates\.helper'\)/);
});

test('a cleared rate is ZERO, never null: the column is NOT NULL', () => {
  const from = ROUTE.indexOf("['addonPercent', 'Add on percentage']");
  assert.ok(from > 0, 'the rate branch must be findable');
  assert.match(ROUTE.slice(from, from + 600), /out\[key\] = 0;/);
});
