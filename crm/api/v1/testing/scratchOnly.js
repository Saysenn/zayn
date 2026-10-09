/**
 * ***************************************************
 * * A WRITE TEST MAY ONLY TOUCH THE SCRATCH GROUP
 * ***************************************************
 *
 * 2026-09-01: a test of Diane's bulk update set three REAL INDIGO rows
 * (Abe Lincoln, BYG, Byron) to preset 2023-09-01 with 0 days and 0 payable,
 * quietly taking £2,700 out of September. Nothing in the code stopped it.
 * It was found by a preset spread query hours later and put back from the
 * change log.
 *
 * "Only test on fake data" was a rule in a document. This is the same rule
 * with teeth: armed, every write goes through a group check first and a row
 * outside `SCRATCH` THROWS rather than being written.
 *
 * IT GUARDS THE WRITE, NOT THE FILTER. The incident was a filter that
 * matched more than anybody meant, so checking the filter would have missed
 * it. By the time a row reaches update() its group is a fact, not an
 * intention.
 *
 * Arm it FIRST, before requiring anything that holds its own reference to
 * the repo:
 *
 *   require('./v1/testing/scratchOnly').arm();
 */
const repo = require('../repos/masterSheetRows.repo');
// The review writes `stopped_on` from its own transaction, so it is a write
// to tb_mastersheet that does not go through the repo above. A guard that
// only wrapped that repo would wave "mark them all no" straight through.
const reviewRepo = require('../repos/monthlyReview.repo');
// A profile rate reaches EVERY deal the person holds, and tb_people was
// outside this guard entirely. See personIsScratch.
const peopleRepo = require('../repos/people.repo');
const companiesRepo = require('../repos/companies.repo');

// The one group a test may write to. Named here and nowhere else.
const SCRATCH = 'ZZTEST';

// CAPTURED IN arm(), never at import. Taken at module load it grabs
// whatever the repo held before a test had stubbed anything, so the guard
// would wave the write straight past the stub and into the real database.
//
// EVERY WRITE, NOT EVERY DESTRUCTIVE ONE. Stopping a deal takes its money
// out of the month exactly as a preset change does, and a company closure
// stops every deal on it at once, which is the widest write in the CRM.
const WRITES = [
  'create', 'update', 'updateMany', 'remove', 'removeMany',
  'stop', 'stopIfLive', 'stopMany', 'stopCompany', 'resume', 'resumeCompany',
  'setReviewMonthlyForCompany', 'setGoingConcernForCompany', 'setDealStatus',
  'clearOrphanFlags', 'clearPaydayFlag', 'keepPaydayFlag',
];

const REVIEW_WRITES = ['answerOne'];

// The person's own profile: their name, notes and BOTH RATES, and the undo
// that puts a rate back onto it.
const PEOPLE_WRITES = ['upsert', 'revertProfileRate'];

// A COMPANY'S OWN DETAILS: tier, notes, status, its name. Unguarded until 2026-09-28,
// so a company test stayed on ZZ companies only because the prompt named one.
const COMPANY_WRITES = ['update', 'rename', 'setTiers', 'revertCompanyField'];
let real = null;
let armed = false;

let realReview = null;
let realPeople = null;
let realCompanies = null;

const refuse = (what, where) => {
  throw new Error(
    `SCRATCH ONLY: refused to ${what} a row in ${where || 'an unknown group'}. `
    + `A write test may only touch ${SCRATCH}.`,
  );
};

async function groupOf(id) {
  const row = await repo.findById(id);
  // A missing row is not a pass. It means the check could not be made, and
  // an unchecked write is the thing this exists to prevent.
  if (!row) refuse('write', `a row (#${id}) that could not be read`);
  return row.group_name;
}

