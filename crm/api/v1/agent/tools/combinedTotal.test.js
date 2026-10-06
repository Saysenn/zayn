const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../repos/masterSheetRows.repo');
const peopleRepo = require('../../repos/people.repo');
const settingsRepo = require('../../repos/settings.repo');
const { masterSheetTools } = require('./masterSheet');
const { peopleIn } = require('./resolvePerson');
const { currentMonth } = require('../../shared/presetMonth.helper');

/**
 * ***************************************************
 * * "combine gloria and gloria difference"
 * ***************************************************
 *
 * She answered AED 150 and called it the total for both. Gloria's four
 * deals, GBP 2,000, were simply absent, inside a sentence that read as a
 * confident answer.
 *
 * TWO bugs, and fixing either alone still gives a wrong figure:
 *   1. The single person path takes the LONGEST name in the sentence.
 *      Right for one person, silently drops the other when there are two.
 *   2. `said` was applied to EVERY entry of the `people` list, so both
 *      names resolved to the same longest one and the pool held one person.
 *
 * A CURRENCY IS NEVER ADDED TO ANOTHER. GBP 2,000 and AED 150 is two
 * figures, not 2,150.
 */

const total = masterSheetTools.find((t) => t.name === 'total_master_sheet');

// ABOVE ITS FIRST USE. A const is not hoisted, and the fixture below reads
// it: declared later this threw before a single test ran.
const MONTH = currentMonth();

const deal = (id, person, group, currency, amount) => ({
  id,
  person_id: person.trim().toLowerCase().replace(/\s+/g, '-'),
  person_name: person,
  company: 'Workforce',
  group_name: group,
  currency,
  payable_amount: amount,
  payable_days: 30,
  preset_on: `${MONTH}-01`,
  payment_method: 'cash',
  addon_percent: 0,
  fee_percent: 0,
});

const ROWS = [
  deal(3, 'Gloria', 'INDIGO', 'GBP', 500),
  deal(39, 'Gloria', 'MILKMAN', 'GBP', 500),
  deal(74, 'Gloria', 'NEXUS', 'GBP', 500),
  deal(80, 'Gloria', 'MANBAT', 'GBP', 500),
  deal(93, 'Gloria difference', 'ALL GROUPS', 'AED', 150),
];

