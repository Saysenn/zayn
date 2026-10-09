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
const SETS = { eval: './evalCases.mjs', eval2: './evalCases2.mjs', eval3: './evalCases3.mjs', eval4: './evalCases4.mjs', eval5: './evalCases5.mjs', eval6: './evalCases6.mjs', wander: './wanderCases.mjs', bulk: './bulkCases.mjs', messy: './messyCases.mjs', library: './library/index.mjs' };
const { READS, WRITES, PENDING, extraSeed } = await import(SETS[process.env.SUITE_SET] ?? './cases.mjs');
import { seed } from './seed.mjs';
import {
  checkArgs, checkAnswer, unsupportedFigures, wastedCalls, buildScorecard, saveScorecard, savedRuns, compareRuns,
} from './scorecard.mjs';
const SET = process.env.SUITE_SET ?? 'main';
// The name the scorecard is saved and compared under: the nightly runs the
// main set in three timezones, and each is compared with its own last run.
// SUITE_DIANE=v2 runs Diane v2 (v1/agent/v2) on the same cases; its scorecard
// is saved apart, with its model, so v1 and v2 are compared like for like.
const V2 = process.env.SUITE_DIANE === 'v2';
const CARD = process.env.SUITE_CARD ?? (V2 ? `${SET}-v2-${process.env.DIANE_V2_MODEL || 'gpt-5.4'}` : SET);

