/**
 * BULK UPDATES, EVERY COLUMN, MESSY WORDS. SUITE_SET=bulk.
 *
 * His ask 2026-10-06: "make her super efficient in these bulk updates and
 * understanding the request, however messy". Each case is one person's
 * deals (Kiran Vale holds three), changed in one column by a request typed
 * the way a busy admin types it: typos, no apostrophes, two fields at once.
 *
 * Every case runs twice, MANUAL and AUTO. A change to several deals is
 * previewed in both (auto mode skips only a one-row preview, by design;
 * see agent/autoConfirm.js), so both are a request, a yes, and the check.
 * A single-deal person (Otto Fenn) covers auto mode applying at once.
 *
 * Each case snapshots Kiran's deals first and puts them back after, so the
 * cases stay independent whatever she did.
 */
const KIRAN = 'Kiran Vale';
const COLS = [
  'monthly_amount', 'payable_amount', 'payable_days', 'currency', 'payment_method', 'location', 'door_number',
  'postcode', 'accepting_postals', 'account_number', 'sort_code', 'label', 'notes', 'bank_details', 'role_label',
  'needs_review', 'review_reason', 'override_should_be_paid', 'override_paid', 'special_case_deal',
  'addon_percent', 'fee_percent', 'assigned_on', 'payment_start_on', 'preset_on', 'end_on',
];
const rowsOf = async (db, person = KIRAN) => (await db.query(
  `SELECT id, company, ${COLS.map((c) => `${c}::text AS ${c}`).join(', ')}
     FROM tb_mastersheet WHERE person_name = $1 AND stopped_on IS NULL ORDER BY company`,
  [person],
)).rows;

const saved = {};
// EVERYONE ELSE, as one fingerprint: a bulk change for Kiran must leave it
// alone. The 14-deal raise of 2026-10-06 is what this catches.
const othersPrint = async (db, person = KIRAN) => (await db.query(
  `SELECT md5(string_agg(${COLS.map((c) => `coalesce(${c}::text,'')`).join(" || '|' || ")}, ',' ORDER BY id)) AS p
     FROM tb_mastersheet WHERE person_name <> $1`,
  [person],
)).rows[0].p;
const othersSaved = {};
const snapshot = (person = KIRAN) => ({
  act: async ({ db }) => { saved[person] = await rowsOf(db, person); othersSaved[person] = await othersPrint(db, person); },
});
const restore = (person = KIRAN) => ({
  act: async ({ db }) => {
    for (const r of saved[person] ?? []) {
      const sets = COLS.map((c, i) => `${c} = $${i + 2}`).join(', ');
      // eslint-disable-next-line no-await-in-loop
      await db.query(`UPDATE tb_mastersheet SET ${sets} WHERE id = $1`, [r.id, ...COLS.map((c) => r[c])]);
    }
  },
});

/** Every one of Kiran's live deals passes `test(row, before)`. */
const all = (test, what, person = KIRAN) => async (db) => {
  const now = await rowsOf(db, person);
  const before = new Map((saved[person] ?? []).map((r) => [r.id, r]));
  const bad = now.filter((r) => !test(r, before.get(r.id) ?? {}));
  return bad.length ? `${what}: ${bad.map((r) => `${r.company}=${JSON.stringify(Object.fromEntries(COLS.filter((c) => r[c] !== before.get(r.id)?.[c]).map((c) => [c, r[c]])))}`).join('; ')}` : null;
};
const othersAlone = (person = KIRAN) => async (db) => ((await othersPrint(db, person)) === othersSaved[person] ? null : 'SOMEBODY ELSE\'S DEALS CHANGED');
const both = (...checks) => async (db) => {
  for (const c of checks) {
    // eslint-disable-next-line no-await-in-loop
    const bad = await c(db);
    if (bad) return bad;
  }
  return null;
};
const unchanged = (person = KIRAN) => all((r, b) => COLS.every((c) => r[c] === b[c]), 'changed before the yes', person);
const num = (v) => Number(v ?? 0);
const yearOf = () => new Date().getFullYear();

