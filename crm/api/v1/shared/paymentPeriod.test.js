const test = require('node:test');
const assert = require('node:assert');

const {
  paymentPeriodSql, payStatusSql, periodEnded, periodFor, isPeriodEnded,
} = require('./paymentPeriod.helper');
const { paymentStartState, START_STATE } = require('./owedThisMonth.helper');

/**
 * ***************************************************
 * * The payment period IS the preset formula
 * ***************************************************
 *
 * ONE CONDITION, THREE CONSUMERS: the cell colour, the month's total, and
 * this badge. A GREEN or AMBER payment start cell is Active and a RED one
 * is not, so the badge can never contradict the colour beside it.
 *
 * It read the END DATE directly, which is the reading the rest of the CRM
 * had already moved off. Six NEXUS deals on one August preset came out four
 * Ended and two Active purely because their end dates were appointment plus
 * a year and the appointments differed.
 */

const row = (over) => ({
  payment_start_on: '2025-04-01', preset_on: '2026-08-01', end_on: null, ...over,
});

test('a deal already running is active', () => {
  assert.strictEqual(periodEnded(row()), false);
});

test('a deal starting INSIDE the month is active, part month or not', () => {
  // Amber. It is owed something, so it is running.
  assert.strictEqual(periodEnded(row({ payment_start_on: '2026-08-15' })), false);
  assert.strictEqual(periodEnded(row({ payment_start_on: '2026-08-31' })), false);
});

test('a deal starting AFTER the month is not active', () => {
  // Red. Nothing is owed for August.
  assert.strictEqual(periodEnded(row({ payment_start_on: '2026-09-01' })), true);
  assert.strictEqual(periodEnded(row({ payment_start_on: '2026-11-03' })), true);
});

test('AN END DATE ALONE CHANGES NOTHING while the setting is off', () => {
  // The whole correction. These six are the real NEXUS rows.
  const nexus = [
    { who: 'Abe', payment_start_on: '2025-06-04', end_on: '2026-03-06' },
    { who: 'Juan Estrada', payment_start_on: '2025-06-04', end_on: '2026-03-06' },
    { who: 'Gloria', payment_start_on: '2025-04-01', end_on: '2026-01-01' },
    { who: 'Pino', payment_start_on: '2025-04-01', end_on: '2026-01-01' },
    { who: 'Dewell', payment_start_on: '2025-11-04', end_on: '2026-08-06' },
    { who: 'Drew', payment_start_on: '2025-11-04', end_on: '2026-08-06' },
  ];
  for (const r of nexus) {
    assert.strictEqual(periodEnded(row(r)), false, `${r.who} should be active`);
  }
});

test('with the setting ON, ending before the month ends the period', () => {
  assert.strictEqual(periodEnded(row({ end_on: '2026-01-01' }), { useEndDate: true }), true);
  // Ending INSIDE the month is still active: the boss pays it in full.
  assert.strictEqual(periodEnded(row({ end_on: '2026-08-26' }), { useEndDate: true }), false);
});

test('no preset is no month to measure, so active', () => {
  assert.strictEqual(periodEnded({ preset_on: null, end_on: '2020-01-01' }), false);
});

test('A HAND-SET STATUS IS IGNORED. The dates decide, and only the dates', () => {
  // It used to win. `isOwedThisMonth` never saw the claim, so the money
  // never moved with it: a row read Ended beside a GREEN payment start cell
  // with its amount still in the month's total. Gloria carried four deals
  // with identical dates and read Ended on two. Removed 2026-09-09,
  // migration 052 cleared the claims left behind.
  const held = { manually_overridden_fields: ['status'] };
  // A stale 'ended' on a row whose dates say it is running.
  assert.strictEqual(periodEnded({ ...row(), status: 'ended', ...held }), false);
  // A stale 'active' on a row that has not begun.
  assert.strictEqual(
    periodEnded({ ...row({ payment_start_on: '2026-12-01' }), status: 'active', ...held }),
    true,
  );
});

test('THE BADGE AND THE COLOUR CANNOT DISAGREE', () => {
  // The property that matters: red is ended, green and amber are active,
  // for every combination either could see.
  const starts = [null, '2025-04-01', '2026-08-01', '2026-08-20', '2026-09-05'];
  const ends = [null, '2026-01-01', '2026-08-26', '2027-01-01'];
  for (const useEndDate of [false, true]) {
    for (const s of starts) {
      for (const e of ends) {
        const r = row({ payment_start_on: s, end_on: e });
        const red = paymentStartState(r, { useEndDate }) === START_STATE.NOT_STARTED;
        assert.strictEqual(
          periodEnded(r, { useEndDate }), red,
          `start=${s} end=${e} useEndDate=${useEndDate}`,
        );
      }
    }
  }
});

