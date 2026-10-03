import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  THEMES, THEME_IDS, DEFAULT_THEME_ID, themeVars, dianeOf,
} from './themes.js';

// ***************************************************
// * Every theme is readable, and every theme is complete
// ***************************************************
// "Ensure text colours adapt to the background": held here as WCAG contrast,
// for every theme, on every pairing the roles in tailwind.config.js promise.

const WHITE = '#ffffff';
const channel = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const AA = 4.5;
const AAA = 7;
// Faint text is a caption, never a figure: large text rule.
const LARGE = 3;

test('FIVE THEMES, the default teal', () => {
  assert.deepEqual(THEME_IDS, ['green', 'teal', 'yellow', 'blue', 'red']);
  // Yellow's partner is maroon, red's a subtle yellow.
  assert.equal(THEMES.yellow.accent.strong, '#7a1f2b');
  assert.equal(THEMES.red.accent.DEFAULT, '#ffe9a8');
  assert.equal(DEFAULT_THEME_ID, 'teal');
  assert.equal(THEMES.green.accent.strong, '#14764a');
  // The light blue is the export's own "Blue white" band.
  assert.equal(THEMES.blue.accent['tint-strong'], '#ddebf7');
});

test('EVERY THEME NAMES EVERY VALUE, so none falls back to another colour', () => {
  const keys = (theme) => ({
    accent: Object.keys(theme.accent).sort(),
    neutral: Object.keys(theme.neutral).sort(),
    chart: Object.keys(theme.chart).sort(),
    diane: Object.keys(theme.diane).sort(),
  });
  const want = keys(THEMES[DEFAULT_THEME_ID]);
  for (const id of THEME_IDS) {
    assert.deepEqual(keys(THEMES[id]), want, id);
    assert.deepEqual(Object.keys(themeVars(THEMES[id])).sort(), Object.keys(themeVars(THEMES[DEFAULT_THEME_ID])).sort(), id);
  }
});

for (const id of THEME_IDS) {
  const { accent: a, neutral: n } = THEMES[id];
  test(`${id}: the CRM's text reads on what it sits on`, () => {
    assert.ok(contrast(WHITE, a.strong) >= AA, `white on the primary button: ${contrast(WHITE, a.strong).toFixed(2)}`);
    assert.ok(contrast(WHITE, a['strong-deep']) >= AA, 'white on the pressed button');
    assert.ok(contrast(a.strong, n.bg) >= AA, `accent text on the page: ${contrast(a.strong, n.bg).toFixed(2)}`);
    assert.ok(contrast(a.strong, a.tint) >= AA, 'accent text on its tint');
    assert.ok(contrast(a.ink, a.DEFAULT) >= AA, `ink on the pale fill: ${contrast(a.ink, a.DEFAULT).toFixed(2)}`);
    assert.ok(contrast(a.ink, a.deep) >= AA, 'ink on the pressed fill');
    assert.ok(contrast(n.text, n.bg) >= AAA, 'body text on the page');
    assert.ok(contrast(n['text-muted'], WHITE) >= AA, 'muted text on a card');
    assert.ok(contrast(n['text-faint'], WHITE) >= LARGE, 'faint captions on a card');
  });

  test(`${id}: Diane's text reads on her dark ground`, () => {
    const d = dianeOf(THEMES[id]);
    assert.ok(contrast(d.signal, d.void) >= AAA, `signal on her ground: ${contrast(d.signal, d.void).toFixed(2)}`);
    assert.ok(contrast(d.signal, d.panel) >= AA, 'signal on a panel');
    assert.ok(contrast(d.dim, d.void) >= AA, `labels on her ground: ${contrast(d.dim, d.void).toFixed(2)}`);
    assert.ok(contrast(d.void, d.signal) >= AAA, 'her dark text on a signal button');
    // A warning must not vanish into the theme's own colour.
    assert.notEqual(d.warn.toLowerCase(), d.signal.toLowerCase(), 'warning distinct from the signal');
  });
}

test('THE BRAND IS THEMED, THE MEANING IS NOT: statuses and exports keep their colours', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  for (const status of ['paying', 'active', 'confirmed', 'resolved', 'going_concern', 'newly_opened']) {
    assert.match(css, new RegExp(`\\.badge-${status} \\{ @apply bg-success-tint text-success-strong; \\}`), status);
  }
  const config = readFileSync(new URL('../../tailwind.config.js', import.meta.url), 'utf8');
  assert.match(config, /success: \{ strong: '#14764a', tint: '#eefaf3' \}/);
  // The payment start tints are what the exported sheet shows: never themed.
  const start = readFileSync(new URL('../helpers/paymentStartState.js', import.meta.url), 'utf8');
  assert.match(start, /bg-\[#CDEBD5\]/);
});
