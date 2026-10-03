import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NAV_TOP, NAV_GROUPS, VISIBLE_GROUPS, NAV_ITEMS, ADMIN_MENU, WORKSPACE_NAME,
} from './navigation.js';

/**
 * ***************************************************
 * * The sidebar has ONE control file
 * ***************************************************
 *
 * Grouped by what the money is DOING, his call 2026-09-17. Adding a page
 * is one entry here and nothing else, which is the whole reason it stopped
 * being a list inside Layout.jsx.
 */

test('THREE KINDS OF MONEY, THEN THE OTHER SYSTEM, in his order', () => {
  assert.deepEqual(NAV_GROUPS.map((g) => g.key), ['payments', 'expenses', 'debts', 'whatbot']);
  assert.deepEqual(NAV_GROUPS.map((g) => g.label), ['Payments', 'Expenses', 'Debts', 'Whatbot']);
});

test('THE MASTER SHEET IS A PAGE INSIDE PAYMENTS, not a sibling of it', () => {
  // One table, four views: tb_mastersheet is the payment record and
  // People, Companies and the Archive are readings of it. As a sibling of
  // Payments nobody could predict which page sat under which.
  const payments = NAV_GROUPS.find((g) => g.key === 'payments');
  assert.deepEqual(
    payments.items.map((i) => i.to),
    ['/master-sheet', '/people', '/companies', '/review', '/archive'],
  );
});

test('REVIEW COMES BEFORE THE ARCHIVE, because it is what sends deals there', () => {
  // His call 2026-09-29: it was a modal behind a button that only appeared
  // while something was waiting, so the one screen that ASKS a question
  // could not be opened to check it had been answered.
  const payments = NAV_GROUPS.find((g) => g.key === 'payments');
  const order = payments.items.map((i) => i.to);
  assert.ok(order.indexOf('/review') < order.indexOf('/archive'));
});

test('DASHBOARD LEADS, in no group', () => {
  // It reads across every flow, so it belongs to none of them.
  assert.deepEqual(NAV_TOP.map((i) => i.to), ['/dashboard']);
});

test('FLAGGED BELONGS TO WHATBOT, and comes LAST', () => {
  // His call 2026-09-17: it is what the WhatsApp agent raised with a
  // person, not a kind of money.
  const whatbot = NAV_GROUPS.find((g) => g.key === 'whatbot');
  assert.deepEqual(whatbot.items.map((i) => i.to), ['/flagged']);
  assert.equal(NAV_GROUPS.at(-1).key, 'whatbot');
});

test('CHAT IS NOT TOP LEVEL. It opens on a named person', () => {
  assert.equal(NAV_ITEMS.some((i) => i.to === '/chat'), false);
});

test('AN EMPTY GROUP DRAWS NOTHING', () => {
  // Debts is declared because the shape is decided, and has no page
  // because what a debt IS has not been. A heading over nothing is a dead
  // link with a title.
  assert.deepEqual(NAV_GROUPS.find((g) => g.key === 'debts').items, []);
  assert.deepEqual(VISIBLE_GROUPS.map((g) => g.key), ['payments', 'expenses', 'whatbot']);
});

test('NAV_ITEMS IS BUILT FROM THE GROUPS, never written twice', () => {
  // The phone's bottom bar has no room for headings, so it draws the flat
  // list. Two hand kept lists is a page reachable on a laptop and missing
  // on a phone.
  const flat = [
    ...NAV_TOP.map((i) => i.to),
    ...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to)),
  ];
  assert.deepEqual(NAV_ITEMS.map((i) => i.to), flat);
});

test('EVERY ITEM IS WHOLE, and no destination is listed twice', () => {
  const seen = new Set();
  for (const item of NAV_ITEMS) {
    assert.match(item.to, /^\/[a-z-]+$/, `${item.to} is not a path`);
    assert.ok(item.label, `${item.to} has no label`);
    assert.equal(typeof item.icon, 'string', `${item.to} has no icon`);
    assert.equal(seen.has(item.to), false, `${item.to} is in the nav twice`);
    seen.add(item.to);
  }
});

test('EVERY NAV PATH IS A REAL ROUTE', () => {
  // A heading is cosmetic; a link that goes nowhere is a broken page.
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  for (const item of [...NAV_ITEMS, ...ADMIN_MENU]) {
    const path = item.to.slice(1);
    assert.match(app, new RegExp(`<Route path="${path}"`), `${item.to} has no route`);
  }
});

