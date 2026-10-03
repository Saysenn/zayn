const { Router } = require('express');
const rowsRepo = require('./repos/masterSheetRows.repo');
const snapshotsRepo = require('./repos/monthSnapshots.repo');
const settingsRepo = require('./repos/settings.repo');
const peopleRepo = require('./repos/people.repo');
const concernsRepo = require('./repos/concerns.repo');
const fxRates = require('./shared/fxRates.helper');
const { currentMonth } = require('./shared/presetMonth.helper');
const { buildDashboard } = require('./dashboard/buildDashboard');

const router = Router();

router.get('/dashboard', async (req, res, next) => {
  try {
    const dashboard = await buildDashboard(req.query, {
      currentMonth: currentMonth(),
      rowsRepo,
      snapshotsRepo,
      settingsRepo,
      peopleRepo,
      concernsRepo,
      fxRates,
    });
    res.json(dashboard);
  } catch (error) {
    next(error);
  }
});

module.exports = { router };
