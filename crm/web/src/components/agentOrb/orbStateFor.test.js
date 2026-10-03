import test from 'node:test';
import assert from 'node:assert/strict';
import { orbStateFor } from './orbStateFor.js';

test('THE ORB FOLLOWS WHAT SHE IS DOING', () => {
  assert.equal(orbStateFor({ mode: 'idle' }), 'idle');
  assert.equal(orbStateFor({ mode: 'listening' }), 'listening');
  assert.equal(orbStateFor({ mode: 'thinking' }), 'thinking');
  assert.equal(orbStateFor({ mode: 'speaking' }), 'speaking');
});

test('a reply arriving as text is speaking, even with her voice muted', () => {
  assert.equal(orbStateFor({ mode: 'thinking', streaming: true }), 'speaking');
});

test('building a file is the turning ring', () => {
  assert.equal(orbStateFor({ mode: 'building' }), 'connecting');
});

test('a failed answer shows as an error only while she is idle', () => {
  assert.equal(orbStateFor({ mode: 'idle', failed: true }), 'error');
  assert.equal(orbStateFor({ mode: 'thinking', failed: true }), 'thinking', 'a new turn clears it');
});

test('an unknown mode is idle, never undefined', () => {
  assert.equal(orbStateFor({ mode: 'dancing' }), 'idle');
});
