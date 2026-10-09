const path = require('path');
const express = require('express');
const pinoHttp = require('pino-http');
const logger = require('../configs/logger');
const helmet = require('../configs/helmet');
const cors = require('../configs/cors');
const cookieParser = require('../configs/cookieParser');
const health = require('./health');
const { router: authRouter } = require('./auth');
const { router: agentRouter } = require('./agent');
const { router: companiesRouter } = require('./companies');
const { router: concernsRouter } = require('./concerns');
const { router: messagesRouter } = require('./messages');
const { router: peopleRouter } = require('./people');
const { router: settingsRouter } = require('./settings');
const expenseBot = require('./expenseBot');
const { router: agentContextRouter } = require('./agentContext');
const { router: hmrcRouter } = require('./hmrc');
const { router: conversationsRouter } = require('./conversations');
const { router: logsRouter } = require('./logs');
const { router: masterSheetRouter } = require('./masterSheet');
const { router: exportRouter } = require('./export');
const { router: dashboardRouter } = require('./dashboard');
const { router: expensesRouter } = require('./expenses');
const { router: monthlyReviewRouter } = require('./monthlyReview');
const { router: deadPeopleRouter } = require('./deadPeople');
const briefingRouter = require('./briefing');
const { router: scheduledActionsRouter } = require('./scheduledActions');
const { requireSession } = require('./middlewares/requireSession');
const { requireApiKey } = require('./middlewares/requireApiKey');
const { notFound, errorHandler } = require('./middlewares/errors');
const settingsRepo = require('./repos/settings.repo');
const { setDevMode } = require('./shared/devMode.helper');
const { queueSummaryRepair } = require('./agent/summaryRecovery');
const { startBackupScheduler } = require('./backups/scheduler');
const { startSnapshotScheduler } = require('./masterSheet/snapshotScheduler');

const app = express();

// The error handler's dev-mode check is in-memory (see devMode.helper.js) so
// it costs nothing per-request; this is the one DB read that fills it, once,
// at boot. Fire-and-forget: a failure here just leaves dev mode at its
// false default until the next PATCH /settings, never blocks startup.
settingsRepo
  .get()
  .then((row) => setDevMode(row.dev_mode))
  .catch((err) => logger.error({ err }, 'failed to load tb_settings at boot'));

queueSummaryRepair();
startBackupScheduler();
// RECEIPTS: the 3 month clear and the backup copy, every 6 hours
require('./expenses/bot/receipts').startReceiptsKeeper();
// EXPENSES NOT REFUNDED by the 1st: a flag for the CRM admin, weekly
require('./expenses/unpaidAlerts').startUnpaidAlerts();
startSnapshotScheduler();

// Behind nginx in production: without this, every request looks like it
// comes from nginx's own address, which breaks the per-IP login rate limit
// (configs/rateLimit.js) and how Express detects HTTPS for the secure
// cookie flag (configs/session.js). Trusts the immediate hop only (nginx on
// the same box), not an arbitrary chain of proxies.
app.set('trust proxy', 1);

app.use(helmet);
app.use(cors);
app.use(pinoHttp({ logger }));
// 2mb, not express's 100kb default. The upload's commit step posts the
// parsed rows back — the preview holds them in the browser rather than in
// a server-side cache that would have to be expired — and a 96-row sheet
// of 31 columns is comfortably over 100kb. It failed as a bare 413 with no
// body, which reads like the route not existing.
// EXPENSES THROUGH WHATBOT, before the 2mb parser: a message can carry
// receipt photos and files, sent as base64. WhatBot's key, never a session.
app.use('/api/v1/agent/expenses', requireApiKey, express.json({ limit: '25mb' }), expenseBot.agent);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser);

// public — not versioned, infra probes expect a stable path
app.use(health);

app.use('/api/v1/auth', authRouter);
// whatbot only, gated by its own shared key — never the admin session cookie
app.use('/api/v1/agent', requireApiKey, agentRouter);
app.use('/api/v1', requireSession);
app.use('/api/v1', companiesRouter);
app.use('/api/v1', concernsRouter);
app.use('/api/v1', messagesRouter);
app.use('/api/v1', settingsRouter);
app.use('/api/v1', expenseBot.admin);
app.use('/api/v1', agentContextRouter);
app.use('/api/v1', hmrcRouter);
app.use('/api/v1', conversationsRouter);
app.use('/api/v1', logsRouter);
app.use('/api/v1', masterSheetRouter);
app.use('/api/v1', exportRouter);
app.use('/api/v1', dashboardRouter);
app.use('/api/v1', expensesRouter);
app.use('/api/v1', monthlyReviewRouter);
app.use('/api/v1', deadPeopleRouter);
app.use('/api/v1', briefingRouter);
app.use('/api/v1', scheduledActionsRouter);
app.use('/api/v1/people', peopleRouter);

// the built React dashboard — one deployable, Express serves what Vite built
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(publicDir, 'index.html'), (err) => err && next(err));
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
