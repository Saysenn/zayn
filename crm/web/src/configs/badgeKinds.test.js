import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BADGE_LABELS, BADGE_CLASSES } from './badgeKinds.js';
import tailwind from '../../tailwind.config.js';

/**
 * ***************************************************
 * * A CLASS NAME NOTHING SPELLS OUT IS DROPPED FROM THE BUILD
 * ***************************************************
 *
 * Tailwind's content scan reads source TEXT. `StatusBadge` builds
 * `badge-${status}`, so no file contains `badge-going_concern`, and every
 * rule whose class is never seen is purged out of the compiled CSS.
 *
 * ELEVEN OF THE TWENTY WERE DEAD IN PRODUCTION, found 2026-09-21 against
 * the built stylesheet and the live page. Only `badge-liquidation`
 * survived, because two files happen to write it in full. Among the dead:
 * the end date pill, `going_concern`, and every payment outcome.
 *
 * `colourTokens.test.js` was green throughout. It checks that a token
 * inside a class EXISTS; this checks that the class SURVIVES.
 *
 * So the safelist is the guard and this is what keeps it honest, in both
 * directions: a rule with no key is purged, a key with no rule renders
 * plain.
 */

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

/** `.badge-going_concern { ... }`, including the grouped selectors. */
function classesInCss() {
  const css = read('../index.css');
  const found = new Set();
  for (const [, kind] of css.matchAll(/\.badge-([a-z_]+)\s*(?:,|\{)/g)) {
    // The size modifier is not a kind: it carries no colour and rides on
    // top of one.
    if (kind !== 'sm') found.add(kind);
  }
  return found;
}

test('EVERY BADGE RULE IN index.css IS SAFELISTED, or the build drops it', () => {
  const orphans = [...classesInCss()].filter((kind) => !(kind in BADGE_LABELS));
  assert.deepEqual(
    orphans,
    [],
    'These rules are purged: nothing spells the class out and configs/badgeKinds.js\n'
    + `does not list it, so the badge renders as bare text.\n  ${orphans.join('\n  ')}`,
  );
});

test('AND EVERY KIND HAS A RULE, or the badge renders with no colour', () => {
  const inCss = classesInCss();
  const unstyled = Object.keys(BADGE_LABELS).filter((kind) => !inCss.has(kind));
  assert.deepEqual(
    unstyled,
    [],
    `These have a label and no colour, so they print plain:\n  ${unstyled.join('\n  ')}`,
  );
});

test('THE SAFELIST IS BUILT FROM THE KEYS, never typed out beside them', () => {
  const safelist = tailwind.safelist ?? [];
  for (const cls of BADGE_CLASSES) {
    assert.ok(safelist.includes(cls), `${cls} is missing from tailwind.config.js safelist`);
  }
  // Derived, so adding a badge is one line in one file. A hand written
  // list is the same bug waiting: the next kind gets added to the map and
  // not to the config.
  assert.match(read('../../tailwind.config.js'), /safelist: \[\.\.\.BADGE_CLASSES\]/);
});

test('THE CLASS IS STILL COMPOSED, which is why the safelist is needed', () => {
  // If this ever becomes a literal lookup the safelist stops being load
  // bearing, and this test should be the thing that says so.
  assert.match(read('../components/badges/StatusBadge.jsx'), /badge-\$\{status\}/);
});

test('THE FIVE COMPANY STATUSES ALL HAVE A BADGE', () => {
  // The mirror that started it: migration 058 added two and 059 a fifth,
  // and each arrived unstyled because the class was never scanned.
  for (const status of ['active', 'going_concern', 'liquidation', 'dissolved', 'closed']) {
    assert.ok(status in BADGE_LABELS, `${status} has no badge`);
  }
});
