/**
 * PARK FRESH 5, written blind 2026-10-22. Never tune Diane to these; run only to measure.
 *
 * Changes parked for a later month: nothing moves on the sheet now, a yes
 * saves one tb_scheduled_actions row per month (status 'parked'), with the
 * FINAL value. Every month is relative to currentMonth(), so the set never
 * goes stale. Every write is checked in the database: the scheduled rows
 * AND that the sheet did not change now.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { currentMonth } = require('../../v1/shared/presetMonth.helper');

export const READS = [];
export const WRITES = [];
export const PENDING = [];

// ---------- months ----------
const [thisYear, thisPart] = currentMonth().split('-').map(Number);
const at = (offset) => new Date(Date.UTC(thisYear, thisPart - 1 + offset, 1));
const ym = (offset) => { const d = at(offset); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const full = (offset) => at(offset).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
const yearOf = (offset) => at(offset).getUTCFullYear();
const short = (offset) => full(offset).slice(0, 3).toLowerCase();
const lower = (offset) => full(offset).toLowerCase();
// "November 2026", the way every preview must name a month.
const named = (offset) => new RegExp(`${full(offset)},?\\s+${yearOf(offset)}`, 'i');

// A month name that went by two months ago. Said plainly, it means the next
// one, twelve months on. When it went by THIS year she says so first.
const PASSED_BACK = 2;
const passedThisYear = at(-PASSED_BACK).getUTCFullYear() === thisYear;

// ---------- seed snapshot ----------
const seedState = {};
const dealId = (person, company) => {
  const r = seedState.rows.find((x) => x.person_name === person && (!company || x.company === company));
  if (!r) throw new Error(`no seeded deal for ${person} ${company ?? ''}`);
  return r.id;
};

export async function extraSeed({ db }) {
  seedState.rows = (await db.query('SELECT id, person_name, company, monthly_amount, fee_percent, stopped_on FROM tb_mastersheet')).rows;
  seedState.status = (await db.query('SELECT name, status, closed_on FROM tb_companies')).rows;
  seedState.liveIds = seedState.rows.filter((r) => r.stopped_on == null).map((r) => r.id);
}

const reset = {
  act: async ({ db }) => {
    for (const r of seedState.rows) {
      await db.query('UPDATE tb_mastersheet SET monthly_amount = $2, fee_percent = $3 WHERE id = $1', [r.id, r.monthly_amount, r.fee_percent]);
    }
    await db.query('UPDATE tb_mastersheet SET stopped_on = NULL, stopped_reason = NULL WHERE id = ANY($1::int[]) AND stopped_on IS NOT NULL', [seedState.liveIds]);
    for (const c of seedState.status) await db.query('UPDATE tb_companies SET status = $2, closed_on = $3 WHERE name = $1', [c.name, c.status, c.closed_on]);
    await db.query("UPDATE tb_companies SET status = 'active', closed_on = NULL WHERE NOT (name = ANY($1::text[]))", [seedState.status.map((c) => c.name)]);
    await db.query('DELETE FROM tb_scheduled_actions');
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [reset, ...turns] });

// ---------- checks ----------
const all = (...checks) => async (db) => { for (const c of checks) { const why = await c(db); if (why) return why; } return null; };
const num = (v) => (v == null || v === '' ? null : Number(v));

const AMOUNT = /amount|monthly|salary|pay/i;
const FEE = /fee/i;

// Does this args object carry `n` for the field? Accepts {monthlyAmount: n},
// {changes: {monthly_amount: n}} and {field: 'monthlyAmount', value: n}.
const carries = (node, field, n) => {
  if (node == null || typeof node !== 'object') return false;
  const entries = Object.entries(node);
  for (const [k, v] of entries) if (field.test(k) && (typeof v === 'number' || typeof v === 'string') && num(v) === n) return true;
  const namesField = entries.some(([, v]) => typeof v === 'string' && field.test(v));
  if (namesField && entries.some(([, v]) => (typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v))) && num(v) === n)) return true;
  return entries.some(([, v]) => carries(v, field, n));
};

// Is this row about the deal? A deal change names it by args.id or
// target_ids; a fee may go through update_person by the person's name.
const aims = (row, id, person, allowPerson) => {
  const a = row.args || {};
  if (row.tool === 'update_master_sheet_row' && num(a.id) === id) return true;
  if ((row.target_ids || []).map(Number).includes(id) && row.tool !== 'update_person') return true;
  if (allowPerson && row.tool === 'update_person' && JSON.stringify(a).toLowerCase().includes(person.split(' ')[0].toLowerCase())) return true;
  return false;
};

const rows = async (db) => (await db.query('SELECT id, due_month, tool, args, target_ids, status FROM tb_scheduled_actions')).rows;

const deal = (person, company) => ({ person, company, field: AMOUNT, allowPerson: false });
const fee = (person, company) => ({ person, company, field: FEE, allowPerson: true });

const matching = (list, d, month, n, status) => {
  const id = dealId(d.person, d.company);
  return list.filter((r) => r.status === status && r.due_month === ym(month) && aims(r, id, d.person, d.allowPerson) && carries(r.args, d.field, n));
};

const parked = (d, month, n) => async (db) => {
  const got = matching(await rows(db), d, month, n, 'parked');
  return got.length === 1 ? null : `${got.length} parked rows for ${d.person} ${ym(month)} at ${n}, not 1`;
};
const notParked = (d, month, n) => async (db) => {
  const got = matching(await rows(db), d, month, n, 'parked');
  return got.length === 0 ? null : `${d.person} ${ym(month)} still parked at ${n}`;
};
const superseded = (d, month, n) => async (db) => {
  const got = matching(await rows(db), d, month, n, 'superseded');
  return got.length >= 1 ? null : `no superseded row for ${d.person} ${ym(month)} at ${n}`;
};
const parkedCount = (n) => async (db) => {
  const got = (await rows(db)).filter((r) => r.status === 'parked').length;
  return got === n ? null : `${got} parked rows, not ${n}`;
};
const nothingParked = parkedCount(0);
// No parked row anywhere carries this value for the deal (any month).
const neverParks = (d, n) => async (db) => {
  const id = dealId(d.person, d.company);
  const bad = (await rows(db)).filter((r) => r.status === 'parked' && aims(r, id, d.person, d.allowPerson) && carries(r.args, d.field, n));
  return bad.length === 0 ? null : `${d.person} has a parked row carrying ${n}`;
};

// The sheet now: every seeded amount and fee as it was, except `moved`.
const sheetSame = (...moved) => async (db) => {
  const skip = new Set(moved.map((m) => dealId(m.person, m.company)));
  const now = (await db.query('SELECT id, monthly_amount, fee_percent FROM tb_mastersheet')).rows;
  for (const s of seedState.rows) {
    if (skip.has(s.id)) continue;
    const r = now.find((x) => x.id === s.id);
    if (!r) return `deal ${s.id} (${s.person_name}) is gone`;
    if (num(r.monthly_amount) !== num(s.monthly_amount)) return `${s.person_name} ${s.company} amount now ${r.monthly_amount}, was ${s.monthly_amount}`;
    if (num(r.fee_percent) !== num(s.fee_percent)) return `${s.person_name} ${s.company} fee now ${r.fee_percent}, was ${s.fee_percent}`;
  }
  return null;
};
const amountNow = (d, n) => async (db) => {
  const r = (await db.query('SELECT monthly_amount FROM tb_mastersheet WHERE id = $1', [dealId(d.person, d.company)])).rows[0];
  return num(r?.monthly_amount) === n ? null : `${d.person} amount now ${r?.monthly_amount}, not ${n}`;
};
const companyUntouched = async (db) => {
  for (const c of seedState.status) {
    const s = (await db.query('SELECT status FROM tb_companies WHERE name = $1', [c.name])).rows[0]?.status;
    if (s !== c.status) return `${c.name} status moved to ${s}`;
  }
  const n = (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE stopped_on IS NULL')).rows[0].n;
  return n === seedState.liveIds.length ? null : `live deals ${n}, not ${seedState.liveIds.length}`;
};
const quiet = all(nothingParked, sheetSame());

// ---------- people ----------
const OTTO = deal('Otto Fenn', 'Ironleaf');
const MARA = deal('Mara Quill', 'Pinecrest');
const THEO = deal('Theo Brandt', 'Brightwell');
const JUNO = deal('Juno Park', 'Harbor Nine');
const FELIX = deal('Felix Orr', 'Ironleaf');
const BAKER = deal('Baker Jones', 'Pinecrest');
const KARIN = deal('Karin Vole', 'Pinecrest');
const INES = deal('Ines Calder', 'Ironleaf');
const KIRAN_FEE = fee('Kiran Vale', 'Brightwell');

// ================= PLAIN PARK, LAZY =================
write('lazy park two months out', [
  { say: `otto fenn at ironleaf shud go up to 1650 from ${lower(2)} pls not before`, expect: { reply: named(2), db: quiet } },
  { say: 'yep thats it', expect: { db: all(parked(OTTO, 2, 1650), parkedCount(1), sheetSame()) } },
]);

// ================= A MONTH NAME THAT HAS GONE BY =================
write('passed month name is next year', [
  {
    say: `can u put mara quill on 1175 in ${lower(-PASSED_BACK)}`,
    expect: { reply: passedThisYear ? new RegExp(`(?=[\\s\\S]*(?:passed|gone|already|been))(?=[\\s\\S]*${full(12 - PASSED_BACK)},?\\s+${yearOf(12 - PASSED_BACK)})`, 'i') : named(12 - PASSED_BACK), db: quiet },
  },
  { say: 'ok fine do that', expect: { db: all(parked(MARA, 12 - PASSED_BACK, 1175), parkedCount(1), sheetSame()) } },
]);

// ================= NOW AND LATER IN ONE BREATH =================
write('now change plus later change', [
  { say: `theo brandt brightwell make him 750 straight away then 800 from ${lower(3)} onwards`, expect: { reply: named(3), db: quiet } },
  { say: 'yes', expect: { db: all(amountNow(THEO, 750), parked(THEO, 3, 800), neverParks(THEO, 750), parkedCount(1), sheetSame(THEO)) } },
]);

// ================= FOLLOW-UP: SAME AGAIN =================
write('same again for another month', [
  { say: `juno park 640 for ${short(1)}`, expect: { reply: named(1), db: quiet } },
  { say: 'yh go', expect: { db: all(parked(JUNO, 1, 640), parkedCount(1), sheetSame()) } },
  { say: `same again for ${lower(2)}`, expect: { reply: named(2), db: all(parkedCount(1), sheetSame()) } },
  { say: 'yes', expect: { db: all(parked(JUNO, 1, 640), parked(JUNO, 2, 640), parkedCount(2), sheetSame()) } },
]);

// ================= AMOUNT CORRECTED BEFORE THE YES =================
write('amount corrected before yes', [
  { say: `felix orr up to 1380 in ${lower(2)}`, expect: { reply: named(2), db: quiet } },
  { say: 'hang on actually make it 1420 sorry', expect: { db: quiet } },
  { say: 'yes', expect: { db: all(parked(FELIX, 2, 1420), notParked(FELIX, 2, 1380), parkedCount(1), sheetSame()) } },
]);

// ================= TWO PEOPLE AT ONCE =================
write('two people plus 100 next month', [
  { say: `baker jones n karin vole at pinecrest both +100 from ${lower(1)}`, expect: { reply: named(1), db: quiet } },
  { say: 'go on then', expect: { db: all(parked(BAKER, 1, 2300), parked(KARIN, 1, 1300), parkedCount(2), sheetSame()) } },
]);

// ================= CANCEL BY NAME =================
write('cancel a parked change by name', [
  { say: `ines calder 4200 aed from ${lower(1)} pls`, expect: { reply: named(1), db: quiet } },
  { say: 'yes', expect: { db: all(parked(INES, 1, 4200), parkedCount(1), sheetSame()) } },
  { say: 'scrap the ines one i parked, client changed their mind', expect: { db: all(parked(INES, 1, 4200), parkedCount(1), sheetSame()) } },
  { say: 'yes bin it', expect: { db: all(superseded(INES, 1, 4200), nothingParked, sheetSame()) } },
]);

// ================= WHAT IS LINED UP =================
write('casual listing changes nothing', [
  { say: `otto 1600 in ${short(1)} and felix 1350 in ${lower(2)}`, expect: { reply: /(?=[\s\S]*Otto)(?=[\s\S]*Felix)/i, db: quiet } },
  { say: 'ye', expect: { db: all(parked(OTTO, 1, 1600), parked(FELIX, 2, 1350), parkedCount(2), sheetSame()) } },
  {
    say: 'wot have we got lined up then for the next few months',
    expect: { reply: new RegExp(`(?=[\\s\\S]*Otto)(?=[\\s\\S]*Felix)(?=[\\s\\S]*${full(1)})(?=[\\s\\S]*${full(2)})`, 'i'), db: all(parked(OTTO, 1, 1600), parked(FELIX, 2, 1350), parkedCount(2), sheetSame()) },
  },
]);

// ================= AUTO MODE STILL PREVIEWS A PARK =================
write('auto mode: park still shows first', [
  { say: `pinecrest mara quill 1150 from ${lower(4)}`, expect: { reply: named(4), db: quiet } },
  { say: 'yes', expect: { db: all(parked(MARA, 4, 1150), parkedCount(1), sheetSame()) } },
], true);

// ================= A NO SAVES NOTHING =================
write('no saves nothing', [
  { say: `theo brandt to 725 from ${lower(1)}`, expect: { reply: named(1), db: quiet } },
  { say: 'nah leave it for now, il come back to it', expect: { db: quiet } },
]);

// ================= FEE PARK =================
write('fee change parked', [
  { say: `kirans fee on brightwell, bump it up 2 from ${lower(2)}`, expect: { reply: named(2), db: quiet } },
  { say: 'yes', expect: { db: all(parked(KIRAN_FEE, 2, 7), neverParks(KIRAN_FEE, 2), parkedCount(1), sheetSame()) } },
]);

// ================= NEXT N MONTHS =================
write('next 3 months', [
  { say: 'give juno park 700 a month for the next 3 months then we review', expect: { reply: new RegExp(`(?=[\\s\\S]*${full(1)})(?=[\\s\\S]*${full(2)})(?=[\\s\\S]*${full(3)})`, 'i'), db: quiet } },
  { say: 'yes', expect: { db: all(parked(JUNO, 1, 700), parked(JUNO, 2, 700), parked(JUNO, 3, 700), parkedCount(3), sheetSame()) } },
]);

// ================= OVER TWELVE MONTHS =================
write('more than 12 months refused', [
  { say: 'stick otto fenn on 1700 for the next 14 months', expect: { reply: /\b12\b|twelve|a year/i, db: quiet } },
]);

// ================= PARK THE SAME AGAIN SUPERSEDES =================
write('re-park same month replaces the old one', [
  { say: `baker jones 2250 from ${lower(2)}`, expect: { reply: named(2), db: quiet } },
  { say: 'yes', expect: { db: all(parked(BAKER, 2, 2250), parkedCount(1), sheetSame()) } },
  { say: `change of plan bakers ${short(2)} one shud be 2275 not 2250`, expect: { db: all(parked(BAKER, 2, 2250), parkedCount(1), sheetSame()) } },
  { say: 'yes', expect: { db: all(parked(BAKER, 2, 2275), superseded(BAKER, 2, 2250), parkedCount(1), sheetSame()) } },
]);

// ================= CHANGE OF MIND ON THE MONTH =================
write('month changed before yes', [
  { say: `karin vole 1250 from ${lower(1)}.. wait no make that ${lower(2)} her contract starts then`, expect: { reply: named(2), db: quiet } },
  { say: 'yes', expect: { db: all(parked(KARIN, 2, 1250), notParked(KARIN, 1, 1250), parkedCount(1), sheetSame()) } },
]);

// ================= A COMPANY CLOSE IS NEVER PARKED =================
write('close is never parked', [
  { say: `close quarry lane in ${lower(2)} when the accountant signs off`, expect: { db: all(quiet, companyUntouched) } },
  { say: 'yes', expect: { db: all(quiet, companyUntouched) } },
]);
