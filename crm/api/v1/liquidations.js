const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Router } = require('express');
const multer = require('multer');
const repo = require('./repos/liquidations.repo');
const companiesRepo = require('./repos/companies.repo');
const { applyCompanyStatus } = require('./shared/companyStatus.helper');
const { sessionUser } = require('./shared/session.helper');
const { AppError } = require('./middlewares/errors');
const { broadcast } = require('./sockets/index');

// ***************************************************
// * THE LIQUIDATION TRACKER (his call 2026-10-13, migration 084)
// ***************************************************
//
// One row per company being wound down: its stage, instructions, deadline,
// next action, owner, blamed, liquidator, note, a dated log of contact,
// supporting documents, and every stage change with who made it.
//
// THE STAGE MOVES THE PAY STATUS ONLY WHERE THE MEANING IS PLAIN:
//   own liq, HMRC liq  → the company goes into liquidation (the deals keep
//                        paying, reduced; the amounts are set in the
//                        liquidation panel on the company page)
//   active             → out of liquidation, back to active
//   dissolved          → NOT here. Dissolving stops deals, and which ones is
//                        chosen on the company page; the page links there.
//   strike off (either)→ no change to pay.
// Through applyCompanyStatus, the one door the company page and Diane use.

const DOCS_ROOT = process.env.LIQUIDATION_DOCS_DIR || path.join(__dirname, '../storage/liquidations');
const REMOVED = '_removed';
const MAX_DOC_BYTES = 20 * 1024 * 1024;
// The kinds of paper a wind down produces: letters, forms, emails, sheets, scans.
const DOC_TYPES = /\.(pdf|png|jpe?g|heic|webp|docx?|xlsx?|csv|txt|eml|msg)$/i;

const PAY_FOR_STAGE = Object.freeze({
  [repo.STAGE.OWN_LIQ]: companiesRepo.COMPANY_STATUS.LIQUIDATION,
  [repo.STAGE.HMRC_LIQ]: companiesRepo.COMPANY_STATUS.LIQUIDATION,
  [repo.STAGE.ACTIVE]: companiesRepo.COMPANY_STATUS.ACTIVE,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOC_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    const ok = DOC_TYPES.test(file.originalname);
    cb(ok ? null : new AppError(400, `${file.originalname} is not a document we keep. Use a PDF, picture, Word, Excel, CSV, text or email file.`), ok);
  },
});

const router = Router();
const id = (req) => Number(req.params.id);

/** Text fields: trimmed, and capped so a pasted email cannot bloat a row. */
const text = (v, max = 4000) => String(v ?? '').trim().slice(0, max);

/** The page's fields, checked. Throws AppError on a bad value. */
async function cleanFields(body) {
  const out = {};
  if (body.stage !== undefined) {
    if (!repo.STAGES.includes(body.stage)) throw new AppError(400, 'Pick one of the stages.');
    out.stage = body.stage;
  }
  for (const f of ['instructions', 'nextAction', 'liquidator', 'note']) {
    if (body[f] !== undefined) out[f] = text(body[f]);
  }
  if (body.deadline !== undefined) {
    if (body.deadline === null || body.deadline === '') out.deadline = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(body.deadline) && !Number.isNaN(Date.parse(body.deadline))) out.deadline = body.deadline;
    else throw new AppError(400, 'The deadline is a date, like 2026-11-30.');
  }
  if (body.blamed !== undefined) out.blamed = Boolean(body.blamed);
  if (body.owner !== undefined) {
    if (body.owner === null || body.owner === '') out.owner = null;
    else if ((await repo.owners()).includes(body.owner)) out.owner = body.owner;
    else throw new AppError(400, 'The owner is one of the CRM\'s admins.');
  }
  return out;
}

/**
 * The company's pay status, moved to match a new stage where that is plain.
 * Returns what happened, for the page to say: { pay, dissolveOnCompanyPage }.
 */
async function followStage(key, stage) {
  if (stage === repo.STAGE.DISSOLVED) return { dissolveOnCompanyPage: true };
  const want = PAY_FOR_STAGE[stage];
  if (!want) return {};
  const company = await companiesRepo.findByKey(key);
  const now = company?.status ?? companiesRepo.COMPANY_STATUS.ACTIVE;
  // Active only undoes OUR liquidation: a closed or reviewed company is left as it is.
  if (want === companiesRepo.COMPANY_STATUS.ACTIVE && now !== companiesRepo.COMPANY_STATUS.LIQUIDATION) return {};
  if (now === want || companiesRepo.isTerminal(now)) return {};
  const out = await applyCompanyStatus(key, { status: want });
  broadcast(null, 'companies:changed', { action: 'updated', key });
  if (out?.deals || out?.reviewQueueChanged) broadcast(null, 'master-sheet:changed', { action: 'company-status', key });
  return { pay: want };
}

const changed = (row) => broadcast(null, 'liquidations:changed', { id: row?.id ?? null });

router.get('/liquidations', async (req, res, next) => {
  try {
    const [rows, owners] = await Promise.all([repo.list(), repo.owners()]);
    res.json({ rows, owners, stages: repo.STAGES });
  } catch (err) {
    next(err);
  }
});

