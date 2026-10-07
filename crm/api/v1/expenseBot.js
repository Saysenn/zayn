const { Router } = require('express');
const store = require('./expenses/bot/store');
const brain = require('./expenses/bot/brain');
const { meter } = require('./expenses/bot/ai');
const { AppError } = require('./middlewares/errors');

// ***************************************************
// * EXPENSES THROUGH WHATBOT
// ***************************************************
//
// Two routers. `agent` is WhatBot's, behind its API key: one message in,
// one reply out, and the list of registered numbers it guards with before
// downloading anything. `admin` is the Settings page's, behind the session:
// who may send expenses on which group's number.

const agent = Router();

/**
 * One WhatsApp message from an admin. `registered: false` means the number
 * is not an admin on this group's bot: WhatBot sends nothing back and
 * handles the message as it always has. Nothing was read.
 */
agent.post('/message', async (req, res, next) => {
  try {
    const { phone, group, text, attachments, messageId } = req.body ?? {};
    if (!phone || !group) return res.status(400).json({ error: 'phone and group are required' });
    const list = Array.isArray(attachments) ? attachments.slice(0, 10) : [];
    const out = await brain.turn({ phone, group, text, attachments: list, messageId: messageId ? String(messageId) : null });
    res.json({ ...out, usd: Number(meter.dollars.toFixed(4)) });
  } catch (err) {
    next(err);
  }
});

/** The registered admins, for WhatBot's guard. Phones and groups only. */
agent.get('/admins', async (req, res, next) => {
  try {
    const rows = await store.listAdmins();
    res.json({ admins: rows.filter((r) => r.active).map((r) => ({ phone: r.phone, group: r.group_name })) });
  } catch (err) {
    next(err);
  }
});

const admin = Router();

admin.get('/expense-admins', async (req, res, next) => {
  try {
    res.json({ admins: await store.listAdmins() });
  } catch (err) {
    next(err);
  }
});

admin.post('/expense-admins', async (req, res, next) => {
  try {
    const { groupName, name, phone } = req.body ?? {};
    if (!groupName || !name || !phone) return next(new AppError(400, 'Group, name and phone are all needed.'));
    res.status(201).json({ admin: await store.addAdmin({ groupName, name, phone }) });
  } catch (err) {
    if (err.status === 400) return next(new AppError(400, err.message));
    next(err);
  }
});

admin.patch('/expense-admins/:id', async (req, res, next) => {
  try {
    const row = await store.updateAdmin(Number(req.params.id), req.body ?? {});
    if (!row) return next(new AppError(404, 'That admin is not registered.'));
    res.json({ admin: row });
  } catch (err) {
    if (err.status === 400) return next(new AppError(400, err.message));
    if (err.code === '23505') return next(new AppError(409, 'That number is already registered on that group.'));
    next(err);
  }
});

admin.delete('/expense-admins/:id', async (req, res, next) => {
  try {
    const gone = await store.removeAdmin(Number(req.params.id));
    if (!gone) return next(new AppError(404, 'That admin is not registered.'));
    res.json({ deleted: gone.id });
  } catch (err) {
    next(err);
  }
});

module.exports = { agent, admin };
