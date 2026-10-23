/**
 * PARK HELD OUT, written blind 2026-10-22. Never tune Diane to these; run only to measure.
 *
 * Work parked for a later month, said differently from the dev set. Nothing
 * on the sheet moves now, a preview names every month in full, and only a
 * yes saves rows in tb_scheduled_actions. Months are relative to the
 * business month, so these run any month. SUITE_SET=parkheld.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { currentMonth } = require('../../v1/shared/presetMonth.helper');

export const READS = [];
export const WRITES = [];
export const PENDING = [];

// ================= MONTHS, relative to the business month =================
const [Y, M] = currentMonth().split('-').map(Number);
const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthAt = (o) => ym(new Date(Date.UTC(Y, M - 1 + o, 1)));
const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const nameOf = (o) => NAMES[Number(monthAt(o).slice(5)) - 1];
const fullOf = (o) => `${nameOf(o)} ${monthAt(o).slice(0, 4)}`;
const said = (o) => nameOf(o).toLowerCase();
const monthRe = (...os) => new RegExp(os.map((o) => `(?=[\\s\\S]*${fullOf(o)})`).join(''), 'i');
// A month named with no year: the next time it comes round, never this one.
const nextNamed = (n) => {
  let o = (n - M + 12) % 12;
  if (o === 0) { n = (n % 12) + 1; o = 1; }
  return { o, name: NAMES[n - 1].toLowerCase() };
};

// ================= SEED STATE =================
const S = {};
const COLS = 'id, person_name, company, monthly_amount, fee_percent, addon_percent, currency, payment_method, stopped_on';
const FIELDS = ['monthly_amount', 'fee_percent', 'addon_percent', 'currency', 'payment_method'];

export async function extraSeed({ api, db }) {
  for (const key of ['quarry lane', 'pinecrest']) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  await api('GET', '/liquidations');
  S.rows = (await db.query(`SELECT ${COLS} FROM tb_mastersheet`)).rows;
  S.companies = (await db.query('SELECT name, status, closed_on FROM tb_companies')).rows;
}

// 'kiran vale|ironleaf' -> the seeded row.
const row = (who) => {
  const [p, c] = who.split('|');
  const r = S.rows.find((x) => x.person_name.toLowerCase() === p && x.company.trim().toLowerCase() === c);
  if (!r) throw new Error(`no seeded deal ${who}`);
  return r;
};
const idOf = (who) => row(who).id;
const liveOf = (pred) => S.rows.filter((r) => r.stopped_on == null && pred(r));
const num = (v) => Number(v ?? 0);

const reset = {
  act: async ({ db }) => {
    await db.query('DELETE FROM tb_scheduled_actions');
    for (const r of S.rows) {
      await db.query('UPDATE tb_mastersheet SET monthly_amount = $2, fee_percent = $3, addon_percent = $4, currency = $5, payment_method = $6 WHERE id = $1',
        [r.id, r.monthly_amount, r.fee_percent, r.addon_percent, r.currency, r.payment_method]);
    }
    const live = S.rows.filter((r) => r.stopped_on == null).map((r) => r.id);
    await db.query('UPDATE tb_mastersheet SET stopped_on = NULL, stopped_reason = NULL WHERE id = ANY($1::int[]) AND stopped_on IS NOT NULL', [live]);
    for (const c of S.companies) await db.query('UPDATE tb_companies SET status = $2, closed_on = $3 WHERE name = $1', [c.name, c.status, c.closed_on]);
    await db.query("UPDATE tb_companies SET status = 'active', closed_on = NULL WHERE NOT (name = ANY($1::text[]))", [S.companies.map((c) => c.name)]);
    await db.query('DELETE FROM tb_agent_undo');
  },
};
const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [reset, ...turns] });

// ================= CHECKS =================
const all = (...checks) => async (db) => { for (const c of checks) { const why = await c(db); if (why) return why; } return null; };
const same = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  if (String(a).toLowerCase() === String(b).toLowerCase()) return true;
  return String(a).trim() !== '' && String(b).trim() !== '' && !Number.isNaN(Number(a)) && Number(a) === Number(b);
};

// The sheet as seeded, except the listed changes: [['juno park|harbor nine', { monthly_amount: 650 }]].
const sheet = (changes = []) => async (db) => {
  const now = (await db.query(`SELECT ${COLS} FROM tb_mastersheet`)).rows;
  const want = new Map(changes.map(([who, set]) => [idOf(who), set]));
  for (const r of S.rows) {
    const n = now.find((x) => x.id === r.id);
    if (!n) return `${r.person_name} ${r.company} is gone`;
    const set = want.get(r.id) ?? {};
    for (const f of FIELDS) {
      const target = f in set ? set[f] : r[f];
      if (!same(n[f], target)) return `${r.person_name} ${r.company} ${f} is ${n[f]}, not ${target}`;
    }
    if ((n.stopped_on == null) !== (r.stopped_on == null)) return `${r.person_name} ${r.company} stopped state moved`;
  }
  return null;
};
const companiesSame = async (db) => {
  const now = (await db.query('SELECT name, status FROM tb_companies')).rows;
  for (const n of now) {
    const was = S.companies.find((c) => c.name === n.name)?.status ?? 'active';
    if (n.status !== was) return `${n.name} status moved to ${n.status}`;
  }
  return null;
};

const queue = async (db) => (await db.query('SELECT id, due_month, tool, args, target_ids, status, outcome FROM tb_scheduled_actions ORDER BY id')).rows;
const walk = (o, fn) => { if (o && typeof o === 'object') { fn(o); for (const v of Object.values(o)) walk(v, fn); } };
const eq = (v, want) => v != null && typeof v !== 'object' && (typeof want === 'number' ? String(v).trim() !== '' && Number(v) === want : String(v).toLowerCase() === String(want).toLowerCase());
const VALUE_KEYS = ['value', 'to', 'new', 'newValue', 'new_value', 'after'];
// A key (or a { field, value } pair) anywhere in args that carries this FINAL value.
const hasVal = (args, keyRe, want) => {
  let hit = false;
  walk(args, (o) => {
    if (typeof o.field === 'string' && keyRe.test(o.field) && VALUE_KEYS.some((k) => eq(o[k], want))) hit = true;
    for (const [k, v] of Object.entries(o)) if (keyRe.test(k) && eq(v, want)) hit = true;
  });
  return hit;
};
const targets = (r, id) => {
  if ((r.target_ids ?? []).map(Number).includes(id)) return true;
  let hit = false;
  walk(r.args, (o) => {
    for (const [k, v] of Object.entries(o)) {
      if (!/id/i.test(k)) continue;
      if (eq(v, id) || (Array.isArray(v) && v.some((x) => eq(x, id)))) hit = true;
    }
  });
  return hit;
};
const text = (r) => `${r.tool} ${JSON.stringify(r.args)}`.toLowerCase();
const KEY = {
  amount: /amount|monthly/i,
  fee: /^(?!.*add).*fee/i,
  addon: /add.?on/i,
  currency: /currency/i,
  method: /method/i,
};
const v = (x) => (typeof x === 'function' ? x() : x);

const parkedRows = (rows, { o, who, key, value }) => rows.filter((r) => r.status === 'parked'
  && (o == null || r.due_month === monthAt(o))
  && (who == null || targets(r, idOf(who)))
  && (key == null || hasVal(r.args, KEY[key], v(value))));

// A parked row due that month, for that deal, carrying that final value. `n` = exactly that many.
const parked = (spec, n) => async (db) => {
  const got = parkedRows(await queue(db), spec);
  const label = `${spec.who ?? 'any'} ${spec.key ?? ''}=${spec.value != null ? v(spec.value) : ''} due ${spec.o != null ? monthAt(spec.o) : 'any'}`;
  if (!got.length) return `nothing parked: ${label}`;
  if (n != null && got.length !== n) return `${got.length} parked, not ${n}: ${label}`;
  return null;
};
const notParked = (spec) => async (db) => (parkedRows(await queue(db), spec).length ? `parked but should not be: ${spec.who} ${spec.key ?? ''} ${spec.value != null ? v(spec.value) : ''} ${spec.o != null ? monthAt(spec.o) : ''}` : null);
// One parked row per month, each the same final value, and nothing beyond.
const parkedRun = (who, key, value, months) => async (db) => {
  const rows = await queue(db);
  for (const o of months) {
    const got = parkedRows(rows, { o, who, key, value });
    if (got.length !== 1) return `${who} ${key}=${v(value)} due ${monthAt(o)}: ${got.length} parked, not 1`;
  }
  const extra = rows.filter((r) => r.status === 'parked' && targets(r, idOf(who)) && !months.map(monthAt).includes(r.due_month));
  return extra.length ? `${who} has parked work outside ${months.map(monthAt).join(', ')}: ${extra.map((r) => r.due_month).join(', ')}` : null;
};
const parkedTotal = (n) => async (db) => {
  const got = (await queue(db)).filter((r) => r.status === 'parked').length;
  return got === n ? null : `${got} parked rows, not ${n}`;
};
const nothingQueued = async (db) => {
  const got = (await queue(db)).filter((r) => ['parked', 'running', 'done'].includes(r.status));
  return got.length ? `${got.length} rows queued: ${got.map((r) => `${r.tool} ${r.due_month}`).join(', ')}` : null;
};
const cancelled = (spec) => async (db) => {
  const rows = (await queue(db)).filter((r) => r.status === 'superseded' && targets(r, idOf(spec.who))
    && (spec.o == null || r.due_month === monthAt(spec.o)) && (spec.key == null || hasVal(r.args, KEY[spec.key], v(spec.value))));
  if (!rows.length) return `no superseded row for ${spec.who}`;
  return rows.some((r) => /^cancelled\.?$/i.test(String(r.outcome ?? '').trim())) ? null : `${spec.who} superseded but outcome ${rows[0].outcome}`;
};
const replaced = (spec) => async (db) => {
  const rows = (await queue(db)).filter((r) => r.status === 'superseded' && targets(r, idOf(spec.who))
    && r.due_month === monthAt(spec.o) && hasVal(r.args, KEY[spec.key], v(spec.value)));
  return rows.length ? null : `old ${spec.who} ${spec.key}=${v(spec.value)} not superseded`;
};
// A stop parked for that deal and month.
const stopParked = (who, o) => async (db) => {
  const got = (await queue(db)).filter((r) => r.status === 'parked' && r.due_month === monthAt(o) && targets(r, idOf(who)) && /stop|archiv|\bend/.test(text(r)));
  return got.length ? null : `no stop parked for ${who} due ${monthAt(o)}`;
};
// A company close parked for that month: named in args, or its live deals frozen as targets.
const closeParked = (company, o) => async (db) => {
  const ids = liveOf((r) => r.company.trim().toLowerCase() === company).map((r) => r.id);
  const got = (await queue(db)).filter((r) => r.status === 'parked' && r.due_month === monthAt(o)
    && (text(r).includes(company) || (ids.length && ids.every((id) => (r.target_ids ?? []).map(Number).includes(id)))));
  return got.length ? null : `no close of ${company} parked due ${monthAt(o)}`;
};
const untouched = all(sheet(), companiesSame);

const inesAddon = () => num(row('ines calder|ironleaf').addon_percent) + 2;

// ================= NOW AND LATER MIXED =================
write('pay later in another currency, a raise right now', [
  { say: 'from next month pay theo in AED not GBP, and juno to 650 right now', expect: { reply: monthRe(1), db: all(untouched, nothingQueued) } },
  { say: 'yes both', expect: { db: all(sheet([['juno park|harbor nine', { monthly_amount: 650 }]]),
    parked({ o: 1, who: 'theo brandt|brightwell', key: 'currency', value: 'AED' }),
    notParked({ who: 'juno park|harbor nine' })) } },
]);

// ================= FOLLOW-UP ON THE LAST TURN =================
write('ask, then park on "him"', [
  { say: "what's felix on atm", expect: { reply: /1,?300/, db: all(untouched, nothingQueued) } },
  { say: 'bump him to 1400 from next month, dont do it now', expect: { reply: monthRe(1), db: all(untouched, nothingQueued) } },
  { say: 'ok', expect: { db: all(untouched, parked({ o: 1, who: 'felix orr|ironleaf', key: 'amount', value: 1400 }, 1)) } },
]);

// ================= CORRECTION BEFORE THE YES =================
write('correct the value before saying yes', [
  { say: 'park karin vole pinecrest at 1300 for nxt month', expect: { db: all(untouched, nothingQueued) } },
  { say: 'sorry make that 1350', expect: { reply: /1,?350/, db: all(untouched, nothingQueued) } },
  { say: 'yes', expect: { db: all(untouched,
    parked({ o: 1, who: 'karin vole|pinecrest', key: 'amount', value: 1350 }, 1),
    notParked({ who: 'karin vole|pinecrest', key: 'amount', value: 1300 }),
    notParked({ who: 'kiran vale|brightwell' }), notParked({ who: 'kiran vale|ironleaf' }), notParked({ who: 'kiran vale|harbor nine' })) } },
]);

// ================= SEVERAL MONTHS =================
write('extra add-on for two named months', [
  { say: `give ines an extra 2% add on for ${said(1)} and ${said(2)}`, expect: { reply: monthRe(1, 2), db: all(untouched, nothingQueued) } },
  { say: 'yes', expect: { db: all(untouched, parkedRun('ines calder|ironleaf', 'addon', inesAddon, [1, 2])) } },
]);
write('four months on a new amount, plus a question', [
  { say: 'kiran harbor nine on 6500 for the next 4 months. whats she on now?', expect: { reply: /6,?000/, db: all(untouched, nothingQueued) } },
  { say: 'yeah do it', expect: { db: all(untouched, parkedRun('kiran vale|harbor nine', 'amount', 6500, [1, 2, 3, 4])) } },
]);

// ================= PERSON LEVEL =================
write("one person's every deal from a named month", [
  { say: `from ${said(2)} put all kiran vale's deals on a 7% fee`, expect: { reply: monthRe(2), db: all(untouched, nothingQueued) } },
  { say: 'yes', expect: { db: all(untouched,
    parked({ o: 2, who: 'kiran vale|brightwell', key: 'fee', value: 7 }),
    parked({ o: 2, who: 'kiran vale|ironleaf', key: 'fee', value: 7 }),
    parked({ o: 2, who: 'kiran vale|harbor nine', key: 'fee', value: 7 }),
    notParked({ who: 'karin vole|pinecrest' })) } },
]);

// ================= STOP AND CLOSE =================
write('end a deal from a later month, messy', [
  { say: `otto's finishing up, end his ironleaf deal from ${said(3)}`, expect: { reply: monthRe(3), db: all(untouched, nothingQueued) } },
  { say: 'yep', expect: { db: all(untouched, stopParked('otto fenn|ironleaf', 3)) } },
]);
write('shut a company at month end', [
  { say: 'shut quarry lane down at month end pls', expect: { db: all(untouched, nothingQueued) } },
  { say: 'yes', expect: { db: all(untouched, untouched /* corrected 2026-10-22: a close is never scheduled on a date */) } },
]);

