const test = require('node:test');
const assert = require('node:assert');
const { moneyTotals, masterSheetTools } = require('./masterSheet');
const repo = require('../../repos/masterSheetRows.repo');
const peopleRepo = require('../../repos/people.repo');
const settingsRepo = require('../../repos/settings.repo');
const snapshotsRepo = require('../../repos/monthSnapshots.repo');
const fxRates = require('../../shared/fxRates.helper');
const { currentMonth } = require('../../shared/presetMonth.helper');

const THIS_MONTH = currentMonth();

/**
 * THE SUM DIANE GOT WRONG, pinned.
 *
 * Asked for Nicola's August she answered 3,700 against a real 2,900,
 * because she picked row ids by hand and then added them up in prose. The
 * ids are guarded elsewhere; this pins the arithmetic itself, with no
 * database, so the figure cannot drift again.
 *
 * Nicola's real August 2026, from the boss's own MONTH SHEET:
 *   Ackerman Pearce payroll   1400
 *   Acqua resourcing           700
 *   Leadstone solutions        800
 *   Social work partners PR      0   payment starts November
 *                            -----
 *                             2900
 */
const deal = (over = {}) => ({
  person_name: 'Nicola',
  group_name: 'INDIGO',
  company: 'A company',
  currency: 'GBP',
  payable_amount: '0',
  preset_on: '2026-08-01',
  end_on: null,
  payment_period: 'active',
  ...over,
});

const NICOLA = [
  deal({ company: 'Ackerman Pearce payroll', payable_amount: '1400' }),
  deal({ company: 'Acqua resourcing', payable_amount: '700' }),
  deal({ company: 'Leadstone solutions', payable_amount: '800' }),
  deal({ company: 'Social work partners PR', payable_amount: '0' }),
];

test("Nicola's August is 2900, not 3700", () => {
  const { byCurrency, counted } = moneyTotals(NICOLA, '2026-08');
  assert.strictEqual(byCurrency.get('GBP'), 2900);
  assert.strictEqual(counted.length, 4, 'a row worth 0 is still a counted row');
});

test('a row marked for another month is reported, not silently dropped', () => {
  const rows = [
    deal({ payable_amount: '1000' }),
    deal({ company: 'Next month', payable_amount: '500', preset_on: '2026-09-01' }),
  ];
  const { byCurrency, counted, uncounted } = moneyTotals(rows, '2026-08');

  assert.strictEqual(byCurrency.get('GBP'), 1000, 'September money is not August money');
  assert.strictEqual(counted.length, 1);
  assert.strictEqual(uncounted.length, 1);
  assert.equal(uncounted[0].why, 'marked for September 2026, not August 2026');
});

/**
 * SHE TOTALS BY THE EXPORT'S RULE, shared/owedThisMonth.helper.
 *
 * She read `isPeriodEnded` directly, which is what the exports stopped
 * doing: an end date on its own no longer drops a row, because the boss
 * pays a deal that ended on the 26th for the whole month. Left as it was,
 * Diane would have quoted a figure the file she was looking at disagreed
 * with, which is the one failure this tool exists to prevent.
 */
test('an ended payment period alone does not leave her total', () => {
  const rows = [
    deal({ payable_amount: '1000' }),
    deal({
      company: 'Finished', payable_amount: '900', end_on: '2026-06-30', payment_period: 'ended',
    }),
  ];
  const { byCurrency, uncounted } = moneyTotals(rows, '2026-08');

  assert.strictEqual(byCurrency.get('GBP'), 1900);
  assert.strictEqual(uncounted.length, 0);
});

test('with the setting on, a deal that ended before its month is out, and says why', () => {
  const rows = [
    deal({ payable_amount: '1000' }),
    deal({ company: 'Finished', payable_amount: '900', end_on: '2026-06-30' }),
  ];
  const { byCurrency, uncounted } = moneyTotals(rows, '2026-08', { useEndDate: true });

  assert.strictEqual(byCurrency.get('GBP'), 1000);
  assert.equal(uncounted[0].why, 'payment ended 30 June 2026, before August 2026');
});

