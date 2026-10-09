const pool = require('../../configs/db');
const { currentMonth } = require('../shared/presetMonth.helper');

// ***************************************************
// * REFUNDED OR NOT: SETTLING EXPENSES, AND THE EXPENSES CHECK
// ***************************************************
//
// His calls 2026-10-08 (migration 078). Expenses are refunded apart from
// pay, so they have their own status and their own check:
//   - on payday, right after a person answers their payday check, WhatBot
//     asks "Your expenses: 6 · AED 1,240. Refunded?" (startCheck);
//   - "yes" settles EXACTLY the expenses that message listed, and is final;
//   - "no", "partial" or "sorry, that was a mistake" goes to the CRM admin
//     (status review, and a flag on the Flagged page);
//   - the CRM admin settles, reopens or marks for review by hand.
// Every move is logged, who and why. Nothing is ever settled on its own.

const STATUSES = ['unsettled', 'settled', 'review'];

/** "2026-10" → its first day, and the first day of the month before. */
function monthStarts(month = currentMonth()) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  return { first, prev };
}

const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const monthName = (day) => new Date(`${iso(day).slice(0, 7)}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });

/**
 * WHAT ITS BADGE SAYS, worked out (never stored): settled, review, or for
 * an unsettled one from an earlier month, late (no check listed it yet),
 * unpaid (a check did) or overdue (2 paydays gone). Null: this month's, open.
 */
function tagOf(row, month = currentMonth()) {
  const status = row.settle_status ?? 'unsettled';
  if (status === 'settled') return 'settled';
  if (status === 'review') return 'review';
  const { first, prev } = monthStarts(month);
  const day = iso(row.spent_on);
  if (day >= first) return null;
  if (day < prev) return 'overdue';
  return row.settle_check_id ? 'unpaid' : 'late';
}

/** The month it is from, for "late · from Sep". */
const fromMonth = (row) => monthName(row.spent_on);

/**
 * MOVE SOME TO A STATUS, logged: only the ones not already there. Settled
 * stamps when and who; anything else clears that stamp.
 * @returns {Promise<object[]>} the rows that moved, as they are now
 */
async function setStatus(ids, to, { by = null, via, checkId = null, note = null, only = null } = {}) {
  if (!STATUSES.includes(to)) throw new Error(`not a status: ${to}`);
  const list = [...new Set((ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!list.length) return [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: before } = await client.query(
      `SELECT id, settle_status FROM tb_expenses WHERE id = ANY($1::int[]) AND settle_status <> $2 ${only ? 'AND settle_status = ANY($3::text[])' : ''} FOR UPDATE`,
      only ? [list, to, only] : [list, to],
    );
    if (!before.length) { await client.query('COMMIT'); return []; }
    const moving = before.map((r) => r.id);
    const { rows } = await client.query(
      `UPDATE tb_expenses
          SET settle_status = $2,
              settled_at = CASE WHEN $2 = 'settled' THEN now() ELSE NULL END,
              settled_by = CASE WHEN $2 = 'settled' THEN $3 ELSE NULL END,
              settle_check_id = COALESCE($4, settle_check_id),
              updated_at = now()
        WHERE id = ANY($1::int[])
        RETURNING *`,
      [moving, to, by, checkId],
    );
    await client.query(
      `INSERT INTO tb_expense_settle_log (expense_id, from_status, to_status, by_who, via, check_id, note)
       SELECT b.id, b.settle_status, $2, $3, $4, $5, $6 FROM unnest($1::int[], $7::text[]) AS b(id, settle_status)`,
      [moving, to, by, via, checkId, note, before.map((r) => r.settle_status)],
    );
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Their expenses still to be refunded in one group: linked to them, not settled, not under review. */
async function openFor({ personId, group }) {
  const { rows } = await pool.query(
    `SELECT id, spent_on, description, payee, currency, raw_amount, aed_amount
       FROM tb_expenses
      WHERE spent_by_person_id = $1 AND upper(group_name) = upper($2)
        AND settle_status = 'unsettled' AND archived_at IS NULL
      ORDER BY spent_on, id`,
    [String(personId), group],
  );
  return rows;
}

async function switchOn() {
  try {
    const { rows } = await pool.query('SELECT expense_check_enabled FROM tb_settings WHERE id = 1');
    return rows[0]?.expense_check_enabled === true;
  } catch (err) {
    if (err?.code === '42703') return false;
    throw err;
  }
}

function setSwitch(on) {
  return pool
    .query('UPDATE tb_settings SET expense_check_enabled = $1, updated_at = now() WHERE id = 1 RETURNING expense_check_enabled', [on === true])
    .then((r) => r.rows[0]?.expense_check_enabled === true);
}

const money = (n) => `AED ${Number(n ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const raw = (r) => `${r.currency} ${Number(r.raw_amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (v) => new Date(`${iso(v)}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });

/** The question, short: how many, how much, each one, and how to answer. */
function questionText(check, rows) {
  const lines = rows.slice(0, 10).map((r, i) => `${i + 1}. ${day(r.spent_on)} · ${r.description} · ${raw(r)}`);
  return [
    `🧾 *Your expenses · ${check.group_name}*`,
    `${rows.length} ${rows.length === 1 ? 'expense' : 'expenses'} · *${money(check.total_aed)}*`,
    ...lines,
    ...(rows.length > 10 ? [`…and ${rows.length - 10} more`] : []),
    '',
    `Refunded? Reply *yes* or *no*. If only some ${rows.length === 1 ? 'of it' : 'were'}, reply *partial*.`,
  ].join('\n');
}

/**
 * ASK ONE PERSON, ONCE A PAYDAY: what is still theirs to be refunded here.
 * The same check comes back if it was already made (a resend asks nothing
 * new). Null when the switch is off or nothing is open.
 */
async function startCheck({ period, personId, group, phone = null, name = null }) {
  if (!(await switchOn())) return null;
  const { rows: had } = await pool.query('SELECT * FROM tb_expense_checks WHERE period = $1 AND upper(group_name) = upper($2) AND person_id = $3', [period, group, String(personId)]);
  if (had[0]) {
    if (had[0].status !== 'sent') return null;
    const { rows } = await pool.query('SELECT id, spent_on, description, payee, currency, raw_amount, aed_amount FROM tb_expenses WHERE id = ANY($1::int[]) ORDER BY spent_on, id', [had[0].expense_ids]);
    return { check: had[0], rows, text: questionText(had[0], rows) };
  }
  const open = await openFor({ personId, group });
  if (!open.length) return null;
  const total = Math.round(open.reduce((n, r) => n + Number(r.aed_amount ?? 0), 0) * 100) / 100;
  const { rows: made } = await pool.query(
    `INSERT INTO tb_expense_checks (period, group_name, person_id, phone, name, expense_ids, total_aed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (period, group_name, person_id) DO NOTHING RETURNING *`,
    [period, group, String(personId), phone, name, open.map((r) => r.id), total],
  );
  const check = made[0] ?? (await pool.query('SELECT * FROM tb_expense_checks WHERE period = $1 AND group_name = $2 AND person_id = $3', [period, group, String(personId)])).rows[0];
  await pool.query('UPDATE tb_expense_checks SET sent_at = now() WHERE id = $1', [check.id]);
  await pool.query('UPDATE tb_expenses SET settle_check_id = $1 WHERE id = ANY($2::int[]) AND settle_status = $3', [check.id, check.expense_ids, 'unsettled']);
  return { check, rows: open, text: questionText(check, open) };
}

/** A flag for the CRM admin, on the Flagged page. */
async function flag(check, message) {
  // eslint-disable-next-line global-require
  const concerns = require('./concerns.repo');
  return concerns.create({ personId: check.person_id, groupName: check.group_name, category: 'expense-refund', message });
}

/**
 * THEIR ANSWER. yes: settles exactly what was listed (still unsettled),
 * final. no / partial / mistake: the CRM admin looks at it. What to say back
 * is written here, short.
 * @param {'yes'|'no'|'partial'|'mistake'} answer
 */
async function answerCheck(checkId, answer, note = null) {
  const { rows } = await pool.query('SELECT * FROM tb_expense_checks WHERE id = $1', [checkId]);
  const check = rows[0];
  if (!check) return null;
  const first = String(check.name ?? '').split(' ')[0] || 'there';
  const n = check.expense_ids.length;
  const them = n === 1 ? 'expense' : `${n} expenses`;
  if (answer === 'yes') {
    if (check.status !== 'sent') return { check, reply: `Thanks ${first}, that's already noted.` };
    const moved = await setStatus(check.expense_ids, 'settled', { by: check.name, via: 'check', checkId: check.id, note: 'their yes to the Expenses check', only: ['unsettled'] });
    await pool.query("UPDATE tb_expense_checks SET status = 'settled', answer = 'yes', replied_at = now() WHERE id = $1", [check.id]);
    return { check, moved: moved.length, reply: `✅ Thanks ${first}. Your ${them} ${n === 1 ? 'is' : 'are'} marked as refunded.` };
  }
  if (answer === 'mistake') {
    // a yes is final: the expenses stay settled, and the admin decides
    await pool.query("UPDATE tb_expense_checks SET status = 'review', answer = 'mistake', note = $2, replied_at = now() WHERE id = $1", [check.id, note]);
    await flag(check, `Said their expenses refund was a mistake (${n} · ${money(check.total_aed)}): "${String(note ?? '').slice(0, 300)}"`);
    return { check, reply: 'No problem. I\'ve asked the team to check your expenses refund again.' };
  }
  if (answer === 'no' || answer === 'partial') {
    if (check.status === 'review' && check.answer === answer) return { check, reply: 'Thanks, the team already has it.' };
    await setStatus(check.expense_ids, 'review', { by: check.name, via: 'check', checkId: check.id, note: `their ${answer} to the Expenses check`, only: ['unsettled'] });
    await pool.query('UPDATE tb_expense_checks SET status = \'review\', answer = $2, note = $3, replied_at = now() WHERE id = $1', [check.id, answer, note]);
    await flag(check, answer === 'no'
      ? `Says their expenses were NOT refunded (${n} · ${money(check.total_aed)}).`
      : `Says only part of their expenses was refunded (${n} · ${money(check.total_aed)}): "${String(note ?? '').slice(0, 300)}"`);
    return {
      check,
      reply: answer === 'no'
        ? `Thanks for telling us, ${first}. I've passed it to the team: your ${them} ${n === 1 ? 'is' : 'are'} not marked as refunded.`
        : 'Thanks. I\'ve passed it to the team, so they can check which ones were refunded.',
    };
  }
  return null;
}

/**
 * THE 1ST OF THE MONTH, AND WEEKLY AFTER (his call 2026-10-08): one flag
 * per person still owed for an earlier month, unless one is already open
 * from the last 7 days. The CRM admin sees it on the Flagged page.
 */
async function raiseUnpaid({ month = currentMonth() } = {}) {
  const { first, prev } = monthStarts(month);
  const { rows } = await pool.query(
    `SELECT e.spent_by_person_id AS person_id, e.group_name, count(*)::int AS n, COALESCE(sum(e.aed_amount), 0) AS aed,
            count(*) FILTER (WHERE e.spent_on < $2)::int AS overdue, min(e.spent_on) AS oldest
       FROM tb_expenses e
      WHERE e.settle_status <> 'settled' AND e.spent_on < $1 AND e.spent_by_person_id IS NOT NULL AND e.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM tb_concerns c WHERE c.person_id = e.spent_by_person_id AND c.group_name = e.group_name
                         AND c.category = 'expense-refund' AND c.status <> 'resolved' AND c.created_at > now() - interval '7 days')
      GROUP BY 1, 2`,
    [first, prev],
  );
  // eslint-disable-next-line global-require
  const concerns = require('./concerns.repo');
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    await concerns.create({
      personId: r.person_id,
      groupName: r.group_name,
      category: 'expense-refund',
      message: `${r.n} ${r.n === 1 ? 'expense' : 'expenses'} from ${monthName(r.oldest)} still not refunded (${money(r.aed)})${r.overdue ? ` · ${r.overdue} overdue` : ''}.`,
    });
  }
  return rows.length;
}

/** The settle history of one expense, newest first. */
function logFor(expenseId) {
  return pool.query('SELECT * FROM tb_expense_settle_log WHERE expense_id = $1 ORDER BY created_at DESC LIMIT 20', [expenseId]).then((r) => r.rows);
}

module.exports = {
  STATUSES, tagOf, fromMonth, monthStarts, setStatus, openFor, startCheck, answerCheck, raiseUnpaid, logFor, switchOn, setSwitch, questionText,
};
