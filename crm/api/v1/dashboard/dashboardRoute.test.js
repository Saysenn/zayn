const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { loadWith } = require('../testing/stubRepos');

const emptyRoute = () => ({ router: express.Router() });

function get(app, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const request = http.get({
        host: '127.0.0.1',
        port: server.address().port,
        path,
        headers,
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => server.close(() => resolve({
          status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString()),
        })));
      });
      request.on('error', (error) => server.close(() => reject(error)));
    });
  });
}

test('GET dashboard is mounted behind the admin session gate', async () => {
  const dashboardPath = require.resolve('../dashboard.js');
  const buildPath = require.resolve('./buildDashboard.js');
  const dashboardModule = loadWith(dashboardPath, {
    [require.resolve('../repos/masterSheetRows.repo.js')]: {},
    [require.resolve('../repos/monthSnapshots.repo.js')]: {},
    [require.resolve('../repos/settings.repo.js')]: {},
    [require.resolve('../repos/people.repo.js')]: {},
    [require.resolve('../repos/concerns.repo.js')]: {},
    [require.resolve('../shared/fxRates.helper.js')]: {},
    [buildPath]: { buildDashboard: async (query) => ({ ok: true, query }) },
  });

  const appPath = require.resolve('../app.js');
  const routePaths = [
    '../auth.js', '../agent.js', '../companies.js', '../concerns.js', '../messages.js',
    '../people.js', '../settings.js', '../conversations.js', '../logs.js',
    '../masterSheet.js', '../export.js',
  ].map((file) => require.resolve(file));
  const modules = Object.fromEntries(routePaths.map((path) => [path, emptyRoute()]));
  modules[dashboardPath] = dashboardModule;
  modules[require.resolve('../middlewares/requireSession.js')] = {
    requireSession(req, res, next) {
      if (req.headers['x-test-session'] === 'valid') return next();
      return res.status(401).json({ error: 'Not logged in' });
    },
  };
  modules[require.resolve('../repos/settings.repo.js')] = { get: async () => ({ dev_mode: false }) };
  modules[require.resolve('../agent/summaryRecovery.js')] = { queueSummaryRepair() {} };
  modules[require.resolve('../backups/scheduler.js')] = { startBackupScheduler() {} };
  modules[require.resolve('../masterSheet/snapshotScheduler.js')] = { startSnapshotScheduler() {} };

  const app = loadWith(appPath, modules);
  const rejected = await get(app, '/api/v1/dashboard');
  const accepted = await get(app, '/api/v1/dashboard?range=last3', { 'x-test-session': 'valid' });

  assert.equal(rejected.status, 401);
  assert.deepEqual(rejected.body, { error: 'Not logged in' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.ok, true);
  assert.equal(accepted.body.query.range, 'last3');
});