/**
 * ===============================
 * * A PERSON IS NOT A ROW, AND THEIR RATE IS MONEY
 * ===============================
 * `tb_people` was outside this entirely. `update_person` writes an add on
 * that reaches EVERY deal the person holds, and a rate test on the live
 * sheet would have moved a real month's figure: exactly the 2026-09-24
 * incident, but caused by testing rather than found by it.
 *
 * A PERSON IS SCRATCH WHEN EVERY DEAL THEY HOLD IS. Somebody with one
 * ZZTEST row and four real ones is a real person, and their profile rate
 * reaches the real four.
 */
async function personIsScratch(personId) {
  const id = String(personId ?? '').trim();
  if (!id) refuse('write', 'a person with no id');
  const { rows } = await repo.findAll({ page: 1, pageSize: 500 });
  const theirs = rows.filter((r) => String(r.person_id ?? '').trim() === id);
  // NO ROWS IS NOT A PASS, same rule as a missing row above.
  if (theirs.length === 0) refuse('write', `a person (${id}) holding no readable deals`);
  const groups = [...new Set(theirs.map((r) => r.group_name))];
  if (groups.some((g) => g !== SCRATCH)) refuse(`write the profile of ${id}`, groups.join(', '));
}

/**
 * Every write, wrapped. Idempotent, so arming twice does not double wrap.
 */