test('the SQL reads the setting itself rather than trusting a caller', () => {
  const sql = paymentPeriodSql('d');
  assert.match(sql, /SELECT color_uses_end_date FROM tb_settings/);
  // A page that forgot to pass it would show a different answer from the
  // page beside it, so no caller is given the chance.
  assert.match(sql, /COALESCE\(\(SELECT color_uses_end_date/);
});

test('the SQL compares the START against the end of the preset month', () => {
  const sql = paymentPeriodSql('d');
  assert.match(sql, /d\.payment_start_on > \(date_trunc\('month', d\.preset_on\)/);
  assert.ok(!sql.includes('CURRENT_DATE'), 'today has no part in this any more');
});

// `the SQL still lets a hand-set status win first` stood here and was
// DELETED rather than inverted, 2026-09-09. It read
//   sql.indexOf('manually_overridden_fields') < sql.indexOf('payment_start_on')
// and once the branch was gone that is `-1 < 41`, so it went on passing
// while asserting the opposite of the truth. A test that cannot fail is a
// lie. What replaced it is `THE SQL CANNOT READ A CLAIM` at the foot of
// this file, which asserts absence directly and is paired with a test that
// the CASE still contains the three columns it is allowed, so it cannot
// pass on an empty string either.

/* ===============================
 * * Not started is not ended
 * =============================== */

test('the SQL calls a future start NOT STARTED, and reserves ended', () => {
  const sql = paymentPeriodSql('d');
  const start = sql.indexOf('payment_start_on >');
  const endDate = sql.indexOf('color_uses_end_date');

  assert.match(sql.slice(start, endDate), /not_started/, 'a future start still said ended');
  // Order is the meaning: a row that has not begun cannot have finished.
  assert.ok(start < endDate, 'the start must be asked about first');
  assert.match(sql.slice(endDate), /'ended'/, 'only a passed end date may say ended');
});

test('periodFor splits the word, and periodEnded still answers the money', () => {
  const future = row({ payment_start_on: '2026-11-03' });
  assert.strictEqual(periodFor(future), 'not_started');
  // THE ARITHMETIC IS UNTOUCHED. Both non-active states owe nothing, and
  // that is the only question any total ever asks.
  assert.strictEqual(periodEnded(future), true);

  const finished = row({ payment_start_on: '2025-04-01', end_on: '2026-01-01' });
  assert.strictEqual(periodFor(finished, { useEndDate: true }), 'ended');
  assert.strictEqual(periodFor(finished, { useEndDate: false }), 'active');
});

test('a stale status cannot make a future deal read active', () => {
  // The override existed for exactly this: forcing a row that has not begun
  // to read live. It no longer can, and the badge tells the truth the tint
  // was already telling.
  const held = { manually_overridden_fields: ['status'] };
  const future = { ...row({ payment_start_on: '2026-12-01' }), status: 'active', ...held };
  assert.strictEqual(periodFor(future), 'not_started');
});

test('NOT STARTED still counts as out of period, or the export changes', () => {
  // isPeriodEnded feeds the Active company list. Splitting the badge must
  // not quietly make eleven future deals live in it.
  assert.strictEqual(isPeriodEnded({ payment_period: 'not_started' }), true);
  assert.strictEqual(isPeriodEnded({ payment_period: 'ended' }), true);
  assert.strictEqual(isPeriodEnded({ payment_period: 'active' }), false);
  // A row carrying neither keeps the answer it always had.
  assert.strictEqual(isPeriodEnded({}), false);
});

test('a person with only future deals is not "ended"', () => {
  const sql = payStatusSql('d');
  const paying = sql.indexOf("'paying'");
  const notStarted = sql.indexOf('not_started');
  assert.ok(paying < notStarted, 'any active deal still wins');
  assert.match(sql.slice(notStarted), /ELSE 'ended'/, 'ended is the last resort');
});

test('the alias is honoured, including an empty one', () => {
  assert.match(paymentPeriodSql('m'), /m\.payment_start_on/);
  assert.match(paymentPeriodSql(''), /\bpayment_start_on IS NOT NULL\b/);
});

/**
 * ===============================
 * * THE SQL HALF, which no test can execute
 * ===============================
 * `paymentPeriodSql` and `periodEnded` are one rule in two languages, and
 * only the JS half runs here: there is no database in this suite. So when
 * the override was put back into the SQL by hand, every test still passed.
 * These read the string instead. Crude, and it is the only thing standing
 * between a re-added branch and a badge that argues with its own tint.
 */

test('THE SQL CANNOT READ A CLAIM, in any alias', () => {
  for (const alias of ['d', 'm', '']) {
    const sql = paymentPeriodSql(alias);
    assert.doesNotMatch(sql, /manually_overridden_fields/, `alias "${alias}" reads a claim`);
    assert.doesNotMatch(sql, /ANY\(/, 'no array membership test belongs in this CASE');
  }
});

test('the SQL still decides on the three columns it is allowed', () => {
  // Guards the guard above: asserting only what is ABSENT would pass on an
  // empty string.
  const sql = paymentPeriodSql('d');
  assert.match(sql, /d\.preset_on IS NULL/);
  assert.match(sql, /d\.payment_start_on/);
  assert.match(sql, /d\.end_on/);
  assert.match(sql, /color_uses_end_date/, 'the end date is gated by the setting');
});

test('the two languages agree on a row carrying a stale status', () => {
  // The JS half, checked directly. The SQL half is checked by its shape
  // above, because nothing here can run it.
  const stale = {
    preset_on: '2026-09-01',
    payment_start_on: '2025-04-01',
    end_on: '2026-01-01',
    status: 'ended',
    manually_overridden_fields: ['status'],
  };
  assert.strictEqual(periodFor(stale, { useEndDate: false }), 'active', 'Gloria');
  assert.strictEqual(periodFor(stale, { useEndDate: true }), 'ended', 'and the toggle still works');
});
