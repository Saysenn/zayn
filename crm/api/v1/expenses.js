const { Router } = require('express');
const multer = require('multer');
const expensesRepo = require('./repos/expenses.repo');
const { buildExpenseSheet } = require('./expenses/buildExpenseSheet');
const { parseExpenses } = require('./expenses/parseExpenses');
const { diffExpenses } = require('./expenses/diffExpenses');
const {
  HEADERS, PICKABLE, PALETTE, DEFAULT_PALETTE,
} = require('./expenses/expenseColumns');
const { zipBuffer } = require('./shared/zipBuffer.helper');
const { parsePagination } = require('./shared/pagination.helper');
const { AppError } = require('./middlewares/errors');
const { messages } = require('./shared/messages');
const { broadcast } = require('./sockets/index');
const { currentMonth } = require('./shared/presetMonth.helper');

// ***************************************************
// * /expenses
// ***************************************************
//
// A standalone ledger. It reads no deal, writes no payout figure, and never
// touches tb_fx_rates: every row carries the rate it was entered with. See
// docs/expense.md.

const router = Router();

const EVENT = 'expenses:changed';

// ===============================
// * ITS OWN UPLOAD, NEVER THE MASTER SHEET'S
// ===============================
// A separate multer instance on a separate route: sharing one would mean a
// deals file and an expenses file could each reach the other's parser, and
// both parse far enough to look like they worked.
//
// In memory, never to disk. Its only job is to be compared once.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    const isXlsx = /\.xlsx$/i.test(file.originalname) && file.mimetype === XLSX_MIME;
    cb(isXlsx ? null : new AppError(400, messages.notXlsx(file.originalname)), isXlsx);
  },
});

// Required on a create. Everything else is genuinely optional on a spend.
const REQUIRED = ['spentOn', 'description', 'currency', 'rawAmount'];

// A month of expenses is tens of rows, not thousands. The cap is here so a
// download cannot become an unbounded read if that ever stops being true.
const DOWNLOAD_MAX_ROWS = 5000;

/** Both list filters and the summary come off the same query string. */
function filtersFrom(query) {
  return {
    q: query.q || undefined,
    searchField: query.searchField || undefined,
    groups: query.groups,
    currencies: query.currencies,
    amountField: query.amountField || undefined,
    amountMin: query.amountMin,
    amountMax: query.amountMax,
  };
}

/**
 * ===============================
 * * THE CURRENT MONTH, AND THE SERVER DECIDES WHICH
 * ===============================
 * The page is this month and nothing else. The month is NOT a query
 * parameter: which month it is, is the business's question, and the admin's
 * clock and the server's are ten hours apart. A browser sending its own
 * month would put two people on two different ledgers at every boundary.
 */
router.get('/expenses', async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const month = currentMonth();
    const result = await expensesRepo.findAll({
      ...filtersFrom(req.query), month, page, pageSize,
    });
    // NAMED in the response, so the page can say which month it is showing
    // rather than leaving the reader to work it out.
    res.json({ ...result, month, page, pageSize });
  } catch (err) {
    next(err);
  }
});

/**
 * AN EXPENSE'S RECEIPT, as it was kept (expenses/bot/receipts.js): a photo
 * shrunk to JPEG, a PDF or a sheet as sent. 404 once its month is cleared
 * (receipts are kept for the current month and the two before).
 */
router.get('/expenses/:id/receipt', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'No receipt.' });
    // eslint-disable-next-line global-require
    const file = await require('./expenses/bot/receipts').fileOf(id);
    if (file.missing) return res.status(404).json({ error: file.missing === 'cleared' ? 'This receipt was cleared: receipts are kept for 3 months.' : 'This expense has no receipt.' });
    res.set({ 'Content-Type': file.mime, 'Content-Disposition': `inline; filename="${file.filename}"`, 'Cache-Control': 'private, max-age=3600' }).send(file.buffer);
  } catch (err) {
    next(err);
  }
});

// One call for every dropdown plus the rate suggestion, so opening the page
// or the add form is not five round trips.
router.get('/expenses/options', async (req, res, next) => {
  try {
    res.json(await expensesRepo.options());
  } catch (err) {
    next(err);
  }
});

// What the export modal offers. Served, never typed out in the modal as
// well: two lists drift the first time a column or a colour is added.
router.get('/expenses/export/options', async (req, res, next) => {
  try {
    const { groups } = await expensesRepo.options();
    res.json({
      columns: PICKABLE, palettes: PALETTE, defaultPalette: DEFAULT_PALETTE, groups,
    });
  } catch (err) {
    next(err);
  }
});

const asArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : String(value).split(',').filter(Boolean);
};

const safeName = (value) => String(value ?? '').replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'ungrouped';

/**
 * ===============================
 * * THE MONTH AS A SHEET, OR ONE SHEET PER GROUP
 * ===============================
 * Re-importable either way: the columns are `expenseColumns.js`, which the
 * parser reads back.
 *
 * PER GROUP IS A ZIP, because a browser silently drops all but the first of
 * several downloads from one click.
 */