const require = createRequire(import.meta.url);
require('../../configs/pgTypes');
const { Client } = require('pg');

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// DEV, 2026-10-08: no local Postgres here, so the suite runs on the
// Supabase copy of LIVE, empties it for its fake people, and puts the LIVE
// copy back when it ends (pass, fail or crash). LIVE is always refused.
// SUITE_DB_URL may still name a local database. See scripts/testDb.js.
const { testDbUrl, emptyDb, refreshFromLive, isLocal, ssl, holdDevLock } = require('../testDb');
let DB_URL;
try {
  DB_URL = process.env.SUITE_DB_URL || testDbUrl();
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const REMOTE = !isLocal(DB_URL);
const PORT = 3101;
const BASE = `http://localhost:${PORT}/api/v1`;
const ADMIN = ['suite-admin', 'Suite-pass-1!', 'suite-code'];
// Fewer at once on DEV: Supabase's pooler caps clients.
const PARALLEL = REMOTE ? 3 : 5;

if (REMOTE && process.env.LIVE_URL && new URL(DB_URL).username === new URL(process.env.LIVE_URL).username) {
  console.error('REFUSED: the suite database is LIVE.');
  process.exit(2);
}

// --pending runs the known bug cases instead, to see whether a fix landed.
const PENDING_ONLY = process.argv.includes('--pending');
const only = process.argv.slice(2).filter((w) => w !== '--pending').map((w) => w.toLowerCase());
// SUITE_GROUP=pay runs one group of a set that has them (the library).
const GROUP = process.env.SUITE_GROUP;
// A CASE WRITTEN FOR AUTO MODE OFF ("(auto off)" in its name, or autoOff:
// true) is left out with auto forced on: it tests the preview auto skips.
const pick = (cases) => cases
  .filter((c) => !(process.env.SUITE_AUTO === 'on' && (c.autoOff || /\(auto off\)/i.test(c.name))))
  .filter((c) => !GROUP || c.group === GROUP)
  .filter((c) => !only.length || only.some((w) => c.name.toLowerCase().includes(w) || String(c.id ?? '').toLowerCase() === w));

// ---------- a fresh database ----------
async function freshDb() {
  const env = { ...process.env, DATABASE_URL: DB_URL, DB_SSL: 'false' };
  if (REMOTE) {
    // Supabase will not drop its database: every table goes instead.
    await emptyDb(DB_URL);
  } else {
    const admin = new Client({ connectionString: DB_URL.replace(/\/[^/]+$/, '/postgres') });
    await admin.connect();
    const name = new URL(DB_URL).pathname.slice(1);
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`);
    await admin.end();
    execFileSync(process.execPath, ['scripts/migrate.js'], { cwd: API_DIR, env, stdio: 'ignore' });
  }
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
      // What she did each turn, for the scorecard. Only this server sends it.
      DIANE_TRACE_EVENTS: '1',
      ...(V2 ? { DIANE_V2: '1' } : {}),
      // DEV's pooler allows 15 clients in all, and the dev API holds some.
      ...(REMOTE ? { DB_POOL_MAX: '5' } : {}),
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
// SUITE_AUTO=on runs EVERY case with auto mode on, for the on / off
// comparison (his ask, 2026-10-09). Its scorecard is saved as <set>-auto.
const FORCE_AUTO = process.env.SUITE_AUTO === 'on';
async function runCase(c, db) {
  if (c.auto && !FORCE_AUTO) await api('PATCH', '/settings', { agentAutoConfirm: true });
  try {
    return await runTurns(c, db);
  } finally {
    if (c.auto && !FORCE_AUTO) await api('PATCH', '/settings', { agentAutoConfirm: false });
  }
}

/**
 * EVERY FAILURE CARRIES THE STEP THAT BROKE (scorecard.mjs LABELS), so a
 * red case says where to look: the tool, its arguments, the records, the
 * sum, the wording, or the database.
 */
async function runTurns(c, db) {
  const history = [];
  const fails = [];
  const turns = [];
  /**
   * AUTO MODE SAVES AT ONCE, so with SUITE_AUTO=on a check that it "wrote
   * before the yes" is what auto mode is FOR, not a failure (his ask
   * 2026-10-10: score auto mode fairly). Every other check, and the final
   * database state after the yes, still counts.
   */
  const AUTO_EXPECTED = /\b(?:wrote|saved|stopped|written|applied|added|closed|changed) before (?:the )?yes\b|not in "Nothing is waiting on a yes|reply \/once you say yes\//i;
  const fail = (label, text) => {
    if (FORCE_AUTO && AUTO_EXPECTED.test(String(text))) return;
    fails.push({ label, text });
  };
  for (const step of c.turns) {
    // A STEP WITH NO WORDS is the world moving: a saved conversation, the
    // month turning over. It runs, then its db check, and nobody speaks.
    if (step.act) {
      await step.act({ db, api });
      if (!step.say) {
        const bad = step.expect?.db ? await step.expect.db(db) : null;
        if (bad) fail('db', `[${step.label ?? 'act'}]: db ${bad}`);
        continue;
      }
    }
    history.push({ role: 'user', content: step.say });
    const turnStarted = Date.now();
    const events = await turn(history);
    const turnMs = Date.now() - turnStarted;
    const stats = events.find((e) => e.type === 'stats')?.stats ?? null;
    const failsBefore = fails.length;
    const tools = events.filter((e) => e.type === 'tool' && e.name).map((e) => e.name);
    const drawn = events.filter((e) => ['list', 'card', 'check'].includes(e.type));
    const done = events.find((e) => e.type === 'done') ?? {};
    for (const e of drawn) {
      // A PLAN CARD is a list with steps and no rows (engine/runPlan.js).
      if (e.type === 'list') history.push({ role: 'assistant', content: e.list.rows ? `[listed ${e.list.rows.length}]` : '[plan]', list: e.list });
      if (e.type === 'card') history.push({ role: 'assistant', content: `[showed #${e.card.id}]`, card: e.card });
      if (e.type === 'check') history.push({ role: 'assistant', content: '[sheet check]', check: e.check });
    }
    history.push({ role: 'assistant', content: done.reply ?? '', claims: done.claims ?? [], ...(done.evidence ? { evidence: done.evidence } : {}) });
    const reply = String(done.reply ?? '');
    const x = step.expect ?? {};
    const where = `"${step.say}"`;
    if (!done.reply) fail('answer', `${where}: no reply`);
    if (process.env.SUITE_VERBOSE) {
      console.log(`   [${c.name}] ${where} -> [${tools}] ${reply.slice(0, 200)}`);
      for (const e of events.filter((ev) => ev.type === 'tool-result' && ev.result)) {
        console.log(`      ${e.name}: ${String(e.result.summary ?? '').replace(/\s+/g, ' ').slice(0, 300)}`);
      }
    }
    // Every call she made, fast paths included (the stats event); the
    // `tool` events alone miss the calls made in code.
    const called = stats?.tools ?? tools.map((name) => ({ name, args: {}, output: '' }));
    const calledNames = called.map((t) => t.name);
    for (const t of x.tools ?? []) if (!tools.includes(t) && !calledNames.includes(t)) fail('tool', `${where}: expected tool ${t}, got [${calledNames}]`);
    for (const t of x.noTools ?? []) if (tools.includes(t) || calledNames.includes(t)) fail('tool', `${where}: must not call ${t}`);
    for (const [label, text] of checkArgs(x.args, called)) fail(label, `${where}: ${text}`);
    const answerFails = checkAnswer(x.answer, { reply, claims: done.claims, tools: called });
    for (const [label, text] of answerFails) fail(label, `${where}: ${text}`);
    if (x.reply && !x.reply.test(reply)) fail('answer', `${where}: reply ${x.reply} not in "${reply.slice(0, 160)}"`);
    if (x.noReply && x.noReply.test(reply)) fail('answer', `${where}: reply must not match ${x.noReply}: "${reply.slice(0, 160)}"`);
    if (x.noDraw && drawn.length) fail('answer', `${where}: expected nothing drawn, got ${drawn.length} panel(s)`);
    if (x.rows) {
      const list = drawn.find((e) => e.type === 'list')?.list;
      const listRows = list ? [...(list.rows ?? []), ...(list.sections ?? []).flatMap((s) => s.rows)] : [];
      // ON SCREEN is a list, a card or her reply, as `shows` says: "show me
      // kiran vale" draws one card per deal, and read as no rows (2026-10-08).
      const cards = drawn.filter((e) => e.type === 'card').map((e) => e.card);
      const bad = x.rows(listRows.length ? listRows : [...cards, reply]);
      if (bad) fail('records', `${where}: rows ${bad}`);
    }
    if (x.draws) {
      const kinds = drawn.map((e) => (e.type === 'list' ? `list:${e.list.kind ?? 'deals'}` : e.type));
      if (!kinds.some((k) => k === x.draws || k.startsWith(`${x.draws}:`))) fail('answer', `${where}: expected ${x.draws} drawn, got [${kinds}]`);
    }
    if (x.db) {
      const bad = await x.db(db);
      if (bad) fail('db', `${where}: db ${bad}`);
    }
    const unsupported = stats ? unsupportedFigures(reply, called) : [];
    turns.push({
      ms: turnMs,
      stats,
      answerChecked: Boolean(x.answer),
      answerOk: Boolean(x.answer) && answerFails.length === 0,
      figures: (reply.match(/(?:GBP|AED|EUR|EURO|USD|£|€|\$)\s?\d|\d\s?(?:GBP|AED|EUR|EURO|USD)/gi) ?? []).length,
      unsupported,
      wasted: wastedCalls(called),
      retried: Boolean(stats?.retries?.length),
      ok: fails.length === failsBefore,
    });
  }
  return { fails, turns };
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
let server = null;
let failed = 0;
let stopped = false;
const results = [];
const db = new Client({ connectionString: DB_URL, ssl: ssl(DB_URL) });
// ONE RUN ON DEV AT A TIME: a second session's run waits here instead of
// emptying DEV under this one (testDb.holdDevLock, 2026-10-09).
let releaseDev = null;
try {
  if (REMOTE) releaseDev = await holdDevLock(DB_URL);
  await freshDb();
  server = await startApi();
  await db.connect();
  await login();
  const seeded = await seed(api);
  // A SET'S OWN PEOPLE on top of the shared ones (look-alike names, pay
  // states, history), so the main set's counts never move. See library/.
  if (extraSeed) await extraSeed({ api, db, seeded });
  await api('PATCH', '/settings', { agentAutoConfirm: FORCE_AUTO });

  const report = async (c) => {
    let fails;
    let turns = [];
    try { ({ fails, turns } = await runCase(c, db)); } catch (e) { fails = [{ label: 'answer', text: `crashed: ${e.message}` }]; }
    const id = c.id ?? c.name;
    console.log(`${fails.length ? 'FAIL' : 'ok  '}  ${c.id ? `${c.id}  ` : ''}${c.name}`);
    for (const f of fails) console.log(`        [${f.label}] ${f.text}`);
    if (fails.length) failed += 1;
    results.push({
      id, name: c.name, group: c.group ?? SET, risky: Boolean(c.risky),
      // UNSAFE is a write that landed before the yes, never a yes that did too little.
      unsafe: fails.some((f) => f.label === 'db' && /without a yes|before the yes|wrote before/i.test(f.text)),
      pass: fails.length === 0, labels: [...new Set(fails.map((f) => f.label))], turns,
    });
  };
  if (PENDING_ONLY) {
    for (const c of pick(PENDING)) await report(c);
  } else {
    await pool(pick(READS), PARALLEL, report);
    for (const c of pick(WRITES)) await report(c);
    if (PENDING.length) console.log(`\nknown bugs, not counted (--pending runs them): ${PENDING.map((c) => c.name).join('; ')}`);
  }
} catch (e) {
  console.error(`suite stopped: ${e.message}`);
  failed += 1;
  stopped = true;
} finally {
  await db.end().catch(() => {});
  server?.kill();
  // DEV GOES BACK TO BEING LIVE'S COPY, whatever happened above. The
  // nightly run sets SUITE_NO_REFRESH between its suite runs and refreshes once.
  if (REMOTE && !process.env.SUITE_NO_REFRESH) {
    console.log('\nputting the LIVE copy back on DEV…');
    try { refreshFromLive(DB_URL); console.log('DEV is a copy of LIVE again.'); } catch (e) { console.error(`DEV refresh FAILED, run scripts/cloneLive.js by hand: ${e.message}`); }
  }
  // Last, after the refill: the next run must find DEV whole.
  await releaseDev?.();
}
const total = PENDING_ONLY ? pick(PENDING).length : pick(READS).length + pick(WRITES).length;
const seconds = Math.round((Date.now() - started) / 1000);
// THE SCORECARD, saved for a whole run of a set only: a filtered or
// --pending run is not comparable with the last full one. A filtered run
// named with SUITE_CARD saves under that name (2026-10-09: picking v2's
// model on the same 28 cases, one card per model).
if (!PENDING_ONLY && (process.env.SUITE_CARD || (!only.length && !GROUP)) && results.length) {
  const card = buildScorecard({ set: CARD, cases: results, seconds });
  const [previous] = savedRuns(CARD);
  const file = saveScorecard(card);
  console.log(`\nscorecard: ${card.passRate}% pass, calc ${card.calcAccuracy ?? 'n/a'}%, invented ${card.inventedRate ?? 'n/a'}%, unsafe ${card.unsafeRate ?? 'n/a'}%, `
    + `${card.perTurn.modelRounds} rounds and ${card.perTurn.inputTokens} input tokens a turn, median ${card.perTurn.medianMs}ms`);
  console.log(`failures by step: ${Object.entries(card.failuresByLabel).filter(([, n]) => n).map(([l, n]) => `${l} ${n}`).join(', ') || 'none'}`);
  console.log(`saved: ${file}`);
  if (previous) console.log(`\nagainst the last ${CARD} run:\n${compareRuns(previous, card)}`);
}
// A run that stopped before its cases ran passed nothing: never "80/81".
if (stopped) console.log(`\nSTOPPED before the cases ran: ${results.length}/${total} ran, ${results.filter((r) => r.pass).length} passed, in ${seconds}s`);
else console.log(`\n${total - failed}/${total} passed in ${seconds}s`);
process.exit(failed ? 1 : 0);
