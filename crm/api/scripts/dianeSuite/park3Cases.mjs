/**
 * PARK FRESH 3, written blind 2026-10-22. Never tune Diane to these; run only to measure.
 *
 * Parked / scheduled work, the way a lazy UK admin types it. A change asked
 * for later changes nothing now, previews every month in full, and on yes
 * lands one 'parked' row per month in tb_scheduled_actions. Every write is
 * checked in the database: the sheet is unchanged unless a now-change was
 * asked, and the queue holds exactly what was agreed.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { currentMonth } = require('../../v1/shared/presetMonth.helper');

export const READS = [];
export const WRITES = [];
export const PENDING = [];

// ================= MONTHS, relative to the business month =================
const [Y, M] = currentMonth().split('-').map(Number);
const at = (n) => new Date(Date.UTC(Y, M - 1 + n, 1));
const mon = (n) => { const d = at(n); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const full = (n) => { const d = at(n); return `${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`; };
const word = (n) => at(n).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }).toLowerCase();
const short = (n) => word(n).slice(0, 3);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Every month named in full, in any order.
const allMonths = (...ns) => new RegExp(ns.map((n) => `(?=[\\s\\S]*${esc(full(n))})`).join(''), 'i');

// ================= SEED STATE =================
const seedState = {};
const IGNORE = /updated|created|modified|version|overridden|changed/i;

export async function extraSeed({ db }) {
  seedState.sheet = (await db.query('SELECT to_jsonb(m) j FROM tb_mastersheet m ORDER BY id')).rows.map((r) => r.j);
  seedState.cols = (await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'tb_mastersheet' AND column_name <> 'id' AND is_generated = 'NEVER' AND is_identity = 'NO'",
  )).rows.map((r) => r.column_name);
  seedState.companies = (await db.query('SELECT name, status, closed_on FROM tb_companies')).rows;
}

const deal = (person, company) => {
  const d = seedState.sheet.find((r) => r.person_name === person && (!company || String(r.company).trim() === company) && !r.stopped_on);
  if (!d) throw new Error(`no seed deal ${person} ${company ?? ''}`);
  return d;
};
const dealsOf = (person) => seedState.sheet.filter((r) => r.person_name === person && !r.stopped_on);

// ================= CHECKS =================
const all = (...checks) => async (db) => { for (const c of checks) { const why = await c(db); if (why) return why; } return null; };
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const sheetDiff = async (db) => {
  const now = (await db.query('SELECT to_jsonb(m) j FROM tb_mastersheet m ORDER BY id')).rows.map((r) => r.j);
  const out = {};
  if (now.length !== seedState.sheet.length) out.count = [`${now.length} rows, not ${seedState.sheet.length}`];
  for (const was of seedState.sheet) {
    const is = now.find((r) => r.id === was.id);
    if (!is) { out[was.id] = ['deleted']; continue; }
    const keys = Object.keys(was).filter((k) => !IGNORE.test(k) && !same(was[k], is[k]));
    if (keys.length) out[was.id] = keys.map((k) => ({ k, v: is[k] }));
  }
  return out;
};
const sheetUntouched = async (db) => {
  const d = await sheetDiff(db);
  const ids = Object.keys(d);
  return ids.length ? `sheet moved: ${ids.map((id) => `${id}:${JSON.stringify(d[id])}`).join('; ')}` : null;
};
// Only this deal moved now, and some field of it holds the value.
const nowChanged = (pick, v) => async (db) => {
  const target = pick();
  const d = await sheetDiff(db);
  const others = Object.keys(d).filter((id) => Number(id) !== target.id);
  if (others.length) return `other rows moved: ${others.join(',')}`;
  const mine = d[target.id];
  if (!mine || mine === 'deleted' || !mine.some((x) => Number(x.v) === v)) return `${target.person_name} not changed to ${v} now`;
  return null;
};

const companiesUntouched = async (db) => {
  for (const c of seedState.companies) {
    const r = (await db.query('SELECT status FROM tb_companies WHERE name = $1', [c.name])).rows[0];
    if (r?.status !== c.status) return `${c.name} status ${r?.status}, not ${c.status}`;
  }
  const closed = (await db.query("SELECT count(*)::int n FROM tb_companies WHERE status = 'closed' AND NOT (name = ANY($1::text[]))", [seedState.companies.map((c) => c.name)])).rows[0].n;
  return closed ? `${closed} new closed companies` : null;
};

const queue = async (db) => (await db.query('SELECT * FROM tb_scheduled_actions ORDER BY id')).rows;
const queueEmpty = async (db) => { const n = (await queue(db)).length; return n ? `${n} rows in tb_scheduled_actions, not 0` : null; };

const hasValue = (x, v) => {
  if (x == null) return false;
  if (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x)))) return Number(x) === v;
  if (Array.isArray(x)) return x.some((y) => hasValue(y, v));
  if (typeof x === 'object') return Object.values(x).some((y) => hasValue(y, v));
  return false;
};
const isPerson = (got, name) => {
  const g = String(got ?? '').toLowerCase();
  return name.toLowerCase().split(' ').every((part) => g.includes(part));
};
// A row covers this deal: deal shape (args.id) or person shape (args.person).
const covers = (r, d, personLevel) => {
  if (r.tool === 'update_master_sheet_row') return Number(r.args?.id) === d.id;
  if (personLevel && r.tool === 'update_person') return isPerson(r.args?.person, d.person_name);
  return false;
};

/**
 * Exactly what was agreed is parked: each { deals, months, v } has a parked
 * row per month for every deal (or one person row per month), with the
 * FINAL value, and no other row is parked. `personLevel` accepts the
 * update_person shape (a fee or add-on % across someone's deals).
 */