router.get('/expenses/download', async (req, res, next) => {
  try {
    const month = currentMonth();
    const columns = asArray(req.query.columns);
    const palette = req.query.palette;
    const groups = asArray(req.query.groups);

    const { rows } = await expensesRepo.findAll({
      ...filtersFrom(req.query), groups, month, page: 1, pageSize: DOWNLOAD_MAX_ROWS,
    });
    if (rows.length === 0) return next(new AppError(400, messages.nothingMatches));

    if (req.query.perGroup !== 'true') {
      const workbook = buildExpenseSheet(rows, { month, columns, palette });
      res.setHeader('Content-Type', XLSX_MIME);
      res.setHeader('Content-Disposition', `attachment; filename="expenses-${month}.xlsx"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      await workbook.xlsx.write(res);
      return res.end();
    }

    // A row with no group is its own file rather than being dropped: a
    // split that loses rows is a split nobody can check.
    const byGroup = new Map();
    for (const row of rows) {
      const key = row.group_name || 'Ungrouped';
      byGroup.set(key, [...(byGroup.get(key) ?? []), row]);
    }

    const files = [];
    for (const [group, groupRows] of byGroup) {
      const workbook = buildExpenseSheet(groupRows, {
        month, columns, palette, title: group.slice(0, 28),
      });
      files.push({
        name: `expenses-${safeName(group)}-${month}.xlsx`,
        body: Buffer.from(await workbook.xlsx.writeBuffer()),
      });
    }

    const zip = await zipBuffer(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${month}.zip"`);
    res.setHeader('Content-Length', zip.length);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return res.end(zip);
  } catch (err) {
    return next(err);
  }
});

/**
 * ===============================
 * * TWO REQUESTS, AND THE FIRST WRITES NOTHING
 * ===============================
 * Preview parses and compares; commit writes only what came back accepted.
 * The rows travel out and back rather than sitting in a server cache, the
 * same shape the master sheet's import uses and for the same reason.
 */
router.post('/expenses/import/preview', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return next(err instanceof AppError ? err : new AppError(400, err.message));
    try {
      if (!req.file) return next(new AppError(400, messages.noFile));

      const parsed = await parseExpenses(req.file.buffer, { filename: req.file.originalname });
      // TWO DIFFERENT PROBLEMS. No header is the wrong file; no rows is the
      // right file with nothing in it, which is what an exported empty
      // month looks like.
      if (parsed.sheetsRead === 0) {
        return next(new AppError(400, messages.expenses.noHeader(HEADERS)));
      }
      if (parsed.rows.length === 0) return next(new AppError(400, messages.expenses.noRows));

      const month = currentMonth();
      const existing = await expensesRepo.findForMonth(month);
      const compared = diffExpenses(parsed.rows, existing);

      res.json({ ...compared, month, filename: parsed.filename, columns: parsed.columns });
    } catch (error) {
      next(error);
    }
  });
});

router.post('/expenses/import/commit', async (req, res, next) => {
  try {
    const accepted = Array.isArray(req.body?.accepted) ? req.body.accepted : [];
    if (accepted.length === 0) return next(new AppError(400, messages.nothingMatches));

    const made = await expensesRepo.createMany(accepted);
    broadcast(null, EVENT, { action: 'imported', count: made.length });
    res.json({ imported: made.length });
  } catch (err) {
    next(err);
  }
});

router.post('/expenses', async (req, res, next) => {
  try {
    const missing = REQUIRED.filter((f) => req.body?.[f] === undefined || req.body[f] === '');
    if (missing.length) {
      return next(new AppError(400, `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`));
    }

    const expense = await expensesRepo.create(req.body);
    broadcast(null, EVENT, { action: 'created', id: expense.id });
    res.status(201).json({ expense });
  } catch (err) {
    next(err);
  }
});

router.patch('/expenses/:id', async (req, res, next) => {
  try {
    const expense = await expensesRepo.update(req.params.id, req.body);
    if (!expense) return next(new AppError(404, messages.notFound.expense));

    broadcast(null, EVENT, { action: 'updated', id: expense.id });
    res.json({ expense });
  } catch (err) {
    next(err);
  }
});

router.delete('/expenses/:id', async (req, res, next) => {
  try {
    const removed = await expensesRepo.remove(req.params.id);
    if (!removed) return next(new AppError(404, messages.notFound.expense));

    broadcast(null, EVENT, { action: 'deleted', id: removed.id });
    res.json({ deleted: removed.id });
  } catch (err) {
    next(err);
  }
});

// The bulk bar. Row by row through the same update and remove a single
// edit uses, so the sync key and the allow list cannot be skipped.
function bulkIds(body) {
  return (Array.isArray(body?.ids) ? body.ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

router.post('/expenses/bulk-update', async (req, res, next) => {
  try {
    const ids = bulkIds(req.body);
    const fields = req.body?.fields || {};
    const updated = [];
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const expense = await expensesRepo.update(id, fields);
      if (expense) updated.push(expense.id);
    }
    broadcast(null, EVENT, { action: 'bulk-updated', ids: updated });
    res.json({ updated });
  } catch (err) {
    next(err);
  }
});

router.post('/expenses/bulk-delete', async (req, res, next) => {
  try {
    const ids = bulkIds(req.body);
    const deleted = [];
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const removed = await expensesRepo.remove(id);
      if (removed) deleted.push(removed.id);
    }
    broadcast(null, EVENT, { action: 'bulk-deleted', ids: deleted });
    res.json({ deleted });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
