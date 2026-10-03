import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ***************************************************
 * * An open export survives a reload. Its FIGURES do not.
 * ***************************************************
 *
 * The transcript is deliberately not persisted: it is written to the
 * database when a conversation ENDS, never while it is happening. But an
 * export halfway through is work in progress, and losing it to a stray F5
 * means starting the conversation over.
 *
 * SO THE CONFIG IS KEPT AND THE FIGURES ARE NOT. What comes back after a
 * reload is a card rebuilt from the query, not the numbers that happened
 * to be on screen when the tab last had focus.
 */

const HERE = new URL('./AgentOverlay.jsx', import.meta.url);
const src = readFileSync(HERE, 'utf8');
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

test('the open export is restored into history on mount', () => {
  assert.ok(code.includes('openExportFromStorage()'), 'nothing is restored');
  assert.ok(/useState\(\(\) => \[/.test(code), 'it is not seeded at first render');
});

test('ONLY THE CONFIG IS STORED, never the counts or the rows', () => {
  // A remembered figure on a document about to be sent is the whole thing
  // this avoids.
  const stored = code.match(/JSON\.stringify\(\{[\s\S]*?\}\)/)?.[0] ?? '';
  assert.ok(stored.includes('draft') && stored.includes('query'), 'the config is not kept');
  for (const volatile of ['preview', 'rows:', 'columns', 'fileName']) {
    assert.ok(!stored.includes(volatile), `a stale ${volatile} is being stored`);
  }
});

test('the restored card carries NO figures, so it must refetch', () => {
  const restored = code.match(/exportSession: \{ draft, query[^}]*\}/)?.[0] ?? '';
  assert.ok(restored, 'the restored shape changed');
  assert.ok(!restored.includes('preview'), 'it restored a stale count');
});

test('sessionStorage, so it dies with the tab', () => {
  // Same reasoning as the CRM's sticky filters. localStorage would leave
  // a half-built export waiting weeks later.
  assert.ok(code.includes('sessionStorage.getItem'), 'it is not reading storage');
  assert.ok(!code.includes('localStorage'), 'it outlives the tab');
});

test('EVERY READ AND WRITE IS GUARDED', () => {
  // A private window, cleared site data, or a browser set to block it all
  // throw on the accessor itself.
  const helpers = code.match(/function (openExportFromStorage|rememberExport|forgetExport)[\s\S]*?\n\}/g) ?? [];
  assert.equal(helpers.length, 3, 'a storage helper went missing');
  for (const fn of helpers) assert.ok(fn.includes('try'), `unguarded storage access:\n${fn.slice(0, 80)}`);
});

test('PAUSE KEEPS IT, CANCEL AND BUILD DROP IT', () => {
  // The same distinction on disk as on screen. Building ends the session,
  // so a reload afterwards must not resurrect a file already downloaded.
  assert.ok(/build\) forgetExport\(\); else rememberExport/.test(code), 'building leaves it behind');
  assert.ok(code.includes('rememberExport(next[at].exportSession, true)'), 'a pause is not kept');
  assert.ok(/function cancelExport[\s\S]*?forgetExport\(\)/.test(code), 'a cancel leaves it behind');
});
