// Run from crm/api, TEST DATABASE ONLY: node scripts/expenseHarness/harness.js [name filter]
// EXPENSE BRAIN HARNESS, on the test database (DEV) only. The test admin (+447700900001, MANBAT),
// seeded rows marked saved_by='RMTEST', everything removed after each scenario.
// node harness.js [filter words...]   → runs scenarios whose name includes any word
const API = process.cwd();
require(`${API}/node_modules/dotenv`).config({ path: `${API}/.env` });
// THE TEST DATABASE (DEV since 2026-10-08), set before the pool loads.
// testDbUrl refuses LIVE. See scripts/testDb.js.
process.env.DATABASE_URL = require(`${API}/scripts/testDb`).testDbUrl();
process.env.DB_SSL = 'false';
const fs = require('fs');
const path = require('path');
const pool = require(`${API}/configs/db`);
const b = require(`${API}/v1/expenses/bot/brain`);
const { meter } = require(`${API}/v1/expenses/bot/ai`);
const scenarios = require('./scenarios');

const PHONE = '+447700900001';
const TESTDIR = path.join(API, '..', '..', 'docs', 'test');
const SEED = [
  ['2026-10-07', 'Cleaner payment', 'Ahmed (cleaner)', 250, 'MANBAT', 'other'],
  ['2026-10-06', 'Super 98 petrol 38.6L', 'ENOC', 120.43, 'MANBAT', 'fuel'],
  ['2026-10-05', 'Taxi Al Barsha to DIFC', 'Careem', 45, 'MANBAT', 'travel'],
  ['2026-10-06', 'Team lunch', 'Zuma', 30, 'MANBAT', 'food'],
  ['2026-10-03', 'Lunch with client', 'Pret A Manger', 40, 'MANBAT', 'food'],
  ['2026-10-04', 'Groceries', 'Carrefour', 139.91, 'MANBAT', 'food'],
  ['2026-10-01', 'Internet bill Sep 2026', 'DU Telecom', 471.45, 'MANBAT', 'bills'],
  ['2026-10-01', 'Electricity and water Sep', 'DEWA', 919.28, 'MANBAT', 'bills'],
];
const MIME = { jpg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const file = (name) => ({ filename: name, mime: MIME[name.split('.').pop()], base64: fs.readFileSync(path.join(TESTDIR, name)).toString('base64') });

// replies that mean it got stuck or confused; listed, judged by eye
const STUCK = /I didn't catch|handed to the pay side|what should it be instead|Sorry, something went wrong|There's nothing waiting for a yes|Just to be sure/;

/**
 * THE ROWS THIS RUN MADE, and nothing of LIVE's copy. 2026-10-09: the bot
 * saves as the admin's name, "Zayn", which `saved_by IN ('zayn')` never
 * matched, so every save read as "not saved" and was never cleaned up;
 * and on DEV a name match alone would also catch LIVE's own rows. So: the
 * seed (RMTEST), or saved by this run's people since it started.
 */
const RUN_START = new Date();
const OURS = "(saved_by = 'RMTEST' OR (created_at >= $1 AND (lower(saved_by) IN ('zayn', 'gary test') OR spent_by = 'Gary Test')))";
async function clean() {
  await pool.query("DELETE FROM tb_expense_chats WHERE phone IN ($1, 'diane')", [PHONE]);
  await pool.query("DELETE FROM tb_expense_actions WHERE phone IN ($1, 'diane')", [PHONE]);
  await pool.query(`DELETE FROM tb_receipt_prints WHERE expense_id IN (SELECT id FROM tb_expenses WHERE ${OURS})`, [RUN_START]);
  await pool.query(`DELETE FROM tb_expenses WHERE ${OURS}`, [RUN_START]);
}
async function seed() {
  // THE TEST ADMIN, every run: DEV is a copy of LIVE, which has no such
  // admin, so a run on a fresh copy answered "not registered" to all 243
  // (2026-10-09: 9.1%, $0, no model call). Removed again in clean().
  await pool.query("INSERT INTO tb_expense_admins (group_name, name, phone) VALUES ('MANBAT', 'Zayn', $1) ON CONFLICT (group_name, phone) DO UPDATE SET active = true", [PHONE]);
  for (const [d, desc, payee, amt, g, cat] of SEED) {
    await pool.query("INSERT INTO tb_expenses (spent_on, description, payee, currency, raw_amount, exchange_rate, group_name, spent_by, saved_by, category) VALUES ($1,$2,$3,'AED',$4,1,$5,'Zayn','RMTEST',$6)", [d, desc, payee, amt, g, cat]);
  }
}
const rows = async () => (await pool.query(`SELECT description, payee, raw_amount::float AS amount, currency, spent_on::text AS day, spent_by, category FROM tb_expenses WHERE group_name='MANBAT' AND ${OURS} ORDER BY id`, [RUN_START])).rows;
// THE DAY THE SCENARIOS WERE WRITTEN FOR: the seed is 1-7 Oct 2026 and
// "yesterday" is the 6th. Run on any other day, every date check failed
// (2026-10-09). HARNESS_TODAY moves it when the scenarios move.
const TODAY = process.env.HARNESS_TODAY ?? '2026-10-07';
let chatPhone = PHONE;
const chat = async () => (await pool.query('SELECT state FROM tb_expense_chats WHERE phone=$1', [chatPhone])).rows[0]?.state ?? {};

(async () => {
  const want = process.argv.slice(2).map((w) => w.toLowerCase());
  const pick = scenarios.filter((s) => !want.length || want.some((w) => s.name.toLowerCase().includes(w)));
  // ONE RUN ON DEV AT A TIME: a Diane suite run empties DEV (testDb.holdDevLock)
  const release = await require(`${API}/scripts/testDb`).holdDevLock();
  const start = meter.dollars;
  const results = [];
  for (const sc of pick) {
    await clean();
    await seed();
    chatPhone = sc.diane ? 'diane' : PHONE;
    const log = [];
    let calls = 0;
    let codeOnly = 0;
    let ms = 0;
    for (const step of sc.steps) {
      const text = typeof step === 'string' ? step : step.text ?? '';
      const atts = typeof step === 'string' ? [] : (step.files ?? []).map(file);
      const c0 = meter.dollars;
      const t0 = Date.now();
      let o;
      try {
        o = sc.diane
          ? await b.turn({ text, attachments: atts, messageId: `h-${Math.random()}` }, { channel: 'diane', user: 'zayn', today: TODAY })
          : await b.turn({ phone: PHONE, group: 'MANBAT', text, attachments: atts, messageId: `h-${Math.random()}` }, { today: TODAY });
      } catch (err) {
        o = { reply: `CRASH ${err.message}` };
      }
      ms += Date.now() - t0;
      const used = meter.dollars > c0;
      if (used) calls += 1; else codeOnly += 1;
      const reply = o.handOff ? '(handed to the pay side)' : [o.reply, ...(o.replies ?? []).slice(1)].filter(Boolean).join('\n---\n');
      log.push({ text: text || `[${(step.files ?? []).join(', ')}]`, reply, used });
    }
    const st = await chat();
    const db = await rows();
    let ok = true;
    let why = '';
    try {
      const r = await sc.check({ db, log, last: log.at(-1)?.reply ?? '', pending: st.pending ?? null, state: st });
      ok = r === true || r === undefined;
      if (!ok) why = typeof r === 'string' ? r : 'check failed';
    } catch (err) {
      ok = false;
      why = `check threw: ${err.message}`;
    }
    const stuck = log.filter((l) => STUCK.test(l.reply)).map((l) => l.text);
    results.push({ name: sc.name, ok, why, stuck, calls, steps: sc.steps.length, ms, log });
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${sc.name}${why ? `  — ${why}` : ''}${stuck.length ? `  [stuck-ish: ${stuck.join(' | ')}]` : ''}  (${calls}/${sc.steps.length} model)\n`);
  }
  await clean();
  await pool.query('DELETE FROM tb_expense_admins WHERE phone = $1', [PHONE]);
  await release();
  const failed = results.filter((r) => !r.ok);
  const steps = results.reduce((n, r) => n + r.steps, 0);
  const calls = results.reduce((n, r) => n + r.calls, 0);
  console.log(`\n${results.length - failed.length}/${results.length} passed · ${calls}/${steps} messages used the model · $${(meter.dollars - start).toFixed(4)} · avg ${Math.round(results.reduce((n, r) => n + r.ms, 0) / steps)} ms/message`);
  fs.writeFileSync(path.join(require('os').tmpdir(), 'expense-harness-last.json'), JSON.stringify(results, null, 1));
  // THE SAME SCORECARD AS DIANE'S (plan item 27, 2026-10-08), for a whole
  // run only: `node scripts/dianeSuite/compare.mjs expenses` sets it
  // against the last one. A group is the scenario's prefix ("add", "edit").
  if (!want.length) {
    const ms = results.flatMap((r) => (r.steps ? [Math.round(r.ms / r.steps)] : [])).sort((a, b) => a - b);
    const groups = {};
    for (const r of results) {
      const g = (groups[r.name.split(':')[0]] ??= { cases: 0, passed: 0 });
      g.cases += 1;
      if (r.ok) g.passed += 1;
    }
    for (const g of Object.values(groups)) g.passRate = Math.round((g.passed / g.cases) * 1000) / 10;
    const at = new Date().toISOString();
    const card = {
      // v2 (EXPENSE_V2=1, see bot/ai.js) is saved apart: compare.mjs expenses expenses-v2-gpt-5.4
      set: process.env.EXPENSE_V2 === '1' ? `expenses-v2-${process.env.EXPENSE_V2_MODEL || 'gpt-5.4'}` : 'expenses',
      at,
      cases: results.length,
      passed: results.length - failed.length,
      passRate: Math.round(((results.length - failed.length) / (results.length || 1)) * 1000) / 10,
      groups,
      failuresByLabel: { answer: failed.length },
      calcAccuracy: null, inventedRate: null, unsafeRate: null, wastedCallsPerTurn: null, recoveryRate: null,
      perTurn: {
        turns: steps,
        modelRounds: Math.round((calls / (steps || 1)) * 100) / 100,
        toolCalls: null, retries: null, inputTokens: null, cachedPct: null, outputTokens: null,
        medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : 0,
        slowestMs: ms.length ? ms[ms.length - 1] : 0,
      },
      costUsd: Math.round((meter.dollars - start) * 100) / 100,
      results: results.map((r) => ({ id: r.name, name: r.name, group: r.name.split(':')[0], pass: r.ok, labels: r.ok ? [] : ['answer'] })),
    };
    const dir = path.join(API, 'scripts', 'dianeSuite', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${at.replace(/[:.]/g, '-')}-expenses.json`), `${JSON.stringify(card, null, 2)}\n`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
