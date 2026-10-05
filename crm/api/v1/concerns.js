const { Router } = require('express');
const concernsRepo = require('./repos/concerns.repo');
const { broadcast } = require('./sockets/index');
const { parsePagination } = require('./shared/pagination.helper');

const router = Router();

router.get('/concerns', async (req, res, next) => {
  try {
    const { status, from, to, group, q } = req.query;
    const { page, pageSize, limit, offset } = parsePagination(req.query);
    const { rows, total } = await concernsRepo.listGrouped({
      status, from, to, groupName: group, q, limit, offset,
    });
    res.json({ concerns: rows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

router.get('/concerns/person', async (req, res, next) => {
  try {
    const { group, personId } = req.query;
    if (!group || !personId) {
      return res.status(400).json({ error: 'group and personId query params are required' });
    }
    res.json({ concerns: await concernsRepo.listForPerson(group, personId) });
  } catch (err) {
    next(err);
  }
});

router.patch('/concerns/:id', async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!['open', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'status must be open, in_progress or resolved' });
    }
    const concern = await concernsRepo.updateStatus(req.params.id, status);
    if (!concern) return res.status(404).json({ error: 'Concern not found' });
    broadcast(concern.group_name, 'concern:updated', concern);
    res.json({ concern });
  } catch (err) {
    next(err);
  }
});

// The bulk bar on Flagged: a row there is a PERSON, so the ticked rows are
// people and every concern of theirs moves together.
router.post('/concerns/bulk-status', async (req, res, next) => {
  try {
    const { people, status } = req.body || {};
    if (!['open', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'status must be open, in_progress or resolved' });
    }
    const list = (Array.isArray(people) ? people : [])
      .filter((p) => p && typeof p.group === 'string' && typeof p.personId === 'string');
    if (!list.length) return res.json({ updated: 0 });
    const rows = await concernsRepo.updateStatusForPeople(list, status);
    for (const concern of rows) broadcast(concern.group_name, 'concern:updated', concern);
    res.json({ updated: rows.length });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