function arm() {
  if (armed) return SCRATCH;
  armed = true;
  real = Object.fromEntries(WRITES.map((k) => [k, repo[k]]));
  realReview = Object.fromEntries(REVIEW_WRITES.map((k) => [k, reviewRepo[k]]));
  realPeople = Object.fromEntries(PEOPLE_WRITES.map((k) => [k, peopleRepo[k]]));
  realCompanies = Object.fromEntries(COMPANY_WRITES.map((k) => [k, companiesRepo[k]]));

  companiesRepo.update = async (key, ...rest) => {
    await companyIsScratch('change the company', key);
    return realCompanies.update(key, ...rest);
  };
  companiesRepo.rename = async (key, ...rest) => {
    await companyIsScratch('rename the company', key);
    return realCompanies.rename(key, ...rest);
  };
  companiesRepo.setTiers = async (pairs, ...rest) => {
    for (const pair of pairs ?? []) {
      // eslint-disable-next-line no-await-in-loop
      await companyIsScratch('set the tier of', pair?.company);
    }
    return realCompanies.setTiers(pairs, ...rest);
  };
  // Keyed by the logged ROW, so the company is read off it first.
  companiesRepo.revertCompanyField = async (change, ...rest) => {
    const row = await repo.findById(change?.row_id);
    if (!row) refuse('put a company detail back on', `a row (#${change?.row_id}) that could not be read`);
    await companyIsScratch('put a company detail back on', row.company);
    return realCompanies.revertCompanyField(change, ...rest);
  };

  repo.create = async (fields, ...rest) => {
    if (fields?.groupName !== SCRATCH) refuse('create', fields?.groupName);
    return real.create(fields, ...rest);
  };

  repo.update = async (id, fields, ...rest) => {
    const group = await groupOf(id);
    if (group !== SCRATCH) refuse(`update #${id}`, group);
    return real.update(id, fields, ...rest);
  };

  // ===============================
  // * THE ONE THAT WAS MISSED, FOUND 2026-09-16
  // ===============================
  // `updateMany` is one statement across many rows and Diane reaches it
  // directly (agent/tools/masterSheet.js). It was never in this list, so
  // the guard written after a bulk update wrote to three real rows did not
  // cover the other bulk update. Every row is checked, and one outside the
  // scratch group refuses the whole batch: it commits as one transaction,
  // so a partial pass would be worse than a refusal.
  repo.updateMany = async (changes, ...rest) => {
    for (const { id } of changes ?? []) {
      // eslint-disable-next-line no-await-in-loop
      const group = await groupOf(id);
      if (group !== SCRATCH) refuse(`update #${id}`, group);
    }
    return real.updateMany(changes, ...rest);
  };

  repo.remove = async (id, ...rest) => {
    const group = await groupOf(id);
    if (group !== SCRATCH) refuse(`delete #${id}`, group);
    return real.remove(id, ...rest);
  };

  repo.removeMany = async (ids, ...rest) => {
    for (const id of ids ?? []) {
      // eslint-disable-next-line no-await-in-loop
      const group = await groupOf(id);
      if (group !== SCRATCH) refuse(`delete #${id}`, group);
    }
    return real.removeMany(ids, ...rest);
  };

  // ===============================
  // * ENDING A DEAL IS A WRITE, AND IT MOVES MONEY
  // ===============================
  // Same check, same reason: by the time a row reaches here its group is a
  // fact, not an intention. A stop takes a row's amount out of every month
  // from its date onward, which is the same harm the preset incident did.
  repo.stop = async (id, ...rest) => {
    const group = await groupOf(id);
    if (group !== SCRATCH) refuse(`stop #${id}`, group);
    return real.stop(id, ...rest);
  };

  // THE PARKED STOP, replayed at the start of a month with nobody watching.
  // The same write as `stop` through its own door, and that door was open.
  // 2026-10-04.
  repo.stopIfLive = async (id, ...rest) => {
    const group = await groupOf(id);
    if (group !== SCRATCH) refuse(`stop #${id}`, group);
    return real.stopIfLive(id, ...rest);
  };

  repo.resume = async (id, ...rest) => {
    const group = await groupOf(id);
    if (group !== SCRATCH) refuse(`resume #${id}`, group);
    return real.resume(id, ...rest);
  };

  repo.stopMany = async (ids, ...rest) => {
    for (const id of ids ?? []) {
      // eslint-disable-next-line no-await-in-loop
      const group = await groupOf(id);
      if (group !== SCRATCH) refuse(`stop #${id}`, group);
    }
    return real.stopMany(ids, ...rest);
  };

  // BY COMPANY, so there are no ids to check up front. The rows it would
  // reach are read first and every one of them has to be in the scratch
  // group: a company with one real deal on it refuses the whole call.
  repo.stopCompany = async (company, ...rest) => {
    await refuseOutsideCompany('stop every deal on', company);
    return real.stopCompany(company, ...rest);
  };

  repo.resumeCompany = async (company, ...rest) => {
    await refuseOutsideCompany('resume every deal on', company);
    return real.resumeCompany(company, ...rest);
  };

  // ===============================
  // * THE SECOND ONE THAT WAS MISSED, FOUND 2026-09-21
  // ===============================
  // It ticks and unticks `review_monthly` across a whole company BY NAME,
  // which is the "filter matched more than anybody meant" shape this file
  // exists for, and a ticked deal is a deal somebody is asked to stop
  // paying. It was never in WRITES because the completeness test matched
  // write names by PREFIX and this one begins with `set`.
  repo.setReviewMonthlyForCompany = async (company, ...rest) => {
    await refuseOutsideCompany('set the monthly review on every deal on', company);
    return real.setReviewMonthlyForCompany(company, ...rest);
  };

  // Its twin, and it is WORSE: it clears end dates, which cannot be undone
  // by unticking. The completeness test above caught it the moment it was
  // added, which is the whole point of that test existing.
  repo.setGoingConcernForCompany = async (company, ...rest) => {
    await refuseOutsideCompany('clear the end dates on every deal on', company);
    return real.setGoingConcernForCompany(company, ...rest);
  };

  // ONE DEAL'S STATUS, which can clear an end date exactly as the company
  // wide write can. By id, so it is the ordinary check.
  repo.setDealStatus = async (id, ...rest) => {
    const group = await groupOf(id);
    if (group !== SCRATCH) refuse(`set the deal status on #${id}`, group);
    return real.setDealStatus(id, ...rest);
  };

  // AND THE THIRD, found by the same widened test in the same minute. It
  // writes the orphan flags and the review reason on one row by id, so it
  // is the ordinary check.
  repo.clearOrphanFlags = async (id, ...rest) => {
    const group = await groupOf(id);
    if (group !== SCRATCH) refuse(`clear the orphan flags on #${id}`, group);
    return real.clearOrphanFlags(id, ...rest);
  };

  // THE PAYDAY FLAG, both ways (2026-10-08). One row by id: the ordinary check.
  for (const name of ['clearPaydayFlag', 'keepPaydayFlag']) {
    repo[name] = async (id, ...rest) => {
      const group = await groupOf(id);
      if (group !== SCRATCH) refuse(`change the payday flag on #${id}`, group);
      return real[name](id, ...rest);
    };
  }

  /**
   * The profile write, which reaches tb_people and therefore every deal
   * the person holds. A rate test on a real person moves a real month.
   */
  peopleRepo.upsert = async (fields, ...rest) => {
    await personIsScratch(fields?.personId);
    return realPeople.upsert(fields, ...rest);
  };

  // Keyed by the logged ROW, so the person is read off it first.
  peopleRepo.revertProfileRate = async (change, ...rest) => {
    const row = await repo.findById(change?.row_id);
    if (!row) refuse('put a profile rate back on', `a row (#${change?.row_id}) that could not be read`);
    await personIsScratch(row.person_id);
    return realPeople.revertProfileRate(change, ...rest);
  };

  // The review's own write, which reaches tb_mastersheet directly.
  reviewRepo.answerOne = async (dealId, ...rest) => {
    const group = await groupOf(dealId);
    if (group !== SCRATCH) refuse(`answer the review for #${dealId}`, group);
    return realReview.answerOne(dealId, ...rest);
  };

  return SCRATCH;
}

