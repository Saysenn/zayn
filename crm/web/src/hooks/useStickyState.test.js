import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * Filters that survive leaving the page
 * ***************************************************
 *
 * The hook needs React, so what runs here is the STORAGE half: the read,
 * the write and the clear, which is where the traps are. The wiring is
 * asserted against the source.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, f), 'utf8');
const page = (f) => fs.readFileSync(path.join(here, '..', 'pages', f), 'utf8');

const PREFIX = 'crm.filters.';

// The same three functions, rebuilt so they can run without a browser.
function makeStore(impl = {}) {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    ...impl,
  };
}
const read = (store, key, fallback) => {
  try {
    const raw = store.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
};
const write = (store, key, value) => {
  try {
    if (value === undefined) store.removeItem(PREFIX + key);
    else store.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* the page works either way */ }
};
const clear = (store, prefix) => {
  try {
    const full = PREFIX + prefix;
    const keys = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (k && k.startsWith(full)) keys.push(k);
    }
    for (const k of keys) store.removeItem(k);
  } catch { /* as above */ }
};

test('a value written comes back the same', () => {
  const s = makeStore();
  for (const v of ['INDIGO', '', 0, false, { field: 'monthly_amount', min: 500 }, ['a']]) {
    write(s, 'k', v);
    assert.deepEqual(read(s, 'k', 'FALLBACK'), v, `round trip ${JSON.stringify(v)}`);
  }
});

test('UNDEFINED is a real filter state and round-trips as the fallback', () => {
  // "not filtering on this" is undefined, and JSON.stringify turns it into
  // the string "undefined", which parses back as a crash. Removing the key
  // is what works.
  const s = makeStore();
  write(s, 'paid', true);
  write(s, 'paid', undefined);
  assert.equal(s.getItem(`${PREFIX}paid`), null, 'the key is removed, not set to "undefined"');
  assert.equal(read(s, 'paid', undefined), undefined);
});

test('false and 0 are kept, not treated as absent', () => {
  // `raw === null`, never a falsy check: an unticked toggle is a value.
  const s = makeStore();
  write(s, 'byDate', false);
  assert.equal(read(s, 'byDate', true), false);
  write(s, 'n', 0);
  assert.equal(read(s, 'n', 99), 0);
});

test('nothing stored gives the fallback', () => {
  assert.equal(read(makeStore(), 'never-set', 'INDIGO'), 'INDIGO');
});

test('storage that THROWS does not take the page down', () => {
  // Private windows and some embedded browsers throw on access outright.
  const angry = makeStore({
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  });
  assert.equal(read(angry, 'k', 'FALLBACK'), 'FALLBACK');
  assert.doesNotThrow(() => write(angry, 'k', 'x'));
  assert.doesNotThrow(() => clear(angry, 'masterSheet.'));
});

test('corrupt JSON gives the fallback rather than throwing', () => {
  const s = makeStore();
  s.setItem(`${PREFIX}k`, '{not json');
  assert.equal(read(s, 'k', 'FALLBACK'), 'FALLBACK');
});

test('clear removes this page only, and ALL of it', () => {
  // Collected before removing: deleting while iterating skips every other
  // key, so half the filters would survive a Clear.
  const s = makeStore();
  write(s, 'masterSheet.group', 'INDIGO');
  write(s, 'masterSheet.status', 'active');
  write(s, 'masterSheet.paid', true);
  write(s, 'people.filters', { role: 'Mid 1' });

  clear(s, 'masterSheet.');

  assert.equal(read(s, 'masterSheet.group', null), null);
  assert.equal(read(s, 'masterSheet.status', null), null);
  assert.equal(read(s, 'masterSheet.paid', null), null);
  assert.deepEqual(read(s, 'people.filters', null), { role: 'Mid 1' }, 'another page is untouched');
});

test('keys are namespaced, so two pages with a `group` filter do not collide', () => {
  const s = makeStore();
  write(s, 'masterSheet.group', 'INDIGO');
  write(s, 'flagged.group', 'MILKMAN');
  assert.equal(read(s, 'masterSheet.group', null), 'INDIGO');
  assert.equal(read(s, 'flagged.group', null), 'MILKMAN');
});

test('it is sessionStorage, not localStorage', () => {
  // A filter is invisible state. Dying with the tab bounds it to one
  // sitting; localStorage would carry it to next week and the CRM would
  // look broken on Monday.
  const s = src('useStickyState.js');
  assert.match(s, /window\.sessionStorage/);
  // The word appears in the comment explaining WHY not, so the check is
  // on the accessor rather than the string.
  assert.ok(!/window.localStorage/.test(s));
});

test('every filtered page remembers, and every Clear forgets', () => {
  // A page that remembers but does not forget is worse than one that does
  // neither: Clear would work until you walked away and came back.
  for (const f of ['MasterSheetPage.jsx', 'CompaniesPage.jsx', 'PeoplePage.jsx', 'FlaggedPage.jsx']) {
    const s = page(f);
    assert.match(s, /useStickyState\(/, `${f} must remember its filters`);
    assert.match(s, /forgetFilters\(\)/, `${f}'s Clear must forget them`);
  }
});

test('the PAGE NUMBER is never sticky', () => {
  // Coming back to page 4 of a list you have not seen in ten minutes is
  // disorienting, and every filter change resets it to 1 anyway.
  for (const f of ['MasterSheetPage.jsx', 'CompaniesPage.jsx', 'PeoplePage.jsx', 'FlaggedPage.jsx']) {
    assert.match(page(f), /const \[page, setPage\] = useState\(1\)/, `${f} keeps page in plain state`);
  }
});

test('every page that USES the hooks also IMPORTS them', () => {
  // The build cannot catch this. An undefined identifier inside a component
  // is a runtime ReferenceError, not a bundling error, so `npm run build`
  // was green while the People page crashed on open with
  // "useClearSticky is not defined".
  const pages = fs.readdirSync(path.join(here, '..', 'pages')).filter((f) => f.endsWith('.jsx'));
  let checked = 0;
  for (const f of pages) {
    const s = page(f);
    const imported = s.split('\n').find((l) => l.includes("hooks/useStickyState")) ?? '';
    for (const fn of ['useStickyState', 'useClearSticky']) {
      if (!s.includes(`${fn}(`)) continue;
      checked += 1;
      assert.ok(imported.includes(fn), `${f} calls ${fn} without importing it`);
    }
  }
  // Guards the guard: a matcher that quietly matches nothing passes too.
  assert.ok(checked >= 8, `expected both hooks used on four pages, saw ${checked}`);
});