const parked = (specs, personLevel = false) => async (db) => {
  const rows = (await queue(db)).filter((r) => r.status === 'parked');
  const used = new Set();
  for (const s of specs) {
    for (const d of s.deals()) {
      for (const n of s.months) {
        const hit = rows.find((r) => r.due_month === mon(n) && covers(r, d, personLevel) && hasValue(r.args, s.v));
        if (!hit) return `no parked row for ${d.person_name} ${d.company} ${mon(n)} at ${s.v}`;
        used.add(hit.id);
      }
    }
  }
  const extra = rows.filter((r) => !used.has(r.id));
  return extra.length ? `extra parked rows: ${extra.map((r) => `${r.due_month} ${r.tool} ${JSON.stringify(r.args)}`).join('; ')}` : null;
};
const noParkedValue = (v) => async (db) => {
  const bad = (await queue(db)).filter((r) => r.status === 'parked' && hasValue(r.args, v));
  return bad.length ? `parked a relative value ${v}` : null;
};

// ================= RESET =================
const reset = {
  act: async ({ db }) => {
    const cols = seedState.cols;
    const set = cols.map((c) => `"${c}" = r."${c}"`).join(', ');
    for (const row of seedState.sheet) {
      await db.query(`UPDATE tb_mastersheet t SET ${set} FROM jsonb_populate_record(NULL::tb_mastersheet, $1::jsonb) r WHERE t.id = $2`, [JSON.stringify(row), row.id]);
    }
    await db.query('DELETE FROM tb_mastersheet WHERE NOT (id = ANY($1::int[]))', [seedState.sheet.map((r) => r.id)]);
    for (const c of seedState.companies) await db.query('UPDATE tb_companies SET status = $2, closed_on = $3 WHERE name = $1', [c.name, c.status, c.closed_on]);
    await db.query('DELETE FROM tb_scheduled_actions');
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [reset, ...turns] });
const nothingYet = all(sheetUntouched, queueEmpty);

// ================= ONE MONTH =================
write('one later month, lazy typo', [
  { say: `junos pay shud go to 650 in ${word(2)}`, expect: { reply: allMonths(2), db: nothingYet } },
  { say: 'yep', expect: { db: all(sheetUntouched, parked([{ deals: () => [deal('Juno Park')], months: [2], v: 650 }])) } },
]);

write('fee add on is final, one deal', [
  { say: `kiran vale brightwell fee, add 3% on top in ${short(3)}`, expect: { reply: allMonths(3), db: nothingYet } },
  { say: 'ok do it', expect: { db: all(sheetUntouched, parked([{ deals: () => [deal('Kiran Vale', 'Brightwell')], months: [3], v: 8 }], true)) } },
]);

// ================= SEVERAL MONTHS =================
write('next 3 months, AED', [
  { say: 'ines calder 4400 for the next 3 months pls', expect: { reply: allMonths(1, 2, 3), db: nothingYet } },
  { say: 'yes', expect: { db: all(sheetUntouched, parked([{ deals: () => [deal('Ines Calder')], months: [1, 2, 3], v: 4400 }])) } },
]);

write('relative bump over 2 months stays final', [
  { say: 'bump theo brandt +50 for the next 2 months', expect: { reply: allMonths(1, 2), noReply: /\b800\b/, db: nothingYet } },
  { say: 'go', expect: { db: all(sheetUntouched, noParkedValue(800), parked([{ deals: () => [deal('Theo Brandt')], months: [1, 2], v: 750 }])) } },
]);

write('two people, one month', [
  { say: `mara quill n karin vole both on 1250 from ${word(1)}, just that month`, expect: { reply: allMonths(1), db: nothingYet } },
  { say: 'yes', expect: { db: all(sheetUntouched, parked([{ deals: () => [deal('Mara Quill')], months: [1], v: 1250 }, { deals: () => [deal('Karin Vole')], months: [1], v: 1250 }])) } },
]);

write('person fee across all deals, then stretch it', [
  { say: `kiran vales fee to 6% on all her deals from ${word(2)} for 3 months`, expect: { reply: allMonths(2, 3, 4), db: nothingYet } },
  { say: 'oh n make it 4 months actually', expect: { reply: allMonths(2, 3, 4, 5), db: nothingYet } },
  { say: 'yes', expect: { db: all(sheetUntouched, parked([{ deals: () => dealsOf('Kiran Vale'), months: [2, 3, 4, 5], v: 6 }], true)) } },
]);

