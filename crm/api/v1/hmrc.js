const { Router } = require('express');
const repo = require('./repos/hmrc.repo');
const knowledge = require('./agent/hmrc/knowledge');
const { AppError } = require('./middlewares/errors');
const { sessionUser } = require('./shared/session.helper');

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

module.exports = { router };
