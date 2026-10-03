const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../repos/masterSheetRows.repo');
const peopleRepo = require('../../repos/people.repo');
const settingsRepo = require('../../repos/settings.repo');
const fxRates = require('../../shared/fxRates.helper');
const snapshotsRepo = require('../../repos/monthSnapshots.repo');
const { masterSheetTools } = require('./masterSheet');
const { currentMonth } = require('../../shared/presetMonth.helper');

// RELATIVE. A month far from the business month with no year in `said` is
// treated as a guess and dropped, so a hardcoded 2026-09 passes today and
// fails the moment test:drift runs the suite two years on.
const MONTH = currentMonth();
const YEAR = Number(MONTH.slice(0, 4));
// Three years back: far enough to be a guess whenever this runs.
const LONG_AGO = `${YEAR - 3}-09`;
const SAID_LONG_AGO = `what were they owed in september ${YEAR - 3}`;

// The month before this one, and its name, so "and last month?" is a real
// nearby month whenever the suite runs rather than a pinned August.
const prevMonth = () => {
  const [y, m] = MONTH.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
const monthWord = (iso) => new Date(`${iso}-01T00:00:00Z`)
  .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * ***************************************************
 * * "WHY DOES SHE KEEP SAYING DOLLARS"
 * ***************************************************
 *
 * Asked to add two people together she answered in GBP and AED, correctly,
 * and then tacked on "In dollars that is USD 2,887.03". Nobody asked for
 * dollars. The parameter said "use it when they ask", which is a prompt,
 * and she passed it anyway: two currencies in one answer is not a request
 * to merge them.
 *
 * It is not WRONG, which is what makes it worth stopping. An unasked third
 * figure in a money sentence is one more number to reconcile.
 *
 * AND THE RATE LINE NAMED ONE RATE for a figure that converted two
 * currencies: the AED went through the 3.6725 peg and that number appeared
 * nowhere. A converted figure whose rate has no provenance cannot be
 * checked next month, which is the only reason it is said out loud.
 */

const total = masterSheetTools.find((t) => t.name === 'total_master_sheet');

const deal = (id, person, currency, amount) => ({
  id,
  person_id: person.toLowerCase().replace(/\s+/g, '-'),
  person_name: person,
  company: 'Workforce',
  group_name: 'ALL GROUPS',
  currency,
  payable_amount: amount,
  payable_days: 30,
  preset_on: `${MONTH}-01`,
  payment_method: 'cash',
  addon_percent: 0,
  fee_percent: 0,
});

const ROWS = [deal(1, 'Gloria', 'GBP', 2000), deal(2, 'Gloria difference', 'AED', 150)];

const withRepos = (run) => {
  const saved = {
    searchFuzzy: repo.searchFuzzy,
    findAll: repo.findAll,
    rateMap: peopleRepo.rateMap,
    get: settingsRepo.get,
    usdPerGbp: fxRates.usdPerGbp,
    findMany: snapshotsRepo.findMany,
  };
  repo.searchFuzzy = async ({ q }) => {
    const want = String(q ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return ROWS.filter((r) => r.person_name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(want));
  };
  repo.findAll = async () => ({ rows: ROWS, total: ROWS.length });
  // The 5% both actually carry, so this reproduces the reported sentence
  // exactly rather than a simplified version of it.
  peopleRepo.rateMap = async () => new Map([
    ['gloria', { addon: 5, fee: 0 }],
    ['gloria-difference', { addon: 5, fee: 0 }],
  ]);
  settingsRepo.get = async () => ({ color_uses_end_date: false, crypto_percent: 0 });
  fxRates.usdPerGbp = async () => ({
    usdPerGbp: 1.354355, source: 'live', asOf: null, perUsd: { GBP: 0.7383, AED: 3.6725 },
  });
  snapshotsRepo.findMany = async () => [];
  return run().finally(() => {
    repo.searchFuzzy = saved.searchFuzzy;
    repo.findAll = saved.findAll;
    peopleRepo.rateMap = saved.rateMap;
    settingsRepo.get = saved.get;
    fxRates.usdPerGbp = saved.usdPerGbp;
    snapshotsRepo.findMany = saved.findMany;
  });
};

const ask = (said) => total.handler({
  people: ['Gloria', 'Gloria difference'], said, month: MONTH, convertTo: 'USD',
});

test('NOBODY SAID DOLLARS, so there are no dollars', async () => {
  await withRepos(async () => {
    const out = await ask('add gloria and gloria difference together');

    assert.doesNotMatch(out.reply, /USD|dollar/i, `it converted anyway: ${out.reply}`);
    assert.match(out.reply, /Gloria: GBP 2,000/);
    assert.match(out.reply, /Gloria Difference: AED 150/);
    assert.equal(out.converted, null);
  });
});

test('and she is TOLD it was dropped, so she cannot state one anyway', async () => {
  await withRepos(async () => {
    const out = await ask('add gloria and gloria difference together');
    assert.match(out.summary, /NO dollar figure here/);
  });
});

test('SAYING "in dollars" still converts', async () => {
  await withRepos(async () => {
    const out = await ask('add them up, in dollars');
    assert.match(out.reply, /Combined in USD: USD 2,887\.03/);
  });
});

test('so does "convert it to usd"', async () => {
  await withRepos(async () => {
    const out = await ask('combine them and convert it to usd');
    assert.match(out.reply, /USD 2,887\.03/);
  });
});

test('"together" ALONE IS NOT A REQUEST FOR ONE CURRENCY', async () => {
  // The likely misreading, and the one that caused this. A total is not a
  // conversion.
  for (const said of ['add those two together for me', 'combine gloria and gloria difference']) {
    // eslint-disable-next-line no-await-in-loop
    await withRepos(async () => {
      const out = await ask(said);
      assert.doesNotMatch(out.reply, /dollar|USD/i, `"${said}" converted`);
    });
  }
});

test('EVERY RATE USED remains available for a rate follow-up', async () => {
  // It said "at 1.354355 USD per GBP" for a figure that converted GBP AND
  // AED, so the peg the AED went through was invisible.
  await withRepos(async () => {
    const out = await ask('add them up in dollars');

    assert.match(out.converted.clause, /1\.354355 USD per GBP/);
    assert.match(out.converted.clause, /3\.6725 AED per USD/);
    assert.match(out.converted.clause, /fixed peg/);
  });
});

test('one currency retains only its own rate for a follow-up', async () => {
  const only = [deal(1, 'Gloria', 'GBP', 2000)];
  const saved = repo.searchFuzzy;
  repo.searchFuzzy = async () => only;
  try {
    await withRepos(async () => {
      repo.searchFuzzy = async () => only;
      const out = await total.handler({
        person: 'Gloria', said: 'what is gloria owed in dollars', month: MONTH, convertTo: 'USD',
      });
      assert.match(out.converted.clause, /at 1\.354355 USD per GBP \(/);
      assert.doesNotMatch(out.converted.clause, /AED per USD/);
    });
  } finally {
    repo.searchFuzzy = saved;
  }
});

/* ===============================
 * * The same guessed year, on a READ
 * =============================== */

test('A GUESSED YEAR IS REPAIRED, not answered as zero', async () => {
  // The write guard caught her WRITING 2024 from the word "September". The
  // same guess reaches a read, where it is quieter and worse: "owed nothing
  // for September 2024, marked for another month" is every word true, and
  // the admin asked what two people are owed and was told nothing.
  //
  // It used to be DROPPED, which answered the current month. They said
  // September, so the answer is the nearest September. See repairMonth.
  await withRepos(async () => {
    // The month name they said is THIS month's, so the repair has to land on
    // the month the fixture rows are marked for. Naming a fixed month here
    // would make the figures depend on what month the suite runs in, which
    // is what test:drift exists to catch.
    const word = monthWord(MONTH).split(' ')[0];
    const out = await total.handler({
      people: ['Gloria', 'Gloria difference'],
      month: LONG_AGO,
      said: `combine gloria and gloria difference total for ${word.toLowerCase()}`,
    });

    // The month they NAMED, in the year they meant, with the real figures.
    assert.ok(out.reply.includes(monthWord(MONTH)), `answered for the wrong month: ${out.reply}`);
    assert.ok(!out.reply.includes(`${word} ${YEAR - 3}`), 'it kept the year she invented');
    assert.deepEqual(out.total, { GBP: 2000, AED: 150 });
  });
});

test('and she is TOLD, so she reports the month she actually got', async () => {
  await withRepos(async () => {
    const out = await total.handler({
      people: ['Gloria', 'Gloria difference'],
      month: LONG_AGO,
      said: `total for ${monthWord(MONTH).split(' ')[0].toLowerCase()}`,
    });
    assert.match(out.summary, /never said that year/);
    // Whatever it repaired to, the note has to name it, or she reports the
    // year in her own arguments instead of the one that was used.
    assert.ok(out.summary.includes(monthWord(MONTH)), out.summary.slice(0, 200));
  });
});

test('and with NO month word there is nothing to repair to, so it drops', async () => {
  await withRepos(async () => {
    const out = await total.handler({
      people: ['Gloria', 'Gloria difference'],
      month: LONG_AGO,
      said: 'what are they owed',
    });
    assert.match(out.summary, /never said that year/);
    assert.ok(out.reply.includes(monthWord(MONTH)), `it did not fall back to this month: ${out.reply}`);
  });
});

test('SAYING the year keeps it, because then it is their filter', async () => {
  await withRepos(async () => {
    const out = await total.handler({
      people: ['Gloria', 'Gloria difference'],
      month: LONG_AGO,
      said: SAID_LONG_AGO,
    });
    assert.match(out.reply, new RegExp(`September ${YEAR - 3}`));
  });
});

test('a NEARBY month is never second guessed', async () => {
  // Last month and next month are ordinary asks. Only a year away is a
  // guess, or the guard would fight every legitimate filter.
  await withRepos(async () => {
    const out = await total.handler({
      people: ['Gloria', 'Gloria difference'], month: prevMonth(), said: 'and last month?',
    });
    assert.ok(out.reply.includes(monthWord(prevMonth())), out.reply);
  });
});

test('THE MESSAGE IS BUILT WHERE THE VALUES ARE', () => {
  // It was a local in the handler and read from inside totalReply: a
  // ReferenceError, invisible until that branch was taken. The export route
  // lost every single build to exactly that shape.
  const src = require('node:fs').readFileSync(require.resolve('./masterSheet.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function totalReply'));
  assert.match(fn.slice(0, 900), /const droppedYear =/, 'droppedYear is not derived in totalReply');
});

test('A REPAIRED MONTH IS NOT A QUESTION', async () => {
  // She answered "owed nothing for August 2026" and then asked "did you
  // mean August 2026?". They named August; only the year was hers. There is
  // nothing left to ask, and asking it reads as doubt about the figure.
  await withRepos(async () => {
    const word = monthWord(MONTH).split(' ')[0].toLowerCase();
    const out = await total.handler({
      people: ['Gloria', 'Gloria difference'], month: LONG_AGO, said: `total for ${word}`,
    });
    assert.match(out.summary, /Do NOT ask which month or which year they meant/);
  });
});

test('but a month she invented WHOLE still asks', async () => {
  await withRepos(async () => {
    const out = await total.handler({
      people: ['Gloria', 'Gloria difference'], month: LONG_AGO, said: 'what are they owed',
    });
    assert.match(out.summary, /ask which one they meant/);
  });
});

/* ===============================
 * * The previous question's people
 * =============================== */

test('LAST TURN\'S PEOPLE ARE NOT THIS TURN\'S QUESTION', async () => {
  // Live: "nicola total for august", then "cool, add gloria and gloria
  // difference then convert it to usd". She called this with NICOLA, Gloria
  // and Gloria difference and answered for all three. Nicola was the
  // question before; the sentence in front of her named two people.
  await withRepos(async () => {
    const out = await total.handler({
      people: ['Nicola', 'Gloria', 'Gloria difference'],
      month: MONTH,
      convertTo: 'USD',
      said: 'cool, add gloria and gloria difference then convert it to usd',
    });

    assert.equal(out.reply.includes('Nicola'), false, 'it answered for the previous question too');
    assert.match(out.reply, /Gloria: GBP 2,000/);
    assert.match(out.reply, /Gloria Difference: AED 150/);
    assert.deepEqual(out.total, { GBP: 2000, AED: 150 });
    // Told, or she names the person she just left out.
    assert.match(out.summary, /LEFT OUT/);
    assert.match(out.summary, /Do NOT mention the ones left out/);
  });
});

test('IT ONLY FIRES WHEN THEY NAMED SOMEBODY', async () => {
  // "Add those two up" and "and in dollars?" name nobody, so the set has to
  // carry forward or a follow up loses the question entirely.
  for (const said of ['add those two up', 'and in dollars?', 'combine them']) {
    // eslint-disable-next-line no-await-in-loop
    await withRepos(async () => {
      const out = await total.handler({
        people: ['Gloria', 'Gloria difference'], month: MONTH, said,
      });
      assert.deepEqual(out.total, { GBP: 2000, AED: 150 }, `"${said}" dropped them`);
      assert.equal((out.summary.match(/LEFT OUT/) ?? []).length, 0, `"${said}" left somebody out`);
    });
  }
});

test('and a name they DID say survives a typo', async () => {
  // The same tolerance every other name lookup has. "gloria" spelt slightly
  // wrong must not read as last turn's leftover.
  await withRepos(async () => {
    const out = await total.handler({
      people: ['Gloria', 'Gloria difference'], month: MONTH,
      said: 'add glora and gloria difference',
    });
    assert.deepEqual(out.total, { GBP: 2000, AED: 150 });
  });
});

test('a past month without a snapshot never falls back to current live deals', async () => {
  // Live: "nicola total for august", then "add gloria and gloria
  // difference". She kept AUGUST, the rows are marked for this month, and
  // the answer was "owed nothing". Every word true, and nobody asked about
  // August in that sentence.
  await withRepos(async () => {
    const out = await total.handler({
      people: ['Gloria', 'Gloria difference'],
      month: prevMonth(),
      said: 'add gloria and gloria difference',
    });

    assert.match(out.summary, /unavailable because no month snapshot was saved/);
    assert.doesNotMatch(out.summary, /GBP 2,000|AED 150/);
  });
});

test('but a month they DID name is their filter, and carries no such note', async () => {
  await withRepos(async () => {
    const word = monthWord(prevMonth()).split(' ')[0].toLowerCase();
    const out = await total.handler({
      people: ['Gloria', 'Gloria difference'],
      month: prevMonth(),
      said: `what were gloria and gloria difference owed in ${word}`,
    });
    assert.doesNotMatch(out.summary, /THIS IS ZERO ONLY BECAUSE OF THE MONTH/);
  });
});

test('and a REAL total carries no such note either', async () => {
  await withRepos(async () => {
    const out = await total.handler({
      people: ['Gloria', 'Gloria difference'], month: MONTH, said: 'add gloria and gloria difference',
    });
    assert.doesNotMatch(out.summary, /THIS IS ZERO ONLY BECAUSE OF THE MONTH/);
    assert.deepEqual(out.total, { GBP: 2000, AED: 150 });
  });
});

/* ===============================
 * * The refusal must not have an exit
 * =============================== */

test('A LIST OF ONE IS STILL A SINGLE CALL, and still refused', async () => {
  // Refused on the single path for naming two people, she called the LIST
  // path with one name at a time. A list of one takes `said` (that is what
  // saidFor is for) and `said` named two people, so the longest won BOTH
  // times: "Gloria is owed AED 150. Difference is also owed AED 150."
  // Neither figure was Gloria's GBP 2,000.
  for (const one of [['Gloria'], ['Gloria difference']]) {
    // eslint-disable-next-line no-await-in-loop
    await withRepos(async () => {
      const out = await total.handler({
        people: one, month: MONTH, said: 'show me total of gloria and gloria difference',
      });
      assert.equal(out.reply, undefined, `${one[0]} answered for one of two people`);
      assert.match(out.summary, /NOTHING has been totalled/);
      assert.match(out.summary, /a list of one still reads the sentence/);
    });
  }
});

test('THE SINGLE PATH CHECKS THE WHOLE SHEET, not the rows one name found', async () => {
  // `rows` is the fuzzy match for the ONE name she passed, so a second
  // person in the sentence was invisible: refused for "Gloria" she called
  // again with "Gloria difference", whose search returns only hers.
  await withRepos(async () => {
    const out = await total.handler({
      person: 'Gloria difference', month: MONTH, said: 'show me total of gloria and gloria difference',
    });
    assert.equal(out.reply, undefined, 'it answered for one of two people');
    assert.match(out.summary, /2 different people/);
  });
});

test('and ONE person named is answered, on both doors', async () => {
  await withRepos(async () => {
    const a = await total.handler({ person: 'Gloria', month: MONTH, said: 'what is gloria owed' });
    assert.deepEqual(a.total, { GBP: 2000 });

    const b = await total.handler({ people: ['Gloria'], month: MONTH, said: 'what is gloria owed' });
    assert.deepEqual(b.total, { GBP: 2000 });
  });
});

test('a vague sentence names nobody, so a list of one is fine', async () => {
  // "And in dollars?" or "add those two up" must not be refused.
  await withRepos(async () => {
    const out = await total.handler({ people: ['Gloria'], month: MONTH, said: 'and that one?' });
    assert.deepEqual(out.total, { GBP: 2000 });
  });
});
