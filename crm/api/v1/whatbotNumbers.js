const { Router } = require('express');
const { AppError } = require('./middlewares/errors');
const pool = require('../configs/db');
const { e164 } = require('./expenses/bot/store');

// ***************************************************
// * WHATBOT NUMBERS, PER GROUP (migration 083)
// ***************************************************
//
// Two routers, like expenseBot.js. `agent` is WhatBot's worker, behind its
// API key: it posts how each number is doing and gets the list back, every
// few seconds. `admin` is Settings → Whatbot, behind the session.
//
// THE QR IS NEVER STORED. Whoever holds it can link that WhatsApp account,
// so it is kept in memory here for a minute and only shown to a signed-in
// admin. A restart forgets it; the worker sends a fresh one within seconds.

const QR_TTL_MS = 60_000;
// The worker reports at least every 10 seconds: past this it has stopped.
const STALE_MS = 45_000;

/** group → { state, qr, code, at }. state: connected | waiting | offline | logged_out */
const live = new Map();
let workerSeenAt = 0;

const group = (g) => String(g ?? '').trim().toUpperCase();

function list() {
  return pool.query('SELECT * FROM tb_whatbot_numbers ORDER BY group_name').then((r) => r.rows);
}

/** How a number is doing, as the Settings page shows it. */
function statusOf(groupName) {
  const s = live.get(group(groupName));
  if (!s || Date.now() - workerSeenAt > STALE_MS) return { state: 'unknown' };
  return { state: s.state, at: s.at };
}

const bad = (message) => Object.assign(new Error(message), { status: 400 });

function checkPhone(phone) {
  const p = e164(phone);
  if (!p) throw bad(`${phone} is not a phone number. Use the full number with its country code, like +447700900123.`);
  return p;
}

const agent = Router();

/**
 * THE WORKER'S ONE CALL. In: `statuses` (each group's state, with its QR or
 * code while waiting), `done` (relinks it carried out), `seed` (its .env
 * numbers, taken once ever). Out: every number, on or off.
 */
agent.post('/sync', async (req, res, next) => {
  try {
    const { statuses, done, seed } = req.body ?? {};
    workerSeenAt = Date.now();
    // Only numbers that are on: a report racing an Off must not bring back its QR.
    const on = new Set((await list()).filter((n) => n.active).map((n) => group(n.group_name)));
    for (const g of live.keys()) if (!on.has(g)) live.delete(g);
    for (const s of Array.isArray(statuses) ? statuses : []) {
      const g = group(s?.group);
      if (!on.has(g) || !['connected', 'waiting', 'offline', 'logged_out'].includes(s.state)) continue;
      const prev = live.get(g);
      live.set(g, {
        state: s.state,
        qr: s.state === 'waiting' ? (s.qr ?? null) : null,
        code: s.state === 'waiting' ? (s.code ?? null) : null,
        // When it last CHANGED, not when it was last reported.
        at: prev?.state === s.state ? prev.at : Date.now(),
        // A QR WhatsApp has not replaced in a minute is dead: it rotates every ~20 seconds.
        qrAt: s.qr && s.qr === prev?.qr ? prev.qrAt : Date.now(),
      });
    }
    for (const d of Array.isArray(done) ? done : []) {
      if (d?.group && d.relinkAt) {
        await pool.query(
          // JS keeps milliseconds, Postgres microseconds: a newer Relink is never cleared
          `UPDATE tb_whatbot_numbers SET relink_at = NULL
            WHERE upper(group_name) = $1 AND relink_at < $2::timestamptz + interval '1 millisecond'`,
          [group(d.group), d.relinkAt],
        );
      }
    }
    if (Array.isArray(seed) && seed.length) {
      const { rows } = await pool.query('SELECT whatbot_numbers_seeded FROM tb_settings WHERE id = 1');
      if (rows[0] && !rows[0].whatbot_numbers_seeded) {
        for (const s of seed) {
          const p = e164(s?.phone);
          if (!p || !group(s?.group)) continue;
          await pool.query(
            'INSERT INTO tb_whatbot_numbers (group_name, phone) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [group(s.group), p],
          );
        }
        await pool.query('UPDATE tb_settings SET whatbot_numbers_seeded = true WHERE id = 1');
      }
    }
    const numbers = (await list()).map((n) => ({
      group: group(n.group_name),
      phone: n.phone,
      active: n.active,
      linkWith: n.link_with,
      relinkAt: n.relink_at ? n.relink_at.toISOString() : null,
    }));
    res.json({ numbers });
  } catch (err) {
    next(err);
  }
});

