import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toastFor, PRESENT_TENSE } from './toastMessage.js';

/**
 * The first UI-side tests in this repo, and they exist for one reason: the
 * toast is how an admin knows a write landed, its failure mode is silence,
 * and until now nothing could check a single word of it.
 */

test('success reads subject then past-tense verb', () => {
  const t = toastFor({ describe: () => '6 deals', verb: 'deleted' });
  assert.equal(t.level, 'success');
  assert.equal(t.message, '6 deals deleted');
});

test('failure is derived from the same describe, in the present tense', () => {
  const t = toastFor({
    describe: () => '6 deals', verb: 'deleted', error: new Error('boom'),
  });
  assert.equal(t.level, 'error');
  assert.equal(t.message, "Couldn't delete 6 deals");
  assert.equal(t.detail, 'boom');
});

/**
 * The reason PRESENT_TENSE is a map and not a regex.
 *
 * Stripping a trailing "d" happens to work for updated/removed/saved/
 * cleared, which is exactly why somebody wrote it that way once — and then
 * "added" came out as "adde". One counter-example is enough to disqualify
 * the rule, so the map has to stay and this test names the counter-example.
 */
test('added is the case a derived rule gets wrong', () => {
  assert.equal(PRESENT_TENSE.added, 'add');
  assert.notEqual(PRESENT_TENSE.added, 'added'.replace(/d$/, ''));
});

test('every past tense maps to a non-empty present form', () => {
  for (const [past, present] of Object.entries(PRESENT_TENSE)) {
    assert.ok(present && present.length > 0, `${past} has no present form`);
    assert.ok(!present.endsWith('ed'), `${past} -> ${present} is still past tense`);
  }
});

test('an unmapped verb is used as-is rather than dropped', () => {
  const t = toastFor({ describe: () => 'the sheet', verb: 'rebuilt', error: new Error('x') });
  assert.equal(t.message, "Couldn't rebuilt the sheet");
});

test('singular and plural come from describe, not from here', () => {
  const describe = ({ n }) => `${n} ${n === 1 ? 'deal' : 'deals'}`;
  assert.equal(toastFor({ describe, verb: 'deleted', variables: { n: 1 } }).message, '1 deal deleted');
  assert.equal(toastFor({ describe, verb: 'deleted', variables: { n: 6 } }).message, '6 deals deleted');
});

test('verb may be a function of the variables', () => {
  const t = toastFor({
    describe: () => 'Drew', verb: ({ v }) => v, variables: { v: 'archived' },
  });
  assert.equal(t.message, 'Drew archived');
});

test('describe sees the server response on success', () => {
  const t = toastFor({
    describe: (vars, data) => `${data.count} rows`, verb: 'written', data: { count: 12 },
  });
  assert.equal(t.message, '12 rows written');
});

test('describe is NOT given the response on failure', () => {
  // A describe reaching into `data` would throw inside the error handler
  // and swallow the real error, so it is called with variables alone.
  const describe = (vars, data) => `${data.count} rows`;
  const t = toastFor({ describe: (v, d) => (d ? describe(v, d) : 'that upload'), verb: 'written', error: new Error('500') });
  assert.equal(t.message, "Couldn't written that upload");
});

test('no describe means a SILENT success', () => {
  assert.equal(toastFor({ verb: 'saved' }), null);
});

test('no describe still reports a FAILURE', () => {
  const t = toastFor({ verb: 'saved', error: new Error('nope') });
  assert.equal(t.level, 'error');
  assert.equal(t.message, "Couldn't save that");
});

test('the subject is lowercased on failure only', () => {
  const opts = { describe: () => 'Drew Smith', verb: 'deleted' };
  assert.equal(toastFor(opts).message, 'Drew Smith deleted');
  assert.equal(toastFor({ ...opts, error: new Error('x') }).message, "Couldn't delete drew smith");
});

test('verb defaults to saved', () => {
  assert.equal(toastFor({ describe: () => 'That row' }).message, 'That row saved');
});

test('detail is a second line built from the server response', () => {
  const t = toastFor({
    describe: () => 'Drew',
    verb: 'deleted',
    detail: (vars, data) => `${data.orphanedDeals} deals need a new handler`,
    data: { orphanedDeals: 3 },
  });
  assert.equal(t.message, 'Drew deleted');
  assert.equal(t.detail, '3 deals need a new handler');
});

test('detail may return undefined, so nothing is shown', () => {
  const t = toastFor({ describe: () => 'Drew', verb: 'deleted', detail: () => undefined, data: {} });
  assert.equal(t.detail, undefined);
});

test('no detail leaves the field undefined rather than empty', () => {
  assert.equal(toastFor({ describe: () => 'x' }).detail, undefined);
});

test('on failure detail is the error, never the detail function', () => {
  const t = toastFor({
    describe: () => 'Drew', verb: 'deleted',
    detail: () => 'should not appear',
    error: new Error('server exploded'),
  });
  assert.equal(t.detail, 'server exploded');
});

test('icon rides along on success and never on failure', () => {
  assert.equal(toastFor({ describe: () => 'x', icon: 'trash' }).icon, 'trash');
  assert.equal(toastFor({ describe: () => 'x', icon: 'trash', error: new Error('e') }).icon, undefined);
});
