/**
 * ***************************************************
 * * THE LIBRARY'S OWN PEOPLE, on top of the shared seed (../seed.mjs)
 * ***************************************************
 * Plan items 13-22, 2026-10-08. FAKE DATA ONLY. Everything a case below
 * expects is set here, so every expected answer can be worked out by hand:
 *
 *   LOOK-ALIKES   John Smith (CORVID, Pinecrest, 1,800), John Smithson
 *                 (OTTER, Ironleaf, 900), Jon Smith (BAKER, Brightwell, 750);
 *                 companies ABC Ltd (Rae Dunn, 1,000) and ABC Limited (Cole
 *                 Pratt, 1,250). Never one of each merged.
 *   PAY STATES    Otto Fenn paid + said paid. Juno Park paid, but SAID UNPAID
 *                 (the mismatch). Baker Jones said portion (flagged). Theo
 *                 Brandt said unpaid. Felix Orr asked, no reply (awaiting).
 *                 Mara Quill should NOT be paid. Kiran Vale: Brightwell paid
 *                 and said paid, Ironleaf said unpaid, Harbor Nine nothing:
 *                 Paid MIXED, Payment received PORTION.
 *   HISTORY       Last month is snapshotted with Felix Orr on 1,300; this
 *                 month he is on 1,450 (a logged change).
 *
 * Amounts are this month with every day payable, so owed = monthly, less
 * the deal's own fee (Kiran's Brightwell 3,000 less 5% = 2,850).
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { currentMonth } = require('../../../v1/shared/presetMonth.helper');

const [y, m] = currentMonth().split('-').map(Number);
export const THIS_MONTH = currentMonth();
export const LAST_MONTH = (() => { const d = new Date(Date.UTC(y, m - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

const deal = (o) => ({
  assignedOn: `${LAST_MONTH}-01`,
  paymentStartOn: `${LAST_MONTH}-01`,
  presetOn: `${THIS_MONTH}-01`,
  payableDays: daysInMonth,
  currency: 'GBP',
  paymentMethod: 'bank',
  ...o,
});

const EXTRA = [
  deal({ personName: 'John Smith', groupName: 'CORVID', company: 'Pinecrest', roleLabel: 'Tech', monthlyAmount: 1800 }),
  deal({ personName: 'John Smithson', groupName: 'OTTER', company: 'Ironleaf', roleLabel: 'Sales', monthlyAmount: 900 }),
  deal({ personName: 'Jon Smith', groupName: 'BAKER', company: 'Brightwell', roleLabel: 'Admin', monthlyAmount: 750 }),
  deal({ personName: 'Rae Dunn', groupName: 'BAKER', company: 'ABC Ltd', roleLabel: 'Mid 1', monthlyAmount: 1000 }),
  deal({ personName: 'Cole Pratt', groupName: 'CORVID', company: 'ABC Limited', roleLabel: 'Mid 2', monthlyAmount: 1250 }),
];

export const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
export const dealOf = (db, person, company) => one(
  db,
  'SELECT * FROM tb_mastersheet WHERE person_name = $1 AND company = $2 AND stopped_on IS NULL ORDER BY id DESC LIMIT 1',
  [person, company],
);
export const dealsOf = async (db, person) => (await db.query(
  'SELECT * FROM tb_mastersheet WHERE person_name = $1 AND stopped_on IS NULL ORDER BY id',
  [person],
)).rows;

async function patch(api, db, person, company, fields) {
  const row = await dealOf(db, person, company);
  if (!row) throw new Error(`library seed: no deal ${person} / ${company}`);
  const r = await api('PATCH', `/master-sheet/${row.id}`, fields);
  if (r.status >= 300) throw new Error(`library seed ${person}: ${r.status} ${JSON.stringify(r.body)}`);
}

export async function extraSeed({ api, db }) {
  for (const d of EXTRA) {
    const r = await api('POST', '/master-sheet', d);
    if (r.status !== 201) throw new Error(`library seed ${d.personName}: ${r.status} ${JSON.stringify(r.body)}`);
  }

  // HISTORY FIRST: last month as it stood, Felix on 1,300. The snapshot is
  // taken by the same code the month end uses, on this database.
  process.env.DATABASE_URL = process.env.SUITE_DB_URL || require('../../testDb').testDbUrl();
  process.env.DB_SSL = 'false';
  // One connection is plenty here, and DEV's pooler is shared (15 in all).
  process.env.DB_POOL_MAX = '1';
  process.env.DB_POOL_MIN = '0';
  await db.query("UPDATE tb_mastersheet SET preset_on = (preset_on - interval '1 month')::date WHERE stopped_on IS NULL");
  const { takeSnapshot } = require('../../../v1/masterSheet/takeSnapshot');
  await takeSnapshot(LAST_MONTH);
  await db.query("UPDATE tb_mastersheet SET preset_on = (preset_on + interval '1 month')::date WHERE stopped_on IS NULL");
  await require('../../../configs/db').end().catch(() => {});

  // A PORTION is whatbot's answer, flag and all: written as applyPaydayOutcome
  // leaves it (the admin route would clear the flag it is meant to show).
  // BEFORE the API writes below: each of them empties the suite server's
  // read cache, so nothing it holds predates these direct writes.
  await db.query(
    `UPDATE tb_mastersheet SET payment_outcome = 'partial', needs_review = true,
            review_reason = 'payday says only part of the pay arrived'
      WHERE person_name = 'Baker Jones' AND stopped_on IS NULL`,
  );

  await patch(api, db, 'Felix Orr', 'Ironleaf', { monthlyAmount: 1450 });

  // PAY STATES, through the same route the page uses.
  await patch(api, db, 'Otto Fenn', 'Ironleaf', { overridePaid: true, paymentOutcome: 'confirmed' });
  await patch(api, db, 'Juno Park', 'Harbor Nine', { overridePaid: true, paymentOutcome: 'not_received' });
  await patch(api, db, 'Theo Brandt', 'Brightwell', { paymentOutcome: 'not_received' });
  await patch(api, db, 'Felix Orr', 'Ironleaf', { paymentOutcome: 'sent' });
  await patch(api, db, 'Mara Quill', 'Pinecrest', { overrideShouldBePaid: false });
  await patch(api, db, 'Kiran Vale', 'Brightwell', { overridePaid: true, paymentOutcome: 'confirmed' });
  await patch(api, db, 'Kiran Vale', 'Ironleaf', { paymentOutcome: 'not_received' });
}
