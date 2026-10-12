const { Router } = require('express');
const repo = require('./repos/hmrc.repo');
const knowledge = require('./agent/hmrc/knowledge');
const { AppError } = require('./middlewares/errors');
const { sessionUser } = require('./shared/session.helper');
const multer = require('multer');
const playbook = require('./agent/hmrc/playbook');

// ***************************************************
// * DIANE'S HMRC & CIS KNOWLEDGE, FROM SETTINGS
// ***************************************************
// What she knows (GOV.UK pages and our notes), our notes to add, change or
// remove, and a refresh from GOV.UK that runs in the background.

const router = Router();

router.get('/hmrc/status', async (req, res, next) => {
  try {
    const rows = await repo.status();
    const of = (k) => rows.find((r) => r.kind === k) ?? { sources: 0, chunks: 0, last: null };
    res.json({ govuk: of('govuk'), notes: of('note'), refresh: knowledge.refreshState, changes: await repo.recentChanges(10) });
  } catch (err) { next(err); }
});

router.get('/hmrc/notes', async (req, res, next) => {
  try { res.json({ notes: await repo.notes() }); } catch (err) { next(err); }
});

router.post('/hmrc/notes', async (req, res, next) => {
  try {
    const title = String(req.body?.title ?? '').trim().slice(0, 120);
    const body = String(req.body?.body ?? '').trim().slice(0, 8000);
    if (!title || !body) return next(new AppError(400, 'A note needs a title and what it says.'));
    const saved = await knowledge.index({ kind: 'note', title, body, topic: 'ours', addedBy: sessionUser(req) ?? null });
    res.status(201).json(saved);
  } catch (err) { next(err); }
});

router.patch('/hmrc/notes/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await repo.updateNote(id, {
      title: req.body?.title != null ? String(req.body.title).trim().slice(0, 120) : null,
      body: req.body?.body != null ? String(req.body.body).trim().slice(0, 8000) : null,
    });
    if (!before) return next(new AppError(404, 'That note is gone.'));
    // its passages again, with its new words
    await knowledge.reindex(before);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/hmrc/notes/:id', async (req, res, next) => {
  try {
    if (!(await repo.removeNote(Number(req.params.id)))) return next(new AppError(404, 'That note is gone.'));
    knowledge.forget();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/hmrc/refresh', (req, res) => res.status(202).json(knowledge.runRefresh()));

// ---- our playbook (lawyer mode; migration 082) ----
router.get('/hmrc/playbook', async (req, res, next) => {
  try { res.json({ entries: await repo.playbook() }); } catch (err) { next(err); }
});

router.post('/hmrc/playbook', async (req, res, next) => {
  try {
    const out = await playbook.add({ section: req.body?.section, title: req.body?.title, body: req.body?.body, by: sessionUser(req) ?? null });
    res.status(201).json(out);
  } catch (err) { next(err.status ? new AppError(err.status, err.message) : err); }
});

router.patch('/hmrc/playbook/:id', async (req, res, next) => {
  try {
    const out = await playbook.edit(Number(req.params.id), req.body ?? {}, sessionUser(req) ?? null);
    if (!out) return next(new AppError(404, 'That entry is gone.'));
    res.json(out);
  } catch (err) { next(err); }
});

router.delete('/hmrc/playbook/:id', async (req, res, next) => {
  try {
    const out = await playbook.remove(Number(req.params.id), sessionUser(req) ?? null);
    if (!out) return next(new AppError(404, 'That entry is gone.'));
    res.json(out);
  } catch (err) { next(err); }
});

router.get('/hmrc/playbook/history', async (req, res, next) => {
  try { res.json({ changes: await repo.playbookHistory(80) }); } catch (err) { next(err); }
});

router.post('/hmrc/playbook/undo/:changeId', async (req, res, next) => {
  try {
    const out = await playbook.undo(Number(req.params.changeId), sessionUser(req) ?? null);
    if (!out) return next(new AppError(404, 'That change is already put back.'));
    res.json(out);
  } catch (err) { next(err); }
});

// the whole playbook as one document, to read or keep
router.get('/hmrc/playbook/export', async (req, res, next) => {
  try {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="our-playbook-${new Date().toISOString().slice(0, 10)}.md"`);
    res.send(await playbook.asMarkdown());
  } catch (err) { next(err); }
});

/**
 * A DOCUMENT TO READ INTO THE PLAYBOOK, attached in lawyer mode: Word,
 * PowerPoint, text, Markdown, CSV, JSON, or a PDF (its text read by the
 * model, word for word). Nothing is saved here: the text goes with the
 * message, and Diane asks before saving it.
 */
const readUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (!/\.(pdf|docx|pptx|txt|md|csv|tsv|json)$/i.test(file.originalname)) {
      return cb(new AppError(400, `In lawyer mode Diane reads PDF, Word, PowerPoint, text or Markdown files, not ${file.originalname}.`));
    }
    cb(null, true);
  },
});
router.post('/hmrc/playbook/read', (req, res, next) => {
  readUpload.single('file')(req, res, async (err) => {
    if (err) return next(err instanceof AppError ? err : new AppError(400, err.message));
    try {
      if (!req.file) return next(new AppError(400, 'No file came with that.'));
      const name = req.file.originalname;
      let text;
      if (/\.pdf$/i.test(name)) {
        // eslint-disable-next-line global-require
        const openai = require('./agent/chatClient').getClient();
        if (!openai) return next(new AppError(503, 'I cannot read PDFs right now (no AI key).'));
        const r = await openai.chat.completions.create({
          model: process.env.AI_MODEL || 'gpt-4.1',
          temperature: 0,
          messages: [{
            role: 'user',
            content: [
              { type: 'file', file: { filename: name, file_data: `data:application/pdf;base64,${req.file.buffer.toString('base64')}` } },
              { type: 'text', text: 'Write out the full text of this document, word for word, keeping its headings and lists. Nothing else.' },
            ],
          }],
        });
        text = String(r.choices?.[0]?.message?.content ?? '').trim();
      } else {
        // eslint-disable-next-line global-require
        const { intake } = require('./agent/engine/intake');
        const got = await intake({ buffer: req.file.buffer, filename: name });
        const tables = got.tables.map((t) => [t.headers?.join(' | '), ...t.rows.map((row) => (row.cells ?? row).join(' | '))].filter(Boolean).join('\n')).join('\n\n');
        text = [got.text, tables].filter(Boolean).join('\n\n').trim();
      }
      if (!text) return next(new AppError(400, `I couldn't find any text in ${name}.`));
      res.json({ filename: name, text, lines: text.split(/\r?\n/).filter((l) => l.trim()).length, tables: [] });
    } catch (e) {
      req.log?.warn?.({ err: e.message }, 'diane: a lawyer-mode file could not be read');
      next(new AppError(400, `I couldn't read ${req.file?.originalname ?? 'that file'}.`));
    }
  });
});

module.exports = { router };
