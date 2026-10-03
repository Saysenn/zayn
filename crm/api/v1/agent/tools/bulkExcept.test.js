const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../repos/masterSheetRows.repo');
const { masterSheetTools } = require('./masterSheet');

/**
 * ***************************************************
 * * "all of them except him and her"
 * ***************************************************
 *
 * She went group by group when asked to change every group, and there was
 * no way to say "all of them apart from these two" at all. The loop was the
 * expensive half; the exception is the dangerous half.
 *
 * AN EXCLUSION CANNOT BE SEEN IN A COUNT. Approving "93 rows" tells you
 * nothing about which three were skipped, so both numbers and every held
 * back name go in the confirm. And a name that matches NOTHING refuses
 * outright: a misspelt exception is not a no-op, it is that row being
 * changed after all.
 */

const bulk = masterSheetTools.find((t) => t.name === 'bulk_update_master_sheet');

const ROWS = [
  { id: 1, person_name: 'Nathan Cole', company: 'Acme', group_name: 'NEXUS' },
  { id: 2, person_name: 'Gloria difference', company: 'Acme', group_name: 'NEXUS' },
  { id: 3, person_name: 'Byron Hale', company: 'Kite', group_name: 'MILKMAN' },
  { id: 4, person_name: 'Gloria Winter', company: 'Kite', group_name: 'MILKMAN' },
];

// Stubbed, because an unstubbed repo reaches for real Postgres and the test
// hangs instead of failing.
const withRepo = (rows, run) => {
  const findAll = repo.findAll;
  const update = repo.update;
  const written = [];
  repo.findAll = async () => ({ rows, total: rows.length });
  repo.update = async (id, patch) => { written.push({ id, patch }); return { id }; };
  return run(written).finally(() => { repo.findAll = findAll; repo.update = update; });
};

const call = (args) => withRepo(ROWS, async (written) => ({
  out: await bulk.handler({ set: { payableDays: 30 }, ...args }),
  written,
}));

test('NO except: every row, and no held back line', async () => {
  const { out } = await call({ confirmed: false });
  assert.match(out.summary, /on 4 rows/);
  assert.doesNotMatch(out.summary, /HELD BACK/);
});

test('the named rows are HELD BACK, and both numbers are said', async () => {
  const { out, written } = await call({ confirmed: true, except: ['Nathan Cole', 'Byron Hale'] });

  assert.deepEqual(written.map((w) => w.id), [2, 4], 'it wrote a row it was told to skip');
  assert.match(out.summary, /2 rows now have/);
  assert.match(out.summary, /2 left UNCHANGED/);
  assert.match(out.summary, /Nathan Cole/);
  assert.match(out.summary, /Byron Hale/);
});

test('the CONFIRM names them too, before anything is written', async () => {
  const { out, written } = await call({ confirmed: false, except: ['Nathan Cole'] });

  assert.equal(written.length, 0, 'an unconfirmed bulk edit wrote');
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED YET/);
  assert.match(out.summary, /HELD BACK, unchanged: 1 of 4 \(Nathan Cole\)/);
  assert.match(out.summary, /on 3 rows/);
});

test('A NAME THAT MISSES REFUSES THE WHOLE CHANGE', async () => {
  // The dangerous case. Silently ignoring it changes the row they were
  // trying to protect, and the count still reads as a success.
  const { out, written } = await call({ confirmed: true, except: ['Nathan Cole', 'Priya'] });

  assert.equal(written.length, 0, 'it ran the change with an exception it could not find');
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
  assert.match(out.summary, /Priya/);
});

test('AN AMBIGUOUS EXCEPTION REFUSES, and offers the names', async () => {
  const { out, written } = await call({ confirmed: true, except: ['Gloria'] });

  assert.equal(written.length, 0, 'it guessed which Gloria to protect');
  assert.match(out.summary, /Gloria difference/);
  assert.match(out.summary, /Gloria Winter/);
});

test('a typo in an exception still lands when it lands on ONE person', async () => {
  const { out, written } = await call({ confirmed: true, except: ['gloria - diference'] });

  assert.deepEqual(written.map((w) => w.id), [1, 3, 4], 'the typo missed');
  assert.match(out.summary, /Gloria difference/);
});

test('EVERYTHING EXCLUDED writes nothing and says why', async () => {
  const { out, written } = await call({
    confirmed: true,
    except: ['Nathan Cole', 'Gloria difference', 'Byron Hale', 'Gloria Winter'],
  });

  assert.equal(written.length, 0);
  assert.match(out.summary, /nothing left to change/i);
});

test('except never reaches the repo as a filter', async () => {
  const seen = [];
  const findAll = repo.findAll;
  const update = repo.update;
  repo.findAll = async (filter) => { seen.push(filter); return { rows: ROWS, total: ROWS.length }; };
  repo.update = async (id) => ({ id });
  try {
    await bulk.handler({ set: { payableDays: 30 }, confirmed: true, except: ['Nathan Cole'] });
  } finally {
    repo.findAll = findAll;
    repo.update = update;
  }
  assert.equal(seen[0].except, undefined, 'except was passed through as a query filter');
});

test('ASKED FOR EVERY GROUP, A SINGLE GROUP CALL IS REFUSED', async () => {
  // Live run: "update all the preset dates" became eight confirmations,
  // one group at a time. The cap is 500 and the sheet is 96.
  const { out, written } = await call({
    confirmed: true,
    group: 'NEXUS',
    said: 'update all preset dates for all groups except Byron Hale',
  });

  assert.equal(written.length, 0, 'it went group by group anyway');
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
  assert.match(out.summary, /NEXUS/);
  assert.match(out.summary, /no group at all/i);
});

test('ONE GROUP NAMED IS STILL ONE GROUP', async () => {
  // "all the deals in NEXUS" is not "all groups", and blocking it would
  // make the guard worse than the bug.
  const { out, written } = await call({
    confirmed: true,
    group: 'NEXUS',
    said: 'set all the deals in NEXUS to 30 payable days',
  });

  assert.equal(written.length, 4, 'a single group edit was blocked');
  assert.match(out.summary, /Done\./);
});
