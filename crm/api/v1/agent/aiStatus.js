const env = require('../../configs/env');
const logger = require('../../configs/logger');
const { getClient } = require('./chatClient');

// ***************************************************
// * Can Diane think right now?
// ***************************************************
//
// No key, no credit, or a key the provider refuses: each LOCKS her, and the
// page locks with her. A provider has no balance endpoint, so "no credit" is
// learned from a 1 token call, or from any real call that comes back empty.

const AI_LOCK = Object.freeze({
  NO_KEY: 'no_key',
  NO_CREDIT: 'no_credit',
  BAD_KEY: 'bad_key',
});

// A working answer is trusted this long before it is asked again.
const OK_FOR_MS = 15 * 60 * 1000;
// A lock is asked again this often, so a top up unlocks her without a restart.
const LOCKED_FOR_MS = 2 * 60 * 1000;

let known = null;
let asking = null;

/**
 * A lock reason for a provider error, or null when it says nothing about the
 * key: a plain rate limit or a timeout is not a lock, and locking on one
 * would shut her off for the length of a burst.
 */
function lockReasonFor(err) {
  const status = err?.status;
  const code = String(err?.error?.code ?? err?.code ?? err?.error?.type ?? '').toLowerCase();
  if (status === 401 || status === 403 || code === 'invalid_api_key') return AI_LOCK.BAD_KEY;
  if (status === 402 || code === 'insufficient_quota' || code === 'billing_not_active') return AI_LOCK.NO_CREDIT;
  return null;
}

const locked = (reason) => ({ available: false, reason, at: Date.now() });
const open = () => ({ available: true, reason: null, at: Date.now() });

// Any real call's failure: it locks at once, rather than on the next check.
function noteAiFailure(err) {
  const reason = lockReasonFor(err);
  if (reason) known = locked(reason);
  return reason;
}

async function ask() {
  try {
    await getClient().chat.completions.create({
      model: env.openaiModel,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    });
    return open();
  } catch (err) {
    const reason = lockReasonFor(err);
    if (reason) return locked(reason);
    // WE COULD NOT TELL, which is not a lock: the real call says it if it fails.
    logger.warn({ err }, 'diane: the AI status check could not tell');
    return { ...open(), unsure: true };
  }
}

/** @returns {Promise<{available: boolean, reason: string|null}>} */
async function aiStatus() {
  if (!getClient()) return { available: false, reason: AI_LOCK.NO_KEY };
  const age = known ? Date.now() - known.at : Infinity;
  // A lock, or a check that could not tell, is asked again sooner than a working answer.
  const fresh = known && age < (known.available && !known.unsure ? OK_FOR_MS : LOCKED_FOR_MS);
  if (!fresh) {
    // One check in flight, however many pages ask at once.
    asking ??= ask().then((out) => { known = out; return out; }).finally(() => { asking = null; });
    await asking;
  }
  return { available: known.available, reason: known.reason };
}

// For tests: forget what was learned.
function forgetAiStatus() {
  known = null;
  asking = null;
}

module.exports = {
  AI_LOCK, aiStatus, noteAiFailure, lockReasonFor, forgetAiStatus,
};