const admin = Router();

admin.get('/whatbot-numbers', async (req, res, next) => {
  try {
    const rows = await list();
    res.json({
      worker: Date.now() - workerSeenAt <= STALE_MS,
      numbers: rows.map((n) => ({ ...n, ...statusOf(n.group_name) })),
    });
  } catch (err) {
    next(err);
  }
});

admin.post('/whatbot-numbers', async (req, res, next) => {
  try {
    const { groupName, phone } = req.body ?? {};
    if (!group(groupName) || !phone) return next(new AppError(400, 'Group and number are both needed.'));
    if (group(groupName) === 'ALL GROUPS') return next(new AppError(400, 'Pick one group: each group has its own number.'));
    const { rows } = await pool.query(
      'INSERT INTO tb_whatbot_numbers (group_name, phone) VALUES ($1, $2) RETURNING *',
      [group(groupName), checkPhone(phone)],
    );
    res.status(201).json({ number: rows[0] });
  } catch (err) {
    if (err.status === 400) return next(new AppError(400, err.message));
    if (err.code === '23505') return next(new AppError(409, 'That group already has a WhatBot number, or that number is already used.'));
    next(err);
  }
});

admin.patch('/whatbot-numbers/:id', async (req, res, next) => {
  try {
    const { active, linkWith } = req.body ?? {};
    const sets = [];
    const params = [Number(req.params.id)];
    const put = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
    if (active !== undefined) put('active', Boolean(active));
    if (linkWith !== undefined) {
      if (!['qr', 'code'].includes(linkWith)) return next(new AppError(400, 'Link with a QR or a code.'));
      put('link_with', linkWith);
    }
    if (!sets.length) return next(new AppError(400, 'Nothing to change.'));
    const { rows } = await pool.query(
      `UPDATE tb_whatbot_numbers SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      params,
    );
    if (!rows[0]) return next(new AppError(404, 'That number is not registered.'));
    // switched off or to another way of linking: its last report no longer holds
    if (active === false || linkWith !== undefined) live.delete(group(rows[0].group_name));
    res.json({ number: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** Log the number out and link it again: the worker sets the old link aside. */
admin.post('/whatbot-numbers/:id/relink', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE tb_whatbot_numbers SET relink_at = now(), updated_at = now() WHERE id = $1 RETURNING *',
      [Number(req.params.id)],
    );
    if (!rows[0]) return next(new AppError(404, 'That number is not registered.'));
    live.delete(group(rows[0].group_name));
    res.json({ number: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** The QR or code to link it, while it is waiting for one. Never logged, never stored. */
admin.get('/whatbot-numbers/:id/link', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tb_whatbot_numbers WHERE id = $1', [Number(req.params.id)]);
    if (!rows[0]) return next(new AppError(404, 'That number is not registered.'));
    const s = live.get(group(rows[0].group_name));
    const { state } = statusOf(rows[0].group_name);
    const waiting = s && state === 'waiting';
    res.set('Cache-Control', 'no-store');
    res.json({
      state,
      linkWith: rows[0].link_with,
      qr: waiting && Date.now() - s.qrAt <= QR_TTL_MS ? s.qr : null,
      code: waiting ? s.code : null,
    });
  } catch (err) {
    next(err);
  }
});

admin.delete('/whatbot-numbers/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('DELETE FROM tb_whatbot_numbers WHERE id = $1 RETURNING id, group_name', [Number(req.params.id)]);
    if (!rows[0]) return next(new AppError(404, 'That number is not registered.'));
    live.delete(group(rows[0].group_name));
    res.json({ deleted: rows[0].id });
  } catch (err) {
    next(err);
  }
});

module.exports = { agent, admin };
