const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler, AppError } = require('./errors');
const { setDevMode } = require('../shared/devMode.helper');

/**
 * ***************************************************
 * * THE REFERENCE IS IN THE TOAST IN BOTH MODES
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-22. Saving an appointment date failed and the
 * toast read, verbatim and truncated:
 *
 *   null value in column "payable_days" of relation "tb_mastersheet"
 *   violates not-null...
 *
 * That is the driver's own sentence, and with dev mode on it is the RIGHT
 * thing to show: the alternative is debugging a constraint violation by
 * querying the database. What was wrong is that the reference was dropped
 * on exactly that path, so the full message, the stack, the method and the
 * path were all sitting in `logs` under six characters nobody could see.
 *
 * Both branches carry it now. The toast and the log entry name each other
 * whichever mode is on.
 */

/** The body the handler would send, without an express app. */
function bodyFor(err) {
  let out = null;
  const res = {
    status() { return this; },
    json(payload) { out = payload; return this; },
  };
  errorHandler(err, { method: 'PATCH', originalUrl: '/x', log: { error() {} } }, res, () => {});
  return out;
}

const REF = /\b[0-9a-f]{6}\b/;

test.afterEach(() => setDevMode(false));

// ===============================
// * A 500, both ways round
// ===============================

test('DEV MODE SHOWS THE REAL MESSAGE, AND THE REFERENCE WITH IT', () => {
  setDevMode(true);
  const body = bodyFor(new Error('null value in column "payable_days" violates not-null'));
  assert.match(body.error, /payable_days/, 'dev mode stopped showing the real message');
  assert.match(body.error, REF, 'no reference to search the Logs page for');
  assert.match(body.ref, REF);
  // The same six characters in both places, or they name different entries.
  assert.ok(body.error.includes(body.ref), 'the sentence and the field disagree');
});

test('AND WITH IT OFF THE MESSAGE NEVER REACHES THE BROWSER', () => {
  setDevMode(false);
  const body = bodyFor(new Error('null value in column "payable_days" violates not-null'));
  assert.ok(!body.error.includes('payable_days'), 'a driver message leaked to the browser');
  assert.match(body.error, /Search the Logs page for/);
  assert.match(body.error, REF);
  assert.ok(body.error.includes(body.ref));
});

// ===============================
// * And a refusal is unchanged
// ===============================

/**
 * A 4xx message is one we wrote ourselves and is shown as-is. It gets NO
 * reference: there is nothing to look up, and a six character tail on
 * "That company already exists" is noise on a sentence meant for a human.
 */
test('A REFUSAL KEEPS ITS OWN WORDS AND GETS NO REFERENCE', () => {
  for (const dev of [true, false]) {
    setDevMode(dev);
    const body = bodyFor(new AppError(400, 'Pick at least one group'));
    assert.equal(body.error, 'Pick at least one group', `dev=${dev} rewrote a refusal`);
    assert.equal(body.ref, undefined);
  }
});

test('A 404 IS STILL A 404, not a reference', () => {
  setDevMode(true);
  const body = bodyFor(new AppError(404, 'Not found'));
  assert.equal(body.error, 'Not found');
  assert.equal(body.ref, undefined);
});
