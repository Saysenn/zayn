const { Router } = require('express');
const settingsRepo = require('./repos/settings.repo');
const fxRatesRepo = require('./repos/fxRates.repo');
const fxRates = require('./shared/fxRates.helper');
const { AED_PER_USD, codeFor } = require('./shared/toUsd.helper');
const {
  DASHBOARD_HISTORY_OPTIONS, dashboardHistoryMonths,
} = require('./shared/snapshotWindow.helper');
const peopleRepo = require('./repos/people.repo');
const burnRepo = require('./repos/burn.repo');
const { closeMonth } = require('./masterSheet/closeMonth');
const rowsRepo = require('./repos/masterSheetRows.repo');
// The palette the export actually paints with. Served beside the saved
// style so the panel draws real swatches rather than a second list.
const { listPaletteColors } = require('./masterSheet/breakdowns/palette');
const { setDevMode } = require('./shared/devMode.helper');
const { broadcast } = require('./sockets/index');
const { AppError } = require('./middlewares/errors');
const { messages } = require('./shared/messages');

// Admin-only (mounted behind requireSession, same as companies/concerns/messages).
const router = Router();

// Exact-phrase confirmation, not just a "yes" button — these wipe real
// business data with no undo, so the bar is "typed it correctly," same
// spirit as GitHub's "type the repo name to delete it." Checked
// case-sensitively; no partial credit for close.
const BURN_MONTH_PHRASE = 'BURN THIS MONTH';
const RESET_MASTER_SHEET_PHRASE = 'RESET MASTER SHEET';

