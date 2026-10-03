const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { loadWith } = require('../testing/stubRepos');

/**
 * ***************************************************
 * * A NEW SETTINGS COLUMN MUST NOT BE ABLE TO TAKE THE APP DOWN
 * ***************************************************
 *
 * THE NEAR MISS, 2026-09-21. `login_briefing` went into `get()`'s SELECT.
 * `get()` is read on nearly every request path: exports, totals, the review
 * queue, Diane. So a deploy that ran migration 059 and forgot 060 would
 * have 500'd all of it, over a switch for a greeting.
 *
 * Found by the test suite, which reached a real database and came back
 * `column "login_briefing" does not exist`.
 *
 * SO A COLUMN THE HOT PATH DOES NOT NEED IS READ ON ITS OWN, and an
 * undefined_column there means the migration has not run yet: the feature
 * takes its default and nothing else notices.
 */

const SUBJECT = require.resolve('./settings.repo');
const DB = require.resolve('../../configs/db');

function load(onQuery) {
  return loadWith(SUBJECT, { [DB]: { query: onQuery } });
}

test('get() DOES NOT SELECT THE BRIEFING COLUMN', () => {
  // The guard is on the SQL, not on a comment about it: this file explains
  // the rule in prose and a guard that reads prose guards nothing.
  const src = readFileSync(require.resolve('./settings.repo'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const get = /function get\(\) \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
  assert.ok(get.length > 0, 'get() must be findable');
  assert.doesNotMatch(get, /login_briefing/, 'a new column in the hot path');
});

test('A MISSING COLUMN MEANS THE MIGRATION HAS NOT RUN, and the default holds', async () => {
  const missing = Object.assign(new Error('column "login_briefing" does not exist'), {
    code: '42703',
  });
  const repo = load(async () => { throw missing; });
  assert.equal(await repo.loginBriefing(), true, 'ON is its default');
});

test('BUT A REAL DATABASE ERROR STILL THROWS', async () => {
  // Swallowing everything would turn a dead connection into a briefing
  // that quietly never appears, which is the harder bug to find.
  const down = Object.assign(new Error('connection terminated'), { code: '57P01' });
  const repo = load(async () => { throw down; });
  await assert.rejects(() => repo.loginBriefing(), /connection terminated/);
});

test('AND A STORED FALSE IS READ AS OFF', async () => {
  const repo = load(async () => ({ rows: [{ login_briefing: false }] }));
  assert.equal(await repo.loginBriefing(), false);
});

test('A ROW THAT DOES NOT EXIST YET IS ON', async () => {
  // tb_settings is always id=1, but a fresh install reads before it is
  // seeded and must not have the greeting silently disabled.
  const repo = load(async () => ({ rows: [] }));
  assert.equal(await repo.loginBriefing(), true);
});
