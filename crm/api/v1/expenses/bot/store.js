const pool = require('../../../configs/db');

// ***************************************************
// * THE EXPENSE BOT'S OWN TABLES (migration 072)
// ***************************************************
//
// Who may send expenses on which group's number, the conversation waiting on
// a "yes", and what was done so "undo" can put it back. tb_expenses itself
// is only ever written through expenses.repo.js.

/** "+44 7798 710939", "447798710939" → "+447798710939". Null when it is not a phone. */
function e164(value) {
  const digits = String(value ?? '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  const withPlus = digits.startsWith('+') ? digits : `+${digits}`;
  return /^\+\d{7,15}$/.test(withPlus) ? withPlus : null;
}

// ---- registered admins ----

function listAdmins() {
  return pool.query('SELECT * FROM tb_expense_admins ORDER BY group_name, name').then((r) => r.rows);
}

/** The ACTIVE admin for this phone on this group's number, or null. The guard. */
async function adminFor(phone, group) {
  const p = e164(phone);
  if (!p || !group) return null;
  const { rows } = await pool.query(
    `SELECT * FROM tb_expense_admins
      WHERE phone = $1 AND lower(group_name) = lower($2) AND active`,
    [p, String(group).trim()],
  );
  return rows[0] ?? null;
}

async function addAdmin({ groupName, name, phone }) {
  const p = e164(phone);
  if (!p) throw Object.assign(new Error(`${phone} is not a phone number. Use the full number with its country code, like +447700900123.`), { status: 400 });
  const { rows } = await pool.query(
    `INSERT INTO tb_expense_admins (group_name, name, phone) VALUES ($1, $2, $3)
     ON CONFLICT (group_name, phone) DO UPDATE SET name = EXCLUDED.name, active = true, updated_at = now()
     RETURNING *`,
    [String(groupName).trim(), String(name).trim(), p],
  );
  return rows[0];
}

async function updateAdmin(id, { name, phone, groupName, active }) {
  const sets = [];
  const params = [id];
  const put = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (name !== undefined) put('name', String(name).trim());
  if (groupName !== undefined) put('group_name', String(groupName).trim());
  if (active !== undefined) put('active', Boolean(active));
  if (phone !== undefined) {
    const p = e164(phone);
    if (!p) throw Object.assign(new Error(`${phone} is not a phone number.`), { status: 400 });
    put('phone', p);
  }
  if (!sets.length) return pool.query('SELECT * FROM tb_expense_admins WHERE id = $1', [id]).then((r) => r.rows[0] ?? null);
  const { rows } = await pool.query(
    `UPDATE tb_expense_admins SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    params,
  );
  return rows[0] ?? null;
}

function removeAdmin(id) {
  return pool.query('DELETE FROM tb_expense_admins WHERE id = $1 RETURNING id', [id]).then((r) => r.rows[0] ?? null);
}

// ---- the conversation ----

async function getChat(phone, group) {
  const { rows } = await pool.query(
    'SELECT state FROM tb_expense_chats WHERE phone = $1 AND group_name = $2',
    [phone, group],
  );
  return rows[0]?.state ?? {};
}

function saveChat(phone, group, state) {
  return pool.query(
    `INSERT INTO tb_expense_chats (phone, group_name, state, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (phone, group_name) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [phone, group, JSON.stringify(state)],
  );
}

// ---- what was done, for undo ----

function recordAction(client, { phone, group, kind, changes, summary }) {
  return client.query(
    `INSERT INTO tb_expense_actions (phone, group_name, kind, changes, summary)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [phone, group, kind, JSON.stringify(changes), summary],
  ).then((r) => r.rows[0]);
}

/** Their latest action not yet undone (undo never undoes an undo). */
function lastAction(phone, group) {
  return pool.query(
    `SELECT * FROM tb_expense_actions
      WHERE phone = $1 AND group_name = $2 AND undone_at IS NULL AND kind <> 'undo'
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [phone, group],
  ).then((r) => r.rows[0] ?? null);
}

module.exports = {
  e164, listAdmins, adminFor, addAdmin, updateAdmin, removeAdmin, getChat, saveChat, recordAction, lastAction,
};
