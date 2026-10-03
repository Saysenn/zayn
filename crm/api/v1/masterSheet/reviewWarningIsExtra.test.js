const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWith } = require('../testing/stubRepos');

/**
 * ***************************************************
 * * A WARNING IS NEVER WHY A FILE CANNOT BE BUILT
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-16, found by 55 red tests. The review's export
 * warning reached the database for its list, so `previewExport` started
 * depending on the table migration 057 creates. On any database that had
 * not been migrated, EVERY export preview 500'd: a payout file blocked by
 * the thing whose whole job was to warn about it.
 *
 * Two rules came out of it, and both are pinned here.
 */

const SUBJECT = require.resolve('./exportQuery');
// THE QUEUE MOVED BEHIND A HELPER, because it prints money and had to
// start paying the rates. See shared/reviewQueue.helper.js: the export
// warning asks it, not the repo, so the stub follows the caller.
const REVIEW = require.resolve('../shared/reviewQueue.helper');
const ROWS = require.resolve('../repos/masterSheetRows.repo');
const SETTINGS = require.resolve('../repos/settings.repo');

const DUE = {
  id: 91, person_id: 'p', person_name: 'Paddy', group_name: 'NEXUS', company: 'A J Rayson',
  monthly_amount: 1200, payable_amount: 1200, currency: 'GBP', payment_method: 'bank',
  preset_on: '2026-08-01', end_on: '2020-01-01', stopped_on: null, for_this_month: true,
};

const LIVE = { ...DUE, id: 92, end_on: null };
const ALREADY_STOPPED = { ...DUE, id: 93, stopped_on: '2026-01-31' };

/** previewExport, with the review repo answering however the test says. */
function load(rows, review) {
  const asked = [];
  const mod = loadWith(SUBJECT, {
    [ROWS]: { findAllRows: async () => rows },
    // An OBJECT, never null: applyMonth reads color_uses_end_date off it.
    [SETTINGS]: { get: async () => ({}), all: async () => ({}) },
    [REVIEW]: {
      dueThisMonth: async (...args) => {
        asked.push(args);
        if (review instanceof Error) throw review;
        return review ?? [];
      },
    },
  });
  return { previewExport: mod.previewExport, asked };
}

test('A MISSING TABLE DOES NOT BLOCK THE EXPORT', async () => {
  const err = new Error('relation "tb_monthly_review" does not exist');
  err.code = '42P01';
  const { previewExport } = load([DUE], err);

  const out = await previewExport({});
  assert.equal(out.rows, 1, 'the file still has its rows');
  assert.ok(Array.isArray(out.warnings), 'and its warnings still came back');
  assert.equal(out.warnings.find((w) => w.kind === 'unanswered-review'), undefined);
});

test('ANY failure is swallowed, not just a missing table', async () => {
  const { previewExport } = load([DUE], new Error('connection terminated'));
  const out = await previewExport({});
  assert.equal(out.rows, 1);
});

test('WHEN IT WORKS, the warning is there', async () => {
  const { previewExport } = load([DUE], [{ id: 91 }]);
  const out = await previewExport({});
  const hit = out.warnings.find((w) => w.kind === 'unanswered-review');
  assert.ok(hit, 'the door that comes to find you');
  assert.equal(hit.count, 1);
});

test('IT DOES NOT ASK WHEN THE ANSWER CANNOT MATTER', async () => {
  // A deal can only be under review if its end date has PASSED and nothing
  // has stopped it, which is readable from the rows already in hand. Most
  // files contain none, and a round trip that cannot change anything is
  // waste on the one screen somebody is waiting at.
  const live = load([LIVE], [{ id: 92 }]);
  await live.previewExport({});
  assert.deepEqual(live.asked, [], 'an ongoing deal is never under review');

  const stopped = load([ALREADY_STOPPED], [{ id: 93 }]);
  await stopped.previewExport({});
  assert.deepEqual(stopped.asked, [], 'a stopped deal is not being asked about');
});

test('AND IT DOES ASK WHEN ONE COULD BE', async () => {
  const { previewExport, asked } = load([LIVE, DUE], [{ id: 91 }]);
  await previewExport({});
  assert.equal(asked.length, 1, 'one row past its end date is enough');
  assert.deepEqual(asked[0][1], { answered: false }, 'only the unanswered');
});

test('THE REVIEW MONTH IS THE CURRENT ONE, not the month being built', async () => {
  // The review writes a DATE, so the two never have to agree on a month
  // label. Tying this to the generated month would be a second definition
  // of "now" beside the one presetMonth.helper owns.
  const { previewExport, asked } = load([DUE], [{ id: 91 }]);
  await previewExport({ month: '2024-03' });
  assert.match(asked[0][0], /^\d{4}-\d{2}$/);
  assert.notEqual(asked[0][0], '2024-03');
});