router.post('/settings/burn-month', async (req, res, next) => {
  try {
    if (req.body?.confirm !== BURN_MONTH_PHRASE) {
      return next(new AppError(400, messages.typeToConfirm(BURN_MONTH_PHRASE)));
    }
    const snapshot = await closeMonth();
    broadcast(null, 'sync:completed', { burned: true });
    res.json({ burned: true, snapshot });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/reset-master-sheet', async (req, res, next) => {
  try {
    if (req.body?.confirm !== RESET_MASTER_SHEET_PHRASE) {
      return next(new AppError(400, messages.typeToConfirm(RESET_MASTER_SHEET_PHRASE)));
    }
    await burnRepo.resetMasterSheet();
    broadcast(null, 'master-sheet:changed', { action: 'reset' });
    res.json({ reset: true });
  } catch (err) {
    next(err);
  }
});

function toSettings(row) {
  return {
    devMode: row.dev_mode,
    whatbotWrites: row.whatbot_writes_enabled,
    localLocations: row.local_locations ?? [],
    colorUsesEndDate: Boolean(row.color_uses_end_date),
    // An ADD ON, never a fee: we pay the gas, so it goes ON TOP of what a
    // crypto row is owed.
    cryptoPercent: Number(row.crypto_percent ?? 1),
    // A DISPLAY CAP on the dashboard range dropdown, never a retention
    // rule. Snapshots always keep SNAPSHOT_MONTHS. See
    // shared/snapshotWindow.helper.js.
    dashboardHistoryMonths: dashboardHistoryMonths(row.dashboard_history_months),
  };
}

/**
 * The places the export may class as LOCAL, and every place there is.
 *
 * The LIST OF PLACES IS DERIVED from tb_mastersheet, never stored, which
 * is the whole point: a location the boss invents next month appears here
 * by itself, so classifying it is a tick rather than something somebody
 * has to remember to add. Only the CLASSIFICATION is stored.
 */
router.get('/settings/locations', async (req, res, next) => {
  try {
    const [locations, local] = await Promise.all([
      rowsRepo.distinctLocations(),
      settingsRepo.localLocations(),
    ]);
    const localSet = new Set(local.map((l) => String(l).trim().toLowerCase()));
    res.json({
      locations: locations.map((l) => ({
        ...l,
        local: localSet.has(l.location.toLowerCase()),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * ===============================
 * * THE MASTER SHEET EXPORT TAB'S OWN SETTINGS
 * ===============================
 * Its own pair of routes rather than two more keys on PATCH /settings,
 * for the same reason /settings/locations and /settings/rates have theirs:
 * this belongs to ONE screen and is a bag that will grow. Folding it into
 * the general settings body would put a screen's preferences in the
 * payload every page reads on load.
 *
 * VALIDATED, not waved through. It is JSON from a browser going into a
 * jsonb column, so the colour is checked against the palette that exists
 * and the switches are bounded: a bag with no shape is a bag somebody can
 * put anything in.
 */
const STYLE_KEYS = ['primaryColor', 'marks'];
// Enough for every switch the modal has and then some. A cap, not a list:
// the server has no business knowing what the export modal calls them.
const MAX_MARKS = 20;

function readStyle(body) {
  if (body === null) return { style: null };
  if (!body || typeof body !== 'object') return { error: 'the style must be an object' };

  const unknown = Object.keys(body).filter((k) => !STYLE_KEYS.includes(k));
  if (unknown.length) return { error: `unknown setting: ${unknown.join(', ')}` };

  const style = {};
  if (body.primaryColor !== undefined) {
    const ids = listPaletteColors().map((c) => c.id);
    if (!ids.includes(body.primaryColor)) {
      return { error: `${body.primaryColor} is not one of the palette colours` };
    }
    style.primaryColor = body.primaryColor;
  }
  if (body.marks !== undefined) {
    const marks = body.marks;
    if (!marks || typeof marks !== 'object' || Array.isArray(marks)) {
      return { error: 'marks must be an object' };
    }
    const keys = Object.keys(marks);
    if (keys.length > MAX_MARKS) return { error: 'too many switches' };
    if (!keys.every((k) => /^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(k))) {
      return { error: 'a switch name is not a name' };
    }
    if (!keys.every((k) => typeof marks[k] === 'boolean')) {
      return { error: 'a switch must be on or off' };
    }
    style.marks = marks;
  }
  return { style };
}

router.get('/settings/export-tab', async (req, res, next) => {
  try {
    // The palette rides along, the same way the breakdown designs route
    // serves it: two requests for one control is two chances for them to
    // disagree about which colours exist.
    res.json({ style: await settingsRepo.exportTabStyle(), colors: listPaletteColors() });
  } catch (err) {
    next(err);
  }
});

router.put('/settings/export-tab', async (req, res, next) => {
  try {
    const { style, error } = readStyle(req.body?.style ?? null);
    if (error) return res.status(400).json({ error });
    res.json({ style: await settingsRepo.setExportTabStyle(style) });
  } catch (err) {
    next(err);
  }
});

router.get('/settings', async (req, res, next) => {
  try {
    // The briefing flag is read on its own: see settings.repo's banner.
    // A new column in get()'s SELECT would take down every other reader
    // on a deploy that forgot the migration.
    // Auto mode is its own query too, and for the same reason.
    const [row, loginBriefing, agentAutoConfirm, expenseStyle] = await Promise.all([
      settingsRepo.get(), settingsRepo.loginBriefing(), settingsRepo.agentAutoConfirm(), settingsRepo.expenseStyle(),
    ]);
    res.json({ ...toSettings(row), loginBriefing, agentAutoConfirm, expenseStyle });
  } catch (err) {
    next(err);
  }
});

/**
 * Both toggles, independently settable — send either key, or both.
 *
 * `whatbotWrites` gates the one thing whatbot is still allowed to write
 * onto a deal (its payday outcome, agent.js's PATCH /payment-status).
 * A toggle rather than an env var because it needs to be flippable
 * mid-payday without a redeploy, which is exactly when you would want it.
 */
router.patch('/settings', async (req, res, next) => {
  try {
    const {
      devMode, whatbotWrites, localLocations, colorUsesEndDate,
      cryptoPercent, dashboardHistoryMonths: historyMonths, loginBriefing,
      agentAutoConfirm, expenseStyle,
    } = req.body || {};
    if (devMode === undefined && whatbotWrites === undefined
      && localLocations === undefined && colorUsesEndDate === undefined
      && cryptoPercent === undefined && historyMonths === undefined
      && loginBriefing === undefined && agentAutoConfirm === undefined
      && expenseStyle === undefined) {
      return res.status(400).json({ error: 'nothing to change' });
    }

    let row = null;
    if (devMode !== undefined) {
      if (typeof devMode !== 'boolean') {
        return res.status(400).json({ error: 'devMode must be a boolean' });
      }
      row = await settingsRepo.setDevMode(devMode);
      // keeps the error handler's in-memory check in sync without a DB read
      // on every request — see shared/devMode.helper.js
      setDevMode(row.dev_mode);
    }
    if (whatbotWrites !== undefined) {
      if (typeof whatbotWrites !== 'boolean') {
        return res.status(400).json({ error: 'whatbotWrites must be a boolean' });
      }
      row = await settingsRepo.setWhatbotWrites(whatbotWrites);
    }
    /**
     * AN EMPTY LIST IS A REAL ANSWER, not a missing one.
     *
     * "Nothing is local" is a state somebody can legitimately choose, and
     * it means every penny of cash is being sent. So the array is stored
     * as given rather than treated as "unset", and only a non-array is
     * refused.
     */
    if (localLocations !== undefined) {
      if (!Array.isArray(localLocations) || localLocations.some((l) => typeof l !== 'string')) {
        return res.status(400).json({ error: 'localLocations must be an array of strings' });
      }
      const cleaned = [...new Set(localLocations.map((l) => l.trim()).filter(Boolean))];
      await settingsRepo.setLocalLocations(cleaned);
      row = await settingsRepo.get();
    }

    if (loginBriefing !== undefined) {
      if (typeof loginBriefing !== 'boolean') {
        return res.status(400).json({ error: 'loginBriefing must be a boolean' });
      }
      await settingsRepo.setLoginBriefing(loginBriefing);
      row = await settingsRepo.get();
    }

    if (colorUsesEndDate !== undefined) {
      if (typeof colorUsesEndDate !== 'boolean') {
        return res.status(400).json({ error: 'colorUsesEndDate must be a boolean' });
      }
      await settingsRepo.setColorUsesEndDate(colorUsesEndDate);
      row = await settingsRepo.get();
    }

    /**
     * HOW FAR BACK THE DASHBOARD OFFERS, and nothing else.
     *
     * It does NOT drive retention. Snapshots always keep SNAPSHOT_MONTHS,
     * because a snapshot froze the sheet as it stood that day and cannot be
     * rebuilt: a dropdown that deleted nine of them on the next cron tick
     * would be the most destructive control in the app and the only one
     * whose damage lands later, unwatched. His call 2026-09-09.
     *
     * Which is what makes RAISING this free: the months were never gone.
     */
    if (historyMonths !== undefined) {
      const months = Number(historyMonths);
      if (!DASHBOARD_HISTORY_OPTIONS.includes(months)) {
        return res.status(400).json({
          error: `dashboardHistoryMonths must be one of ${DASHBOARD_HISTORY_OPTIONS.join(', ')}`,
        });
      }
      await settingsRepo.setDashboardHistoryMonths(months);
      row = await settingsRepo.get();
    }

    // WHAT A CRYPTO PAYMENT COSTS US IN GAS. An add on, never a fee: it
    // goes on top of what a crypto row is owed.
    if (cryptoPercent !== undefined) {
      const n = Number(cryptoPercent);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: 'crypto percentage must be between 0 and 100' });
      }
      await settingsRepo.setCryptoPercent(n);
      row = await settingsRepo.get();
    }

    /**
     * ===============================
     * * AUTO MODE, AND IT IS A BOOLEAN OR IT IS REFUSED
     * ===============================
     * The one setting that lets a write happen without a second look, so a
     * truthy string must not be able to turn it on. What it may actually
     * skip is a closed ALLOW list in agent/autoConfirm.js, and nothing
     * that deletes, stops or reaches more than one named row is on it.
     */
    if (agentAutoConfirm !== undefined) {
      if (typeof agentAutoConfirm !== 'boolean') {
        return res.status(400).json({ error: 'agentAutoConfirm must be a boolean' });
      }
      await settingsRepo.setAgentAutoConfirm(agentAutoConfirm);
    }
    // How WhatBot and Diane show an expense preview (Settings → Whatbot).
    if (expenseStyle !== undefined) {
      if (!['sheet', 'notebook', 'receipt', 'ledger', 'chalkboard'].includes(expenseStyle)) {
        return res.status(400).json({ error: 'expenseStyle must be sheet, notebook, receipt, ledger or chalkboard' });
      }
      await settingsRepo.setExpenseStyle(expenseStyle);
    }

    // Same reason as the GET: each flag is its own query.
    res.json({
      ...toSettings(row ?? (await settingsRepo.get())),
      loginBriefing: await settingsRepo.loginBriefing(),
      agentAutoConfirm: await settingsRepo.agentAutoConfirm(),
      expenseStyle: await settingsRepo.expenseStyle(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * ===============================
 * * THE RATES WE SET OURSELVES
 * ===============================
 * Checkable BEFORE a conversion runs, which is the whole point: a payout
 * file converted at a rate nobody has seen is a figure nobody can defend.
 *
 * It reports which source is actually in use, so the screen can say whether
 * these saved rates are being applied or a live feed is answering and they
 * are only a standby. See shared/fxRates.helper.
 */
router.get('/settings/rates', async (req, res, next) => {
  try {
    const [saved, live, options] = await Promise.all([
      fxRatesRepo.all(), fxRates.usdPerGbp(), peopleRepo.filterOptions().catch(() => ({})),
    ]);
    // THE CURRENCIES THE SHEET ACTUALLY USES, folded through the same
    // aliases the converter uses, so the sheet's EURO asks for a EUR rate
    // rather than a box nothing will ever read. A currency that appears on
    // a new sheet gets a box on its own, with no edit here.
    const inUseOnSheet = [...new Set((options.currencies ?? []).map(codeFor).filter(Boolean))]
      .filter((code) => code !== 'USD').sort();
    res.json({
      rates: saved,
      inUse: live.source,
      // Which currencies are running on a SAVED rate even though a live
      // feed answered, because the feed does not quote them.
      backfilled: live.backfilled ?? [],
      reason: live.reason ?? null,
      asOf: live.asOf ?? null,
      // The peg, so the screen can show what AED falls back to when no row
      // has been set for it.
      pegAedPerUsd: AED_PER_USD,
      needed: inUseOnSheet,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * One currency at a time. A rate is one fact and each is its own decision.
 *
 * UNITS PER DOLLAR, the way the screen takes it, the way a rate site prints
 * it and the way `toUsd` divides by it. Migration 065: it was stored
 * inverted, and a typed 3.75 came home as 3.74999995.
 */
router.put('/settings/rates/:code', async (req, res, next) => {
  try {
    const { perUsd } = req.body || {};
    const value = Number(perUsd);
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ error: 'perUsd must be a number greater than zero' });
    }
    const saved = await fxRatesRepo.set(req.params.code, value, req.admin?.username ?? null);
    // A rate the converter has already cached is a rate nobody just set.
    fxRates.resetCache();
    return res.json(saved);
  } catch (err) {
    if (/not a currency code|not a usable rate/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
});

router.delete('/settings/rates/:code', async (req, res, next) => {
  try {
    const removed = await fxRatesRepo.remove(req.params.code);
    fxRates.resetCache();
    res.json({ removed });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