/** Every deal on a company, checked before a cascade touches any of them. */
/**
 * ===============================
 * * THE ARCHIVE COUNTS TOO, AND IT WAS NOT READ
 * ===============================
 * This asked for the LIVE rows only, and `resumeCompany` acts on STOPPED
 * ones: a real company whose deals were all stopped read back as an empty
 * list, which is no row outside the scratch group, which is a pass. The
 * guard waved through the one call whose whole target it could not see.
 *
 * Both halves now, so a company is in scope if ANY row on it is.
 */
/**
 * A COMPANY IS SCRATCH WHEN EVERY DEAL ON IT IS, and it has at least one: a company
 * with none cannot be shown to be fake, so it is refused like an unreadable row.
 */
async function companyIsScratch(what, company) {
  const rows = await refuseOutsideCompany(what, company);
  if (rows.length === 0) refuse(what, `a company (${company}) holding no readable deals`);
}

async function refuseOutsideCompany(what, company) {
  const [live, dead] = await Promise.all([
    repo.findAll({ company, pageSize: 500 }),
    repo.findAll({ company, stopped: true, pageSize: 500 }),
  ]);
  const rows = [...live.rows, ...dead.rows];
  const outside = rows.find((row) => row.group_name !== SCRATCH);
  if (outside) refuse(what, outside.group_name);
  // Same rule as a missing row above: a check that could not be made is
  // not a pass. A company with no live deals has nothing to cascade to,
  // which is safe, so only an unreadable list is refused.
  if (!Array.isArray(rows)) refuse(what, 'a company that could not be read');
  return rows;
}

/** Puts the real writes back. For a test that wants to prove the guard. */
function disarm() {
  if (real) Object.assign(repo, real);
  if (realReview) Object.assign(reviewRepo, realReview);
  if (realPeople) Object.assign(peopleRepo, realPeople);
  if (realCompanies) Object.assign(companiesRepo, realCompanies);
  real = null;
  realReview = null;
  realPeople = null;
  realCompanies = null;
  armed = false;
}

// WRITES is exported so its own test can read the real list rather than
// restating it. A second copy of "everything that is guarded" is a second
// thing to forget, which is the fault the list exists to catch.
module.exports = {
  arm, disarm, SCRATCH, WRITES, REVIEW_WRITES, COMPANY_WRITES,
};
