const test = require('node:test');
const assert = require('node:assert/strict');
const {
  monthsRequested, nearestMonths, foldRuns, snapshotParts, fromStoredTotals,
  deltaLines, dropRepeatedScope, directionAsked, alignToDirection, compareMonths,
  MAX_MONTHS,
} = require('./monthHistory');
const snapshotsRepo = require('../../repos/monthSnapshots.repo');
const rowsRepo = require('../../repos/masterSheetRows.repo');
const settingsRepo = require('../../repos/settings.repo');
const peopleRepo = require('../../repos/people.repo');
const fxRates = require('../../shared/fxRates.helper');
const { currentMonth } = require('../../shared/presetMonth.helper');

function move(month, amount) {
  const [year, part] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, part - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function withRepos(run, replacements) {
  const original = {
    findMany: snapshotsRepo.findMany,
    findAllRows: rowsRepo.findAllRows,
    get: settingsRepo.get,
    rateMap: peopleRepo.rateMap,
    filterOptions: peopleRepo.filterOptions,
    usdPerGbp: fxRates.usdPerGbp,
  };
  Object.assign(snapshotsRepo, { findMany: async () => [], ...replacements.snapshots });
  Object.assign(rowsRepo, { findAllRows: async () => [], ...replacements.rows });
  Object.assign(settingsRepo, { get: async () => ({}), ...replacements.settings });
  // `filterOptions` is stubbed by DEFAULT. The empty scope guard reads it,
  // and without this every test that returns no money went to the real
  // database and the suite stopped being offline.
  Object.assign(peopleRepo, {
    rateMap: async () => new Map(),
    filterOptions: async () => ({ groups: ['MILKMAN', 'NEXUS', 'INDIGO', 'MANBAT'], companies: ['Workforce'] }),
    ...replacements.people,
  });
  Object.assign(fxRates, {
    usdPerGbp: async () => ({ usdPerGbp: 1.3, perUsd: { GBP: 0.77 }, source: 'live' }),
    ...replacements.fx,
  });
  try {
    return await run();
  } finally {
    snapshotsRepo.findMany = original.findMany;
    rowsRepo.findAllRows = original.findAllRows;
    settingsRepo.get = original.get;
    peopleRepo.rateMap = original.rateMap;
    peopleRepo.filterOptions = original.filterOptions;
    fxRates.usdPerGbp = original.usdPerGbp;
  }
}

test('history count excludes the current month by default', () => {
  assert.deepEqual(monthsRequested({ count: 3, direction: 'history' }, '2026-09'), [
    '2026-06', '2026-07', '2026-08',
  ]);
});

test('forecast count excludes the current month by default', () => {
  assert.deepEqual(monthsRequested({ count: 3, direction: 'forecast' }, '2026-09'), [
    '2026-10', '2026-11', '2026-12',
  ]);
});

// ***************************************************
// * A GUESSED YEAR IS REPAIRED IN THE ARRAY TOO
// ***************************************************
//
// Live 2026-09-08: "and last august?" arrived as 2025-08 and was answered
// verbatim, then carried into the next four turns. `monthForRead` was
// applied to the single `month` argument and never to `months`.
test('a far off year in the months ARRAY is repaired to the one they named', () => {
  assert.deepEqual(monthsRequested({ months: ['2025-08'], said: 'and last august?' }, '2026-09'), ['2026-08']);
});

test('a year they actually said is left alone', () => {
  assert.deepEqual(
    monthsRequested({ months: ['2025-08'], said: 'how did we do in august 2025' }, '2026-09'),
    ['2025-08'],
  );
});

test('an in-range month passes through untouched', () => {
  assert.deepEqual(monthsRequested({ months: ['2026-08'], said: 'last august' }, '2026-09'), ['2026-08']);
});

test('an inclusive range has one bounded definition', () => {
  assert.deepEqual(monthsRequested({ fromMonth: '2026-07', toMonth: '2026-09' }, '2026-09'), [
    '2026-07', '2026-08', '2026-09',
  ]);
});

test('past year means twelve completed months', () => {
  const months = monthsRequested({ said: 'income for the past year' }, '2026-09');
  assert.equal(months.length, 12);
  assert.equal(months[0], '2025-09');
  assert.equal(months[11], '2026-08');
});

test('a group follow-up keeps the preceding month instead of resetting to current', () => {
  assert.deepEqual(monthsRequested({
    said: 'what about indigo and nexus?',
    saidRecent: 'what about indigo and nexus?\nwhat is the milkman total last month?',
  }, '2026-09'), ['2026-08']);
});

test('an unrelated question never inherits the preceding month', () => {
  assert.deepEqual(monthsRequested({
    said: 'show me nexus people',
    saidRecent: 'show me nexus people\nwhat is the milkman total last month?',
  }, '2026-09'), ['2026-06', '2026-07', '2026-08']);
});

test('saved deal parts can be scoped without recomputing old rules', () => {
  const snapshot = {
    totals: {
      deals: [
        { personName: 'Nicola', company: 'A', group: 'INDIGO', currency: 'GBP', amount: 700, addon: 35, crypto: 0, fee: 0, net: 735 },
        { personName: 'Gloria', company: 'B', group: 'INDIGO', currency: 'GBP', amount: 500, addon: 25, crypto: 0, fee: 0, net: 525 },
      ],
    },
  };
  assert.deepEqual(snapshotParts(snapshot, { person: 'Nicola' }), {
    amount: { GBP: 700 }, addon: { GBP: 35 }, crypto: { GBP: 0 },
    fee: { GBP: 0 }, net: { GBP: 735 }, deals: 1,
  });
});

test('old whole sheet snapshots derive net from their stored parts', () => {
  assert.deepEqual(fromStoredTotals({
    grand: { GBP: 1000 }, addon: { GBP: 50 }, crypto: { GBP: 10 }, fee: { GBP: 20 }, counted: 2,
  }).net, { GBP: 1040 });
});

test('the trend delta is computed from the saved net totals', () => {
  const lines = deltaLines([
    { month: '2026-07', parts: { net: { GBP: 1000 } } },
    { month: '2026-08', parts: { net: { GBP: 1250 } } },
  ]);
  assert.match(lines[0], /up GBP 250\.00 \(25%\)/);
});

// ***************************************************
// * A GAP IS NEVER BRIDGED
// ***************************************************
//
// The unusable months were filtered out FIRST and what was left was paired,
// so August, no September, October came back as one step. The month line
// above it said September was unavailable and the delta still read as a
// single month's move.
test('a month with no snapshot breaks the step, it does not join the two around it', () => {
  const lines = deltaLines([
    { month: '2026-08', parts: { net: { GBP: 1000 } } },
    { month: '2026-09', parts: null },
    { month: '2026-10', parts: { net: { GBP: 1250 } } },
  ]);

  assert.deepEqual(lines, []);
  assert.doesNotMatch(lines.join('\n'), /August 2026 to October 2026/);
});

// Adjacency in the LIST, not in the calendar: asked for January and June
// alone, those two are the step.
test('two months asked for on their own are one step, however far apart', () => {
  const lines = deltaLines([
    { month: '2026-01', parts: { net: { GBP: 1000 } } },
    { month: '2026-06', parts: { net: { GBP: 1100 } } },
  ]);

  assert.equal(lines.length, 1);
  assert.match(lines[0], /January 2026 to June 2026: up GBP 100\.00 \(10%\)/);
});

test('past figures come from the immutable snapshot without reading live deals', async () => {
  const month = move(currentMonth(), -1);
  let liveRead = false;
  const out = await withRepos(
    () => compareMonths.handler({ months: [month], person: 'Nicola' }),
    {
      snapshots: {
        findMany: async () => [{
          month,
          totals: {
            deals: [{
              personName: 'Nicola', company: 'Acqua', group: 'INDIGO', currency: 'GBP',
              amount: 700, addon: 35, crypto: 0, fee: 0, net: 735,
            }],
            fx: { usdPerGbp: 1.2, perUsd: { GBP: 0.83 } },
          },
        }],
      },
      rows: { findAllRows: async () => { liveRead = true; return []; } },
    },
  );
  assert.equal(liveRead, false);
  assert.match(out.reply, /GBP 735\.00, saved actual/);
});

test('future figures project current deals and apply stacked rate arithmetic', async () => {
  const month = move(currentMonth(), 1);
  const out = await withRepos(
    () => compareMonths.handler({ months: [month], person: 'Nicola' }),
    {
      rows: {
        findAllRows: async () => [{
          id: 1,
          person_id: 'nicola', person_name: 'Nicola', company: 'Acqua', group_name: 'INDIGO',
          currency: 'GBP', payment_method: 'cash', monthly_amount: 1000, payable_amount: 1,
          payable_days: 1, payment_start_on: '2020-01-01', preset_on: `${currentMonth()}-01`,
          end_on: null, addon_percent: 0, fee_percent: 0,
        }],
      },
      settings: { get: async () => ({ color_uses_end_date: false, crypto_percent: 0 }) },
      people: { rateMap: async () => new Map([['nicola', { addon: 5, fee: 0 }]]) },
    },
  );
  assert.match(out.reply, /GBP 1,050\.00, projected from current deals/);
});

// ***************************************************
// * ONLY A SAVED MONTH HAS A SAVED RATE
// ***************************************************
//
// Live transcript 2026-09-06. Every converted line ended "converted using
// that month's saved rate", projected ones included, so October 2026
// claimed a rate for a month that has not happened, in the same sentence
// that called itself "projected from current deals".
test('a saved month cites its own rate, a projected one cites today\'s', async () => {
  const past = move(currentMonth(), -1);
  const saved = await withRepos(
    () => compareMonths.handler({ months: [past], person: 'Nicola', convertTo: 'USD' }),
    {
      snapshots: {
        findMany: async () => [{
          month: past,
          totals: {
            deals: [{
              personName: 'Nicola', company: 'Acqua', group: 'INDIGO', currency: 'GBP',
              amount: 700, addon: 0, crypto: 0, fee: 0, net: 700,
            }],
            fx: { usdPerGbp: 1.2, perUsd: { GBP: 0.83 } },
          },
        }],
      },
    },
  );
  assert.match(saved.reply, /saved actual/);
  assert.match(saved.reply, /converted using that month's saved rate/);

  const ahead = move(currentMonth(), 1);
  const projected = await withRepos(
    () => compareMonths.handler({ months: [ahead], person: 'Nicola', convertTo: 'USD' }),
    {
      rows: {
        findAllRows: async () => [{
          id: 1,
          person_id: 'nicola', person_name: 'Nicola', company: 'Acqua', group_name: 'INDIGO',
          currency: 'GBP', payment_method: 'cash', monthly_amount: 1000, payable_amount: 1,
          payable_days: 1, payment_start_on: '2020-01-01', preset_on: `${currentMonth()}-01`,
        }],
      },
    },
  );
  assert.match(projected.reply, /projected from current deals/);
  assert.match(projected.reply, /converted using today's rate/);
  assert.doesNotMatch(projected.reply, /saved rate/);
});

// ***************************************************
// * EVERY LINE NAMES ITS CURRENCY, AND EVERY STEP IS COMPARED
// ***************************************************
//
// Live transcript 2026-09-06. Three currencies, and the zero branch left
// the currency out, so the admin read:
//
//   From November 2026 to December 2026: no change, 0%.
//   From November 2026 to December 2026: no change, 0%.
//   From November 2026 to December 2026: up GBP 1,733.33, 1.89%.
//
// Two lines identical to the eye and a third contradicting them.
//
// Every currency is still named, on ONE line per step. Three months and
// three currencies was nine lines, six of which said nothing happened.
test('a currency that did not move is still named, on the step it belongs to', () => {
  const lines = deltaLines([
    { month: '2026-11', parts: { net: { GBP: 91616.67, AED: 54342.5, EURO: 3510 } } },
    { month: '2026-12', parts: { net: { GBP: 93350, AED: 54342.5, EURO: 3510 } } },
  ]);

  assert.equal(lines.length, 1, 'one step, one line');
  assert.match(lines[0], /AED unchanged/, 'AED must be named');
  assert.match(lines[0], /EURO unchanged/, 'EURO must be named');
  assert.match(lines[0], /up GBP 1,733\.33/, 'GBP moved and says so');
  // A currency that did not move has no percentage to quote.
  assert.doesNotMatch(lines[0], /unchanged \(/);
  assert.doesNotMatch(lines[0], /0%/);
});

// It compared only the FIRST month against the LAST, so a twelve month
// range came back as one delta and every month between was invisible.
test('each consecutive month is compared, not just the ends', () => {
  const lines = deltaLines([
    { month: '2026-09', parts: { net: { GBP: 100 } } },
    { month: '2026-10', parts: { net: { GBP: 150 } } },
    { month: '2026-11', parts: { net: { GBP: 120 } } },
  ]);

  assert.equal(lines.length, 2);
  assert.match(lines[0], /September 2026 to October 2026: up GBP 50\.00 \(50%\)/);
  assert.match(lines[1], /October 2026 to November 2026: down GBP 30\.00 \(20%\)/);
});

// ***************************************************
// * A CAP YOU CANNOT SEE IS THE BUG
// ***************************************************
//
// `MAX_MONTHS` was applied with a silent `.slice()` inside monthsRequested,
// so a forty month ask came back as thirty six and said nothing.
test('every month asked for is gathered, and the answer says where it cut', async () => {
  const asked = monthsRequested({ fromMonth: '2026-01', toMonth: '2029-12' }, '2026-09');
  assert.equal(asked.length, 48, 'the ask is gathered whole, not pre-cut');

  const out = await withRepos(
    () => compareMonths.handler({ fromMonth: '2026-01', toMonth: '2029-12' }),
    { snapshots: { findMany: async () => [] } },
  );

  assert.match(
    out.summary,
    new RegExp(`Answering ${MAX_MONTHS} of the 48 months asked for, the ones nearest now`),
  );
  // And it leads, because it is a fact about the answer under it.
  assert.equal(out.summary.split('\n')[0].startsWith(`Answering ${MAX_MONTHS}`), true);
});

test('THE CAP IS THREE: the two months before this one, and this one', () => {
  // His call 2026-09-09. It was 36, which reached years past the twelve
  // months of snapshots that exist, so a long comparison was a row of empty
  // points and a cap message nobody had asked about. Same window as the
  // dashboard's default.
  assert.equal(MAX_MONTHS, 3);
});

// ***************************************************
// * A CAP KEEPS THE MONTHS NEAREST NOW
// ***************************************************
//
// Live transcript 2026-09-07. "Show me the last 40 months" is May 2023 to
// August 2026, and taking the FIRST 36 cut May, June, July and August 2026:
// the only four months with a snapshot in them. She answered with thirty six
// "unavailable" lines and no data at all.
test('the cap keeps the months nearest now, not the oldest', () => {
  const asked = monthsRequested({ count: 40, direction: 'history' }, '2026-09');
  assert.equal(asked.length, 40);
  assert.equal(asked[0], '2023-05');
  assert.equal(asked.at(-1), '2026-08');

  const kept = nearestMonths(asked, '2026-09');
  assert.equal(kept.length, MAX_MONTHS);
  assert.equal(kept.at(-1), '2026-08', 'the useful end is the recent one');
  // Still in month order, whatever order the distance sort left them in.
  assert.deepEqual(kept, [...kept].sort());
});

test('a range that straddles now keeps the middle', () => {
  const asked = [...Array(40)].map((_, i) => {
    const date = new Date(Date.UTC(2026, 8 - 20 + i, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  const kept = nearestMonths(asked, '2026-09');

  assert.equal(kept.length, MAX_MONTHS);
  assert.ok(kept.includes('2026-09'), 'the month it is nearest to survives');
});

// ***************************************************
// * A RUN OF EMPTY MONTHS IS ONE LINE
// ***************************************************
//
// Same transcript: thirty six identical "unavailable because no month
// snapshot was saved" sentences, with the real figures lost among them.
test('consecutive empty months fold into one entry', () => {
  const folded = foldRuns([
    { month: '2026-01', source: 'missing', parts: null },
    { month: '2026-02', source: 'missing', parts: null },
    { month: '2026-03', source: 'missing', parts: null },
    { month: '2026-04', source: 'saved', parts: { net: { GBP: 10 } } },
  ]);

  assert.equal(folded.length, 2);
  assert.equal(folded[0].run, 3);
  assert.equal(folded[0].month, '2026-01');
  assert.equal(folded[0].until, '2026-03');
  assert.equal(folded[1].month, '2026-04', 'a month with figures is never folded');
});

// Same transcript: a twelve month projection off an unchanged sheet was
// twelve identical figures with eleven "unchanged" steps under them.
test('months holding the same money from the same source fold into one', () => {
  const same = { net: { GBP: 93350, AED: 100 } };
  const folded = foldRuns([
    { month: '2026-12', source: 'projected', parts: { net: { GBP: 90000, AED: 100 } } },
    { month: '2027-01', source: 'projected', parts: same },
    { month: '2027-02', source: 'projected', parts: { net: { AED: 100, GBP: 93350 } } },
    { month: '2027-03', source: 'projected', parts: same },
  ]);

  assert.equal(folded.length, 2);
  assert.equal(folded[1].run, 3, 'key order must not stop two months folding');
  assert.equal(folded[1].month, '2027-01');
  assert.equal(folded[1].until, '2027-03');
  // And no steps are drawn inside it: they all said "unchanged".
  assert.equal(deltaLines(folded).length, 1);
});

// A live estimate and a projection can carry the same figure. Folding them
// would put a fact and a guess on one line.
test('a run never folds across two sources', () => {
  const same = { net: { GBP: 100 } };
  const folded = foldRuns([
    { month: '2026-09', source: 'live', parts: same },
    { month: '2026-10', source: 'projected', parts: same },
  ]);

  assert.equal(folded.length, 2);
});

// "August 2026 to December 2026: up GBP 16,129.05" is four months of
// movement written as one, and read as one month's.
test('a step says how many months it reaches across', () => {
  const lines = deltaLines([
    { month: '2026-08', parts: { net: { GBP: 1000 } } },
    { month: '2026-12', parts: { net: { GBP: 1250 } } },
  ]);

  assert.match(lines[0], /August 2026 to December 2026: up GBP 250\.00 \(25%\) over 4 months\./);
});

test('one month to the next says nothing about a span', () => {
  const lines = deltaLines([
    { month: '2026-08', parts: { net: { GBP: 1000 } } },
    { month: '2026-09', parts: { net: { GBP: 1250 } } },
  ]);

  assert.doesNotMatch(lines[0], /over \d+ months/);
});

// It left from the run's FIRST month, so a fold of a year reported the step
// out of it as if the year had not happened.
test('a step leaves from the last month of a folded run', () => {
  const same = { net: { GBP: 100 } };
  const folded = foldRuns([
    { month: '2026-01', source: 'projected', parts: same },
    { month: '2026-02', source: 'projected', parts: same },
    { month: '2026-03', source: 'projected', parts: same },
    { month: '2026-04', source: 'projected', parts: { net: { GBP: 200 } } },
  ]);

  assert.match(deltaLines(folded)[0], /^March 2026 to April 2026:/);
});

test('the currencies on a money line are sorted, like the ones on a step', async () => {
  const out = await withRepos(
    () => compareMonths.handler({ months: [move(currentMonth(), -1)] }),
    {
      snapshots: {
        findMany: async () => [{
          month: move(currentMonth(), -1),
          totals: { grand: { GBP: 10, AED: 20, EURO: 30 }, net: { GBP: 10, AED: 20, EURO: 30 }, counted: 3 },
        }],
      },
    },
  );

  assert.match(out.summary, /AED 20\.00 and EURO 30\.00 and GBP 10\.00/);
});

// ***************************************************
// * THE MONTHS ANSWERED MUST MATCH THE DIRECTION ASKED
// ***************************************************
//
// "how did indigo do over the past 6 months", asked after a forecast turn,
// answered March to August 2027. The model passed those months explicitly,
// so only checking the answer against the words catches it.
test('a direction is only read when the words say ONE of them', () => {
  assert.equal(directionAsked('how did indigo do over the past 6 months'), 'past');
  assert.equal(directionAsked('whats coming next month'), 'future');
  // Both, so nothing is done: this is a real question and clamping breaks it.
  assert.equal(directionAsked('show me the last 3 months and the next 3'), null);
  assert.equal(directionAsked('compare august to december'), null);
});

test('months on the wrong side of today are dropped and said', () => {
  const out = alignToDirection(['2027-03', '2027-04', '2026-08'], { said: 'the past 6 months' }, '2026-09');

  assert.deepEqual(out.months, ['2026-08']);
  assert.match(out.note, /asked about the past/);
  assert.match(out.note, /2 months after September 2026 are left out/);
});

// THIS MONTH IS NEITHER SIDE, or a past question loses its baseline.
test('the current month survives a question in either direction', () => {
  assert.deepEqual(
    alignToDirection(['2026-08', '2026-09'], { said: 'the past 3 months' }, '2026-09').months,
    ['2026-08', '2026-09'],
  );
  assert.deepEqual(
    alignToDirection(['2026-09', '2026-10'], { said: 'the next 3 months' }, '2026-09').months,
    ['2026-09', '2026-10'],
  );
});

// EVERY month on the wrong side means the arguments are unusable, not
// merely wide. Rebuilt from the words; returning nothing is a dead end.
test('when nothing survives, the period is rebuilt from the words', () => {
  const out = alignToDirection(
    ['2027-03', '2027-04', '2027-05'],
    { said: 'how did indigo do over the past 6 months', count: 6 },
    '2026-09',
  );

  assert.equal(out.months.length, 6);
  assert.equal(out.months.at(-1) <= '2026-09', true, 'all in the past');
  assert.equal(out.months[0], '2026-03');
  assert.match(out.note, /every month worked out was after September 2026/);
});

test('an ambiguous question is left exactly as it was', () => {
  const months = ['2026-08', '2026-10'];
  const out = alignToDirection(months, { said: 'compare august to october' }, '2026-09');
  assert.deepEqual(out.months, months);
  assert.equal(out.note, null);
});

// "did we gain or lose over the past 3 months" came back "For ALL GROUPS":
// a real group, silently narrowing a question about the whole sheet.
test('a group the sentence never named is dropped, not answered', async () => {
  const month = move(currentMonth(), -1);
  const out = await withRepos(
    () => compareMonths.handler({
      months: [month], group: 'ALL GROUPS', said: 'did we gain or lose over the past 3 months',
    }),
    { snapshots: { findMany: async () => [{ month, totals: { grand: { GBP: 10 }, net: { GBP: 10 }, counted: 1 } }] } },
  );

  assert.match(out.summary, /^For the whole sheet:/m);
  assert.doesNotMatch(out.summary, /ALL GROUPS/);
});

// A REGRESSION THE HARNESS CAUGHT. "which of those three earned most"
// names no group, so the guard above dropped it, and she answered with
// three copies of the whole sheet total. A follow-up carries the scope.
test('a follow-up keeps the group named in the line before it', async () => {
  const month = move(currentMonth(), -1);
  const out = await withRepos(
    () => compareMonths.handler({
      months: [month],
      group: 'INDIGO',
      said: 'which of those three earned most',
      saidRecent: 'which of those three earned most\nhow much did indigo do in august',
    }),
    {
      snapshots: {
        findMany: async () => [{
          month,
          totals: { deals: [{ group: 'INDIGO', company: 'Workforce', currency: 'GBP', amount: 10, net: 10 }] },
        }],
      },
    },
  );
  assert.match(out.summary, /^For INDIGO:/m);
});

test('a FRESH question still drops a group nobody named', async () => {
  const month = move(currentMonth(), -1);
  const out = await withRepos(
    () => compareMonths.handler({
      months: [month],
      group: 'ALL GROUPS',
      said: 'did we gain or lose over the past 3 months',
      saidRecent: 'did we gain or lose over the past 3 months\nhow much did indigo do',
    }),
    { snapshots: { findMany: async () => [{ month, totals: { grand: { GBP: 10 }, net: { GBP: 10 }, counted: 1 } }] } },
  );
  assert.match(out.summary, /^For the whole sheet:/m);
});

test('a group they DID name is kept', async () => {
  const month = move(currentMonth(), -1);
  const out = await withRepos(
    () => compareMonths.handler({ months: [month], group: 'INDIGO', said: 'how did indigo do last august' }),
    {
      snapshots: {
        findMany: async () => [{
          month,
          totals: { deals: [{ group: 'INDIGO', company: 'Workforce', currency: 'GBP', amount: 10, net: 10 }] },
        }],
      },
    },
  );
  assert.match(out.summary, /^For INDIGO:/m);
});

// ***************************************************
// * LIVE TRANSCRIPT 2026-09-07: THREE FALSE FIGURES
// ***************************************************

// "convert nexus last august total to usd" answered "For NEXUS, NEXUS:
// nothing, saved actual. USD 0 converted using that month's saved rate."
// The same month answered GBP 4,775 two turns earlier. The model had put
// the group name in the company argument as well, and matchesScope needs
// BOTH to match.
test('one name in the group and company arguments is not an intersection', () => {
  assert.deepEqual(
    dropRepeatedScope({ group: 'NEXUS', company: 'NEXUS', said: 'x' }),
    { group: 'NEXUS', said: 'x' },
  );
  assert.deepEqual(
    dropRepeatedScope({ group: 'MANBAT', companies: ['manbat', 'Workforce'] }),
    { group: 'MANBAT', companies: ['Workforce'] },
  );
  // A real second filter is left alone.
  assert.deepEqual(
    dropRepeatedScope({ group: 'NEXUS', company: 'Workforce' }),
    { group: 'NEXUS', company: 'Workforce' },
  );
  // Nothing to compare against without a group.
  assert.deepEqual(dropRepeatedScope({ company: 'NEXUS' }), { company: 'NEXUS' });
});

// It printed "For manbat, MANBAT" because a Set of raw strings sees two.
test('the scope names itself once, whatever the casing', async () => {
  const out = await withRepos(
    () => compareMonths.handler({ months: [move(currentMonth(), -1)], group: 'MANBAT', company: 'manbat' }),
    {
      snapshots: {
        findMany: async () => [{
          month: move(currentMonth(), -1),
          totals: { deals: [{ group: 'MANBAT', company: 'Workforce', currency: 'GBP', amount: 10, net: 10 }] },
        }],
      },
    },
  );
  assert.match(out.summary, /^For MANBAT:/m);
  assert.doesNotMatch(out.summary, /MANBAT, MANBAT|manbat, MANBAT/i);
});

// "USD 0 converted using that month's saved rate" for a month with no
// figures at all. An empty net went through the converter.
test('nothing does not convert to zero', async () => {
  const month = move(currentMonth(), -1);
  const out = await withRepos(
    () => compareMonths.handler({ months: [month], convertTo: 'USD' }),
    {
      snapshots: {
        findMany: async () => [{
          month,
          totals: { grand: {}, net: {}, counted: 0, fx: { usdPerGbp: 1.3, perUsd: { GBP: 0.77 } } },
        }],
      },
    },
  );
  assert.match(out.summary, /nothing, saved actual\./);
  assert.doesNotMatch(out.summary, /USD 0/);
  assert.doesNotMatch(out.summary, /converted using/);
});

// "milman payment last august" answered "nothing, saved actual"; "milkman"
// on the next line answered AED 3,675 and GBP 19,145.95.
// One slip ("Milman") now resolves to the group, as every deal read does. Two slips still ask.
test('a scope that matched nothing anywhere is checked before a zero is reported', async () => {
  const month = move(currentMonth(), -1);
  const out = await withRepos(
    () => compareMonths.handler({ months: [month], company: 'Mlman', said: 'mlman payment last august' }),
    {
      snapshots: {
        findMany: async () => [{ month, totals: { deals: [] } }],
      },
      people: { filterOptions: async () => ({ groups: ['MILKMAN', 'NEXUS'], companies: ['Workforce'] }) },
    },
  );

  assert.match(out.summary, /MILKMAN/, 'the near miss is offered');
  assert.doesNotMatch(out.summary, /nothing, saved actual/);
});

// "LAST MONTH", not "last august": the fixture is last month, and the words win
// over the argument, so "august" read a month with no snapshot from October on.
// A REGRESSION I WROTE. The guard read every scope slot, and a person is
// correctly neither a group nor a company, so a real person with a quiet
// month was told "there is no group called Gloria".
test('a person with no money in a month is never called a missing group', async () => {
  const month = move(currentMonth(), -1);
  const out = await withRepos(
    () => compareMonths.handler({ months: [month], person: 'Gloria', said: 'gloria last month' }),
    { snapshots: { findMany: async () => [{ month, totals: { deals: [] } }] } },
  );

  assert.match(out.summary, /nothing, saved actual/);
  assert.doesNotMatch(out.summary, /NO GROUP|NO COMPANY/);
});

// A REAL name with a quiet month must still be allowed to say nothing.
test('a real scope with no money still reports nothing', async () => {
  const month = move(currentMonth(), -1);
  const out = await withRepos(
    () => compareMonths.handler({ months: [month], group: 'NEXUS', said: 'nexus last month' }),
    {
      snapshots: { findMany: async () => [{ month, totals: { deals: [] } }] },
      people: { filterOptions: async () => ({ groups: ['MILKMAN', 'NEXUS'], companies: ['Workforce'] }) },
    },
  );
  assert.match(out.summary, /nothing, saved actual/);
});

// ***************************************************
// * A COMBINED FIGURE, ONLY WHEN THE QUESTION IS ABOUT ONE
// ***************************************************
//
// "did we earn past months?" got three months and two steps and never
// answered what was asked.
test('an earnings question gets a span total that says what it counted', async () => {
  const [older, newer] = [move(currentMonth(), -2), move(currentMonth(), -1)];
  const out = await withRepos(
    () => compareMonths.handler({ count: 3, direction: 'history', said: 'did we earn past months?' }),
    {
      snapshots: {
        findMany: async () => [
          { month: older, totals: { grand: { GBP: 1000 }, net: { GBP: 1000 }, counted: 1 } },
          { month: newer, totals: { grand: { GBP: 1500 }, net: { GBP: 1500 }, counted: 1 } },
        ],
      },
    },
  );

  assert.match(out.summary, /Over the 3 months asked for: GBP 2,500\.00 owed/);
  assert.match(out.summary, /1 of the 3 asked for have none and are not in this total/);
  // OWED, never earned: the sheet holds payable.
  assert.doesNotMatch(out.summary, /earned/i);
  assert.match(out.summary, /Across the whole span, .*up GBP 500\.00/);
});

test('a plain month question gets no combined figure', async () => {
  const out = await withRepos(
    () => compareMonths.handler({ count: 3, direction: 'history', said: 'show me the last 3 months' }),
    { snapshots: { findMany: async () => [] } },
  );
  assert.doesNotMatch(out.summary, /Over the 3 months asked for/);
});

test('a single empty month is not a run, and two reasons never fold together', () => {
  const folded = foldRuns([
    { month: '2026-01', source: 'missing', parts: null },
    { month: '2026-02', source: 'saved', parts: null },
    { month: '2026-03', source: 'saved', parts: { net: { GBP: 10 } } },
  ]);

  assert.equal(folded.length, 3, 'no snapshot and no breakdown read differently');
  assert.equal(folded[0].run, 0, 'one month is said the way it always was');
});

test('an ask inside the cap says nothing about cutting', async () => {
  const out = await withRepos(
    () => compareMonths.handler({ fromMonth: '2026-07', toMonth: '2026-09' }),
    { snapshots: { findMany: async () => [] } },
  );
  assert.doesNotMatch(out.summary, /Answering the first/);
});


// 2026-09-28: "and the month after" asked for two months ahead, every month fell
// outside her window, and the reply crashed reading the first of none.
test('A MONTH PAST HER WINDOW IS SAID, never a crash', async () => {
  const far = move(currentMonth(), 2);
  const out = await withRepos(() => compareMonths.handler({ months: [far], said: 'and the month after' }), {});
  assert.match(out.reply, /is further ahead than I can see\. I can answer from /);
});

// 2026-09-28: "milman total last august" arrived as company "milman" and answered "For milman".
test('A GROUP SENT AS A COMPANY IS READ AS THE GROUP', async () => {
  const out = await withRepos(
    () => compareMonths.handler({ company: 'milman', month: currentMonth(), said: 'milman total this month' }),
    {},
  );
  assert.match(out.reply, /^For MILKMAN:/m);
});

// 2026-09-28: two empty months printed "September 2026 to October 2026: .".
test('TWO MONTHS WITH NOTHING IN THEM ARE NO STEP', () => {
  const now = currentMonth();
  const empty = (month) => ({ month, source: 'projected', parts: { net: {} } });
  assert.deepEqual(deltaLines([empty(now), empty(move(now, 1))]), []);
});
