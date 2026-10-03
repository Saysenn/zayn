const { Router } = require('express');
const settingsRepo = require('./repos/settings.repo');
const { briefing } = require('./shared/briefing.helper');
const { currentDay } = require('./shared/presetMonth.helper');
const { sessionUser } = require('./shared/session.helper');

// ***************************************************
// * What Diane says when you sign in
// ***************************************************
//
// ONE REQUEST, FOUR COUNTS. Four separate calls at sign-in is four round
// trips before she opens her mouth, on the one screen whose whole job is
// to be quick. See shared/briefing.helper.js for what is in it.

const router = Router();

router.get('/briefing', async (req, res, next) => {
  try {
    // Read on its own, never through get(): see the repo's banner. A
    // forgotten migration must not take down every other settings reader.
    //
    // SWITCHED OFF IS AN EMPTY BRIEFING, not a 404 or a flag the client has
    // to interpret. The frontend already skips the screen when there is
    // nothing to say, so off and quiet take the same path and there is one
    // behaviour to get right rather than two.
    //
    // `day` (business timezone) and `admin` let the web show it ONCE per
    // business day per admin; the web keeps that in localStorage.
    const seen = { day: currentDay(), admin: sessionUser(req) };
    if (!await settingsRepo.loginBriefing()) {
      return res.json({ period: null, items: [], enabled: false, ...seen });
    }
    return res.json({ ...await briefing(), enabled: true, ...seen });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
