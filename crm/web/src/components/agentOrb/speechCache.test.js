import test from 'node:test';
import assert from 'node:assert/strict';
import { primeSpeech, takePrimed } from './speechCache.js';

test('A PRIMED LINE IS TAKEN ONCE, so it never replays', () => {
  const request = Promise.resolve('audio');
  primeSpeech('Hello again.', request);
  assert.equal(takePrimed('Hello again.'), request);
  assert.equal(takePrimed('Hello again.'), undefined, 'gone after the first take');
  assert.equal(takePrimed('Something else.'), undefined);
});
