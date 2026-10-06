/**
 * ***************************************************
 * * DIANE'S CAPABILITY SUITE. Run it after EVERY change to her.
 * ***************************************************
 *
 * His rule, 2026-09-30: a new capability must not break an old one, so the
 * whole set of known working conversations runs every time, not only the
 * new case. Add a case to cases.mjs whenever a capability is added or fixed.
 *
 * FAKE DATA ONLY, on its OWN database and port. It drops and recreates
 * `crm_suite` on a LOCAL postgres, seeds invented people, starts its own API
 * on :3101, talks to Diane over the real route, and checks what she said,
 * what she drew and what landed in the database. It refuses any database
 * that is not on localhost.
 *
 *   node scripts/dianeSuite/run.mjs            every case
 *   node scripts/dianeSuite/run.mjs undo fees   only cases whose name matches
 *
 * SUITE_DB_URL overrides the default local postgres.
 * FAST: read only cases run in parallel; cases that write run one by one.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// SUITE_SET=eval runs the held-out questions in evalCases.mjs instead: wording
// no rule was written for, so a change is judged on what she was never taught.
const SETS = { eval: './evalCases.mjs', eval2: './evalCases2.mjs', eval3: './evalCases3.mjs', eval4: './evalCases4.mjs', eval5: './evalCases5.mjs', eval6: './evalCases6.mjs', wander: './wanderCases.mjs', bulk: './bulkCases.mjs', messy: './messyCases.mjs' };
const { READS, WRITES, PENDING } = await import(SETS[process.env.SUITE_SET] ?? './cases.mjs');
import { seed } from './seed.mjs';

const require = createRequire(import.meta.url);
require('../../configs/pgTypes');
const { Client } = require('pg');

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB_URL = process.env.SUITE_DB_URL || 'postgresql://postgres:localtest@127.0.0.1:54329/crm_suite';
const PORT = 3101;
const BASE = `http://localhost:${PORT}/api/v1`;
const ADMIN = ['suite-admin', 'Suite-pass-1!', 'suite-code'];
const PARALLEL = 5;

if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DB_URL)) {
  console.error(`REFUSED: ${DB_URL.replace(/:[^:@/]+@/, ':***@')} is not a local database.`);
  process.exit(2);
}

// --pending runs the known bug cases instead, to see whether a fix landed.
const PENDING_ONLY = process.argv.includes('--pending');
const only = process.argv.slice(2).filter((w) => w !== '--pending').map((w) => w.toLowerCase());
const pick = (cases) => (only.length ? cases.filter((c) => only.some((w) => c.name.toLowerCase().includes(w))) : cases);

// ---------- a fresh database ----------
async function freshDb() {
  const admin = new Client({ connectionString: DB_URL.replace(/\/[^/]+$/, '/postgres') });
  await admin.connect();
  const name = new URL(DB_URL).pathname.slice(1);
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`);
  await admin.end();
  const env = { ...process.env, DATABASE_URL: DB_URL, DB_SSL: 'false' };
  execFileSync(process.execPath, ['scripts/migrate.js'], { cwd: API_DIR, env, stdio: 'ignore' });
  execFileSync(process.execPath, ['scripts/seedAdmin.js', ...ADMIN], { cwd: API_DIR, env, stdio: 'ignore' });
}

// ---------- its own API ----------
async function startApi() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: DB_URL,
      DB_SSL: 'false',
      PORT: String(PORT),
      // Nothing leaves the machine from a test run.
      WHATBOT_WEBHOOK_URL: '',
      WHATBOT_WEBHOOK_KEY: '',
      BACKUP_INTERVAL_HOURS: '0',
    },
    // SUITE_LOG=path keeps the suite server's own log, for an investigation.
    stdio: process.env.SUITE_LOG ? ['ignore', fs.openSync(process.env.SUITE_LOG, 'w'), fs.openSync(process.env.SUITE_LOG, 'a')] : 'ignore',
  });
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://localhost:${PORT}/health`)).ok) return child; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error('suite API did not start');
}

// ---------- http ----------
let cookie = '';
async function login() {
  const post = (p, body) => fetch(`${BASE}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const { ticket } = await (await post('/auth/login', { username: ADMIN[0], password: ADMIN[1] })).json();
  const r = await post('/auth/login/verify', { ticket, code: ADMIN[2] });
  if (!r.ok) throw new Error(`login failed ${r.status}`);
  cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
export async function api(method, p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method, headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
async function turn(history) {
  const r = await fetch(`${BASE}/master-sheet/agent`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ history, context: 'master-sheet' }),
  });
  if (!r.ok) throw new Error(`agent ${r.status}`);
  return (await r.text()).split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)));
}

// ---------- one conversation ----------
// A case may run in AUTO MODE (changes apply without a yes), set for it alone.
async function runCase(c, db) {
  if (c.auto) await api('PATCH', '/settings', { agentAutoConfirm: true });
  try {
    return await runTurns(c, db);
  } finally {
    if (c.auto) await api('PATCH', '/settings', { agentAutoConfirm: false });
  }
}

async function runTurns(c, db) {
  const history = [];
  const fails = [];
  for (const step of c.turns) {
    // A STEP WITH NO WORDS is the world moving: a saved conversation, the
    // month turning over. It runs, then its db check, and nobody speaks.
    if (step.act) {
      await step.act({ db, api });
      if (!step.say) {
        const bad = step.expect?.db ? await step.expect.db(db) : null;
        if (bad) fails.push(`[${step.label ?? 'act'}]: db ${bad}`);
        continue;
      }
    }
    history.push({ role: 'user', content: step.say });
    const events = await turn(history);
    const tools = events.filter((e) => e.type === 'tool' && e.name).map((e) => e.name);
    const drawn = events.filter((e) => ['list', 'card', 'check'].includes(e.type));
    const done = events.find((e) => e.type === 'done') ?? {};
    for (const e of drawn) {
      if (e.type === 'list') history.push({ role: 'assistant', content: `[listed ${e.list.rows.length}]`, list: e.list });
      if (e.type === 'card') history.push({ role: 'assistant', content: `[showed #${e.card.id}]`, card: e.card });
      if (e.type === 'check') history.push({ role: 'assistant', content: '[sheet check]', check: e.check });
    }
    history.push({ role: 'assistant', content: done.reply ?? '', claims: done.claims ?? [] });
    const reply = String(done.reply ?? '');
    const x = step.expect ?? {};
    const where = `"${step.say}"`;
    if (!done.reply) fails.push(`${where}: no reply`);
    if (process.env.SUITE_VERBOSE) {
      console.log(`   [${c.name}] ${where} -> [${tools}] ${reply.slice(0, 200)}`);
      for (const e of events.filter((ev) => ev.type === 'tool-result' && ev.result)) {
        console.log(`      ${e.name}: ${String(e.result.summary ?? '').replace(/\s+/g, ' ').slice(0, 300)}`);
      }
    }
    for (const t of x.tools ?? []) if (!tools.includes(t)) fails.push(`${where}: expected tool ${t}, got [${tools}]`);
    for (const t of x.noTools ?? []) if (tools.includes(t)) fails.push(`${where}: must not call ${t}`);
    if (x.reply && !x.reply.test(reply)) fails.push(`${where}: reply ${x.reply} not in "${reply.slice(0, 160)}"`);
    if (x.noReply && x.noReply.test(reply)) fails.push(`${where}: reply must not match ${x.noReply}: "${reply.slice(0, 160)}"`);
    if (x.noDraw && drawn.length) fails.push(`${where}: expected nothing drawn, got ${drawn.length} panel(s)`);
    if (x.rows) {
      const list = drawn.find((e) => e.type === 'list')?.list;
      const listRows = list ? [...(list.rows ?? []), ...(list.sections ?? []).flatMap((s) => s.rows)] : [];
      const bad = x.rows(listRows);
      if (bad) fails.push(`${where}: rows ${bad}`);
    }
    if (x.draws) {
      const kinds = drawn.map((e) => (e.type === 'list' ? `list:${e.list.kind ?? 'deals'}` : e.type));
      if (!kinds.some((k) => k === x.draws || k.startsWith(`${x.draws}:`))) fails.push(`${where}: expected ${x.draws} drawn, got [${kinds}]`);
    }
    if (x.db) {
      const bad = await x.db(db);
      if (bad) fails.push(`${where}: db ${bad}`);
    }
  }
  return fails;
}

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const at = i++; out[at] = await fn(items[at]); }
  }));
  return out;
}

// ---------- main ----------
const started = Date.now();
await freshDb();
const server = await startApi();
const db = new Client({ connectionString: DB_URL });
let failed = 0;
try {
  await db.connect();
  await login();
  await seed(api);
  await api('PATCH', '/settings', { agentAutoConfirm: false });

  const report = async (c) => {
    let fails;
    try { fails = await runCase(c, db); } catch (e) { fails = [`crashed: ${e.message}`]; }
    console.log(`${fails.length ? 'FAIL' : 'ok  '}  ${c.name}`);
    for (const f of fails) console.log(`        ${f}`);
    if (fails.length) failed += 1;
  };
  if (PENDING_ONLY) {
    for (const c of pick(PENDING)) await report(c);
  } else {
    await pool(pick(READS), PARALLEL, report);
    for (const c of pick(WRITES)) await report(c);
    if (PENDING.length) console.log(`\nknown bugs, not counted (--pending runs them): ${PENDING.map((c) => c.name).join('; ')}`);
  }
} finally {
  await db.end().catch(() => {});
  server.kill();
}
const total = PENDING_ONLY ? pick(PENDING).length : pick(READS).length + pick(WRITES).length;
console.log(`\n${total - failed}/${total} passed in ${Math.round((Date.now() - started) / 1000)}s`);
process.exit(failed ? 1 : 0);
