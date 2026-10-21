/**
 * CLOSING, WINDING DOWN AND "WHERE IS IT AT". SUITE_SET=close.
 *
 * His list 2026-10-21, the way he really talks: close one, close several,
 * close one and wind another down in the same breath, wind down one or
 * several (messy), and ask the status of one, several or all. Quarry Lane
 * and Pinecrest start winding down; Ironleaf, Harbor Nine and Brightwell
 * start active. Every write is checked in the database.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { currentDay } = require('../../v1/shared/presetMonth.helper');

export const READS = [];
export const WRITES = [];
export const PENDING = [];

const WINDING = ['quarry lane', 'pinecrest'];
const seedState = {};

const status = async (db, name) => (await db.query('SELECT status FROM tb_companies WHERE lower(name) = $1', [name])).rows[0]?.status ?? 'active';
const live = async (db, name) => (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE lower(btrim(company)) = $1 AND stopped_on IS NULL', [name])).rows[0].n;
const all = (...checks) => async (db) => { for (const c of checks) { const why = await c(db); if (why) return why; } return null; };
const statusIs = (name, want) => async (db) => { const s = await status(db, name); return s === want ? null : `${name} status ${s}, not ${want}`; };
const liveIs = (name, n) => async (db) => { const got = await live(db, name); return got === n ? null : `${name} has ${got} live deals, not ${n}`; };
const liveKept = (name) => async (db) => ((await live(db, name)) > 0 ? null : `${name} lost its live deals`);
const closed = (name) => all(statusIs(name, 'closed'), liveIs(name, 0));
const winding = (name) => all(statusIs(name, 'liquidation'), liveKept(name));
const untouched = async (db) => {
  for (const c of seedState.status) if ((await status(db, c.name.toLowerCase())) !== c.status) return `${c.name} status moved to ${await status(db, c.name.toLowerCase())}`;
  const n = (await db.query('SELECT count(*)::int n FROM tb_mastersheet WHERE stopped_on IS NULL')).rows[0].n;
  return n === seedState.liveIds.length ? null : `live deals ${n}, not ${seedState.liveIds.length}`;
};

export async function extraSeed({ api, db }) {
  for (const key of WINDING) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  const later = new Date(Date.parse(currentDay()) + 9 * 86_400_000).toISOString().slice(0, 10);
  await db.query("UPDATE tb_liquidations SET stage = 'hmrc_liq', stage_kind = 'petition', deadline = $1, next_action = 'Pay HMRC or agree terms', liquidator = 'Begbies Traynor' WHERE company_key = 'quarry lane'", [later]);
  await db.query("UPDATE tb_liquidations SET stage = 'own_liq', stage_kind = 'cvl' WHERE company_key = 'pinecrest'");
  seedState.liq = (await db.query('SELECT * FROM tb_liquidations')).rows;
  seedState.status = (await db.query('SELECT name, status, closed_on FROM tb_companies')).rows;
  seedState.liveIds = (await db.query('SELECT id FROM tb_mastersheet WHERE stopped_on IS NULL')).rows.map((r) => r.id);
  seedState.reviewIds = (await db.query('SELECT id FROM tb_mastersheet WHERE review_monthly')).rows.map((r) => r.id);
}

const reset = {
  act: async ({ db }) => {
    for (const c of seedState.status) await db.query('UPDATE tb_companies SET status = $2, closed_on = $3 WHERE name = $1', [c.name, c.status, c.closed_on]);
    // A company with no record until a case set its status is active again.
    await db.query("UPDATE tb_companies SET status = 'active', closed_on = NULL WHERE NOT (name = ANY($1::text[]))", [seedState.status.map((c) => c.name)]);
    await db.query('UPDATE tb_mastersheet SET stopped_on = NULL, stopped_reason = NULL WHERE id = ANY($1::int[]) AND stopped_on IS NOT NULL', [seedState.liveIds]);
    await db.query('UPDATE tb_mastersheet SET review_monthly = (id = ANY($1::int[]))', [seedState.reviewIds]);
    for (const r of seedState.liq) {
      await db.query('UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6 WHERE id = $1',
        [r.id, r.stage, r.stage_kind, r.deadline, r.next_action, r.liquidator]);
    }
    await db.query('DELETE FROM tb_liquidations WHERE NOT (id = ANY($1::int[]))', [seedState.liq.map((r) => r.id)]);
    await db.query('DELETE FROM tb_liquidation_comms');
    await db.query('DELETE FROM tb_liquidation_history');
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [reset, ...turns] });
const read = (name, turns) => READS.push({ name, turns });

// ================= CLOSE =================
write('close one', [
  { say: 'close quarry lane', expect: { db: untouched } },
  { say: 'yes', expect: { db: closed('quarry lane') } },
]);
write('close several', [
  { say: 'close quarry lane and pinecrest', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(closed('quarry lane'), closed('pinecrest')) } },
]);
write('close lazy, typo', [
  { say: 'pinecrst can be closed now', expect: { db: untouched } },
  { say: 'ya', expect: { db: closed('pinecrest') } },
]);
write('close one, wind one down, close another', [
  { say: 'close quarry lane, wind down ironleaf and close pinecrest also', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(closed('quarry lane'), winding('ironleaf'), closed('pinecrest')) } },
]);
write('close a company that is not winding down', [
  { say: 'close harbor nine', expect: { db: untouched } },
]);

// ================= WIND DOWN =================
write('wind down one', [
  { say: 'wind down ironleaf', expect: { db: untouched } },
  { say: 'yes', expect: { db: winding('ironleaf') } },
]);
write('wind down several', [
  { say: 'wind down ironleaf, harbor nine and brightwell', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(winding('ironleaf'), winding('harbor nine'), winding('brightwell')) } },
]);
write('wind down, super messy', [
  { say: 'ok so ironleaf n harbour nine r going under, put em in winding down. oh n brightwell too pls', expect: { db: untouched } },
  { say: 'go', expect: { db: all(winding('ironleaf'), winding('harbor nine'), winding('brightwell')) } },
]);
write('wind down, then change mind on one', [
  { say: 'wind down ironleaf and brightwell', expect: { db: untouched } },
  { say: 'actually just ironleaf', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(winding('ironleaf'), statusIs('brightwell', 'active')) } },
]);
write('already winding down', [
  { say: 'wind down pinecrest', expect: { reply: /already/i, db: untouched } },
]);

// ================= STATUS =================
read('status of one winding down', [
  { say: 'whats the current status of quarry lane winding down', expect: { reply: /HMRC liq|petition/i, db: untouched } },
]);
read('the whole liquidation status', [
  { say: 'whats the current liquidation status', expect: { reply: /(?=[\s\S]*Quarry Lane)(?=[\s\S]*Pinecrest)/i, noReply: /Ironleaf|Harbor Nine|Brightwell/, db: untouched } },
]);
read('closure status of two', [
  { say: 'whats the closure status of quarry lane and pinecrest', expect: { reply: /(?=[\s\S]*Quarry Lane[\s\S]*(?:HMRC|petition))(?=[\s\S]*Pinecrest[\s\S]*(?:CVL|own liq))/i, db: untouched } },
]);
read('status of a company not winding down', [
  { say: 'is ironleaf winding down?', expect: { reply: /\bno\b|not winding|active/i, db: untouched } },
]);
read('is it closed yet', [
  { say: 'is pinecrest closed yet', expect: { reply: /\bno\b|not (?:yet|closed)|still winding|winding down/i, db: untouched } },
]);
read('status lazy', [
  { say: 'where r we w pinecrest closure', expect: { reply: /Pinecrest[\s\S]*(?:CVL|own liq|creditors'? voluntary)/i, db: untouched } },
]);

// ================= AUTO MODE: a close still asks =================
write('auto mode: a close still shows first', [
  { say: 'close quarry lane', expect: { db: untouched } },
  { say: 'yes', expect: { db: closed('quarry lane') } },
], true);
write('auto mode: winding down saves at once', [
  { say: 'wind down ironleaf', expect: { db: winding('ironleaf') } },
], true);
