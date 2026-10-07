const { Router } = require('express');
const multer = require('multer');
const files = require('./expenses/bot/files');
const { messages } = require('./shared/messages');
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
    // A burst of receipts arrives as one turn (WhatBot's expenses/batch.js).
    const list = Array.isArray(attachments) ? attachments.slice(0, 20) : [];
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

/**
 * A FILE FOR DIANE'S EXPENSES CONTEXT: a receipt photo, a PDF, or a sheet.
 * Held briefly by id (expenses/bot/files.js), never put in the chat, which
 * is posted whole every turn.
 */
const attachUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (!/\.(jpe?g|png|webp|heic|pdf|xlsx|csv|txt|tsv|json|docx|pptx)$/i.test(file.originalname)) {
      return cb(new AppError(400, `For expenses I can read photos, PDFs, Excel, CSV, Word, PowerPoint or text files, not ${file.originalname}.`));
    }
    cb(null, true);
  },
});
admin.post('/expenses/agent/attach', (req, res, next) => {
  attachUpload.single('file')(req, res, (err) => {
    if (err) return next(err instanceof AppError ? err : new AppError(400, err.message));
    if (!req.file) return next(new AppError(400, messages.noFile));
    const name = req.file.originalname;
    const mime = req.file.mimetype && req.file.mimetype !== 'application/octet-stream'
      ? req.file.mimetype
      : /\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : 'image/jpeg';
    const fileId = files.hold({ buffer: req.file.buffer, filename: name, mime });
    res.json({ fileId, filename: name, mime });
  });
});

/**
 * ONE TURN OF DIANE'S EXPENSES CONTEXT, for agent/workspaces.js: the last
 * thing they said (and the file with it, by id) to the expense brain, for
 * every group and with no spender assumed. A preview goes out as a card.
 */
async function dianeTurn(history, send) {
  const last = [...history].reverse().find((m) => m.role === 'user') ?? {};
  const text = String(last.content ?? '').replace(/^📎 [^\n]*\n?/, '').trim();
  // SEVERAL FILES IN ONE MESSAGE (the paperclip takes up to 20): one turn,
  // one preview for all of them.
  const wanted = last.attachment?.files?.length ? last.attachment.files : last.attachment?.fileId ? [last.attachment] : [];
  const atts = wanted.map((f) => ({ name: f.filename, file: files.get(f.fileId) }));
  const gone = atts.filter((a) => !a.file).map((a) => a.name ?? 'a file');
  if (gone.length) {
    return { reply: `I no longer have ${gone.join(', ')} (files are kept for an hour). Attach ${gone.length === 1 ? 'it' : 'them'} again.` };
  }
  const out = await brain.turn({ text, attachments: atts.map((a) => a.file) }, { channel: 'diane' });
  if (out.card) send({ type: 'list', list: out.card });
  return { reply: out.reply ?? '' };
}

module.exports = { agent, admin, dianeTurn };
