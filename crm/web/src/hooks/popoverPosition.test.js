import test from 'node:test';
import assert from 'node:assert/strict';

import { popoverPosition } from './usePopoverPosition.js';

const VIEW = { width: 1000, height: 800 };
const BOX = { width: 256, height: 96 };
const anchor = (over) => ({
  top: 100, bottom: 114, left: 300, right: 314, ...over,
});

test('it sits below the anchor when there is room', () => {
  const { top } = popoverPosition(anchor(), BOX, VIEW);
  assert.equal(top, 118, 'the anchor bottom plus the gap');
});

test('it FLIPS ABOVE on the last row, where there is not', () => {
  // 40px of space below, a 96px panel. Rendered below it would be cut off
  // by the window, which is exactly the bottom of a long table.
  const { top } = popoverPosition(anchor({ top: 746, bottom: 760 }), BOX, VIEW);
  assert.equal(top, 646, 'above the anchor, by its own height plus the gap');
});

test('a panel on the rightmost column is pulled back on screen', () => {
  const { left } = popoverPosition(anchor({ left: 980 }), BOX, VIEW);
  assert.equal(left, 736, 'the viewport less the panel and the edge margin');
});

test('a panel at the left edge keeps the edge margin', () => {
  const { left } = popoverPosition(anchor({ left: 0 }), BOX, VIEW);
  assert.equal(left, 8);
});

test('an ordinary anchor is left alone', () => {
  const { left } = popoverPosition(anchor(), BOX, VIEW);
  assert.equal(left, 300);
});
