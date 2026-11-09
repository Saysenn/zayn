/**
 * THE CLOSURE SHEET'S FIELDS ON WINDING DOWN, DEV SET. SUITE_SET=sheetdev.
 *
 * Migration 092 (2026-11-04) gave the Winding down page the boss's closure
 * sheet columns: official receiver, last action, unresolved matters, current
 * play, prompts (what the director said), the stage's Companies House date,
 * joint liquidators (one a line), other involved parties, and an audit trail
 * of every change. These cases were written BLIND, from how the office
 * actually types, not from how Diane is built. The held-out set is
 * sheetHeldCases.mjs; it shares this seed.
 *
 * Seven companies: the five seeded ones with deals, plus Copperfield Joinery
 * and Saltmarsh Bakery, which are on the page with NO deals at all. Dates are
 * relative to today. Every write is checked in the database and on the
 * audit trail.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { currentDay } = require('../../v1/shared/presetMonth.helper');

export const READS = [];
export const WRITES = [];
export const PENDING = [];

export const seedState = {};

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const isoIn = (n) => new Date(Date.parse(currentDay()) + n * 86_400_000).toISOString().slice(0, 10);
/** "7 November 2026", n days from today. */
export const longIn = (n) => { const d = new Date(`${isoIn(n)}T00:00:00Z`); return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** Her words for that day: "7 November", "7 Nov", "November 7", "07/11". */
export const saidIso = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  const m = MONTH[d.getUTCMonth()];
  return new RegExp(`\\b${day}(?:st|nd|rd|th)? ${m.slice(0, 3)}|\\b${m} ${day}\\b|\\b0?${day}/0?${d.getUTCMonth() + 1}\\b|${iso}`, 'i');
};
export const said = (n) => saidIso(isoIn(n));

// The two companies on the page with no deals with us.
export const NO_DEALS = ['Copperfield Joinery', 'Saltmarsh Bakery'];
const WITH_DEALS = ['quarry lane', 'pinecrest', 'ironleaf', 'harbor nine', 'brightwell'];
// Every field the page keeps, old and new (092).
const FIELDS = ['stage', 'stage_kind', 'next_action', 'owner', 'liquidator', 'official_receiver', 'last_action', 'unresolved', 'play', 'prompts'];
const DATES = ['deadline', 'stage_date'];