// ================= REFUSED =================
write('the current month by name cannot be parked', [
  { say: `park baker jones on 2300 for ${said(0)}`, expect: { reply: /now|this month|current month|right away|straight ?away/i, db: all(untouched, nothingQueued) } },
]);
write('more than 12 months at once', [
  { say: 'add 1% to kiran brightwell fee every month for the next 15 months', expect: { reply: /\b12\b|twelve/i, db: all(untouched, nothingQueued) } },
]);

// ================= NO AFTER THE PREVIEW =================
write('back out after the preview', [
  { say: 'pls park mara quil at 1200 from next mnth', expect: { db: all(untouched, nothingQueued) } },
  { say: 'actually no forget it', expect: { db: all(untouched, nothingQueued) } },
]);

// ================= WHAT HAPPENS NEXT MONTH =================
write('what happens next month lists and changes nothing', [
  { say: 'park otto on 1600 for next month', expect: { db: nothingQueued } },
  { say: 'yes', expect: { db: parked({ o: 1, who: 'otto fenn|ironleaf', key: 'amount', value: 1600 }) } },
  { say: `ines to 4100 in ${said(2)}`, expect: { db: parkedTotal(1) } },
  { say: 'yes', expect: { db: parked({ o: 2, who: 'ines calder|ironleaf', key: 'amount', value: 4100 }) } },
  { say: 'so what happens next month?', expect: { reply: /(?=[\s\S]*Otto)(?=[\s\S]*1,?600)/i, db: all(untouched, parkedTotal(2)) } },
]);