router.post('/liquidations', async (req, res, next) => {
  try {
    const { companyKey, stage = repo.STAGE.ACTIVE } = req.body ?? {};
    if (!repo.STAGES.includes(stage)) return next(new AppError(400, 'Pick one of the stages.'));
    const key = repo.companyKey(companyKey);
    if (!key || !(await companiesRepo.findByKey(key))) return next(new AppError(404, 'That company is not in the CRM.'));
    const newId = await repo.add(key, stage, sessionUser(req));
    if (!newId) return next(new AppError(409, 'That company is already on the tracker.'));
    const follow = await followStage(key, stage);
    const row = await repo.findById(newId);
    changed(row);
    res.status(201).json({ row, ...follow });
  } catch (err) {
    next(err);
  }
});

router.get('/liquidations/:id', async (req, res, next) => {
  try {
    const row = await repo.findById(id(req));
    if (!row) return next(new AppError(404, 'That company is not on the tracker.'));
    res.json({ row, ...(await repo.details(row.id)) });
  } catch (err) {
    next(err);
  }
});

router.patch('/liquidations/:id', async (req, res, next) => {
  try {
    const fields = await cleanFields(req.body ?? {});
    if (!Object.keys(fields).length) return next(new AppError(400, 'Nothing to change.'));
    const result = await repo.update(id(req), fields, sessionUser(req));
    if (!result) return next(new AppError(404, 'That company is not on the tracker.'));
    let row = await repo.findById(id(req));
    const follow = result.before !== result.after ? await followStage(row.company_key, result.after) : {};
    if (follow.pay) row = await repo.findById(id(req));
    changed(row);
    res.json({ row, ...follow });
  } catch (err) {
    next(err);
  }
});

router.post('/liquidations/:id/comms', async (req, res, next) => {
  try {
    const body = text(req.body?.body);
    if (!body) return next(new AppError(400, 'Write what was said.'));
    const saidOn = req.body?.saidOn;
    if (saidOn && !/^\d{4}-\d{2}-\d{2}$/.test(saidOn)) return next(new AppError(400, 'The date is a date, like 2026-10-13.'));
    if (!(await repo.findById(id(req)))) return next(new AppError(404, 'That company is not on the tracker.'));
    const comm = await repo.addComm(id(req), { saidOn, body }, sessionUser(req));
    changed({ id: id(req) });
    res.status(201).json({ comm });
  } catch (err) {
    next(err);
  }
});

router.post('/liquidations/:id/docs', (req, res, next) => {
  upload.single('file')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') return next(new AppError(400, 'That file is over 20 MB.'));
        return next(uploadErr instanceof AppError ? uploadErr : new AppError(400, uploadErr.message));
      }
      if (!req.file) return next(new AppError(400, 'Pick a file to upload.'));
      if (!(await repo.findById(id(req)))) return next(new AppError(404, 'That company is not on the tracker.'));
      // Our own name on disk, never the uploaded one: it is shown, not trusted.
      const ext = path.extname(req.file.originalname).toLowerCase();
      const rel = path.join(String(id(req)), `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
      await fs.mkdir(path.join(DOCS_ROOT, String(id(req))), { recursive: true });
      await fs.writeFile(path.join(DOCS_ROOT, rel), req.file.buffer);
      const doc = await repo.addDoc(id(req), {
        fileName: path.basename(req.file.originalname).slice(0, 200),
        storedPath: rel,
        mime: req.file.mimetype,
        size: req.file.size,
      }, sessionUser(req));
      changed({ id: id(req) });
      res.status(201).json({ doc });
    } catch (err) {
      next(err);
    }
  });
});

/** Inside the docs folder, or nothing: a stored path is ours, but checked anyway. */
const onDisk = (rel) => {
  const full = path.resolve(DOCS_ROOT, rel);
  return full.startsWith(path.resolve(DOCS_ROOT) + path.sep) ? full : null;
};

router.get('/liquidations/:id/docs/:docId', async (req, res, next) => {
  try {
    const doc = await repo.findDoc(id(req), Number(req.params.docId));
    const full = doc && onDisk(doc.stored_path);
    if (!full) return next(new AppError(404, 'That document is not there.'));
    res.set('Cache-Control', 'no-store');
    res.download(full, doc.file_name, (err) => {
      if (err && !res.headersSent) next(new AppError(404, 'That document\'s file is missing from this machine.'));
    });
  } catch (err) {
    next(err);
  }
});

/** Taken off the row; the file is moved aside, never deleted. */
router.delete('/liquidations/:id/docs/:docId', async (req, res, next) => {
  try {
    const doc = await repo.findDoc(id(req), Number(req.params.docId));
    const full = doc && onDisk(doc.stored_path);
    if (!full) return next(new AppError(404, 'That document is not there.'));
    const rel = path.join(REMOVED, doc.stored_path);
    await fs.mkdir(path.dirname(path.join(DOCS_ROOT, rel)), { recursive: true });
    await fs.rename(full, path.join(DOCS_ROOT, rel)).catch(() => null);
    await repo.removeDoc(doc.id, rel);
    changed({ id: id(req) });
    res.json({ removed: doc.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
