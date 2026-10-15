const fs = require('node:fs/promises');
const { Router } = require('express');
const multer = require('multer');
const repo = require('./repos/liquidations.repo');
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
// THE PAGE FOLLOWS THE COMPANY STATUS (his call 2026-10-13): a company is
// listed because its status is liquidation, set on its company page or by
// Diane. Nobody adds one here, and the stage does not move the company
// status, WITH ONE EXCEPTION (his call 2026-10-14, migration 091): stage
// Dissolved is the end of either road, so it CLOSES the company and stops
// its live deals. The page asks first, saying how many deals stop.
// (Own liq once set liquidation and active set it back, for a day. Gone.)
const { applyCompanyStatus } = require('./shared/companyStatus.helper');

const {
  onDisk, moveAside, storeDoc, NEVER, MAX_DOC_BYTES, typeOf,
} = require('./shared/liquidationDocs.helper');
const docIndex = require('./shared/liquidationDocIndex');
const video = require('./shared/videoTranscript.helper');

// ON DISK, NOT IN MEMORY: a video can be 500 MB (his call 2026-10-14). The
// 25 MB rule for everything else is checked once the files are in.
const UPLOAD_TMP = require('node:path').join(video.TEMP_ROOT, 'uploads');
// A restart's leftovers (a video it never finished) go now.
video.sweepTemp().then(() => fs.mkdir(UPLOAD_TMP, { recursive: true })).catch(() => null);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => fs.mkdir(UPLOAD_TMP, { recursive: true }).then(() => cb(null, UPLOAD_TMP), cb),
  }),
  // SEVERAL AT ONCE, any kind of document; never a program.
  limits: { fileSize: video.MAX_VIDEO_BYTES, files: 20 },
  fileFilter(req, file, cb) {
    const ok = !NEVER.test(file.originalname);
    cb(ok ? null : new AppError(400, `${file.originalname} is a program, not a document, so it is not kept.`), ok);
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
    // '' or null is "not set"
    if (body.stage === null || body.stage === '') out.stage = null;
    else if (!repo.STAGES.includes(body.stage)) throw new AppError(400, 'Pick one of the stages.');
    else out.stage = body.stage;
  }
  // THE STAGE'S KIND (migration 090): '' or null is not said. Checked against
  // its stage in the route, once the stage it will sit on is known.
  // `proposalKind` is the name it had for a day; still read.
  const kind = body.stageKind !== undefined ? body.stageKind : body.proposalKind;
  if (kind !== undefined) out.stageKind = kind === null || kind === '' ? null : String(kind);
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

const changed = (row) => broadcast(null, 'liquidations:changed', { id: row?.id ?? null });

router.get('/liquidations', async (req, res, next) => {
  try {
    const [rows, owners] = await Promise.all([repo.list(), repo.owners()]);
    res.json({ rows, owners, stages: repo.STAGES });
  } catch (err) {
    next(err);
  }
});

/**
 * THE PAGE AS AN EXCEL FILE: the rows it is showing (`ids`, after its
 * filters and search), in its order; every company in liquidation when
 * none are named. Declared before /:id, which would take "download".
 */
// What the export modal offers: the columns and the header colours.
router.get('/liquidations/export-options', (req, res) => {
  // eslint-disable-next-line global-require
  const { PICKABLE, PALETTE, DEFAULT_PALETTE } = require('./shared/liquidationSheet.helper');
  res.json({ columns: PICKABLE, palettes: PALETTE, defaultPalette: DEFAULT_PALETTE });
});