// ================= CANCEL =================
write('scrap the parked change by its month', [
  { say: `kiran brightwell on 3200 for ${said(2)}, park it`, expect: { db: nothingQueued } },
  { say: 'yes', expect: { db: parked({ o: 2, who: 'kiran vale|brightwell', key: 'amount', value: 3200 }) } },
  { say: `scrap the ${said(2)} one`, expect: { reply: monthRe(2), db: all(untouched, parkedTotal(1)) } },
  { say: 'yep', expect: { db: all(untouched, parkedTotal(0), cancelled({ o: 2, who: 'kiran vale|brightwell' })) } },
]);
write('cancel asked, then kept', [
  { say: 'park felix at 1400 for next month', expect: { db: nothingQueued } },
  { say: 'yes', expect: { db: parked({ o: 1, who: 'felix orr|ironleaf', key: 'amount', value: 1400 }) } },
  { say: "cancel felix's parked change", expect: { db: parkedTotal(1) } },
  { say: 'no keep it', expect: { db: all(untouched, parked({ o: 1, who: 'felix orr|ironleaf', key: 'amount', value: 1400 }, 1)) } },
]);

// ================= RE-PARK REPLACES =================
write('a change of plan for the same month replaces the old', [
  { say: 'park kiran brightwell fee at 6% for next month', expect: { db: nothingQueued } },
  { say: 'yes', expect: { db: parked({ o: 1, who: 'kiran vale|brightwell', key: 'fee', value: 6 }) } },
  { say: "change of plan, make next month's fee 8% for kiran brightwell", expect: { db: parked({ o: 1, who: 'kiran vale|brightwell', key: 'fee', value: 6 }) } },
  { say: 'yes', expect: { db: all(untouched,
    parked({ o: 1, who: 'kiran vale|brightwell' }, 1),
    parked({ o: 1, who: 'kiran vale|brightwell', key: 'fee', value: 8 }),
    replaced({ o: 1, who: 'kiran vale|brightwell', key: 'fee', value: 6 })) } },
]);

// ================= YEAR ROLLOVER, AUTO MODE =================
const FEB = nextNamed(2);
write('auto mode: a bare month name rolls to the next one and still previews', [
  { say: `${FEB.name}, put felix orr on 1500`, expect: { reply: monthRe(FEB.o), db: all(untouched, nothingQueued) } },
  { say: 'yes', expect: { db: all(untouched, parked({ o: FEB.o, who: 'felix orr|ironleaf', key: 'amount', value: 1500 }), parkedTotal(1)) } },
], true);