test('a payment starting after the month is out of her total whatever the setting', () => {
  // The half of the rule that never depended on a toggle.
  const rows = [
    deal({ payable_amount: '1000' }),
    deal({ company: 'Later', payable_amount: '900', payment_start_on: '2026-11-01' }),
  ];
  assert.strictEqual(moneyTotals(rows, '2026-08').byCurrency.get('GBP'), 1000);
});

/**
 * ===============================
 * * THE SECOND TIME, 2026-08-28
 * ===============================
 * Same person, same month, opposite failure: she said Nicola was owed
 * NOTHING "because all her deals are marked for another month", off the
 * cards she had just shown. Every preset reads 2026-08-01, so that reason
 * was untrue of all four rows, and three of them are worth 2,900 together.
 *
 * The live rows differ from the fixture above in one way that matters: the
 * Social work partners row starts in NOVEMBER, so it is worth nothing for a
 * reason that has nothing to do with its preset.
 */
const NICOLA_LIVE = [
  deal({
    company: 'Social work partners PR', payable_amount: '0', payment_start_on: '2026-11-03', end_on: '2027-08-05',
  }),
  deal({ company: 'Acqua resourcing', payable_amount: '700', payment_start_on: '2026-07-19' }),
  deal({ company: 'Leadstone solutions', payable_amount: '800', payment_start_on: '2026-08-01' }),
  deal({ company: 'Ackerman Pearce payroll', payable_amount: '1400', payment_start_on: '2026-05-07' }),
];

test('a November start is worth nothing in August, and the rest still total 2900', () => {
  const { byCurrency, counted, uncounted } = moneyTotals(NICOLA_LIVE, '2026-08');
  assert.strictEqual(byCurrency.get('GBP'), 2900);
  assert.strictEqual(counted.length, 3);
  assert.strictEqual(uncounted.length, 1);
});

test('the excluded row says WHY, and it is not "another month"', () => {
  // Its preset IS August. Saying "marked for another month" about it is
  // simply false, and it is the sentence she reached for.
  const { uncounted } = moneyTotals(NICOLA_LIVE, '2026-08');
  assert.equal(uncounted[0].why, 'payment starts 3 November 2026, after August 2026');
  assert.ok(!/another month/.test(uncounted[0].why));
});

