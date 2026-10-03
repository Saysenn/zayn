const { Router } = require('express');
const logsRepo = require('./repos/logs.repo');
const { parsePagination } = require('./shared/pagination.helper');

// Admin-only (mounted behind requireSession). Reads whatever's in the table —
// empty unless dev mode has been on at some point (see captureLog.helper.js).
const router = Router();

router.get('/logs', async (req, res, next) => {
  try {
    const { source, level } = req.query;
    const { page, pageSize, limit, offset } = parsePagination(req.query);
    const { rows, total } = await logsRepo.list({ source, level, limit, offset });
    res.json({ logs: rows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

router.get('/logs/count', async (req, res, next) => {
  try {
    const { source, level } = req.query;
    res.json({ count: await logsRepo.count({ source, level }) });
  } catch (err) {
    next(err);
  }
});

// One batch per call (200 rows), oldest first — the frontend loops this to
// turn "clear logs" into a real determinate progress bar. See
// crm/web/src/hooks/useLogs.js's clear().
router.delete('/logs', async (req, res, next) => {
  try {
    const { source, level } = req.query;
    const deleted = await logsRepo.deleteBatch({ source, level });
    res.json({ deleted });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
