// ***************************************************
// * When Diane cannot think: no key, no credit, a refused key
// ***************************************************
//
// The reasons are the API's (v1/agent/aiStatus.js AI_LOCK), mirrored as a
// contract and pinned by aiLock.test.js. The words are the page's own.

export const AI_STATUS_KEY = ['ai-status'];

// A lock is asked again this often, so a top up unlocks her with no reload.
export const AI_RECHECK_MS = 2 * 60 * 1000;

export const AI_LOCK_REASON = Object.freeze({
  NO_KEY: 'no_key',
  NO_CREDIT: 'no_credit',
  BAD_KEY: 'bad_key',
});

const SAID = {
  [AI_LOCK_REASON.NO_KEY]: {
    title: 'Diane is switched off',
    body: 'No AI key is set up on the server, so she cannot think. Add one and she comes back on.',
  },
  [AI_LOCK_REASON.NO_CREDIT]: {
    title: 'Diane is out of credit',
    body: 'The AI account has no balance left. Top it up and she comes back on her own within a few minutes.',
  },
  [AI_LOCK_REASON.BAD_KEY]: {
    title: 'Diane\'s key was refused',
    body: 'The AI provider rejected the key on the server. Check it, and she comes back on once it works.',
  },
};

// An unknown reason still says she is off, never nothing.
export const aiLockSaid = (reason) => SAID[reason] ?? SAID[AI_LOCK_REASON.NO_KEY];