// ---------- checks ----------
export const liq = async (db, key) => (await db.query('SELECT * FROM tb_liquidations WHERE company_key = $1', [key])).rows[0];
const status = async (db, name) => (await db.query('SELECT status FROM tb_companies WHERE lower(name) = $1', [name])).rows[0]?.status ?? 'active';
const iso = (v) => {
  if (!v) return '';
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
export const lines = (text) => String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
export const parties = async (db, key) => (await db.query(
  'SELECT p.* FROM tb_liquidation_parties p JOIN tb_liquidations l ON l.id = p.liquidation_id WHERE l.company_key = $1 ORDER BY p.id',
  [key],
)).rows;
export const all = (...checks) => async (db) => { for (const c of checks) { const why = await c(db); if (why) return why; } return null; };

/** A text field matches (a regex) or equals (a string, '' for empty). */
export const fieldIs = (key, field, want) => async (db) => {
  const r = await liq(db, key);
  if (!r) return `${key} has no row`;
  const got = String(r[field] ?? '');
  if (want instanceof RegExp) return want.test(got) ? null : `${key} ${field} "${got}", not ${want}`;
  return got === String(want ?? '') ? null : `${key} ${field} "${got}", not "${want ?? ''}"`;
};
/** The play is one of these values. */
export const playIs = (key, ...want) => async (db) => {
  const r = await liq(db, key);
  return want.includes(r.play ?? null) ? null : `${key} play ${r.play}, not ${want.join(' or ')}`;
};
export const stageDateIs = (key, want) => async (db) => {
  const got = iso((await liq(db, key)).stage_date);
  return got === want ? null : `${key} stage_date ${got || 'empty'}, not ${want}`;
};
/** Every regex in `has` is one liquidator line; none in `not` is; and the count if given. */
export const liquidatorsAre = (key, has, { not = [], count } = {}) => async (db) => {
  const l = lines((await liq(db, key)).liquidator);
  for (const re of has) if (!l.some((x) => re.test(x))) return `${key} liquidators [${l.join(' | ')}] miss ${re}`;
  for (const re of not) if (l.some((x) => re.test(x))) return `${key} liquidators [${l.join(' | ')}] still have ${re}`;
  if (count !== undefined && l.length !== count) return `${key} has ${l.length} liquidator lines [${l.join(' | ')}], not ${count}`;
  return null;
};
export const partyHas = (key, nameRe, positionRe) => async (db) => {
  const ps = await parties(db, key);
  const p = ps.find((x) => nameRe.test(x.name));
  if (!p) return `${key} parties [${ps.map((x) => x.name).join(', ')}] miss ${nameRe}`;
  if (positionRe && !positionRe.test(`${p.position} ${p.name}`)) return `${key} party ${p.name} position "${p.position}", not ${positionRe}`;
  return null;
};
export const partyGone = (key, nameRe) => async (db) => {
  const ps = await parties(db, key);
  return ps.some((x) => nameRe.test(x.name)) ? `${key} still has party ${nameRe}` : null;
};
/** A change on this company landed on the audit trail, made the way `via` says. */
export const audited = (key, via = 'diane') => async (db) => {
  const { n } = (await db.query('SELECT count(*)::int n FROM tb_liquidation_audit WHERE company_key = $1 AND via = $2', [key, via])).rows[0];
  return n ? null : `no audit line for ${key} via ${via}`;
};

/** NOTHING ON THE PAGE MOVED: every field, date, party and status as seeded, and nothing on the trail from Diane. */
export const untouched = async (db) => {
  for (const s of seedState.liq) {
    const r = (await db.query('SELECT * FROM tb_liquidations WHERE id = $1', [s.id])).rows[0];
    if (!r) return `${s.company_key} row gone`;
    for (const f of FIELDS) if (String(r[f] ?? '') !== String(s[f] ?? '')) return `${s.company_key} ${f} moved to "${r[f]}"`;
    for (const f of DATES) if (iso(r[f]) !== iso(s[f])) return `${s.company_key} ${f} moved to ${iso(r[f])}`;
  }
  const ps = (await db.query('SELECT id, name, position FROM tb_liquidation_parties ORDER BY id')).rows;
  const want = seedState.parties.map((p) => `${p.id}:${p.name}:${p.position}`).join('|');
  if (ps.map((p) => `${p.id}:${p.name}:${p.position}`).join('|') !== want) return 'the other involved parties moved';
  for (const c of seedState.status) if ((await status(db, c.name.toLowerCase())) !== c.status) return `${c.name} status moved`;
  const { n } = (await db.query("SELECT count(*)::int n FROM tb_liquidation_audit WHERE via = 'diane'")).rows[0];
  return n ? `${n} audit line(s) from Diane, so she wrote` : null;
};

// ---------- the seed ----------
export async function extraSeed({ api, db }) {
  for (const key of WITH_DEALS) await api('PATCH', `/companies/${encodeURIComponent(key)}`, { status: 'liquidation' });
  // ON THE PAGE WITH NO DEALS: a company we wind down that nobody is paid from.
  for (const name of NO_DEALS) {
    await db.query("INSERT INTO tb_companies (name, status) VALUES ($1, 'liquidation') ON CONFLICT DO NOTHING", [name]);
  }
  await api('GET', '/liquidations');
  for (const name of NO_DEALS) {
    await db.query('INSERT INTO tb_liquidations (company_key) VALUES ($1) ON CONFLICT (company_key) DO NOTHING', [name.toLowerCase()]);
  }
  const set = (key, f) => db.query(
    `UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, liquidator = $6,
            official_receiver = $7, last_action = $8, unresolved = $9, play = $10, prompts = $11, stage_date = $12
      WHERE company_key = $1`,
    [key, f.stage ?? null, f.kind ?? null, f.deadline ?? null, f.next ?? '', f.liquidator ?? '',
      f.or ?? '', f.last ?? '', f.unresolved ?? '', f.play ?? null, f.prompts ?? '', f.stageDate ?? null],
  );
  // QUARRY LANE: HMRC petition, JOINT liquidators, we chase. The director blamed his accountant.
  await set('quarry lane', {
    stage: 'hmrc_liq', kind: 'petition', deadline: isoIn(10), next: 'Get the payroll records to Begbies',
    liquidator: 'Kate Morris\nGareth Lyle', play: 'chase', stageDate: isoIn(-12),
    last: 'Emailed Begbies Traynor for the bank statements',
    unresolved: 'PAYE arrears of £48,210 not agreed with HMRC; final payroll records missing',
    prompts: 'Nell Arden (director) said the accountant never filed the PAYE returns, blamed Fairway Accounts',
  });
  // PINECREST: our CVL, waiting on FRP.
  await set('pinecrest', {
    stage: 'own_liq', kind: 'cvl', liquidator: 'FRP Advisory', play: 'wait', stageDate: isoIn(-30),
    last: 'Sent the statement of affairs to FRP Advisory',
  });
  // IRONLEAF: Companies House's strike off; we leave it be.
  await set('ironleaf', {
    stage: 'active_proposal', kind: 'compulsory', play: 'leave', stageDate: isoIn(-20),
    unresolved: 'Confirmation statement still overdue',
  });
  // HARBOR NINE: wound up, the Official Receiver is liquidator, and DO NOT CONTACT.
  await set('harbor nine', {
    stage: 'hmrc_liq', kind: 'winding_up_order', play: 'do_not_contact', stageDate: isoIn(-7),
    or: 'Mark Tolley, Official Receiver (Birmingham), appointed as liquidator',
    unresolved: 'Statement of affairs not yet submitted to the Official Receiver',
    prompts: 'Kiran Vale said HMRC lost his payment and blamed the bank; told us never to ring him again',
  });
  // BRIGHTWELL: our strike off, suspended by HMRC's objection.
  await set('brightwell', {
    stage: 'strike_off_suspended', play: 'chase', stageDate: isoIn(-45),
    last: 'Called HMRC about a payment plan', unresolved: 'Unpaid VAT of £6,200 owed to HMRC',
  });
  // COPPERFIELD JOINERY: no deals, a CVL with Leonard Curtis.
  await set('copperfield joinery', {
    stage: 'own_liq', kind: 'cvl', liquidator: 'Leonard Curtis', play: 'wait', stageDate: isoIn(-60),
    last: 'Signed the CVL papers', unresolved: "Director's loan account of £12,400 still owed to the company",
  });
  // SALTMARSH BAKERY: no deals, a voluntary strike off, nothing decided.
  await set('saltmarsh bakery', { stage: 'active_proposal', kind: 'voluntary' });

  const party = (key, name, position) => db.query(
    'INSERT INTO tb_liquidation_parties (liquidation_id, name, position) SELECT id, $2, $3 FROM tb_liquidations WHERE company_key = $1',
    [key, name, position],
  );
  await party('harbor nine', 'Chloe Fletcher', 'Insolvency Examiner');
  await party('brightwell', 'Dev Rana', 'HMRC Debt Management officer');
  await party('copperfield joinery', 'Amira Shah', 'Case Manager');

  // THE TRAIL SO FAR, for the history questions (read cases run before any reset).
  const trail = (key, field, from, to, by, daysAgo) => db.query(
    `INSERT INTO tb_liquidation_audit (liquidation_id, company_key, field, old_value, new_value, by_user, via, changed_at)
     SELECT id, $1, $2, $3, $4, $5, 'admin', now() - ($6 || ' days')::interval FROM tb_liquidations WHERE company_key = $1`,
    [key, field, from, to, by, String(daysAgo)],
  );
  await trail('pinecrest', 'current play', 'Chase', 'Wait', 'sophie', 3);
  await trail('harbor nine', 'current play', 'Chase', 'Do not contact', 'marcus', 5);
  await trail('harbor nine', 'official receiver', '', 'Mark Tolley, Official Receiver (Birmingham), appointed as liquidator', 'marcus', 6);

  seedState.liq = (await db.query('SELECT * FROM tb_liquidations')).rows;
  seedState.parties = (await db.query('SELECT * FROM tb_liquidation_parties ORDER BY id')).rows;
  seedState.status = (await db.query('SELECT name, status, closed_on FROM tb_companies')).rows;
  seedState.liveIds = (await db.query('SELECT id FROM tb_mastersheet WHERE stopped_on IS NULL')).rows.map((r) => r.id);
  seedState.reviewIds = (await db.query('SELECT id FROM tb_mastersheet WHERE review_monthly')).rows.map((r) => r.id);
}

// ---------- back to the seed before every write case ----------
export const reset = {
  act: async ({ db }) => {
    for (const r of seedState.liq) {
      await db.query(
        `UPDATE tb_liquidations SET stage = $2, stage_kind = $3, deadline = $4, next_action = $5, owner = $6, blamed = $7,
                liquidator = $8, note = $9, instructions = $10, official_receiver = $11, last_action = $12, unresolved = $13,
                play = $14, prompts = $15, stage_date = $16
          WHERE id = $1`,
        [r.id, r.stage, r.stage_kind, r.deadline, r.next_action, r.owner, r.blamed, r.liquidator, r.note, r.instructions,
          r.official_receiver, r.last_action, r.unresolved, r.play, r.prompts, r.stage_date],
      );
    }
    await db.query('DELETE FROM tb_liquidation_parties');
    for (const p of seedState.parties) {
      await db.query(
        'INSERT INTO tb_liquidation_parties (id, liquidation_id, name, position, by_user, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [p.id, p.liquidation_id, p.name, p.position, p.by_user, p.created_at],
      );
    }
    await db.query('UPDATE tb_mastersheet SET stopped_on = NULL, stopped_reason = NULL WHERE id = ANY($1::int[]) AND stopped_on IS NOT NULL', [seedState.liveIds]);
    await db.query('UPDATE tb_mastersheet SET review_monthly = (id = ANY($1::int[]))', [seedState.reviewIds]);
    await db.query('DELETE FROM tb_liquidation_audit');
    await db.query('DELETE FROM tb_liquidation_comms');
    await db.query('DELETE FROM tb_liquidation_history');
    await db.query('DELETE FROM tb_liquidations WHERE NOT (id = ANY($1::int[]))', [seedState.liq.map((r) => r.id)]);
    for (const c of seedState.status) await db.query('UPDATE tb_companies SET status = $2, closed_on = $3 WHERE name = $1', [c.name, c.status, c.closed_on]);
    await db.query("UPDATE tb_companies SET status = 'active', closed_on = NULL WHERE NOT (name = ANY($1::text[]))", [seedState.status.map((c) => c.name)]);
    await db.query('DELETE FROM tb_agent_undo');
  },
};
export const makeWrite = (into) => (name, turns, auto = false) => into.push({ name, auto, turns: [reset, ...turns] });
export const makeRead = (into) => (name, turns) => into.push({ name, turns });
const write = makeWrite(WRITES);
const read = makeRead(READS);

// Contacting a do-not-contact company, in her words.
// A CONTACT SUGGESTED, not one refused or quoted: "do not contact them" and
// "told us never to ring him again" failed it (2026-11-04, his OK to fix the check).
export const CONTACTS = /(?<!\b(?:not|never|don'?t|no|without)(?: to)? )\b(?:call|ring|phone|email|e-mail|chase|contact|text|message|reach out to|get in touch with|speak to|write to)(?:ing)? (?:them|him|her|the director|kiran(?: vale)?|the company|harbor nine)\b/i;

// ================= READS =================
read('who we are chasing', [
  { say: 'who are we chasing at the mo on the winding down page?', expect: { tools: ['list_liquidations'], reply: /(?=[\s\S]*Quarry Lane)(?=[\s\S]*Brightwell)/i, db: untouched } },
]);
read('unresolved at one company, lazy', [
  { say: 'whats unresolved at brightwell', expect: { reply: /6,?200|VAT/i, db: untouched } },
]);
read('the joint liquidators', [
  { say: 'who r the liquidators on quarry lane', expect: { reply: /(?=[\s\S]*Kate Morris)(?=[\s\S]*Gareth Lyle)/i, db: untouched } },
]);
read('the official receiver, misspelt company', [
  // A close name is asked first, never picked (his rule 2026-11-04).
  { say: 'whos the OR on harbour nine', expect: { db: untouched, reply: /did you mean|do you mean|exact name|is that|meant/i } },
  { say: 'yes', expect: { reply: /Mark Tolley/i, db: untouched } },
]);
read('who else is involved', [
  { say: 'anyone else involved with harbor nine apart from the receiver?', expect: { reply: /(?=[\s\S]*Chloe Fletcher)(?=[\s\S]*examiner)/i, db: untouched } },
]);
read('what the director said, and who he blamed', [
  { say: 'what did the director say at quarry lane, who did he blame', expect: { reply: /Fairway/i, db: untouched } },
]);
read('when the strike off was suspended', [
  { say: 'when did brightwells strike off get suspended?', expect: { reply: said(-45), db: untouched } },
]);
read('which have no deals with us', [
  { say: 'which of the winding down ones have no deals with us', expect: { reply: /(?=[\s\S]*Copperfield)(?=[\s\S]*Saltmarsh)/i, noReply: /\bBrightwell\b/i, db: untouched } },
]);
read('who changed the play, from the trail', [
  { say: 'who put pinecrest on wait?', expect: { reply: /sophie/i, db: untouched } },
]);
read('do not contact: the next step does not say contact them', [
  { say: 'what should we do next for harbor nine', expect: { tools: ['liquidation_next_step'], noReply: CONTACTS, db: untouched } },
]);
read('the next step names the unresolved matters', [
  { say: 'quarry lane - next step?', expect: { tools: ['liquidation_next_step'], reply: /payroll records|PAYE|48,?210/i, db: untouched } },
]);

// ================= WRITES: the play =================
write('do not contact, with a reason', [
  { say: "pinecrest - do not contact, the director's lawyered up", expect: { db: untouched } },
  { say: 'yes', expect: { db: all(playIs('pinecrest', 'do_not_contact'), audited('pinecrest')) } },
]);
write('park it', [
  { say: 'park brightwell for now, nothing more we can do till hmrc come back', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(playIs('brightwell', 'wait', 'leave'), audited('brightwell')) } },
]);
write('three plays in one message', [
  { say: 'chase pinecrest and ironleaf, put copperfield joinery on leave', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(playIs('pinecrest', 'chase'), playIs('ironleaf', 'chase'), playIs('copperfield joinery', 'leave'), fieldIs('quarry lane', 'play', 'chase')) } },
]);

// ================= WRITES: the text fields =================
write('last action and unresolved together', [
  { say: 'quarry lane: last action - sent the payroll records to begbies today. only thing still outstanding is the PAYE arrears', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(
    fieldIs('quarry lane', 'last_action', /payroll/i),
    fieldIs('quarry lane', 'unresolved', /PAYE/i),
    fieldIs('quarry lane', 'unresolved', /^(?![\s\S]*payroll records missing)/i),
    audited('quarry lane'),
  ) } },
]);
write('what the director said', [
  { say: "brightwell's director rang, says its HMRC's fault the VAT was late, blamed their new online system. stick that in prompts", expect: { db: untouched } },
  { say: 'yes', expect: { db: all(fieldIs('brightwell', 'prompts', /HMRC/i), fieldIs('brightwell', 'prompts', /system/i), audited('brightwell')) } },
]);
write('official receiver changed, then undone', [
  { say: 'OR on harbor nine has changed, its Priya Nair at the Manchester office now', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(fieldIs('harbor nine', 'official_receiver', /Priya Nair/i), audited('harbor nine')) } },
  { say: 'undo that', expect: {} },
  { say: 'yes', expect: { db: all(fieldIs('harbor nine', 'official_receiver', /Mark Tolley/i), audited('harbor nine', 'undo')) } },
]);
write('the gazette date', [
  { say: `saltmarsh bakery's first gazette notice went out on ${longIn(-9)}`, expect: { db: untouched } },
  { say: 'yes', expect: { db: all(stageDateIs('saltmarsh bakery', isoIn(-9)), audited('saltmarsh bakery')) } },
]);

