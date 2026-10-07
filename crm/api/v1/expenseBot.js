const { Router } = require('express');
const multer = require('multer');
const files = require('./expenses/bot/files');
const { messages } = require('./shared/messages');
const store = require('./expenses/bot/store');
const brain = require('./expenses/bot/brain');
const { meter } = require('./expenses/bot/ai');
const { AppError } = require('./middlewares/errors');
const pool = require('../configs/db');
const { renderCard, SAMPLE, STYLES } = require('./expenses/bot/card');

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

/**
 * HOW MANY ARE IN THE OPEN PREVIEW, for WhatBot's "adding them to your open
 * preview (141 so far)" while it reads a new batch. A count only.
 */
agent.get('/pending', async (req, res, next) => {
  try {
    const { phone, group } = req.query ?? {};
    if (!phone || !group) return res.status(400).json({ error: 'phone and group are required' });
    const state = await store.getChat(String(phone), String(group));
    const open = state.pending?.kind === 'add' ? state.pending.items.filter((x) => !x.skipped).length : 0;
    res.json({ open });
  } catch (err) {
    next(err);
  }
});

/** The picture style picked in Settings, for WhatBot's own pay pictures. */
agent.get('/style', async (req, res, next) => {
  try {
    // eslint-disable-next-line global-require
    res.json({ style: await require('./repos/settings.repo').expenseStyle() });
  } catch (err) {
    next(err);
  }
});

/**
 * The registered admins, for WhatBot's guard. Phones and groups only. With
 * them, his switch for people seeing their own expenses (Settings →
 * Whatbot), so WhatBot reads both in the one call it already makes.
 */
agent.get('/admins', async (req, res, next) => {
  try {
    const rows = await store.listAdmins();
    // eslint-disable-next-line global-require
    const employeeView = await require('./repos/settings.repo').employeeExpenses();
    res.json({ admins: rows.filter((r) => r.active).map((r) => ({ phone: r.phone, group: r.group_name })), employeeView });
  } catch (err) {
    next(err);
  }
});

/**
 * ===============================
 * * MY EXPENSES, FOR ONE PERSON ON WHATSAPP
 * ===============================
 * His calls 2026-10-07: what they SPENT, in THIS group, THIS month, read
 * only. WhatBot sends the person its verified phone already is; this
 * checks it again here before reading anything:
 *   - his switch is on (Settings → Whatbot);
 *   - that phone IS that person on the master sheet, in that group;
 *   - or the phone is an active admin of that group (an admin's own,
 *     linked by phone when they are not on the master sheet).
 * Anything else reads nothing.
 */
agent.get('/mine', async (req, res, next) => {
  try {
    // eslint-disable-next-line global-require
    const settingsRepo = require('./repos/settings.repo');
    if (!(await settingsRepo.employeeExpenses())) return res.status(403).json({ off: true });
    const phone = String(req.query.phone ?? '').trim();
    const group = String(req.query.group ?? '').trim();
    const personId = String(req.query.personId ?? '').trim() || null;
    if (!/^\+\d{7,15}$/.test(phone) || !group) return res.status(400).json({ error: 'phone and group are required' });
    const digits = phone.replace(/\D/g, '');
    const onSheet = personId ? (await pool.query(
      `SELECT 1 FROM tb_mastersheet
        WHERE person_id = $1 AND upper(group_name) = upper($2) AND regexp_replace(phone, '\\D', '', 'g') = $3 LIMIT 1`,
      [personId, group, digits],
    )).rows.length > 0 : false;
    const asAdmin = await store.adminFor(phone, group);
    if (!onSheet && !asAdmin) return res.status(404).json({ error: 'not found' });
    // eslint-disable-next-line global-require
    const { currentMonth } = require('./shared/presetMonth.helper');
    const month = currentMonth();
    // eslint-disable-next-line global-require
    const rows = await require('./repos/expenses.repo').spentByPerson(
      { personId: onSheet ? personId : null, phone: asAdmin ? asAdmin.phone : null, group, month },
    );
    res.json({ month, rows });
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
 * THE STYLE PICKER'S PREVIEWS (Settings → Whatbot): each style drawn from
 * the same sample expenses, so they can be compared side by side.
 */
admin.get('/expense-style/preview/:style', (req, res, next) => {
  try {
    const { style } = req.params;
    if (!STYLES.includes(style)) throw new AppError(404, 'No picture for that style.');
    const png = renderCard(SAMPLE, { group: 'MANBAT', style });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' }).send(png);
  } catch (err) {
    next(err);
  }
});

/**
 * A PICTURE DIANE SENT, by id: for her chat and its Attachments panel. The
 * chat itself lives in the browser tab, so it keeps only the id.
 */
admin.get('/agent-images/:id', async (req, res, next) => {
  try {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new AppError(404, 'Picture not found.');
    const { rows } = await pool.query('SELECT png FROM tb_agent_images WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new AppError(404, 'Picture not found.');
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' }).send(rows[0].png);
  } catch (err) {
    next(err);
  }
});

// Each picture is kept by pictures/store.js (30 days).
const keepImage = (image, caption) => require('./pictures/store').keepImage(Buffer.from(image.base64, 'base64'), caption);

/**
 * ONE TURN OF DIANE'S EXPENSES CONTEXT, for agent/workspaces.js: the last
 * thing they said (and the file with it, by id) to the expense brain, for
 * every group and with no spender assumed. A preview goes out as a card.
 */
async function dianeTurn(history, send, { user = null } = {}) {
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
  const out = await brain.turn({ text, attachments: atts.map((a) => a.file) }, { channel: 'diane', user });
  if (out.card) send({ type: 'list', list: out.card });
  // A RECEIPT ASKED FOR: a photo shows in her chat (and Attachments); a PDF
  // or sheet is opened from the Expenses page
  if (out.receipt && /^image\//.test(out.receipt.mime)) {
    try {
      const caption = `Receipt · ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
      send({ type: 'image', image: { id: await keepImage(out.receipt, caption), caption } });
    } catch (err) {
      require('../configs/logger').warn({ err: err.message }, 'diane: could not show the receipt');
    }
  } else if (out.receipt) {
    out.reply = `${out.reply ?? ''} It is a file: open it from the Expenses page.`.trim();
  }
  // THE PICTURE under the card, in the style picked in Settings. Kept in the
  // CRM so it can be opened again from the conversation's Attachments.
  if (out.image) {
    try {
      const when = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const all = [out.image, ...(out.moreImages ?? [])];
      for (const [i, img] of all.entries()) {
        const what = img.kind === 'report' ? 'Spending' : img.saved ? 'Saved' : 'Preview';
        const caption = `${what}${all.length > 1 ? ` ${i + 1}/${all.length}` : ''} · ${when}`;
        // eslint-disable-next-line no-await-in-loop
        send({ type: 'image', image: { id: await keepImage(img, caption), caption } });
      }
    } catch (err) {
      require('../configs/logger').warn({ err: err.message }, 'diane: could not keep the expense picture');
    }
  }
  return { reply: out.reply ?? '' };
}

module.exports = { agent, admin, dianeTurn };