/**
 * ===============================
 * * THE ACCOUNT MENU IS THIS FILE'S TOO
 * ===============================
 * Settings was written into Layout.jsx by hand, TWICE: a sidebar row and a
 * second gear in the header for phones. So it was the one nav entry this
 * file did not decide, and the two copies could drift. History joining it
 * (his call 2026-09-29) would have been a third and a fourth.
 */
test('HISTORY SITS ABOVE SETTINGS, and neither is in a group', () => {
  assert.deepEqual(ADMIN_MENU.map((i) => i.to), ['/history', '/settings']);
  const grouped = new Set(NAV_ITEMS.map((i) => i.to));
  for (const item of ADMIN_MENU) {
    assert.equal(grouped.has(item.to), false, `${item.to} is in a group as well`);
  }
});

test('AND ITS ENTRIES ARE WHOLE, like every other one', () => {
  const icons = readFileSync(new URL('../components/icons/index.jsx', import.meta.url), 'utf8');
  for (const item of ADMIN_MENU) {
    assert.match(item.to, /^\/[a-z-]+$/, `${item.to} is not a path`);
    assert.ok(item.label, `${item.to} has no label`);
    assert.ok(icons.includes(`export const ${item.icon} `), `${item.icon} is not an icon`);
  }
});

test('SIGN OUT IS NOT IN IT, because it is an act and not a page', () => {
  // Everything in this file has a `to`. An act with a route is a route that
  // does something when you land on it, which is a page you cannot refresh.
  for (const item of ADMIN_MENU) assert.ok(item.to, 'every entry is a destination');
  assert.equal(ADMIN_MENU.some((i) => /sign ?out/i.test(i.label)), false);
});

test('THE MENU DRAWS ITSELF FROM HERE, not from its own list', () => {
  // Comments stripped: this file talks about Sign out before it renders it.
  const menu = readFileSync(new URL('../components/layout/AdminMenu.jsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(menu, /ADMIN_MENU\.map/);
  assert.match(menu, /import \* as Icons from '\.\.\/icons'/, 'the icon name resolves');
  // And it renders the act itself, after the destinations.
  assert.ok(menu.indexOf('ADMIN_MENU.map') < menu.indexOf('Sign out'));
});

test('THE LAYOUT KEEPS NO SECOND COPY OF ANY OF THEM', () => {
  const layout = readFileSync(new URL('../components/layout/Layout.jsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(layout, /<AdminMenu \/>/);
  // The hardcoded sidebar row, the red button under it and the phone's pair
  // are what this replaced. Any of them coming back is two ways to do one
  // thing, and one of them not reading this file.
  assert.doesNotMatch(layout, /to="\/settings"/, 'no second Settings link');
  assert.doesNotMatch(layout, /aria-label="Sign out"/, 'no second sign out');
  assert.doesNotMatch(layout, /useLogout/, 'the layout does not sign anybody out');
});

test('THE WORKSPACE IS NAMED ONCE, and both places read it', () => {
  assert.ok(WORKSPACE_NAME);
  const layout = readFileSync(new URL('../components/layout/Layout.jsx', import.meta.url), 'utf8');
  const menu = readFileSync(new URL('../components/layout/AdminMenu.jsx', import.meta.url), 'utf8');
  for (const [where, src] of [['layout', layout], ['menu', menu]]) {
    assert.match(src, /\{WORKSPACE_NAME\}/, `${where} spells the name out`);
    assert.ok(!src.includes(`"${WORKSPACE_NAME}"`), `${where} has a literal copy`);
  }
});

test('LAYOUT DECIDES NOTHING. It reads this file', () => {
  const layout = readFileSync(new URL('../components/layout/Layout.jsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(layout, /const NAV_ITEMS = \[/, 'the list must not live in the layout');
  assert.match(layout, /from '\.\.\/\.\.\/configs\/navigation'/);
});

test('EVERY ICON NAME IS A REAL EXPORT', () => {
  // The config is pure data so it can be tested at all, which means the
  // name is only checked here. An unresolved one renders as `undefined` and
  // React throws, taking the whole sidebar with it.
  const icons = readFileSync(new URL('../components/icons/index.jsx', import.meta.url), 'utf8');
  for (const item of NAV_ITEMS) {
    assert.ok(
      icons.includes(`export const ${item.icon} `),
      `${item.icon} is not an icon`,
    );
  }
});

test('EVERY RENDERER RESOLVES THE NAME, so none draws a blank', () => {
  const layout = readFileSync(new URL('../components/layout/Layout.jsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // The sidebar and the phone's bottom bar. The account menu resolves its
  // own, and navigation.test's own check above pins that.
  assert.equal((layout.match(/Icons\[/g) ?? []).length, 2);
  assert.match(layout, /import \* as Icons from '\.\.\/icons'/);
});
