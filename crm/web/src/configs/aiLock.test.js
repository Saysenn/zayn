import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_LOCK_REASON, aiLockSaid } from './aiLock.js';

// A CONTRACT with the API's v1/agent/aiStatus.js AI_LOCK, which pins the same three.
test('THE LOCK REASONS ARE THE API\'S THREE', () => {
  assert.deepEqual(Object.values(AI_LOCK_REASON).sort(), ['bad_key', 'no_credit', 'no_key']);
});

test('EVERY REASON SAYS WHAT IS WRONG AND WHAT BRINGS HER BACK, with no dash', () => {
  for (const reason of Object.values(AI_LOCK_REASON)) {
    const { title, body } = aiLockSaid(reason);
    assert.ok(title && body, reason);
    assert.doesNotMatch(`${title} ${body}`, /—| - /, reason);
  }
  // An unknown reason still says she is off.
  assert.ok(aiLockSaid('something new').title);
});
