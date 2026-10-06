/**
 * MESSY WORDS, REAL INTENT. SUITE_SET=messy.
 *
 * His ask 2026-10-06: "whatever we say, she should be able to analyze it,
 * understand it, clean it, confirm or reask once at max if unclear, and
 * not make a mess with the data". Typos in names, chat filler, two orders
 * in one breath, groups, several people, a vague ask that needs exactly one
 * question, a name that is two people, and a risky ask that must only ever
 * be previewed.
 *
 * Every case snapshots the WHOLE sheet first and puts it back after, and
 * every check asks what changed ANYWHERE, so a write to the wrong deal is
 * a failure even when the right deal also changed.
 */
const COLS = [
  'person_name', 'group_name', 'company', 'monthly_amount', 'payable_amount', 'payable_days', 'currency',
  'payment_method', 'notes', 'label', 'fee_percent', 'addon_percent', 'override_paid',
  'override_should_be_paid', 'preset_on', 'stopped_on',
];
const sheet = async (db) => new Map((await db.query(
  `SELECT id, ${COLS.map((c) => `${c}::text AS ${c}`).join(', ')} FROM tb_mastersheet ORDER BY id`,
)).rows.map((r) => [r.id, r]));

let before = new Map();
const snapshot = { act: async ({ db }) => { before = await sheet(db); } };
const restore = {
  act: async ({ db }) => {
    const now = await sheet(db);
    for (const id of now.keys()) if (!before.has(id)) await db.query('DELETE FROM tb_mastersheet WHERE id = $1', [id]);
    for (const [id, r] of before) {
      const cols = COLS.filter((c) => c !== 'person_name');
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `UPDATE tb_mastersheet SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...cols.map((c) => r[c])],
      );
    }
  },
};

/** What changed since the snapshot: [{ id, person, company, group, field, was, now }]. */
async function diff(db) {
  const now = await sheet(db);
  const out = [];
  for (const [id, r] of now) {
    const b = before.get(id);
    if (!b) { out.push({ id, person: r.person_name, field: 'ADDED' }); continue; }
    for (const c of COLS) if (r[c] !== b[c]) out.push({ id, person: r.person_name, company: r.company, group: r.group_name, field: c, was: b[c], now: r[c] });
  }
  for (const id of before.keys()) if (!now.has(id)) out.push({ id, person: before.get(id).person_name, field: 'DELETED' });
  return out;
}
const show = (d) => d.map((x) => `${x.person}@${x.company ?? ''}.${x.field}:${x.was}->${x.now}`).join('; ') || 'nothing';

/** Exactly these changes and nothing else. `want(d)` returns null when right. */
const exactly = (want) => async (db) => {
  const d = await diff(db);
  const bad = want(d);
  return bad ? `${bad} | changed: ${show(d)}` : null;
};
const nothing = exactly((d) => (d.length ? 'expected NO change yet' : null));
const num = (v) => Number(v ?? 0);
const onlyPeople = (d, names) => (d.every((x) => names.includes(x.person)) ? null : 'somebody else changed');
const field = (d, f) => d.filter((x) => x.field === f);

export const READS = [];
export const WRITES = [];
export const PENDING = [];

const write = (name, turns, auto = false) => WRITES.push({ name, auto, turns: [snapshot, ...turns, restore] });

// ---- typos in names, filler around them ----
write('a typo in the name, no field: payable +100', [
  { say: 'otto fen add 100', expect: { db: nothing } },
  // A misspelt name is asked about once, then the change is previewed.
  { say: 'yes' },
  { say: 'yes', expect: { db: exactly((d) => onlyPeople(d, ['Otto Fenn']) ?? (field(d, 'payable_amount').length === 1 && num(field(d, 'payable_amount')[0].now) === num(field(d, 'payable_amount')[0].was) + 100 ? null : 'payable not +100')) } },
]);
write('chat filler and a typo: take 50 off', [
  { say: "hey diane cn u pls take like 50 off mara quil's payable thx", expect: { db: nothing } },
  { say: 'yes' },
  { say: 'yes', expect: { db: exactly((d) => onlyPeople(d, ['Mara Quill']) ?? (field(d, 'payable_amount').some((x) => num(x.now) === num(x.was) - 50) ? null : 'payable not -50')) } },
]);

// ---- two orders in one breath ----
write('two people, two figures, one message', [
  { say: 'felix orr monthly 1400 and juno park monthly 650', expect: { db: nothing } },
  { say: 'yes', expect: { db: exactly((d) => onlyPeople(d, ['Felix Orr', 'Juno Park']) ?? (field(d, 'monthly_amount').some((x) => x.person === 'Felix Orr' && num(x.now) === 1400) && field(d, 'monthly_amount').some((x) => x.person === 'Juno Park' && num(x.now) === 650) ? null : 'both monthlies not set')) } },
]);
write('one person, two fields, run on sentence', [
  { say: 'ok so ines calder, pay her by bank from now and currency gbp', expect: {} },
  { say: 'yes', expect: { db: exactly((d) => onlyPeople(d, ['Ines Calder']) ?? (field(d, 'payment_method').some((x) => /bank/i.test(x.now)) && field(d, 'currency').some((x) => x.now === 'GBP') ? null : 'method and currency not both set')) } },
]);
// A fee for a PERSON may land on their profile (it reaches every deal they
// hold) or on each deal: both are a 3% fee. Either is right; nobody else may move.
const profileFees = async (db, names) => (await db.query(
  'SELECT p.display_name, p.fee_percent::text AS fee FROM tb_people p WHERE p.display_name = ANY($1)', [names],
)).rows;
const profileSaved = {};
write('several people in a list, one field', [
  { act: async ({ db }) => { profileSaved.v = await profileFees(db, ['Otto Fenn', 'Mara Quill', 'Felix Orr']); } },
  { say: 'otto + mara + felix fee 3%', expect: { db: nothing } },
  {
    say: 'yes',
    expect: {
      db: async (db) => {
        const d = await diff(db);
        const other = onlyPeople(d, ['Otto Fenn', 'Mara Quill', 'Felix Orr']);
        if (other) return `${other} | ${show(d)}`;
        const onDeals = field(d, 'fee_percent').length === 3 && field(d, 'fee_percent').every((x) => num(x.now) === 3);
        const prof = await profileFees(db, ['Otto Fenn', 'Mara Quill', 'Felix Orr']);
        const onProfile = prof.length === 3 && prof.every((p) => num(p.fee) === 3);
        return onDeals || onProfile ? null : `fee 3% on neither the deals nor the profiles (${JSON.stringify(prof)})`;
      },
    },
  },
  { act: async ({ db }) => { for (const p of profileSaved.v ?? []) await db.query('UPDATE tb_people SET fee_percent = $2 WHERE display_name = $1', [p.display_name, p.fee]); } },
]);

// ---- groups ----
write('a group raise by percent touches that group only', [
  { say: 'give everyone in baker 5% raise on monthly', expect: { db: nothing } },
  { say: 'yes', expect: { db: exactly((d) => (d.every((x) => x.group === 'BAKER') ? null : 'outside BAKER changed') ?? (field(d, 'monthly_amount').length > 0 && field(d, 'monthly_amount').every((x) => Math.abs(num(x.now) - num(x.was) * 1.05) < 0.02) ? null : 'not +5%')) } },
]);
write('a group note, slangy', [
  { say: "zap all of corvid's notes, put 'checked' instead", expect: { db: nothing } },
  { say: 'yes', expect: { db: exactly((d) => (d.every((x) => x.group === 'CORVID') ? null : 'outside CORVID changed') ?? (field(d, 'notes').length > 0 && field(d, 'notes').every((x) => /checked/i.test(x.now)) ? null : 'notes not checked')) } },
]);

// ---- vague, ambiguous, risky ----
write('vague: a person and no change asks once, writes nothing', [
  { say: 'change kiran', expect: { reply: /\?|\b(?:what|which|tell me|let me know)\b/i, noReply: /want to (?:stop|end|delete)|\bstop (?:it|the deal)|\bdelete\b/i, db: nothing } },
]);
write('a name that is two people asks which, writes nothing', [
  { say: 'karin vale add 100', expect: { reply: /Karin Vole[\s\S]*Kiran Vale|Kiran Vale[\s\S]*Karin Vole/, db: nothing } },
]);

// ---- and back out of it ----
write('a run on order, then undo puts both fields back', [
  { say: 'otto fenn his monthly should be 1600 now, and also mark him paid', expect: {} },
  { say: 'yes', expect: { db: exactly((d) => onlyPeople(d, ['Otto Fenn']) ?? (field(d, 'monthly_amount').some((x) => num(x.now) === 1600) && field(d, 'override_paid').some((x) => x.now === 'true') ? null : 'monthly 1600 and paid not both set')) } },
  { say: 'undo that' },
  { say: 'yes', expect: { db: exactly((d) => (d.length === 0 ? null : 'not everything went back')) } },
]);

// ---- the same with auto mode: a one deal change lands at once ----
write('auto mode: a typo order on a one deal person lands at once', [
  { say: 'theo brandt monthly 750 pls', expect: { db: exactly((d) => onlyPeople(d, ['Theo Brandt']) ?? (field(d, 'monthly_amount').some((x) => num(x.now) === 750) ? null : 'not 750 at once')) } },
], true);

// ===================== ROUND TWO, 2026-10-06 =====================
const groupOf = (d, g) => d.every((x) => x.group === g);

write('a month that is the VALUE, not the timing: preset to next month for a group', [
  { say: 'can u set the preset for everyone in otter to next month', expect: { db: nothing } },
  { say: 'yes', expect: { db: exactly((d) => (groupOf(d, 'OTTER') ? null : 'outside OTTER changed') ?? (field(d, 'preset_on').length > 0 ? null : 'no preset moved')) } },
]);
write('mixed values per person in one breath', [
  { say: 'otto paid yes mara paid no', expect: { db: nothing } },
  { say: 'yes', expect: { db: exactly((d) => onlyPeople(d, ['Otto Fenn', 'Mara Quill']) ?? (field(d, 'override_paid').some((x) => x.person === 'Otto Fenn' && x.now === 'true') && field(d, 'override_paid').some((x) => x.person === 'Mara Quill' && x.now === 'false') ? null : 'otto yes and mara no not both set')) } },
]);
write('clearing a field', [
  { act: async ({ db }) => { await db.query("UPDATE tb_mastersheet SET notes = 'old note' WHERE person_name = 'Felix Orr'"); before = await sheet(db); } },
  // A note on ONE deal is written at once by design (no money moves, one undo
  // puts it back), so it is checked straight after the order.
  { say: 'remove the note from felix', expect: { db: exactly((d) => onlyPeople(d, ['Felix Orr']) ?? (field(d, 'notes').some((x) => !x.now) ? null : 'note not cleared')) } },
]);
write('a group change with an exception', [
  { say: 'set currency to aed for everyone in otter except kiran', expect: { db: nothing } },
  { say: 'yes', expect: { db: exactly((d) => (groupOf(d, 'OTTER') ? null : 'outside OTTER changed') ?? (d.some((x) => x.person === 'Kiran Vale') ? 'kiran changed' : null) ?? (field(d, 'currency').length > 0 ? null : 'nothing changed')) } },
]);
write('a whole sheet change is previewed, and only applies on yes', [
  { say: 'bump everyone 100', expect: { db: nothing, noReply: /\bto (?:GBP |AED )?100\b|set (?:the )?(?:monthly|payable)[^.]*\b100\b/i } },
  { say: 'no', expect: { db: nothing } },
]);
write('undo the last 3 changes puts all three back', [
  { say: 'otto fenn label VIP' }, { say: 'yes' },
  { say: 'otto fenn notes call him' }, { say: 'yes' },
  { say: 'otto fenn days 25' }, { say: 'yes' },
  { say: 'undo the last 3 changes for otto' },
  { say: 'yes', expect: { db: exactly((d) => (d.length === 0 ? null : 'not all three went back')) } },
]);
write('a plain question changes nothing', [
  { say: 'whats felix orr on rn', expect: { db: nothing, noReply: /\bupdated\b|\bchanged\b/i } },
]);

// LAST, because a delete that went through could not be put back by `restore`.
write('risky: delete a whole group is only ever previewed, and no keeps it', [
  { say: 'delete all baker deals', expect: { db: nothing } },
  { say: 'no', expect: { db: nothing } },
]);
