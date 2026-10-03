const { Router } = require('express');
const deadRepo = require('./repos/deadPeople.repo');
const settingsRepo = require('./repos/settings.repo');
const { parsePagination } = require('./shared/pagination.helper');
const { shapeDeadPerson } = require('./shared/deadPersonJourney.helper');
const { AppError } = require('./middlewares/errors');
const { messages } = require('./shared/messages');

// ***************************************************
// * The Archive's dead persons tab, and one dead person's page
// ***************************************************
// Read only: a person leaves the list by a deal being added back, never here.

const router = Router();

router.get('/dead-people', async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const { rows, total } = await deadRepo.findAll({
      q: req.query.q || undefined, group: req.query.group || undefined, page, pageSize,
    });
    res.json({ people: rows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

router.get('/dead-people/:personId', async (req, res, next) => {
  try {
    const [row, settings] = await Promise.all([deadRepo.findById(req.params.personId), settingsRepo.get()]);
    if (!row) return next(new AppError(404, messages.notFound.deadPerson));
    res.json({
      person: shapeDeadPerson(row, {
        useEndDate: Boolean(settings?.color_uses_end_date),
        cryptoPercent: Number(settings?.crypto_percent ?? 0),
      }),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
