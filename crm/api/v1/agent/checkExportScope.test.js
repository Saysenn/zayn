const test = require('node:test');
const assert = require('node:assert/strict');
const { checkExportScope } = require('./checkExportScope');

const GROUPS = ['ALL GROUPS', 'INDIGO', 'MANBAT', 'MILKMAN', 'NEXUS'];
const session = (groups = []) => ({ draft: { template: 'bank', groups, month: '2026-09' } });

// The live fault, 2026-09-06: an all-groups bank file of 21 rows, handed
// over as NEXUS's. NEXUS has 2.
test('an all groups file described as one group is caught', () => {
  const out = checkExportScope(
    'The bank sheet for Nexus, September 2026, with 21 deals and 18 people is built and downloading now.',
    session([]),
    GROUPS,
  );
  assert.equal(out.ok, false);
  assert.deepEqual(out.named, ['NEXUS']);
});

test('the other scope words are caught too', () => {
  for (const said of [
    'Built just MILKMAN for you.',
    'This is only the INDIGO deals.',
    'The file is limited to MANBAT.',
  ]) {
    assert.equal(checkExportScope(said, session([]), GROUPS).ok, false, said);
  }
});

// An all groups file really does contain every group's rows, so naming one
// is only a fault when she says the file IS that group's.
test('mentioning a group an all groups file really contains is fine', () => {
  for (const said of [
    'That covers 96 deals, including NEXUS and MILKMAN.',
    'Every group is in there: INDIGO, MANBAT, MILKMAN, NEXUS.',
    '18 people across NEXUS and INDIGO are on it.',
  ]) {
    assert.equal(checkExportScope(said, session([]), GROUPS).ok, true, said);
  }
});

test('a correctly scoped file may be described by its own group', () => {
  const out = checkExportScope(
    'The bank sheet for Nexus is set with 2 deals and 2 people.',
    session(['NEXUS']),
    GROUPS,
  );
  assert.equal(out.ok, true);
});

// A scoped file does not contain the other groups AT ALL, so naming one is
// wrong however she phrases it. No preposition needed.
test('a scoped file named with any other group is caught, mention or not', () => {
  const scoped = session(['NEXUS']);

  assert.equal(checkExportScope('Built the NEXUS sheet, and MILKMAN is in there too.', scoped, GROUPS).ok, false);
  assert.equal(checkExportScope('This covers INDIGO.', scoped, GROUPS).ok, false);
  assert.deepEqual(checkExportScope('Includes MANBAT rows.', scoped, GROUPS).named, ['MANBAT']);
});

test('the literal ALL GROUPS group is not the every-group scope', () => {
  // "all group" is the real group of that name, per the naming rules.
  const out = checkExportScope('The bank sheet for all group is ready.', session([]), GROUPS);
  assert.equal(out.ok, false);
  assert.deepEqual(out.named, ['ALL GROUPS']);
});

test('nothing to judge is never a fault', () => {
  assert.equal(checkExportScope('', session([]), GROUPS).ok, true);
  assert.equal(checkExportScope('All done, darling!', session([]), GROUPS).ok, true);
  assert.equal(checkExportScope('The sheet for Nexus is ready.', null, GROUPS).ok, true);
  assert.equal(checkExportScope('The sheet for Nexus is ready.', session([]), []).ok, true);
});
