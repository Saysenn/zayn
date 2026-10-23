/**
 * PARK FRESH 4, written blind 2026-10-22. Never tune Diane to these; run only to measure.
 *
 * Parked / scheduled changes for a later month, the way a lazy UK admin
 * types them. Months are worked out from currentMonth(), so the set never
 * goes stale. Every write is checked in tb_scheduled_actions and tb_mastersheet.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { currentMonth } = require('../../v1/shared/presetMonth.helper');

export const READS = [];
export const WRITES = [];
export const PENDING = [];

// ---------- months ----------
const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const [Y, M] = currentMonth().split('-').map(Number);
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const ahead = (n) => { const d = new Date(Date.UTC(Y, M - 1 + n, 1)); return ym(d.getUTCFullYear(), d.getUTCMonth() + 1); };
const full = (k) => { const [y, m] = k.split('-').map(Number); return `${NAMES[m - 1]} ${y}`; };
const word = (k) => NAMES[Number(k.split('-')[1]) - 1].toLowerCase();
const m1 = ahead(1); const m2 = ahead(2); const m3 = ahead(3); const m4 = ahead(4);
const now = ahead(0);
// A month name already gone this year: read as next year.
const passedM = Math.max(1, M - 3);
const passedThis = ym(Y, passedM);
const passedNext = ym(Y + 1, passedM);
// "december" said as a follow-up: this year's unless we are in it.
const dec = M < 12 ? ym(Y, 12) : ym(Y + 1, 12);

const has = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const allOf = (...parts) => new RegExp(parts.map((p) => `(?=[\\s\\S]*${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`).join(''), 'i');

// ---------- db helpers ----------
const seedState = {};
const SHEET_COLS = ['monthly_amount', 'fee_percent', 'stopped_on', 'stopped_reason', 'review_monthly', 'end_on', 'preset_on', 'payable_days', 'currency', 'payment_method'];

const deal = async (db, person, company) => {
  const r = await db.query(
    `SELECT id, monthly_amount, fee_percent FROM tb_mastersheet
      WHERE lower(person_name) = $1 AND ($2::text IS NULL OR lower(btrim(company)) = $2) AND stopped_on IS NULL
      ORDER BY id LIMIT 1`, [person, company ?? null]);
  return r.rows[0];
};

// Numbers the parked call carries, ignoring ids and names.
const SKIP = new Set(['id', 'ids', 'person', 'target_ids', 'deal_id', 'dealId', 'row_id', 'rowId']);
const nums = (v, out = []) => {
  if (v == null) return out;
  if (typeof v === 'number') out.push(v);
  else if (typeof v === 'string') { if (/^\s*[+]?\d+(?:\.\d+)?\s*%?\s*$/.test(v)) out.push(Number(v.replace(/[%+\s]/g, ''))); }
  else if (Array.isArray(v)) v.forEach((x) => nums(x, out));
  else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!SKIP.has(k)) nums(x, out);
  return out;
};

// Parked rows for one person's deal (either call shape) and month.
const parkedRows = async (db, person, company, due, status = 'parked') => {
  const d = await deal(db, person, company);
  if (!d) return [];
  const r = await db.query(
    `SELECT * FROM tb_scheduled_actions
      WHERE status = $1 AND ($2::text IS NULL OR due_month = $2)
        AND ((args->>'id') = $3::text OR $4::int = ANY(target_ids) OR args::text ILIKE $5)`,
    [status, due, String(d.id), d.id, `%${person}%`]);
  return r.rows;
};

const all = (...checks) => async (db) => { for (const c of checks) { const why = await c(db); if (why) return why; } return null; };

const parkedCount = async (db) => (await db.query("SELECT count(*)::int n FROM tb_scheduled_actions WHERE status = 'parked'")).rows[0].n;
const noParks = async (db) => { const n = await parkedCount(db); return n === 0 ? null : `${n} rows parked, expected none`; };
const parksAre = (n) => async (db) => { const got = await parkedCount(db); return got === n ? null : `${got} rows parked, not ${n}`; };

const sheetSame = async (db) => {
  for (const s of seedState.sheet) {
    const r = (await db.query('SELECT monthly_amount, fee_percent FROM tb_mastersheet WHERE id = $1', [s.id])).rows[0];
    if (Number(r.monthly_amount) !== Number(s.monthly_amount)) return `${s.person_name} monthly moved to ${r.monthly_amount}`;
    if (Number(r.fee_percent ?? 0) !== Number(s.fee_percent ?? 0)) return `${s.person_name} fee moved to ${r.fee_percent}`;
  }
  return null;
};
const untouched = all(sheetSame, noParks);

// Everything except the named people's deals stays put.
const othersSame = (...people) => async (db) => {
  for (const s of seedState.sheet) {
    if (people.includes(s.person_name.toLowerCase())) continue;
    const r = (await db.query('SELECT monthly_amount, fee_percent FROM tb_mastersheet WHERE id = $1', [s.id])).rows[0];
    if (Number(r.monthly_amount) !== Number(s.monthly_amount) || Number(r.fee_percent ?? 0) !== Number(s.fee_percent ?? 0)) return `${s.person_name} changed`;
  }
  return null;
};

const amountIs = (person, n, company) => async (db) => {
  const d = await deal(db, person, company);
  return d && Number(d.monthly_amount) === n ? null : `${person} monthly ${d?.monthly_amount}, not ${n}`;
};

// One parked row for that person and month, carrying `value` (and never `not`).
const parked = (person, due, value, { company, not } = {}) => async (db) => {
  const rows = await parkedRows(db, person, company, due);
  if (rows.length !== 1) return `${person} ${due}: ${rows.length} parked rows, not 1`;
  const v = nums(rows[0].args);
  if (!v.includes(value)) return `${person} ${due}: parked args ${JSON.stringify(rows[0].args)} lack ${value}`;
  if (not != null && v.includes(not)) return `${person} ${due}: parked args carry ${not}`;
  return null;
};
const notParked = (person, due, company) => async (db) => {
  const rows = await parkedRows(db, person, company, due);
  return rows.length === 0 ? null : `${person} ${due} still has ${rows.length} parked rows`;
};

export async function extraSeed({ db }) {
  const cols = (await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'tb_mastersheet'")).rows.map((r) => r.column_name);
  seedState.cols = SHEET_COLS.filter((c) => cols.includes(c));
  seedState.sheet = (await db.query(`SELECT id, person_name, ${seedState.cols.join(', ')} FROM tb_mastersheet`)).rows;
}

const reset = {
  act: async ({ db }) => {
    const set = seedState.cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    for (const r of seedState.sheet) await db.query(`UPDATE tb_mastersheet SET ${set} WHERE id = $1`, [r.id, ...seedState.cols.map((c) => r[c])]);
    await db.query('DELETE FROM tb_scheduled_actions');
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [reset, ...turns] });

// ================= ONE MONTH =================
write('one later month, lazy', [
  { say: `cn u bump juno park to 750 for ${word(m2)} pls`, expect: { reply: has(full(m2)), db: untouched } },
  { say: 'yep', expect: { db: all(parked('juno park', m2, 750), parksAre(1), sheetSame) } },
]);

// ================= A RUN OF MONTHS =================
write('next three months, txt-speak', [
  { say: 'felix orr 1450 for the nxt 3 months, then back to normal', expect: { reply: allOf(full(m1), full(m2), full(m3)), db: untouched } },
  { say: 'ok go', expect: { db: all(parked('felix orr', m1, 1450), parked('felix orr', m2, 1450), parked('felix orr', m3, 1450), parksAre(3), sheetSame) } },
]);

// ================= A MONTH NAME ALREADY GONE =================
write('passed month name reads as next year', [
  { say: `otto fenn shuld be on 1650 in ${word(passedThis)}`, expect: { reply: allOf(full(passedNext)), db: untouched } },
  { say: 'yeah thats fine', expect: { db: all(parked('otto fenn', passedNext, 1650), notParked('otto fenn', passedThis), parksAre(1), sheetSame) } },
]);

// ================= NOW AND LATER IN ONE GO =================
write('now change plus later change', [
  { say: `mara quill goes to 1150 straight away and then 1250 from ${word(m2)}, just that month mind`, expect: { reply: has(full(m2)), db: untouched } },
  { say: 'yes', expect: { db: all(amountIs('mara quill', 1150), parked('mara quill', m2, 1250, { not: 1150 }), parksAre(1), othersSame('mara quill')) } },
]);

// ================= FOLLOW-UP: SAME FOR DECEMBER =================
write('follow-up, same for december', [
  { say: `theo brandt 820 in ${word(m1)}`, expect: { reply: has(full(m1)), db: untouched } },
  { say: 'yes', expect: { db: all(parked('theo brandt', m1, 820), parksAre(1), sheetSame) } },
  { say: 'and do the same for december', expect: { reply: has(full(dec)), db: parksAre(1) } },
  { say: 'yes', expect: { db: all(parked('theo brandt', m1, 820), parked('theo brandt', dec, 820), parksAre(2), sheetSame) } },
]);

// ================= CORRECTION BEFORE YES =================
write('amount corrected before yes', [
  { say: `ines calder 4200 for ${word(m3)}`, expect: { reply: has(full(m3)), db: untouched } },
  { say: 'actually make it 4500 sorry', expect: { reply: /4,?500/, db: untouched } },
  { say: 'yes', expect: { db: all(parked('ines calder', m3, 4500, { not: 4200 }), parksAre(1), sheetSame) } },
]);

// ================= TWO PEOPLE =================
write('two people, add 100 each', [
  { say: `baker jones n karin vole both up 100 in ${word(m2)}, only that month`, expect: { reply: has(full(m2)), db: untouched } },
  { say: 'go ahead', expect: { db: all(parked('baker jones', m2, 2300), parked('karin vole', m2, 1300), parksAre(2), sheetSame) } },
]);

// ================= FEE, FINAL VALUE =================
write('fee plus two stored as final value', [
  { say: `kiran vale brightwell fee +2 for ${word(m1)} only`, expect: { reply: has(full(m1)), db: untouched } },
  { say: 'yes', expect: { db: all(parked('kiran vale', m1, 7, { company: 'brightwell', not: 2 }), sheetSame) } },
]);

// ================= ALREADY IN PLACE =================
write('value already in place parks nothing', [
  { say: `put otto fenn on 1500 for ${word(m2)}`, expect: { reply: /already|no change|nothing to/i, db: untouched } },
]);

// ================= REFUSALS =================
write('this month cannot be parked', [
  { say: `park juno 650 for ${word(now)}`, expect: { reply: /this month|current month|can(?:no|')t|now/i, db: untouched } },
]);
write('more than 12 months refused', [
  { say: 'felix orr 1400 every month for the next 18 months', expect: { reply: /12/, db: untouched } },
]);
write('company close never parked', [
  { say: `close pinecrest in ${word(m2)} pls, schedule it`, expect: { db: noParks } },
]);

// ================= SUPERSEDE =================
write('parking same month again supersedes', [
  { say: `juno park 700 in ${word(m3)}`, expect: { db: untouched } },
  { say: 'yes', expect: { db: parked('juno park', m3, 700) } },
  { say: `no wait juno shld be 720 for ${word(m3)} not 700`, expect: { db: parked('juno park', m3, 700) } },
  { say: 'yes', expect: { db: all(parked('juno park', m3, 720, { not: 700 }), parksAre(1), async (db) => ((await parkedRows(db, 'juno park', null, m3, 'superseded')).length === 1 ? null : 'old row not superseded'), sheetSame) } },
]);

// ================= CANCEL BY NAME =================
write('cancel by name previews first', [
  { say: `theo brandt 900 for ${word(m2)}`, expect: { db: untouched } },
  { say: 'yes', expect: { db: parked('theo brandt', m2, 900) } },
  { say: `scrap theos ${word(m2)} change, not happening now`, expect: { reply: has(full(m2)), db: parked('theo brandt', m2, 900) } },
  { say: 'yes', expect: { db: all(notParked('theo brandt', m2), async (db) => {
    const rows = await parkedRows(db, 'theo brandt', null, m2, 'superseded');
    return rows.length === 1 && rows[0].outcome === 'Cancelled.' ? null : `cancelled row: ${JSON.stringify(rows.map((r) => r.outcome))}`;
  }, sheetSame) } },
]);

// ================= LIST =================
write('list what is parked changes nothing', [
  { say: `karin vole 1350 for ${word(m1)} and felix orr 1500 for ${word(m3)}`, expect: { db: untouched } },
  { say: 'yes', expect: { db: all(parked('karin vole', m1, 1350), parked('felix orr', m3, 1500), parksAre(2)) } },
  { say: 'wats lined up for the comin months', expect: { reply: allOf('Karin', 'Felix', full(m1), full(m3)), db: all(parked('karin vole', m1, 1350), parked('felix orr', m3, 1500), parksAre(2), sheetSame) } },
]);

// ================= AUTO MODE: a park still previews =================
write('auto mode still previews a park', [
  { say: `otto 1600 for ${word(m4)}`, expect: { reply: has(full(m4)), db: untouched } },
  { say: 'yes', expect: { db: all(parked('otto fenn', m4, 1600), parksAre(1), sheetSame) } },
], true);
