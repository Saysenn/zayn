import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readThemeId, saveThemeId, applyTheme } from './theme.js';
import { DEFAULT_THEME_ID } from '../configs/themes.js';

// ***************************************************
// * The chosen theme survives a page load and a sign out
// ***************************************************

function fakeBrowser({ throws = false } = {}) {
  const store = new Map();
  const vars = {};
  globalThis.window = {
    localStorage: {
      getItem: (k) => { if (throws) throw new Error('blocked'); return store.get(k) ?? null; },
      setItem: (k, v) => { if (throws) throw new Error('blocked'); store.set(k, String(v)); },
    },
  };
  globalThis.document = { documentElement: { dataset: {}, style: { setProperty: (n, v) => { vars[n] = v; } } } };
  return { store, vars };
}

test('A SAVED THEME IS READ BACK on the next load', () => {
  fakeBrowser();
  saveThemeId('teal');
  assert.equal(readThemeId(), 'teal');
});

test('AND APPLIED before anything draws', () => {
  const { vars } = fakeBrowser();
  applyTheme('red');
  assert.equal(document.documentElement.dataset.theme, 'red');
  assert.equal(vars['--accent-strong'], '185 28 28');
  // main.jsx applies it BEFORE rendering, so the login page is themed too.
  const main = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8');
  assert.ok(main.indexOf('applyTheme(readThemeId())') < main.indexOf('createRoot('), 'applied after the first render');
});

test('A THEME THAT NO LONGER EXISTS, or blocked storage, falls back to the default', () => {
  const { store } = fakeBrowser();
  store.set('crm.theme', 'rose');
  assert.equal(readThemeId(), DEFAULT_THEME_ID);
  fakeBrowser({ throws: true });
  assert.equal(readThemeId(), DEFAULT_THEME_ID);
  assert.doesNotThrow(() => saveThemeId('teal'));
});

// Sign out must not wipe it: nothing may clear localStorage wholesale.
test('NOTHING CLEARS THE WHOLE OF localStorage', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  const offenders = walk(root)
    .filter((f) => /\.(js|jsx)$/.test(f) && !f.endsWith('.test.js'))
    .filter((f) => /localStorage\.clear\(\)/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});
