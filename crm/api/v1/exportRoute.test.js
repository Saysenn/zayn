const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');

const rowsRepo = require('./repos/masterSheetRows.repo');
const companiesRepo = require('./repos/companies.repo');
const peopleRepo = require('./repos/people.repo');
const settingsRepo = require('./repos/settings.repo');
const fxRates = require('./shared/fxRates.helper');
const { router } = require('./export');

/**
 * ***************************************************
 * * THE EXPORT ROUTE ACTUALLY BUILDS A FILE
 * ***************************************************
 *
 * `/export/xlsx` referenced a bare `preset` that was never declared in the
 * handler, so EVERY export threw `preset is not defined` and 500'd before
 * building anything. Live, for who knows how long.
 *
 * It was invisible from the transcript because of what happens next: the
 * client catches the failure and says "that one would not build on my
 * end", and Diane's own turn, already in flight, announces the file as
 * downloading. An admin reads the second sentence.
 *
 * Nothing here mocks the builder. The point of the test is that the whole
 * route runs, so a ReferenceError anywhere in it fails here. Only the
 * DATABASE and the live FX call are stubbed, since a test must not need
 * either.
 *
 * STUBBED AT THE REPO, not at `exportQuery`. `export.js` DESTRUCTURES
 * `rowsFor` at import, so replacing it on the module object does nothing
 * and the first version of this test silently ran against live Postgres:
 * green, and worthless on any machine without a database.
 */

const ROWS = [{
  id: 1,
  person_id: 'anthony-wareham',
  person_name: 'Anthony Wareham',
  group_name: 'MILKMAN',
  company: 'Yellowstone Associates',
  role_label: 'Director',
  currency: 'GBP',
  payment_method: 'bank',
  monthly_amount: 1000,
  payable_amount: 1000,
  payable_days: 30,
  preset_on: '2026-09-01',
  status: 'active',
  bank_details: 'Monzo',
  account_number: '15381787',
  sort_code: '04-00-04',
  manually_overridden_fields: [],
}];

const stub = () => {
  const saved = {
    findAllRows: rowsRepo.findAllRows,
    tierMap: companiesRepo.tierMap,
    rateMap: peopleRepo.rateMap,
    get: settingsRepo.get,
    localLocations: settingsRepo.localLocations,
    cryptoPercent: settingsRepo.cryptoPercent,
    usdPerGbp: fxRates.usdPerGbp,
  };
  rowsRepo.findAllRows = async () => ROWS;
  companiesRepo.tierMap = async () => new Map();
  peopleRepo.rateMap = async () => new Map();
  settingsRepo.get = async () => ({ color_uses_end_date: false, crypto_percent: 0 });
  settingsRepo.localLocations = async () => [];
  settingsRepo.cryptoPercent = async () => 0;
  fxRates.usdPerGbp = async () => ({ usdPerGbp: 1.27, source: 'fallback', asOf: null, perUsd: { GBP: 0.79 } });
  return () => Object.assign(rowsRepo, { findAllRows: saved.findAllRows }) && Object.assign(companiesRepo, { tierMap: saved.tierMap })
    && Object.assign(peopleRepo, { rateMap: saved.rateMap })
    && Object.assign(settingsRepo, {
      get: saved.get, localLocations: saved.localLocations, cryptoPercent: saved.cryptoPercent,
    })
    && Object.assign(fxRates, { usdPerGbp: saved.usdPerGbp });
};

function fetchXlsx(query) {
  const app = express();
  app.use('/api/v1', router);
  // The real error middleware turns a 500 into a reference code, which
  // would hide the very message this test exists to catch.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status ?? 500).end(String(err.message)));

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      http.get(`http://127.0.0.1:${port}/api/v1/export/xlsx?${query}`, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          server.close(() => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
      }).on('error', (e) => { server.close(() => reject(e)); });
    });
  });
}

test('IT RETURNS A REAL XLSX, not a 500', async () => {
  const restore = stub();
  try {
    const res = await fetchXlsx('preset=bank&template=bank&groupName=MILKMAN&month=2026-09');

    assert.equal(res.status, 200, `it failed with: ${res.body.toString().slice(0, 200)}`);
    // PK is the zip magic every xlsx starts with. A 200 carrying an error
    // page would pass a status check and fail this.
    assert.equal(res.body.slice(0, 2).toString(), 'PK', 'the body is not a workbook');
    assert.ok(res.body.length > 1000, `suspiciously small: ${res.body.length} bytes`);
  } finally {
    restore();
  }
});

test('THE COUNTS TRAVEL WITH THE FILE, so no cache can disagree with it', async () => {
  // A 21 row bank run was announced as "3 rows, 3 people": the previous
  // export's figures, read from a client side preview. A count derived
  // anywhere but here can go stale; this one is computed from the rows the
  // workbook was built from.
  const restore = stub();
  try {
    const res = await fetchXlsx('template=bank&groupName=MILKMAN&month=2026-09');

    assert.equal(res.headers['x-row-count'], String(ROWS.length));
    assert.equal(res.headers['x-people-count'], '1');
    // Unreadable by the client without this, so the header may as well not
    // be there.
    assert.match(res.headers['access-control-expose-headers'] ?? '', /X-Row-Count/);
    assert.match(res.headers['access-control-expose-headers'] ?? '', /X-People-Count/);
  } finally {
    restore();
  }
});

test('and it names the file, so the browser does not invent one', async () => {
  const restore = stub();
  try {
    const res = await fetchXlsx('preset=bank&template=bank&groupName=MILKMAN&month=2026-09');
    assert.match(res.headers['content-disposition'] ?? '', /filename="[^"]+\.xlsx"/);
    // Without this the same-origin XHR cannot read the header back, and
    // the modal would have to invent a second name that drifts from it.
    assert.match(res.headers['access-control-expose-headers'] ?? '', /Content-Disposition/);
  } finally {
    restore();
  }
});

test('EVERY TEMPLATE BUILDS, since the fault was in shared setup', async () => {
  // The ReferenceError sat above the template switch, so it took all of
  // them down at once. One at a time here, because a shape that throws on
  // its own is the other kind of fault.
  const restore = stub();
  try {
    for (const template of ['master-sheet', 'monthly-sheet', 'cash', 'bank', 'bank-details', 'expensing']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetchXlsx(`template=${template}&groupName=MILKMAN&month=2026-09`);
      assert.equal(res.status, 200, `${template}: ${res.body.toString().slice(0, 160)}`);
      assert.equal(res.body.slice(0, 2).toString(), 'PK', `${template} did not return a workbook`);
    }
  } finally {
    restore();
  }
});

test('nothing matching is a 404, not a broken file', async () => {
  const saved = rowsRepo.findAllRows;
  rowsRepo.findAllRows = async () => [];
  try {
    const res = await fetchXlsx('template=bank&groupName=NOBODY');
    assert.equal(res.status, 404);
  } finally {
    rowsRepo.findAllRows = saved;
  }
});
