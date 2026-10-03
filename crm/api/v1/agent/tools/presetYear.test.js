const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../repos/masterSheetRows.repo');
const { masterSheetTools } = require('./masterSheet');
const { currentMonth } = require('../../shared/presetMonth.helper');

/**
 * ***************************************************
 * * A YEAR SHE WAS NEVER TOLD IS A YEAR SHE GUESSED
 * ***************************************************
 *
 * Asked to "update all the presets to September" she wrote `2024-09-01` on
 * all 96 rows. The right month, the wrong year by two.
 *
 * NOTHING ON SCREEN SAID SO, and this is what makes it the dangerous shape:
 * the filters answered correctly. "Preset: an old month" showed all 96;
 * "Preset: this month" showed none. Both were right. The sheet simply owed
 * NOTHING, for every row, forever, and the only clue was a year in a column.
 *
 * It has happened before: `todo.md` carried Anteep Sourcing sitting on
 * `2024-09-01` and computing as zero.
 *
 * A bare month has no year in it, so somebody must supply one, and she is
 * the one party who must not guess. The year has to be in what the ADMIN
 * said, and `said` is injected by runAgent rather than passed, so she
 * cannot satisfy the check by writing the year herself.
 */

const bulk = masterSheetTools.find((t) => t.name === 'bulk_update_master_sheet');
const update = masterSheetTools.find((t) => t.name === 'update_master_sheet_row');

const ROWS = [
  { id: 1, person_name: 'Erkki', company: 'Workforce', group_name: 'ALL GROUPS' },
  { id: 2, person_name: 'Jay', company: 'Workforce', group_name: 'ALL GROUPS' },
];

const withRepo = (run) => {
  const saved = { findAll: repo.findAll, update: repo.update, findById: repo.findById };
  const written = [];
  repo.findAll = async () => ({ rows: ROWS, total: ROWS.length });
  repo.findById = async (id) => ROWS.find((r) => r.id === Number(id)) ?? null;
  repo.update = async (id, patch) => { written.push({ id, patch }); return { id, ...patch }; };
  return run(written).finally(() => Object.assign(repo, saved));
};

// Relative to the business month, so this cannot rot into a fixture that
// only passes in 2026. `npm run test:drift` runs the suite months ahead.
const year = (n) => String(Number(currentMonth().slice(0, 4)) + n);
const THIS_YEAR = `${currentMonth()}-01`;
const TWO_YEARS_BACK = `${year(-2)}-09-01`;

test('THE ACTUAL INCIDENT: a bare month cannot become a past year', async () => {
  await withRepo(async (written) => {
    const out = await bulk.handler({
      set: { presetOn: TWO_YEARS_BACK },
      confirmed: true,
      said: 'update all the presets to september',
    });

    assert.equal(written.length, 0, 'it wrote a year nobody said');
    assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
    assert.match(out.summary, /owed\s+NOTHING/);
    // The year has to be named, or the sentence is unactionable.
    assert.match(out.summary, new RegExp(year(-2)));
  });
});

test('SAYING THE YEAR IS ENOUGH, because then it is their decision', async () => {
  await withRepo(async (written) => {
    const out = await bulk.handler({
      set: { presetOn: TWO_YEARS_BACK },
      confirmed: true,
      said: `set them all to september ${year(-2)} please`,
    });

    assert.equal(written.length, 2, 'a deliberate backdate was blocked');
    assert.match(out.summary, /Done\./);
  });
});

test('the ordinary case is untouched', async () => {
  for (const iso of [THIS_YEAR, `${year(0)}-12-01`]) {
    // eslint-disable-next-line no-await-in-loop
    await withRepo(async (written) => {
      await bulk.handler({ set: { presetOn: iso }, confirmed: true, said: 'roll them forward' });
      assert.equal(written.length, 2, `${iso} was refused and should not be`);
    });
  }
});

test('A FUTURE YEAR IS GUESSED TOO, and refused the same way', async () => {
  // The fault is the missing year, not the direction.
  await withRepo(async (written) => {
    const out = await bulk.handler({
      set: { presetOn: `${year(3)}-09-01` },
      confirmed: true,
      said: 'update all the presets to september',
    });
    assert.equal(written.length, 0);
    assert.match(out.summary, /AFTER/);
  });
});

test('ONE ROW IS GUARDED TOO, or the same fault just runs slower', async () => {
  // They named a month and no year, so the guessed year never reaches the
  // row: it is replaced with the nearest September (2026-09-29).
  await withRepo(async (written) => {
    await update.handler({
      id: 1,
      presetOn: TWO_YEARS_BACK,
      said: 'put erkki on september',
      confirmed: true,
    });
    for (const w of written) assert.notEqual(w.patch.presetOn, TWO_YEARS_BACK);
  });
});

test('SHE CANNOT TALK HER WAY PAST IT with her own arguments', async () => {
  // `said` is the admin's words, injected by runAgent. If the check read
  // anything the model controls it would be a prompt, not a guard.
  await withRepo(async (written) => {
    await bulk.handler({
      set: { presetOn: TWO_YEARS_BACK },
      confirmed: true,
      // No `said` at all: nothing to find the year in.
      note: `the admin definitely meant ${year(-2)}`,
    });
    assert.equal(written.length, 0);
  });
});

test('a preset that is not being set at all is not judged', async () => {
  await withRepo(async (written) => {
    await bulk.handler({ set: { payableDays: 31 }, confirmed: true, said: 'thirty one days' });
    assert.equal(written.length, 2);
  });
});