// ================= NOTHING TO PARK / REFUSED =================
write('value already in place parks nothing', [
  { say: `set felix orr to 1300 in ${word(2)}`, expect: { reply: /already/i, db: nothingYet } },
]);

write('this month cannot be parked', [
  { say: `park baker jones on 2300 for ${word(0)}`, expect: { reply: /this month|right now|\bnow\b|can'?t|cannot/i, db: nothingYet } },
]);

write('past month refused', [
  { say: `put mara on 1150 for ${word(-2)} pls`, expect: { reply: /past|passed|gone|can'?t|cannot|already/i, db: nothingYet } },
]);

write('more than 12 months refused', [
  { say: 'karin vole to 1300 for the next 18 months', expect: { reply: /\b12\b|twelve/i, db: nothingYet } },
]);

write('a close is never scheduled', [
  { say: 'close pinecrest at the end of the month', expect: { reply: /can'?t|cannot|not able|unable|schedul/i, db: all(nothingYet, companiesUntouched) } },
]);

// ================= SUPERSEDE / CANCEL =================
write('park the same month again supersedes', [
  { say: `juno park 700 in ${word(3)}`, expect: { reply: allMonths(3), db: nothingYet } },
  { say: 'yes', expect: { db: all(sheetUntouched, parked([{ deals: () => [deal('Juno Park')], months: [3], v: 700 }])) } },
  { say: `actually make juno 720 for ${word(3)} instead`, expect: { reply: allMonths(3), db: all(sheetUntouched, parked([{ deals: () => [deal('Juno Park')], months: [3], v: 700 }])) } },
  {
    say: 'yes',
    expect: {
      db: all(sheetUntouched, parked([{ deals: () => [deal('Juno Park')], months: [3], v: 720 }]), async (db) => {
        const old = (await queue(db)).filter((r) => r.due_month === mon(3) && hasValue(r.args, 700));
        return old.length === 1 && old[0].status === 'superseded' ? null : `old 700 row not superseded (${old.map((r) => r.status).join(',') || 'missing'})`;
      }),
    },
  },
]);

write('cancel one parked month', [
  { say: `ines to 4100 for ${word(1)} and ${word(2)}`, expect: { reply: allMonths(1, 2), db: nothingYet } },
  { say: 'yes', expect: { db: all(sheetUntouched, parked([{ deals: () => [deal('Ines Calder')], months: [1, 2], v: 4100 }])) } },
  { say: `scrap the ${short(2)} one for ines`, expect: { reply: allMonths(2), db: all(sheetUntouched, parked([{ deals: () => [deal('Ines Calder')], months: [1, 2], v: 4100 }])) } },
  {
    say: 'yes cancel it',
    expect: {
      db: all(sheetUntouched, parked([{ deals: () => [deal('Ines Calder')], months: [1], v: 4100 }]), async (db) => {
        const r = (await queue(db)).find((x) => x.due_month === mon(2));
        return r?.status === 'superseded' && r.outcome === 'Cancelled.' ? null : `${mon(2)} row ${r?.status} / ${r?.outcome}`;
      }),
    },
  },
]);

// ================= NOW + LATER =================
write('now change plus later change in one go', [
  { say: `felix orr to 1350 now and then 1500 from ${word(1)} for 2 months`, expect: { reply: allMonths(1, 2), db: nothingYet } },
  { say: 'yes both', expect: { db: all(nowChanged(() => deal('Felix Orr'), 1350), parked([{ deals: () => [deal('Felix Orr')], months: [1, 2], v: 1500 }])) } },
]);

// ================= LISTING =================
write('listing parked work changes nothing', [
  {
    act: async ({ db }) => {
      const j = deal('Juno Park');
      const t = deal('Theo Brandt');
      await db.query("INSERT INTO tb_scheduled_actions (due_month, tool, args, target_ids, said) VALUES ($1, 'update_master_sheet_row', $2, $3, $4), ($5, 'update_master_sheet_row', $6, $7, $8)",
        [mon(2), JSON.stringify({ id: j.id, monthlyAmount: 980 }), [j.id], `juno park to 980 in ${word(2)}`,
          mon(4), JSON.stringify({ id: t.id, monthlyAmount: 760 }), [t.id], `theo to 760 in ${word(4)}`]);
    },
  },
  {
    say: 'whats lined up for the next few months?',
    expect: {
      reply: new RegExp(`(?=[\\s\\S]*Juno)(?=[\\s\\S]*Theo)(?=[\\s\\S]*${esc(full(2))})(?=[\\s\\S]*${esc(full(4))})`, 'i'),
      db: all(sheetUntouched, async (db) => {
        const rows = await queue(db);
        return rows.length === 2 && rows.every((r) => r.status === 'parked') ? null : `queue moved: ${rows.map((r) => r.status).join(',')}`;
      }),
    },
  },
]);

// ================= AUTO MODE: a park still previews =================
write('auto mode: a park still shows first', [
  { say: `theo brandt to 820 in ${word(4)}`, expect: { reply: allMonths(4), db: nothingYet } },
  { say: 'yes', expect: { db: all(sheetUntouched, parked([{ deals: () => [deal('Theo Brandt')], months: [4], v: 820 }])) } },
], true);
