import test from 'node:test';
import assert from 'node:assert/strict';

import { paginationPages } from './paginationPages.js';

test('ten pages or fewer remain directly visible', () => {
  assert.deepEqual(paginationPages(4, 8), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('large pagination keeps the ends and current page in a compact row', () => {
  assert.deepEqual(paginationPages(50, 100), [1, 'start-gap', 49, 50, 51, 'end-gap', 100]);
  assert.deepEqual(paginationPages(1, 100), [1, 2, 3, 4, 5, 'end-gap', 100]);
  assert.deepEqual(paginationPages(100, 100), [1, 'start-gap', 96, 97, 98, 99, 100]);
});