test('the display answer puts paid deals first, uses no bullets, and ends with the exact zero reason', async () => {
  const [year, part] = THIS_MONTH.split('-').map(Number);
  const futureDate = new Date(Date.UTC(year, part + 1, 3));
  const futureIso = futureDate.toISOString().slice(0, 10);
  const futureWords = futureDate.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
  const currentWords = new Date(`${THIS_MONTH}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
  const rows = NICOLA_LIVE.map((row) => ({
    ...row,
    preset_on: `${THIS_MONTH}-01`,
    ...(row.company === 'Social work partners PR' ? { payment_start_on: futureIso } : {}),
  }));
  const saved = {
    searchFuzzy: repo.searchFuzzy,
    findAll: repo.findAll,
    rateMap: peopleRepo.rateMap,
    get: settingsRepo.get,
  };
  repo.searchFuzzy = async () => rows;
  repo.findAll = async () => ({ rows, total: rows.length });
  peopleRepo.rateMap = async () => new Map();
  settingsRepo.get = async () => ({ color_uses_end_date: false, crypto_percent: 0 });

  try {
    const total = masterSheetTools.find((tool) => tool.name === 'total_master_sheet');
    const out = await total.handler({
      person: 'Nicola', month: THIS_MONTH, said: `show me Nicola total for ${THIS_MONTH}`,
    });

    assert.doesNotMatch(out.reply, /[•*-]\s/);
    assert.ok(out.reply.indexOf('Acqua resourcing: GBP 700') < out.reply.indexOf('Social work partners PR'));
    assert.ok(out.reply.indexOf('Leadstone solutions: GBP 800') < out.reply.indexOf('Social work partners PR'));
    assert.ok(out.reply.indexOf('Ackerman Pearce payroll: GBP 1,400') < out.reply.indexOf('Social work partners PR'));
    assert.match(
      out.reply,
      new RegExp(`Social work partners PR is GBP 0 because payment starts ${futureWords}, after ${currentWords}\\.$`),
    );
  } finally {
    repo.searchFuzzy = saved.searchFuzzy;
    repo.findAll = saved.findAll;
    peopleRepo.rateMap = saved.rateMap;
    settingsRepo.get = saved.get;
  }
});

test('a multi-month answer never substitutes live deals for missing history', async () => {
  const rows = NICOLA_LIVE.map((row) => ({ ...row, preset_on: `${THIS_MONTH}-01` }));
  const previous = (() => {
    const [year, part] = THIS_MONTH.split('-').map(Number);
    const date = new Date(Date.UTC(year, part - 2, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  })();
  const saved = {
    searchFuzzy: repo.searchFuzzy,
    findAll: repo.findAll,
    rateMap: peopleRepo.rateMap,
    get: settingsRepo.get,
    findMany: snapshotsRepo.findMany,
    findAllRows: repo.findAllRows,
    usdPerGbp: fxRates.usdPerGbp,
  };
  repo.searchFuzzy = async () => rows;
  repo.findAll = async () => ({ rows, total: rows.length });
  peopleRepo.rateMap = async () => new Map();
  settingsRepo.get = async () => ({ color_uses_end_date: false, crypto_percent: 0 });
  snapshotsRepo.findMany = async () => [];
  repo.findAllRows = async () => rows;
  fxRates.usdPerGbp = async () => ({ usdPerGbp: 1.3, perUsd: { GBP: 0.77 }, source: 'live' });

  try {
    const total = masterSheetTools.find((tool) => tool.name === 'total_master_sheet');
    const out = await total.handler({
      person: 'Nicola',
      months: [previous, THIS_MONTH],
      said: 'what is Nicola owed last month and this month',
    });

    assert.match(out.reply, /unavailable because no month snapshot was saved/);
    // Pence, since money and percentages were split: `checkFigures` rounds
    // both sides so the trailing zero cannot make a real figure look wrong.
    assert.match(out.reply, /GBP 2,900\.00, live current estimate/);
  } finally {
    repo.searchFuzzy = saved.searchFuzzy;
    repo.findAll = saved.findAll;
    peopleRepo.rateMap = saved.rateMap;
    settingsRepo.get = saved.get;
    snapshotsRepo.findMany = saved.findMany;
    repo.findAllRows = saved.findAllRows;
    fxRates.usdPerGbp = saved.usdPerGbp;
  }
});

test('same-company deal lines identify their groups', async () => {
  const rows = [
    deal({ company: 'Workforce', group_name: 'INDIGO', payable_amount: '3675', preset_on: `${THIS_MONTH}-01` }),
    deal({ company: 'Workforce', group_name: 'MILKMAN', payable_amount: '3675', preset_on: `${THIS_MONTH}-01` }),
  ];
  const saved = {
    searchFuzzy: repo.searchFuzzy,
    findAll: repo.findAll,
    rateMap: peopleRepo.rateMap,
    get: settingsRepo.get,
  };
  repo.searchFuzzy = async () => rows;
  repo.findAll = async () => ({ rows, total: rows.length });
  peopleRepo.rateMap = async () => new Map();
  settingsRepo.get = async () => ({ color_uses_end_date: false, crypto_percent: 0 });

  try {
    const total = masterSheetTools.find((tool) => tool.name === 'total_master_sheet');
    const out = await total.handler({ person: 'Nicola', month: THIS_MONTH, said: 'how much is Nicola owed' });
    assert.match(out.reply, /Workforce in INDIGO: GBP 3,675\./);
    assert.match(out.reply, /Workforce in MILKMAN: GBP 3,675\./);
  } finally {
    repo.searchFuzzy = saved.searchFuzzy;
    repo.findAll = saved.findAll;
    peopleRepo.rateMap = saved.rateMap;
    settingsRepo.get = saved.get;
  }
});

test('a details-only sentence cannot inherit an earlier total or month', async () => {
  const saved = { searchFuzzy: repo.searchFuzzy, findAll: repo.findAll };
  repo.searchFuzzy = async () => NICOLA_LIVE;
  repo.findAll = async () => ({ rows: NICOLA_LIVE, total: NICOLA_LIVE.length });

  try {
    const total = masterSheetTools.find((tool) => tool.name === 'total_master_sheet');
    const out = await total.handler({
      person: 'Nicola', month: '2026-08', said: 'show me Nicola',
    });
    assert.equal(out.total, undefined);
    assert.match(out.summary, /details only/i);
  } finally {
    repo.searchFuzzy = saved.searchFuzzy;
    repo.findAll = saved.findAll;
  }
});

test('omitting the month gives the same figure as naming this one', () => {
  // "the total for Nicola" and "the total for Nicola for THIS month" must
  // not be two different numbers.
  //
  // IT NAMED AUGUST AND MEANT "NOW", so it passed all August and failed on
  // the first of September, when the unnamed side moved on and the named
  // one did not. The rest of this file names a month on both sides on
  // purpose, and those are left alone.
  const { thisMonth, presetNow } = require('../../testing/months');
  const rows = NICOLA_LIVE.map((r) => ({ ...r, preset_on: presetNow() }));

  assert.strictEqual(
    moneyTotals(rows, thisMonth()).byCurrency.get('GBP'),
    moneyTotals(rows, undefined).byCurrency.get('GBP'),
  );
});

/**
 * ===============================
 * * TWO RATES, OPPOSITE DIRECTIONS
 * ===============================
 * An ADD ON is income on top of what the group sends us. A FEE is deducted
 * from the total after it. Both stack person plus deal.
 */
test('a 5% add on is added to what is owed', () => {
  const rows = NICOLA_LIVE.map((r) => ({ ...r, person_id: 'nicola' }));
  const rates = new Map([['nicola', { addon: 5, fee: 0 }]]);
  const { byCurrency, addonByCurrency, withRates } = moneyTotals(rows, '2026-08', { rates });

  assert.strictEqual(byCurrency.get('GBP'), 2900, 'what the group sends us');
  assert.strictEqual(addonByCurrency.get('GBP'), 145, '5% of 2,900');
  assert.strictEqual(withRates.get('GBP'), 3045, 'what there is to find');
});

test('a 5% fee is taken OFF, never added', () => {
  const rows = NICOLA_LIVE.map((r) => ({ ...r, person_id: 'nicola' }));
  const rates = new Map([['nicola', { addon: 0, fee: 5 }]]);
  const { feeByCurrency, withRates } = moneyTotals(rows, '2026-08', { rates });

  assert.strictEqual(feeByCurrency.get('GBP'), 145);
  assert.strictEqual(withRates.get('GBP'), 2755, '2,900 less 145');
});

test('ADD ON FIRST, then the fee off the result', () => {
  // The order is the whole arithmetic. 500 + 8% = 540, less 2% of 540 =
  // 529.20. Taking the fee off 500 instead would be 529.00.
  const rows = [deal({
    person_id: 'a', payable_amount: '500', preset_on: '2026-08-01', addon_percent: 3, fee_percent: 0,
  })];
  const rates = new Map([['a', { addon: 5, fee: 2 }]]);
  const { addonByCurrency, feeByCurrency, withRates } = moneyTotals(rows, '2026-08', { rates });

  assert.strictEqual(addonByCurrency.get('GBP'), 40, '5% person + 3% deal = 8% of 500');
  assert.strictEqual(feeByCurrency.get('GBP'), 10.8, '2% of 540, not of 500');
  assert.strictEqual(withRates.get('GBP'), 529.2);
});

test('person and deal rates STACK, they do not override', () => {
  const rows = [deal({
    person_id: 'a', payable_amount: '1000', preset_on: '2026-08-01', fee_percent: 3,
  })];
  const rates = new Map([['a', { addon: 0, fee: 2 }]]);
  const { feeByCurrency } = moneyTotals(rows, '2026-08', { rates });
  assert.strictEqual(feeByCurrency.get('GBP'), 50, '2% person + 3% deal = 5%');
});

test('no rate means no line at all, never a zero', () => {
  const rows = NICOLA_LIVE.map((r) => ({ ...r, person_id: 'nicola' }));
  const { addonByCurrency, feeByCurrency, withRates } = moneyTotals(rows, '2026-08', { rates: new Map() });
  assert.strictEqual(addonByCurrency.size, 0);
  assert.strictEqual(feeByCurrency.size, 0);
  assert.strictEqual(withRates.get('GBP'), 2900, 'to find is the same as owed');
});

test('a rate is only charged on rows that COUNT', () => {
  const rows = [
    deal({ person_id: 'x', payable_amount: '1000', preset_on: '2026-08-01' }),
    deal({ person_id: 'x', payable_amount: '1000', preset_on: '2026-09-01' }),
  ];
  const rates = new Map([['x', { addon: 10, fee: 0 }]]);
  const { byCurrency, addonByCurrency } = moneyTotals(rows, '2026-08', { rates });
  assert.strictEqual(byCurrency.get('GBP'), 1000);
  assert.strictEqual(addonByCurrency.get('GBP'), 100, 'the September row is not charged');
});

test('each person is charged their OWN percentage on a group total', () => {
  const rows = [
    deal({ person_id: 'a', person_name: 'A', payable_amount: '1000', preset_on: '2026-08-01' }),
    deal({ person_id: 'b', person_name: 'B', payable_amount: '1000', preset_on: '2026-08-01' }),
  ];
  const rates = new Map([['a', { addon: 10, fee: 0 }], ['b', { addon: 0, fee: 0 }]]);
  const { addonByCurrency, withRates } = moneyTotals(rows, '2026-08', { rates });
  assert.strictEqual(addonByCurrency.get('GBP'), 100, 'only A carries one');
  assert.strictEqual(withRates.get('GBP'), 2100);
});

test('currencies keep their own rates', () => {
  const rows = [
    deal({ person_id: 'a', payable_amount: '1000', currency: 'GBP', preset_on: '2026-08-01' }),
    deal({ person_id: 'a', payable_amount: '2000', currency: 'AED', preset_on: '2026-08-01' }),
  ];
  const rates = new Map([['a', { addon: 10, fee: 0 }]]);
  const { addonByCurrency, withRates } = moneyTotals(rows, '2026-08', { rates });
  assert.strictEqual(addonByCurrency.get('GBP'), 100);
  assert.strictEqual(addonByCurrency.get('AED'), 200);
  assert.strictEqual(withRates.get('GBP'), 1100);
  assert.strictEqual(withRates.get('AED'), 2200);
});

test('a total is never computed over a partial page', () => {
  // A CAP ON A TOTAL IS A WRONG TOTAL, and it would look right. The whole
  // point of this tool is that the figure is computed rather than added up
  // by the model, so quietly summing the first page would defeat it.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'masterSheet.js'), 'utf8',
  );
  assert.match(src, /if \(found\.total > found\.rows\.length\)/);
  assert.match(src, /more than I add up in one go/);
  assert.ok(!src.includes('page: 1, pageSize: 500 }'), 'the silent 500 cap must be gone');
});

test('a row with NO preset counts every month', () => {
  // The standing roster. CLAUDE.md: no preset means owed every month.
  const { byCurrency } = moneyTotals([deal({ payable_amount: '600', preset_on: null })], '2026-08');
  assert.strictEqual(byCurrency.get('GBP'), 600);
});

test('currencies are never blended into one number', () => {
  const rows = [
    deal({ payable_amount: '1000', currency: 'GBP' }),
    deal({ payable_amount: '3675', currency: 'AED' }),
  ];
  const { byCurrency } = moneyTotals(rows, '2026-08');

  assert.strictEqual(byCurrency.get('GBP'), 1000);
  assert.strictEqual(byCurrency.get('AED'), 3675);
  assert.strictEqual(byCurrency.size, 2, 'two currencies stay two figures');
});

test('a non-numeric payable amount is skipped, never counted as zero-ish junk', () => {
  const rows = [deal({ payable_amount: '1000' }), deal({ payable_amount: 'TBC' })];
  assert.strictEqual(moneyTotals(rows, '2026-08').byCurrency.get('GBP'), 1000);
});

// THE CRYPTO CHARGE MOVED TO THE ROWS. It was a percentage of the crypto
// subtotal computed inside one breakdown design, so no total contained
// it. It is a Settings rate applied to a crypto ROW now, and it is
// pinned in masterSheet/cryptoRates.test.js.

/* ===============================
 * * The crypto charge, which the export adds and she did not
 * =============================== */

test('a crypto row carries the charge into her total', () => {
  // She called amountWithRates without the rate, so it defaulted to 0 and
  // her answer was SHORT against the sheet beside her for any group
  // holding a crypto row.
  const rows = [deal({
    person_id: 'abe', payable_amount: '1000', preset_on: '2026-08-01', payment_method: 'crypto',
  })];
  const { byCurrency, cryptoByCurrency, withRates } = moneyTotals(rows, '2026-08', { cryptoPercent: 1 });

  assert.strictEqual(byCurrency.get('GBP'), 1000, 'what the group sends us');
  assert.strictEqual(cryptoByCurrency.get('GBP'), 10, 'the gas, added');
  assert.strictEqual(withRates.get('GBP'), 1010);
});

test('a row paid any other way carries none of it', () => {
  const rows = [deal({ person_id: 'a', payable_amount: '1000', preset_on: '2026-08-01', payment_method: 'cash' })];
  const { cryptoByCurrency, withRates } = moneyTotals(rows, '2026-08', { cryptoPercent: 1 });
  assert.strictEqual(cryptoByCurrency.size, 0);
  assert.strictEqual(withRates.get('GBP'), 1000);
});

test('HER FIGURE EQUALS THE SHEET, which is the whole point', () => {
  // One predicate, two readers. paymentBreakdown builds the exported
  // total and moneyTotals builds hers; they must land on the same number
  // or the file contradicts the answer that was read aloud beside it.
  const { paymentBreakdown } = require('../../masterSheet/groupTables');
  const rows = [
    deal({ person_id: 'abe', person_name: 'Abe', payable_amount: '1000', preset_on: '2026-08-01', payment_method: 'crypto' }),
    deal({ person_id: 'neo', person_name: 'Neo', payable_amount: '500', preset_on: '2026-08-01', payment_method: 'cash' }),
  ];
  const rates = new Map([['neo', { addon: 5, fee: 0 }]]);

  const hers = moneyTotals(rows, '2026-08', { rates, cryptoPercent: 1 }).withRates.get('GBP');
  // RATED FIRST, which is the whole contract paymentBreakdown has. It used
  // to ACCEPT `rates` and `cryptoPercent` and ignore them, so this passed
  // them and got 1,500 against her 1,535. Two real callers made the same
  // mistake; both options are gone from that signature now.
  const { withRates } = require('../../shared/rates.helper');
  const rated = rows.map((row) => withRates(row, rates, { cryptoPercent: 1 }));
  const sheet = paymentBreakdown(rated)
    .grand.find((g) => g.currency === 'GBP').total;

  assert.strictEqual(hers, 1535, '1,000 + 10 gas, plus 500 + 25 add on');
  assert.strictEqual(hers, sheet, 'her total and the exported total must agree');
});