// THE MONTH IN WORDS IS THE CURRENT ONE. A hard "september" sent every
// call to `compare_months` (and the database) from 1 October. 2026-10-06.
const MONTH_WORD = new Date(`${MONTH}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }).toLowerCase();
const SAID = `combine gloria and gloria difference total for ${MONTH_WORD} and show me percentages they have.`;

// EXPLICIT, or these assert what month it is rather than the arithmetic.
// The fixtures are marked for September, so a run in any other month would
// count none of them and every figure below would be 0. `npm run test:drift`
// exists to catch exactly that.

const withRepos = (run) => {
  const saved = {
    searchFuzzy: repo.searchFuzzy,
    findAll: repo.findAll,
    rateMap: peopleRepo.rateMap,
    get: settingsRepo.get,
  };
  repo.searchFuzzy = async ({ q }) => {
    const want = String(q ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return ROWS.filter((r) => r.person_name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(want));
  };
  repo.findAll = async () => ({ rows: ROWS, total: ROWS.length });
  peopleRepo.rateMap = async () => new Map([
    ['gloria', { addon: 5, fee: 0 }],
    ['gloria-difference', { addon: 5, fee: 0 }],
  ]);
  settingsRepo.get = async () => ({ color_uses_end_date: false, crypto_percent: 0 });

  return run().finally(() => {
    repo.searchFuzzy = saved.searchFuzzy;
    repo.findAll = saved.findAll;
    peopleRepo.rateMap = saved.rateMap;
    settingsRepo.get = saved.get;
  });
};

test('THE SENTENCE NAMES BOTH, and the short name is not swallowed', () => {
  assert.deepEqual(peopleIn(ROWS, SAID), ['Gloria difference', 'Gloria']);
});

test('one mention of the long name only is ONE person', () => {
  assert.deepEqual(peopleIn(ROWS, 'show me gloria difference'), ['Gloria difference']);
  assert.deepEqual(peopleIn(ROWS, 'gloria - diference'), ['Gloria difference']);
  assert.deepEqual(peopleIn(ROWS, 'what is gloria owed'), ['Gloria']);
});

test('A SINGLE PERSON TOTAL REFUSES when they named two', async () => {
  await withRepos(async () => {
    const out = await total.handler({ person: 'Gloria', said: SAID, month: MONTH });

    assert.match(out.summary, /NOTHING has been totalled/);
    assert.match(out.summary, /people/);
    assert.match(out.summary, /Gloria difference/);
    // No figure may appear, or she will read one out of the refusal.
    assert.doesNotMatch(out.summary, /TOTAL OWED/);
  });
});

test('BOTH PEOPLE ARE IN THE POOL, which is the £2,000 that vanished', async () => {
  await withRepos(async () => {
    const out = await total.handler({ people: ['Gloria', 'Gloria difference'], said: SAID, month: MONTH });

    assert.deepEqual(out.total, { GBP: 2000, AED: 150 });
    assert.equal(out.rows.length, 5, 'a deal was dropped from the pool');
  });
});

test('CURRENCIES ARE NEVER ADDED TOGETHER', async () => {
  await withRepos(async () => {
    const out = await total.handler({ people: ['Gloria', 'Gloria difference'], said: SAID, month: MONTH });

    assert.match(out.reply, /Gloria: GBP 2,000/);
    assert.match(out.reply, /Gloria Difference: AED 150/);
    assert.doesNotMatch(out.reply, /2,150/);
    // 5% on each, in its own currency.
    assert.deepEqual(out.addon, { GBP: 100, AED: 7.5 });
  });
});

test('the finished answer is compact, deal-based, and ready to display', async () => {
  await withRepos(async () => {
    const out = await total.handler({ people: ['Gloria', 'Gloria difference'], said: SAID, month: MONTH });

    assert.equal(out.computedReply, true);
    // A PLURAL LINE KEEPS ITS TOTAL: each one IS that person's answer, not
    // an explanation of a headline above it.
    // Words, not + and -: a minus reads as a dash. 2026-09-28.
    assert.match(out.reply, /Gloria: GBP 2,000 plus 5% add on \(GBP 100\) = GBP 2,100/);
  assert.match(out.reply, /Gloria Difference: AED 150 plus 5% add on \(AED 7\.5\) = AED 157\.5/);
    assert.doesNotMatch(out.reply, /\brows?\b|to find|what (?:next|shall)/i);
  });
});

test('THE PERCENTAGES ARE THERE, one line per person', async () => {
  // "show me percentages they have" had no answer: the money an add on
  // came to was reported, never the rate behind it.
  await withRepos(async () => {
    const out = await total.handler({ people: ['Gloria', 'Gloria difference'], said: SAID, month: MONTH });

    assert.match(out.summary, /RATES/);
    assert.match(out.summary, /Gloria: 5% add on/);
    assert.match(out.summary, /Gloria difference: 5% add on/);
    // Four deals at one rate is one arrangement, not four.
    assert.equal((out.summary.match(/Gloria: 5% add on/g) ?? []).length, 1);
  });
});

test('one person alone is unaffected', async () => {
  await withRepos(async () => {
    const out = await total.handler({ person: 'Gloria', said: `what is gloria owed for ${MONTH_WORD}`, month: MONTH });
    assert.deepEqual(out.total, { GBP: 2000 });
  });
});

// ***************************************************
// * THE FINISHED SENTENCE MUST CARRY THE ARITHMETIC
// ***************************************************
//
// Live, 2026-09-06, the same person on the same day, two different answers:
//   capabilities-read  "Gloria is owed GBP 2,000 for September 2026."
//   multi-month        "Gloria: GBP 2,000 + 5% add on of GBP 100 = 2,100."
//
// `summary` told her to say "GBP 2,000 owed plus GBP 100 in add ons, so GBP
// 2,100 in total", and `reply`, which is the finished sentence she hands
// back, said only the raw total. Two halves of one tool result disagreeing
// about money, and whichever she followed was what the admin saw. An add on
// is real money; leaving it out understates the figure by the rate.
test('one person with an add on: the HEADLINE is the computed figure', async () => {
  const out = await withRepos(() => total.handler({
    people: ['Gloria'], month: MONTH, said: 'what is gloria owed this month',
  }));

  // THE NET, not the raw. The headline used to say 2,000 and then talk its
  // way up to 2,100 in the same sentence.
  assert.match(out.reply, /Gloria is owed GBP 2,100 for/, 'the net leads');
  assert.match(out.reply, /GBP 2,000 (?:at [^.]+ )?plus GBP 100 add on \(5%\)/, 'and one line says where it came from');
  assert.doesNotMatch(out.reply, /to find/, 'the old wording is gone for good');

  /**
   * ONE REPRESENTATION, NOT THREE. His words, 2026-09-14. The answer
   * carried the same money in the headline, again in the clause, and again
   * on the person's own line. For a single person that third line restates
   * the sentence directly above it.
   */
  assert.doesNotMatch(out.reply, /Gloria: GBP 2,000/, 'no per person line: the subject is already her');
  assert.doesNotMatch(out.reply, /= GBP 2,100/, 'and no restated total');

  // The summary and the reply must not disagree about the money.
  assert.match(out.summary, /GBP 2,100/);
});

test('a person carrying NO rate gets no arithmetic line saying so', async () => {
  // Twelve rows reading "plus 0%" is what stops a block being read at all.
  const saved = peopleRepo.rateMap;
  try {
    const out = await withRepos(() => {
      peopleRepo.rateMap = async () => new Map();
      return total.handler({ people: ['Gloria'], month: MONTH, said: 'what is gloria owed this month' });
    });
    assert.doesNotMatch(out.reply, /Gloria: GBP 2,000 \+/);
    assert.doesNotMatch(out.reply, /0%/);
  } finally {
    peopleRepo.rateMap = saved;
  }
});

test('no rate, no clause: an ordinary total is not padded with arithmetic', async () => {
  const saved = peopleRepo.rateMap;
  try {
    // INSIDE the harness: withRepos assigns rateMap itself, so an override
    // set before it is overwritten before the handler ever runs.
    const out = await withRepos(() => {
      peopleRepo.rateMap = async () => new Map();
      return total.handler({ people: ['Gloria'], month: MONTH, said: 'what is gloria owed this month' });
    });
    assert.match(out.reply, /GBP 2,000/);
    assert.doesNotMatch(out.reply, /add ons|in total/);
  } finally {
    peopleRepo.rateMap = saved;
  }
});
