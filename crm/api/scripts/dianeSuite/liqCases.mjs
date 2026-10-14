/**
 * THE LIQUIDATIONS PAGE, FLAGS AND RATES. SUITE_SET=liq.
 *
 * His ask 2026-10-13: Diane does on these three what the pages do, as
 * efficiently and as safely as the master sheet. Plain asks, a messy order
 * across all three, bulk, undo, typos, a day in words, a rate typed upside
 * down, and the refusals (a company goes on the page by its status only).
 *
 * Every write case starts from the same state (`reset`), and every check
 * reads the database: what she SAYS is checked against what LANDED.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { currentDay } = require('../../v1/shared/presetMonth.helper');
const { dayFrom } = require('../../v1/shared/dayWords.helper');

export const READS = [];
export const WRITES = [];
export const PENDING = [];

const IN_LIQ = ['quarry lane', 'pinecrest'];
const DOCS_ROOT = process.env.LIQUIDATION_DOCS_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '../../storage/liquidations');
const seedState = {};

const liq = async (db, key) => (await db.query('SELECT * FROM tb_liquidations WHERE company_key = $1', [key])).rows[0];
const comms = async (db, key) => (await db.query(
  'SELECT c.body, c.said_on::text AS said_on FROM tb_liquidation_comms c JOIN tb_liquidations l ON l.id = c.liquidation_id WHERE l.company_key = $1', [key],
)).rows;
const status = async (db, name) => (await db.query('SELECT status FROM tb_companies WHERE lower(name) = $1', [name])).rows[0]?.status ?? 'active';
const flagsOf = async (db, person) => (await db.query(
  'SELECT c.group_name, c.status FROM tb_concerns c WHERE c.person_id = (SELECT person_id FROM tb_mastersheet WHERE person_name = $1 LIMIT 1) ORDER BY c.id', [person],
)).rows;
const rate = async (db, code) => (await db.query('SELECT usd_per_unit::text AS u FROM tb_fx_rates WHERE code = $1', [code])).rows[0]?.u ?? null;
const day = (words) => dayFrom(words, currentDay());

export async function extraSeed({ api, db }) {
  // Two companies in liquidation, set the way the page and Diane set it.
  for (const key of IN_LIQ) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  const yesterday = new Date(Date.parse(currentDay()) - 86_400_000).toISOString().slice(0, 10);
  const later = new Date(Date.parse(currentDay()) + 20 * 86_400_000).toISOString().slice(0, 10);
  await db.query("UPDATE tb_liquidations SET deadline = $1, liquidator = 'Begbies', next_action = 'Send bank statements' WHERE company_key = 'quarry lane'", [yesterday]);
  await db.query("UPDATE tb_liquidations SET deadline = $1 WHERE company_key = 'pinecrest'", [later]);
  // A letter on Quarry Lane, to be sent back.
  const ql = await liq(db, 'quarry lane');
  fs.mkdirSync(path.join(DOCS_ROOT, String(ql.id)), { recursive: true });
  fs.writeFileSync(path.join(DOCS_ROOT, String(ql.id), 'zzsuite-letter.pdf'), '%PDF-1.4 suite');
  await db.query("INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes) VALUES ($1, 'HMRC winding up letter.pdf', $2, 'application/pdf', 14)", [ql.id, `${ql.id}/zzsuite-letter.pdf`]);
  // Flags: Kiran in two groups, Otto and Mara in one.
  const pid = async (name, group) => (await db.query('SELECT person_id FROM tb_mastersheet WHERE person_name = $1 AND group_name = $2 LIMIT 1', [name, group])).rows[0].person_id;
  const flags = [
    [await pid('Kiran Vale', 'BAKER'), 'BAKER'], [await pid('Kiran Vale', 'CORVID'), 'CORVID'],
    [await pid('Otto Fenn', 'BAKER'), 'BAKER'], [await pid('Otto Fenn', 'BAKER'), 'BAKER'],
    [await pid('Mara Quill', 'BAKER'), 'BAKER'],
  ];
  for (const [p, g] of flags) await db.query("INSERT INTO tb_concerns (person_id, group_name, category, message) VALUES ($1, $2, 'wants-human', 'suite flag')", [p, g]);
  // Rates: one manual GBP, and a day's pull so no test needs the network.
  await db.query("INSERT INTO tb_fx_rates (code, usd_per_unit, per_usd, updated_at) VALUES ('GBP', 1.3, round(1 / 1.3, 8), now()) ON CONFLICT (code) DO UPDATE SET usd_per_unit = 1.3, per_usd = round(1 / 1.3, 8)");
  await db.query(`INSERT INTO tb_fx_rates_daily (code, per_usd, source, fetched_at) VALUES
    ('GBP', 0.755, 'openexchangerates', now() - interval '1 hour'), ('EUR', 0.86, 'openexchangerates', now() - interval '1 hour'),
    ('AED', 3.6725, 'openexchangerates', now() - interval '1 hour'), ('USD', 1, 'openexchangerates', now() - interval '1 hour')
    ON CONFLICT (code) DO NOTHING`);
  // The state every write case starts from.
  seedState.liq = (await db.query('SELECT * FROM tb_liquidations')).rows;
  seedState.flags = (await db.query('SELECT * FROM tb_concerns')).rows;
  seedState.rates = (await db.query('SELECT * FROM tb_fx_rates')).rows;
  seedState.status = (await db.query('SELECT name, status FROM tb_companies')).rows;
}

const reset = {
  act: async ({ db }) => {
    for (const r of seedState.liq) {
      await db.query(
        'UPDATE tb_liquidations SET stage = $2, deadline = $3, next_action = $4, owner = $5, blamed = $6, liquidator = $7, note = $8, instructions = $9 WHERE id = $1',
        [r.id, r.stage, r.deadline, r.next_action, r.owner, r.blamed, r.liquidator, r.note, r.instructions],
      );
    }
    await db.query('DELETE FROM tb_liquidation_comms');
    await db.query('DELETE FROM tb_liquidation_history');
    await db.query('UPDATE tb_liquidation_docs SET removed_at = NULL');
    await db.query('DELETE FROM tb_concerns');
    for (const c of seedState.flags) {
      await db.query('INSERT INTO tb_concerns (id, person_id, group_name, category, message, status, created_at, status_changed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [c.id, c.person_id, c.group_name, c.category, c.message, c.status, c.created_at, c.status_changed_at]);
    }
    await db.query('DELETE FROM tb_fx_rates');
    for (const r of seedState.rates) {
      await db.query('INSERT INTO tb_fx_rates (code, per_usd, usd_per_unit, updated_at, updated_by) VALUES ($1,$2,$3,$4,$5)', [r.code, r.per_usd, r.usd_per_unit, r.updated_at, r.updated_by]);
    }
    for (const c of seedState.status) await db.query('UPDATE tb_companies SET status = $2 WHERE name = $1', [c.name, c.status]);
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [reset, ...turns] });
const read = (name, turns) => READS.push({ name, turns });

// Nothing on the three areas moved.
const untouched = async (db) => {
  const l = (await db.query('SELECT stage, owner, next_action FROM tb_liquidations ORDER BY id')).rows;
  const f = (await db.query("SELECT count(*)::int n FROM tb_concerns WHERE status <> 'open'")).rows[0].n;
  const n = (await db.query('SELECT count(*)::int n FROM tb_concerns')).rows[0].n;
  const g = await rate(db, 'GBP');
  if (l.some((r) => r.stage || r.owner)) return `a liquidation changed: ${JSON.stringify(l)}`;
  if (f || n !== seedState.flags.length) return 'a flag changed';
  if (Number(g) !== 1.3) return `GBP rate changed to ${g}`;
  return null;
};

// ================= READS =================
read("who's in liquidation", [
  { say: "who's in liquidation right now?", expect: { tools: ['list_liquidations'], reply: /Quarry Lane[\s\S]*Pinecrest|Pinecrest[\s\S]*Quarry Lane/i, noReply: /Ironleaf|Brightwell/ } },
]);
read('deadlines due this week names only the near one', [
  { say: 'any liquidation deadlines due or passed this week?', expect: { tools: ['list_liquidations'], reply: /Quarry Lane/i, noReply: /Pinecrest/i } },
]);
read('one company in full', [
  { say: "pull up quarry lane's liquidation details", expect: { tools: ['list_liquidations'], reply: /Begbies/ } },
]);
read('the gbp rate is still read', [
  { say: "what's the gbp to usd rate we're using?", expect: { reply: /1 GBP = 1\.3\d* USD/ } },
]);
read('send a document back', [
  { say: 'send me the hmrc letter on quarry lane', expect: { tools: ['liquidation_document'], reply: /HMRC winding up letter/i } },
]);

// ================= LIQUIDATIONS =================
write('a stage: shown first, written on yes, status untouched', [
  { say: 'put quarry lane on hmrc liq', expect: { db: async (db) => ((await liq(db, 'quarry lane')).stage ? 'written before yes' : null) } },
  { say: 'yes', expect: { db: async (db) => ((await liq(db, 'quarry lane')).stage !== 'hmrc_liq' ? 'stage not hmrc_liq' : (await status(db, 'quarry lane')) !== 'liquidation' ? 'company status moved' : null) } },
]);
write('a messy order: stage, deadline in words, a call, and another company\'s owner', [
  { say: 'quarry lane went hmrc liq, deadline friday, begbies rang asking for bank statements. oh and pinecrest owner is suite-admin', expect: { db: untouched } },
  {
    say: 'yes',
    expect: {
      db: async (db) => {
        const q = await liq(db, 'quarry lane');
        const p = await liq(db, 'pinecrest');
        if (q.stage !== 'hmrc_liq') return `QL stage ${q.stage}`;
        if (String(q.deadline).slice(0, 10) !== day('friday')) return `QL deadline ${q.deadline} not ${day('friday')}`;
        if (!(await comms(db, 'quarry lane')).some((c) => /bank statements/i.test(c.body))) return 'no contact line';
        if (p.owner !== 'suite-admin') return `PC owner ${p.owner}`;
        return null;
      },
    },
  },
]);
write('bulk: every company in liquidation to own liq', [
  { say: 'set every company in liquidation to own liq', expect: { db: untouched } },
  { say: 'yes', expect: { db: async (db) => { const s = (await db.query('SELECT stage FROM tb_liquidations')).rows; return s.every((r) => r.stage === 'own_liq') ? null : JSON.stringify(s); } } },
]);
write('undo puts the last liquidation change back', [
  { say: 'pinecrest liquidator is frp advisory and next action chase the director', expect: {} },
  { say: 'yes', expect: { db: async (db) => ((await liq(db, 'pinecrest')).liquidator === 'frp advisory' || /frp/i.test((await liq(db, 'pinecrest')).liquidator) ? null : 'not saved') } },
  { say: 'actually undo that' },
  { say: 'yes', expect: { db: async (db) => { const p = await liq(db, 'pinecrest'); return p.liquidator === '' && !/chase/i.test(p.next_action) ? null : `not put back: ${p.liquidator} / ${p.next_action}`; } } },
]);
write('a typo in the company asks, writes nothing', [
  { say: 'set quary lane to strike off', expect: { reply: /Quarry Lane/i, db: untouched } },
]);
write('a company not in liquidation is pointed at its status, nothing written', [
  { say: 'set ironleaf to hmrc liq', expect: { reply: /not in liquidation|status/i, db: async (db) => ((await status(db, 'ironleaf')) !== 'active' ? 'Ironleaf status moved' : untouched(db)) } },
]);
write('end of month is a real date', [
  { say: 'pinecrest deadline is end of month', expect: { db: untouched } },
  { say: 'yes', expect: { db: async (db) => (String((await liq(db, 'pinecrest')).deadline).slice(0, 10) === day('end of month') ? null : `deadline ${(await liq(db, 'pinecrest')).deadline}`) } },
]);
write('log a contact line', [
  { say: 'log for pinecrest: liquidator emailed, wants payroll records', expect: {} },
  { say: 'yes', expect: { db: async (db) => ((await comms(db, 'pinecrest')).some((c) => /payroll records/i.test(c.body)) ? null : 'no line') } },
]);
// Its status is the only door, and liquidation writes straight away by
// design (it stops no deal; companies.js WHICH STATUSES ASK FIRST).
write('adding a company to the page goes through its status', [
  { say: 'add brightwell to the liquidations page', expect: { tools: ['update_company'], db: async (db) => ((await status(db, 'brightwell')) === 'liquidation' ? null : 'Brightwell not put into liquidation') } },
]);

// ================= FLAGS =================
write("resolve one person's flags", [
  { say: "resolve otto fenn's flags", expect: { db: untouched } },
  { say: 'yes', expect: { db: async (db) => { const f = await flagsOf(db, 'Otto Fenn'); return f.length === 2 && f.every((x) => x.status === 'resolved') ? null : JSON.stringify(f); } } },
]);
write('a name in two groups is asked about', [
  { say: "resolve kiran's flags", expect: { reply: /BAKER[\s\S]*CORVID|CORVID[\s\S]*BAKER|which group/i, db: untouched } },
]);
write('delete then undo brings the flags back', [
  { say: "delete mara quill's flags", expect: { db: untouched } },
  { say: 'yes', expect: { db: async (db) => ((await flagsOf(db, 'Mara Quill')).length ? 'not deleted' : null) } },
  { say: 'undo that' },
  { say: 'yes', expect: { db: async (db) => ((await flagsOf(db, 'Mara Quill')).length === 1 ? null : 'not back') } },
]);
write('bulk: every open flag in BAKER in progress', [
  { say: 'mark all the open flags in baker as in progress', expect: { db: untouched } },
  { say: 'yes', expect: { db: async (db) => { const r = (await db.query("SELECT group_name, status FROM tb_concerns")).rows; const bad = r.filter((x) => (x.group_name === 'BAKER' ? x.status !== 'in_progress' : x.status !== 'open')); return bad.length ? JSON.stringify(bad) : null; } } },
]);

// ================= RATES =================
write('set a rate the xe.com way', [
  { say: 'set gbp to 1.36', expect: { db: untouched } },
  { say: 'yes', expect: { db: async (db) => ((await rate(db, 'GBP')) === '1.36' ? null : `GBP ${await rate(db, 'GBP')}`) } },
]);
write('a rate typed upside down is caught before yes', [
  { say: 'gbp rate should be 0.74', expect: { reply: /upside|backwards|other way|wrong way|reverse|what 1 USD is|1 USD = 0\.74/i, db: untouched } },
]);
write('two rates in one message', [
  { say: 'eur 1.17 and aed 0.27 please', expect: { db: untouched } },
  { say: 'yes', expect: { db: async (db) => ((await rate(db, 'EUR')) === '1.17' && (await rate(db, 'AED')) === '0.27' ? null : `EUR ${await rate(db, 'EUR')} AED ${await rate(db, 'AED')}`) } },
]);
write('clear a manual rate back to the daily one', [
  { say: 'clear the manual gbp rate, use the daily one', expect: { db: untouched } },
  { say: 'yes', expect: { db: async (db) => ((await rate(db, 'GBP')) === null ? null : 'GBP still manual') } },
]);
write('undo a rate change', [
  { say: 'set eur to 1.2' },
  { say: 'yes', expect: { db: async (db) => ((await rate(db, 'EUR')) === '1.2' ? null : 'not set') } },
  { say: 'undo that' },
  { say: 'yes', expect: { db: async (db) => ((await rate(db, 'EUR')) === null ? null : `EUR still ${await rate(db, 'EUR')}`) } },
]);

// ================= ACROSS ALL THREE =================
write('one messy message across liquidations, flags and rates', [
  { say: "quarry lane deadline next friday, resolve otto's flags and gbp is 1.35", expect: { db: untouched } },
  {
    say: 'yes',
    expect: {
      db: async (db) => {
        if (String((await liq(db, 'quarry lane')).deadline).slice(0, 10) !== day('next friday')) return `QL deadline ${(await liq(db, 'quarry lane')).deadline} not ${day('next friday')}`;
        if (!(await flagsOf(db, 'Otto Fenn')).every((x) => x.status === 'resolved')) return 'otto not resolved';
        if ((await rate(db, 'GBP')) !== '1.35') return `GBP ${await rate(db, 'GBP')}`;
        return null;
      },
    },
  },
]);
write('auto mode: a plain change saves without asking', [
  { say: "pinecrest's liquidation note: waiting on the court date", expect: { db: async (db) => (/court date/i.test((await liq(db, 'pinecrest')).note) ? null : 'not saved in auto mode') } },
], true);
