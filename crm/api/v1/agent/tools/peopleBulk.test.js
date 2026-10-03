const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../repos/masterSheetRows.repo');
const peopleRepo = require('../../repos/people.repo');
const { masterSheetTools } = require('./masterSheet');

/**
 * ***************************************************
 * * "update Alex and Blake" as ONE act
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-24, both halves in one session.
 *
 *   "update alex and blake add on rates to 5%"
 *     -> "I can't update both at once by name here." She can.
 *
 *   Asked again, she proposed both, was told yes, and ONE was written.
 *   Her answer said both were done. The runtime had remembered two pending
 *   calls and applied the newest; see confirmReplay.js for that half.
 *
 * Both faults come from one shape: several people meant several calls.
 * `people` makes it one call, one confirmation, one set of writes.
 *
 * A DELTA IS THE TEST THAT MATTERS. `settleRates` resolves "add 3%" against
 * the person in front of it and writes the answer back into the fields it
 * was handed, so one shared object would put the first person's new total
 * on everybody after them.
 */

const update = masterSheetTools.find((t) => t.name === 'update_person');

const deal = (id, person, over = {}) => ({
  id,
  person_id: person.trim().toLowerCase().replace(/\s+/g, '-'),
  person_name: person,
  company: 'Workforce',
  group_name: 'ALPHA',
  currency: 'GBP',
  payable_amount: 500,
  addon_percent: 0,
  fee_percent: 0,
  person_addon_percent: 0,
  person_fee_percent: 0,
  ...over,
});

const ROWS = [
  deal(1, 'Alex Example', { person_addon_percent: 5 }),
  deal(2, 'Blake Example'),
  deal(3, 'Blake Example', { id: 3, group_name: 'BETA' }),
  // Two different people wearing one name, which is the exit that must
  // survive a list: she asks WHICH, and writes nothing for anybody.
  deal(4, 'Casey Example', { person_id: 'casey-1' }),
  deal(5, 'Casey Example', { person_id: 'casey-2', company: 'Northstar Care' }),
];

const fold = (s) => String(s ?? '').toLowerCase();

/**
 * The real repos, patched for the length of one test.
 *
 * `searchFuzzy` FILTERS, because the tool asks it once per name and a stub
 * answering every question with every row cannot tell the two apart.
 */
const withRepo = (run) => {
  const saved = {
    searchFuzzy: repo.searchFuzzy,
    upsert: peopleRepo.upsert,
    findById: peopleRepo.findById,
  };
  const written = [];
  repo.searchFuzzy = async ({ q }) => ROWS.filter((r) => fold(r.person_name).includes(fold(q)));
  peopleRepo.upsert = async (args) => { written.push(args); return { display_name: args.personId }; };
  // Not held: the current rates come off the row, which is where the tool
  // falls back to. Stubbed so the test never reaches a database.
  peopleRepo.findById = async () => null;
  return run(written).finally(() => Object.assign(peopleRepo, {
    upsert: saved.upsert, findById: saved.findById,
  }, repo.searchFuzzy = saved.searchFuzzy));
};

test('TWO NAMES, ONE CONFIRMATION, and the first call writes nothing', async () => {
  await withRepo(async (written) => {
    const out = await update.handler({
      people: ['Alex Example', 'Blake Example'],
      addonPercent: 5,
      said: 'update alex and blake add on to 5%',
    });

    assert.equal(out.pending, true);
    assert.equal(written.length, 0, 'the unconfirmed call wrote');
    // BOTH NAMED IN THE PREVIEW. Alex is already on 5%, so his line says
    // so rather than going missing: a list of two previewing one reads as
    // a change to one person and nobody can see who was left out.
    const lines = (out.lines ?? []).join('\n');
    assert.match(lines, /Alex Example: already on those rates/);
    assert.match(lines, /Blake Example.*add on 0% to 5%/);
    // The count is the deals it TOUCHES, which is Blake's two.
    assert.match(out.summary, /2 deals/);
  });
});

test('the confirmed call writes EVERY one of them', async () => {
  await withRepo(async (written) => {
    const out = await update.handler({
      people: ['Alex Example', 'Blake Example'],
      addonPercent: 5,
      confirmed: true,
      said: 'yes',
    });

    // Alex is already on 5%, so he is reported and not written. Blake is.
    assert.deepEqual(written.map((w) => w.personId), ['blake-example']);
    assert.equal(written[0].addonPercent, 5);
    assert.match(out.summary, /Alex Example: already on those rates, unchanged/);
  });
});

