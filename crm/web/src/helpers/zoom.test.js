import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomAt, MAX_ZOOM } from './zoom.js';

test('A RECEIPT ZOOMS AROUND THE POINTER: that spot stays put (his call 2026-10-07)', () => {
  const v = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 });
  assert.deepEqual(v, { scale: 2, x: -100, y: -50 });
  // the point under the pointer maps to the same screen spot before and after
  const before = { x: 100, y: 50 };
  assert.equal((before.x - v.x) / v.scale * 1, 100);
});

test('ZOOM STAYS BETWEEN FIT AND 6×, and fitting again centres it', () => {
  assert.equal(zoomAt({ scale: 5, x: 0, y: 0 }, 50, { x: 0, y: 0 }).scale, MAX_ZOOM);
  assert.deepEqual(zoomAt({ scale: 2, x: -40, y: 10 }, 0.5, { x: 0, y: 0 }), { scale: 1, x: 0, y: 0 });
});
