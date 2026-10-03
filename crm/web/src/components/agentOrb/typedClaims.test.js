import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./AgentOverlay.jsx', import.meta.url), 'utf8');

test('the final typed claims travel with the assistant history entry', () => {
  // THE RULE IS THAT CLAIMS ARRIVE AND ARE CARRIED, not the exact shape of
  // the destructure. This pinned the whole line, so widening it to take the
  // turn's `offer` read as breaking it. Repinned 2026-09-29.
  assert.match(source, /const \{[^}]*\bclaims = \[\][^}]*\} = await/);
  assert.match(source, /\{ role: 'assistant', content: reply, claims \}/);
});