// ================= WRITES: liquidators =================
write('a joint liquidator added, the first kept', [
  { say: 'add Tom Haines as joint liquidator on pinecrest', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(liquidatorsAre('pinecrest', [/FRP/i, /Tom Haines/i], { count: 2 }), audited('pinecrest')) } },
]);
write('the liquidators replaced', [
  { say: "quarry lane's liquidators are now Sam Cole and Ruth Bell from Interpath, the begbies pair are off it", expect: { db: untouched } },
  { say: 'yes', expect: { db: liquidatorsAre('quarry lane', [/Sam Cole/i, /Ruth Bell/i], { not: [/Kate Morris/i, /Gareth Lyle/i] }) } },
]);
write('one liquidator removed, asked first', [
  { say: 'take gareth lyle off quarry lane', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(liquidatorsAre('quarry lane', [/Kate Morris/i], { not: [/Gareth Lyle/i], count: 1 }), audited('quarry lane')) } },
]);

// ================= WRITES: other involved parties =================
write('a party added with a position, then undone', [
  { say: "add Hannah Price on ironleaf, she's the case officer at companies house", expect: { db: untouched } },
  { say: 'yes', expect: { db: all(partyHas('ironleaf', /Hannah Price/i, /case officer/i), audited('ironleaf')) } },
  { say: 'undo that', expect: {} },
  { say: 'yes', expect: { db: all(partyGone('ironleaf', /Hannah Price/i), audited('ironleaf', 'undo')) } },
]);
write('a party removed, asked first', [
  { say: 'remove chloe fletcher from harbor nine, shes not on it anymore', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(partyGone('harbor nine', /Chloe Fletcher/i), audited('harbor nine')) } },
]);