router.get('/liquidations/download', async (req, res, next) => {
  try {
    const wanted = String(req.query.ids ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const all = await repo.list();
    const rows = wanted.length ? wanted.map((n) => all.find((r) => r.id === n)).filter(Boolean) : all;
    if (!rows.length) return next(new AppError(400, 'No companies to export.'));
    // eslint-disable-next-line global-require
    const { buildLiquidationSheet } = require('./shared/liquidationSheet.helper');
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="winding-down-${day}.xlsx"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    const columns = String(req.query.columns ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    await buildLiquidationSheet(rows, { columns, palette: req.query.palette }).xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

/** Videos sent to a company from Diane's chat, being made transcripts: her chat's cards. Before /:id. */
router.get('/liquidations/video-jobs', (req, res) => {
  res.json({ jobs: video.fromChat() });
});

router.get('/liquidations/:id', async (req, res, next) => {
  try {
    const row = await repo.findById(id(req));
    if (!row) return next(new AppError(404, 'That company is not on the Winding down page.'));
    res.json({ row, ...(await repo.details(row.id)) });
  } catch (err) {
    next(err);
  }
});

router.patch('/liquidations/:id', async (req, res, next) => {
  try {
    const fields = await cleanFields(req.body ?? {});
    if (!Object.keys(fields).length) return next(new AppError(400, 'Nothing to change.'));
    // A KIND BELONGS TO ITS STAGE: the one being set, or the one it has now.
    if (fields.stageKind) {
      const stage = fields.stage !== undefined ? fields.stage : (await repo.findById(id(req)))?.stage;
      if (!repo.kindFits(stage, fields.stageKind)) {
        const offered = Object.values(repo.STAGE_KINDS[stage] ?? {});
        return next(new AppError(400, offered.length ? `Pick ${offered.join(' or ')}.` : 'That stage has no kinds.'));
      }
    }
    const before = await repo.findById(id(req));
    const result = await repo.update(id(req), fields, sessionUser(req));
    if (!result) return next(new AppError(404, 'That company is not on the Winding down page.'));
    // DISSOLVED CLOSES IT: the stage is written first, so how it ended is kept.
    let closed = null;
    if (fields.stage === 'dissolved' && before?.pay_status === 'liquidation') {
      const done = await applyCompanyStatus(before.company_name, { status: 'closed', via: 'admin' });
      closed = { stopped: done.deals?.stopped?.length ?? 0 };
      broadcast(null, 'companies:changed', { action: 'updated' });
      broadcast(null, 'master-sheet:changed', { action: 'company-status' });
      broadcast(null, 'people:changed', { action: 'company-status' });
    }
    const row = await repo.findById(id(req));
    changed(row);
    res.json({ row, closed });
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
    if (!(await repo.findById(id(req)))) return next(new AppError(404, 'That company is not on the Winding down page.'));
    const comm = await repo.addComm(id(req), { saidOn, body }, sessionUser(req));
    changed({ id: id(req) });
    res.status(201).json({ comm });
  } catch (err) {
    next(err);
  }
});

router.post('/liquidations/:id/docs', (req, res, next) => {
  // `files` for several, `file` for one (the page's first upload sent that).
  upload.fields([{ name: 'files', maxCount: 20 }, { name: 'file', maxCount: 1 }])(req, res, async (uploadErr) => {
    const files = [...(req.files?.files ?? []), ...(req.files?.file ?? [])];
    // Every temp file not handed to a video job goes, whatever happens here.
    const handed = new Set();
    try {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') return next(new AppError(400, 'A video is over 500 MB.'));
        if (uploadErr.code === 'LIMIT_FILE_COUNT' || uploadErr.code === 'LIMIT_UNEXPECTED_FILE') return next(new AppError(400, 'Up to 20 files at once.'));
        return next(uploadErr instanceof AppError ? uploadErr : new AppError(400, uploadErr.message));
      }
      if (!files.length) return next(new AppError(400, 'Pick a file to upload.'));
      const big = files.find((f) => !video.isVideo(f.originalname, f.mimetype) && f.size > MAX_DOC_BYTES);
      if (big) return next(new AppError(400, `${big.originalname} is over 25 MB.`));
      const row = await repo.findById(id(req));
      if (!row) return next(new AppError(404, 'That company is not on the Winding down page.'));
      const docs = [];
      const jobs = [];
      for (const f of files) {
        if (video.isVideo(f.originalname, f.mimetype)) {
          // NOT KEPT: it becomes its transcript, after this answers.
          handed.add(f.path);
          jobs.push(video.view(video.start(id(req), {
            videoPath: f.path, fileName: f.originalname, names: [row.company_name, row.liquidator, row.owner],
          }, sessionUser(req))));
        } else {
          // eslint-disable-next-line no-await-in-loop
          docs.push(await storeDoc(id(req), { buffer: await fs.readFile(f.path), originalName: f.originalname, mime: f.mimetype }, sessionUser(req)));
        }
      }
      if (docs.length) changed({ id: id(req) });
      res.status(201).json({ docs, doc: docs[0] ?? null, jobs });
    } catch (err) {
      next(err);
    } finally {
      await Promise.all(files.filter((f) => !handed.has(f.path)).map((f) => fs.rm(f.path, { force: true }).catch(() => null)));
    }
  });
});

/** A company's videos being made into transcripts: the page asks every 2 seconds. */
router.get('/liquidations/:id/video-jobs', (req, res) => {
  res.json({ jobs: video.forCompany(id(req)) });
});

router.post('/liquidations/:id/video-jobs/:jobId/cancel', (req, res, next) => {
  const job = video.cancel(id(req), req.params.jobId);
  if (!job) return next(new AppError(404, 'That video is no longer being worked on.'));
  return res.json({ job: video.view(job) });
});

/** Rename: the name shown, never the file on disk. */
router.patch('/liquidations/:id/docs/:docId', async (req, res, next) => {
  try {
    const name = String(req.body?.fileName ?? '').trim().slice(0, 200);
    if (!name) return next(new AppError(400, 'Give it a name.'));
    const doc = await repo.renameDoc(id(req), Number(req.params.docId), name);
    if (!doc) return next(new AppError(404, 'That document is not there.'));
    docIndex.forgetCache();
    changed({ id: id(req) });
    res.json({ doc });
  } catch (err) {
    next(err);
  }
});

/** Several taken off at once; each file moved aside, never deleted. */
router.post('/liquidations/:id/docs/remove', async (req, res, next) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean);
    if (!ids.length) return next(new AppError(400, 'Pick the documents to remove.'));
    let removed = 0;
    for (const docId of ids) {
      // eslint-disable-next-line no-await-in-loop
      const doc = await repo.findDoc(id(req), docId);
      if (!doc) continue;
      // eslint-disable-next-line no-await-in-loop
      await repo.removeDoc(doc.id, await moveAside(doc.stored_path));
      removed += 1;
    }
    docIndex.forgetCache();
    changed({ id: id(req) });
    res.json({ removed });
  } catch (err) {
    next(err);
  }
});

/** What it says, for the viewer: its text, and a spreadsheet's rows as a table. */
router.get('/liquidations/:id/docs/:docId/text', async (req, res, next) => {
  try {
    const doc = await repo.findDoc(id(req), Number(req.params.docId));
    if (!doc) return next(new AppError(404, 'That document is not there.'));
    let tables = null;
    const full = onDisk(doc.stored_path);
    if (full && /\.(xlsx|csv|tsv)$/i.test(doc.file_name)) {
      // eslint-disable-next-line global-require
      const { intake } = require('./agent/engine/intake');
      const buffer = await fs.readFile(full).catch(() => null);
      if (buffer) {
        const got = await intake(/\.xlsx$/i.test(doc.file_name) ? { buffer, filename: doc.file_name } : { text: buffer.toString('utf8'), filename: doc.file_name }).catch(() => null);
        tables = got?.tables?.slice(0, 5).map((t) => ({ sheet: t.sheet, headers: t.headers, rows: t.rows.slice(0, 500).map((r) => r.cells) })) ?? null;
      }
    }
    res.set('Cache-Control', 'no-store');
    res.json({ status: doc.read_status, how: doc.read_how, error: doc.read_error, text: doc.text ?? '', tables });
  } catch (err) {
    next(err);
  }
});

/** Read it again (a failed reading, or a file replaced on disk). */
router.post('/liquidations/:id/docs/:docId/read', async (req, res, next) => {
  try {
    const doc = await repo.findDoc(id(req), Number(req.params.docId));
    if (!doc) return next(new AppError(404, 'That document is not there.'));
    await repo.setRead(doc.id, { status: 'waiting' });
    docIndex.queueRead(doc.id);
    res.json({ queued: doc.id });
  } catch (err) {
    next(err);
  }
});

/**
 * A COMPANY'S DOCUMENTS AS ONE ZIP (his call 2026-10-13): the ones in `ids`,
 * or every one. A browser drops all but the first of several downloads from
 * one click, so many files are always one archive. Declared before :docId,
 * which would take "zip".
 */
router.get('/liquidations/:id/docs/zip', async (req, res, next) => {
  try {
    const row = await repo.findById(id(req));
    if (!row) return next(new AppError(404, 'That company is not on the Winding down page.'));
    const wanted = String(req.query.ids ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const { docs } = await repo.details(row.id);
    const chosen = wanted.length ? docs.filter((d) => wanted.includes(d.id)) : docs;
    if (!chosen.length) return next(new AppError(400, 'No documents to download.'));
    // Same name twice in one archive: the second gets " (2)".
    const used = new Map();
    const files = [];
    for (const d of chosen) {
      // eslint-disable-next-line no-await-in-loop
      const full = await repo.findDoc(row.id, d.id).then((x) => x && onDisk(x.stored_path));
      if (!full) continue;
      const n = (used.get(d.file_name) ?? 0) + 1;
      used.set(d.file_name, n);
      const name = n === 1 ? d.file_name : d.file_name.replace(/(\.[^.]+)?$/, ` (${n})$1`);
      // eslint-disable-next-line no-await-in-loop
      files.push({ name, body: await fs.readFile(full) });
    }
    if (!files.length) return next(new AppError(404, 'Those documents\' files are missing from this machine.'));
    // eslint-disable-next-line global-require
    const { zipBuffer } = require('./shared/zipBuffer.helper');
    const zip = await zipBuffer(files);
    const day = new Date().toISOString().slice(0, 10);
    const zipName = `${row.company_name} documents ${day}.zip`;
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${zipName.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(zipName)}`);
    res.set('Access-Control-Expose-Headers', 'Content-Disposition');
    return res.send(zip);
  } catch (err) {
    next(err);
  }
});

router.get('/liquidations/:id/docs/:docId', async (req, res, next) => {
  try {
    const doc = await repo.findDoc(id(req), Number(req.params.docId));
    const full = doc && onDisk(doc.stored_path);
    if (!full) return next(new AppError(404, 'That document is not there.'));
    res.set('Cache-Control', 'no-store');
    // ?inline=1 opens it in the viewer (a PDF or a picture shown, not saved).
    if (req.query.inline) {
      res.type(typeOf(doc.file_name, doc.mime));
      res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`);
      res.set('X-Content-Type-Options', 'nosniff');
      return res.sendFile(full, (err) => {
        if (err && !res.headersSent) next(new AppError(404, 'That document\'s file is missing from this machine.'));
      });
    }
    return res.download(full, doc.file_name, (err) => {
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
    await repo.removeDoc(doc.id, await moveAside(doc.stored_path));
    docIndex.forgetCache();
    changed({ id: id(req) });
    res.json({ removed: doc.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