test('NOBODY NEEDING A CHANGE WRITES NOTHING AND SAYS SO', async () => {
  await withRepo(async (written) => {
    const out = await update.handler({
      people: ['Alex Example'],
      addonPercent: 5,
      confirmed: true,
      said: 'set alex to 5%',
    });

    assert.equal(written.length, 0);
    assert.match(out.summary, /nothing to change/);
  });
});

test('A DELTA RESOLVES AGAINST EACH PERSON, never against the first', async () => {
  // Alex holds 5% and Blake holds none. "Add 3%" is 8 and 3, and a shared
  // fields object would write 8 to both.
  await withRepo(async (written) => {
    await update.handler({
      people: ['Alex Example', 'Blake Example'],
      addonPercentDelta: 3,
      confirmed: true,
      said: 'add another 3% to alex and blake',
    });

    assert.equal(written.length, 2);
    assert.equal(written[0].addonPercent, 8, "Alex's own 5% was not read");
    assert.equal(written[1].addonPercent, 3, "Blake got Alex's total");
  });
});

test('ONE AMBIGUOUS NAME STOPS THE WHOLE ACT', async () => {
  await withRepo(async (written) => {
    const out = await update.handler({
      people: ['Alex Example', 'Casey Example'],
      addonPercent: 5,
      confirmed: true,
      said: 'set alex and casey to 5%',
    });

    assert.equal(out.ambiguous, true);
    assert.equal(written.length, 0, 'the unambiguous half was written anyway');
    assert.match(out.summary, /NOTHING HAS BEEN CHANGED, for any of them/);
  });
});

test('ONE UNKNOWN NAME STOPS THE WHOLE ACT', async () => {
  await withRepo(async (written) => {
    const out = await update.handler({
      people: ['Alex Example', 'Nobody At All'],
      addonPercent: 5,
      confirmed: true,
      said: 'set alex and nobody to 5%',
    });

    assert.equal(written.length, 0, 'the name that resolved was written anyway');
    assert.match(out.summary, /Nobody on the sheet matches/);
    assert.match(out.summary, /NOTHING HAS BEEN CHANGED, for any of them/);
  });
});

test('the same name twice is one person, not two writes', async () => {
  // An increment applied twice is the reason this collapses rather than
  // trusting the caller.
  await withRepo(async (written) => {
    await update.handler({
      people: ['Alex Example', 'alex example'],
      addonPercentDelta: 3,
      confirmed: true,
      said: 'add 3% to alex',
    });

    assert.equal(written.length, 1);
    assert.equal(written[0].addonPercent, 8);
  });
});

test('both `person` and `people` is refused rather than guessed', async () => {
  await withRepo(async (written) => {
    const out = await update.handler({
      person: 'Alex Example',
      people: ['Blake Example'],
      addonPercent: 5,
      confirmed: true,
      said: 'set them to 5%',
    });

    assert.equal(written.length, 0);
    assert.match(out.summary, /Send ONE of them/);
  });
});

test('A DISPLAY NAME CANNOT GO ON SEVERAL PEOPLE', async () => {
  // It would give three humans one name, which is not an edit anybody
  // means. The rates legitimately apply to everybody named.
  await withRepo(async (written) => {
    const out = await update.handler({
      people: ['Alex Example', 'Blake Example'],
      displayName: 'Alex',
      confirmed: true,
      said: 'rename them both',
    });

    assert.equal(written.length, 0);
    assert.match(out.summary, /belongs to ONE person/);
  });
});

test('ONE NAME STILL BEHAVES EXACTLY AS IT DID', async () => {
  await withRepo(async (written) => {
    const out = await update.handler({
      person: 'Alex Example', email: 'a@x.com', said: 'set alex email',
    });

    // An email needs no confirmation: it reaches no figure.
    assert.equal(out.pending, undefined);
    assert.equal(written.length, 1);
    assert.equal(written[0].personId, 'alex-example');
    assert.equal(written[0].email, 'a@x.com');
  });
});