// [name, messy request, check on every deal]
const COLUMN_CASES = [
  ['deduct with a typo', 'dudcut 200 to kiran vales deals', (r, b) => num(r.payable_amount) === num(b.payable_amount) - 200],
  ['a percent raise on monthly', 'bump kirans monthly by 10% on all of them', (r, b) => Math.abs(num(r.monthly_amount) - num(b.monthly_amount) * 1.1) < 0.01],
  ['monthly set to one figure', 'kiran vale monthly 2750 every deal', (r) => num(r.monthly_amount) === 2750],
  ['payable days', 'payable days 20 for all kiran deals pls', (r) => num(r.payable_days) === 20],
  ['currency', 'switch all kiran vale deals to aed', (r) => r.currency === 'AED'],
  ['payment method', 'kiran gets paid by bank now, all deals', (r) => /bank/i.test(r.payment_method)],
  ['location', 'kirans location is manchester now for every deal', (r) => /manchester/i.test(r.location)],
  ['postcode', 'postcode M1 1AA on all of kiran vale', (r) => /M1\s?1AA/i.test(r.postcode)],
  ['door number', 'door no 12b for kiran all deals', (r) => /12b/i.test(r.door_number)],
  ['accepting postals', 'kiran accepts postals, set it on all', (r) => /yes|true|accept/i.test(r.accepting_postals)],
  ['account and sort code at once', 'acc no 12345678 and sort code 20-00-00 for all kirans deals', (r) => /12345678/.test(r.account_number) && /20-?00-?00/.test(r.sort_code)],
  ['bank details', 'kiran vale bank is monzo on all deals', (r) => /monzo/i.test(r.bank_details)],
  ['label', 'label all kiran deals VIP', (r) => /vip/i.test(r.label)],
  ['notes', 'note on every kiran deal: chase the invoice', (r) => /chase the invoice/i.test(r.notes)],
  ['role', 'kiran is Tech on all his deals now', (r) => /^tech$/i.test(r.role_label)],
  ['fee percent', 'kiran vale fee 5% everywhere', (r) => num(r.fee_percent) === 5],
  ['add on percent', 'addon 3 percent kiran all deals', (r) => num(r.addon_percent) === 3],
  ['preset month', 'kiran preset month november for all', (r) => String(r.preset_on).startsWith(`${yearOf()}-11-01`) || String(r.preset_on).startsWith(`${yearOf() + 1}-11-01`)],
  ['end date', 'end date 31 dec for all of kirans deals', (r) => /-12-31/.test(String(r.end_on))],
  ['payment start', 'kiran payment start 1st oct all deals', (r) => /-10-01/.test(String(r.payment_start_on))],
  ['appointment date', 'appointment date on kiran vale deals is 1 sept', (r) => /-09-01/.test(String(r.assigned_on))],
  ['paid', 'mark all kirans deals paid', (r) => r.override_paid === 'true'],
  ['should be paid, no', 'kiran shouldnt get paid this month on any deal', (r) => r.override_should_be_paid === 'false'],
  ['special case', 'make kiran vale deals special case', (r) => r.special_case_deal === 'true'],
  // The reason column is the importer's own explanation, not admin data, so only the flag is set.
  ['flag for review with a reason', 'flag all kiran deals for review, reason bank details missing', (r) => r.needs_review === 'true'],
];

export const READS = [];
export const WRITES = [];
export const PENDING = [];

for (const auto of [false, true]) {
  for (const [label, say, test] of COLUMN_CASES) {
    WRITES.push({
      name: `bulk ${label} (auto ${auto ? 'on' : 'off'})`,
      auto,
      turns: [
        snapshot(),
        { say, expect: { noReply: /which (group|company|one|deal)|could you clarify|not sure what/i, db: unchanged() } },
        { say: 'yes', expect: { db: both(all(test, `${label} not applied`), othersAlone()) } },
        restore(),
      ],
    });
  }

  // THE LAST TWO, BACK. "undo and revert the past 2 updates made for zayn".
  WRITES.push({
    name: `undo the last 2 updates for one person (auto ${auto ? 'on' : 'off'})`,
    auto,
    turns: [
      snapshot(),
      { say: 'kiran vale fee 4% on all deals' },
      { say: 'yes', expect: { db: all((r) => num(r.fee_percent) === 4, 'fee not 4') } },
      { say: 'and label them all VIP' },
      { say: 'yes', expect: { db: all((r) => /vip/i.test(r.label), 'label not VIP') } },
      { say: 'revert the past 2 updates made for kiran' },
      { say: 'yes', expect: { db: all((r, b) => r.fee_percent === b.fee_percent && r.label === b.label, 'the two updates were not both reverted') } },
      restore(),
    ],
  });
}

// AUTO MODE, ONE DEAL: no preview, it just lands.
WRITES.push({
  name: 'auto mode: one-deal person, messy deduct lands at once',
  auto: true,
  turns: [
    snapshot('Otto Fenn'),
    { say: 'take 50 off otto fenns payable', expect: { db: all((r, b) => num(r.payable_amount) === num(b.payable_amount) - 50, 'not -50 at once', 'Otto Fenn') } },
    restore('Otto Fenn'),
  ],
});
