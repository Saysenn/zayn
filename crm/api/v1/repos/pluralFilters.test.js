const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../configs/db');
const masterSheetRepo = require('./masterSheetRows.repo');
const concernsRepo = require('./concerns.repo');

/**
 * ***************************************************
 * * SEVERAL FILTER VALUES ARE ONE WIDER QUESTION
 * ***************************************************
 *
 * "Cash and bank" asks for one total over both methods. It must not run
 * the tool twice, and it must not silently keep only one of the values.
 */

async function capture(run) {
  const real = pool.query;
  let seen = null;
  pool.query = async (text, params) => {
    seen = { text, params };
    return { rows: [{ total: 0, rows: [] }] };
  };
  try {
    await run();
  } finally {
    pool.query = real;
  }
  return seen;
}

test('exact filter lists use ANY, so one query includes every value', async () => {
  const { text, params } = await capture(() => masterSheetRepo.findAll({
    source: ['synced', 'manual'],
    currency: ['GBP', 'AED'],
    paymentMethod: ['cash', 'bank'],
    status: ['active', 'ended'],
  }));

  assert.match(text, /source\s*=\s*ANY\(/i);
  assert.match(text, /upper\(currency\)\s*=\s*ANY\(/i);
  assert.match(text, /lower\(payment_method\)\s*=\s*ANY\(/i);
  assert.match(text, /payment_period[\s\S]*=\s*ANY\(/i);
  assert.deepEqual(params.filter(Array.isArray), [
    ['synced', 'manual'], ['GBP', 'AED'], ['cash', 'bank'], ['active', 'ended'],
  ]);
});

test('company, role and tier are direct read filters, singular or plural', async () => {
  const { text, params } = await capture(() => masterSheetRepo.findAll({
    company: ['Acqua', 'Leadstone'],
    roleLabel: ['Director', 'Mid 1'],
    tier: ['T3', 'Provider'],
  }));

  assert.match(text, /regexp_replace\(btrim\(company\)[\s\S]+\s*=\s*ANY\(/i);
  assert.match(text, /lower\(btrim\(role_label\)\)\s*=\s*ANY\(/i);
  assert.match(text, /tb_companies[\s\S]+lower\(btrim\(c\.tier\)\)\s*=\s*ANY\(/i);
  assert.deepEqual(params.filter(Array.isArray), [
    ['acqua', 'leadstone'], ['director', 'mid 1'], ['t3', 'provider'],
  ]);
});

test('several month categories are ORed inside one query', async () => {
  const { text, params } = await capture(() => masterSheetRepo.findAll({
    presetWhen: ['current', 'old'],
    paymentStartWhen: ['this-month', 'future'],
    endWhen: ['none', 'soon'],
  }));

  assert.ok((text.match(/preset_on IS NOT NULL/g) ?? []).length >= 2);
  assert.ok((text.match(/payment_start_on IS NOT NULL/g) ?? []).length >= 2);
  assert.match(text, /\(end_on IS NULL OR end_on IS NOT NULL/);
  assert.ok(params.includes(masterSheetRepo.ENDING_SOON_MONTHS));
});

test('several search fields search their union, never the default columns', async () => {
  const { text, params } = await capture(() => masterSheetRepo.findAll({
    q: 'needle', searchField: ['company', 'notes'],
  }));

  assert.match(text, /company ILIKE/);
  assert.match(text, /notes ILIKE/);
  assert.doesNotMatch(text, /person_name ILIKE/);
  assert.ok(params.includes('%needle%'));
});

test('concern statuses widen one grouped query with ANY', async () => {
  const { text, params } = await capture(() => concernsRepo.listGrouped({
    status: ['open', 'in_progress'],
  }));

  assert.match(text, /=\s*ANY\(\$3::text\[\]\)/i);
  assert.deepEqual(params[2], ['open', 'in_progress']);
});

test('scalar callers still work while the browser migrates independently', async () => {
  const { text, params } = await capture(() => masterSheetRepo.findAll({ currency: 'GBP' }));
  assert.match(text, /upper\(currency\)\s*=\s*upper\(/i);
  assert.ok(params.includes('GBP'));
});
