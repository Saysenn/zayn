import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import defaultColors from 'tailwindcss/colors.js';
import tailwind from '../../tailwind.config.js';

/**
 * ***************************************************
 * * A COLOUR CLASS TAILWIND DOES NOT KNOW COMPILES TO NOTHING
 * ***************************************************
 *
 * No error, no warning, no style. Three invented tokens shipped this way
 * and nobody saw them because the element still rendered, just plain:
 *
 *   bg-surface-subtle   a panel with no panel
 *   surface-hover       row hover on Companies, Flagged and People, dead
 *   border-line         nine table separators falling back to Tailwind's
 *                       grey instead of the green hairline
 *
 * Every one is a PLAUSIBLE SIBLING of a real token, which is exactly why
 * reading the diff never caught them. Found 2026-09-21.
 *
 * So the config is the allow list and the source is checked against it.
 * A new token is one line in tailwind.config.js; a typo is a red test.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(HERE, '..');

// Prefixes whose value can be a colour. `shadow` and `accent` are left out:
// their non-colour uses swamp the colour ones.
const COLOUR_PREFIXES = [
  'bg', 'text', 'border', 'ring', 'divide', 'placeholder', 'caret',
  'decoration', 'fill', 'stroke', 'outline', 'from', 'to', 'via',
];

/**
 * The suffixes these prefixes take that are NOT colours: sizes, sides,
 * styles, alignment. Anything here and not a colour is fine; anything in
 * neither is the bug this test exists for.
 *
 * Adding `text-5xl` one day means adding `5xl` here. One line, and the
 * failure says so.
 */
const NOT_A_COLOUR = new Set([
  // widths, sizes and offsets
  '0', '1', '2', '4', '8', 'px',
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl',
  'offset-0', 'offset-1', 'offset-2', 'offset-4', 'offset-8',
  'spacing-0', 'spacing-px',
  // sides and axes
  'b', 'b-0', 'b-2', 't', 't-0', 't-2', 'r', 'r-0', 'l', 'l-0',
  'x', 'x-0', 'x-2', 'y', 'y-0', 'y-2', 's', 'e',
  // line styles and table layout
  'solid', 'dashed', 'dotted', 'double', 'hidden', 'none',
  'collapse', 'separate', 'inset', 'box',
  // background clipping: `bg-clip-text` paints a gradient into the letters
  'clip-text',
  // text layout
  'left', 'center', 'right', 'justify', 'start', 'end',
  'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip',
  'underline', 'overline', 'line-through', 'no-underline',
  // backgrounds
  'fixed', 'local', 'scroll', 'auto', 'cover', 'contain',
  'top', 'bottom', 'repeat', 'no-repeat',
  'gradient-to-t', 'gradient-to-tr', 'gradient-to-r', 'gradient-to-br',
  'gradient-to-b', 'gradient-to-bl', 'gradient-to-l', 'gradient-to-tl',
]);

/** `{ accent: { DEFAULT, tint } }` is `accent` and `accent-tint`. */
function flatten(colours, prefix = '') {
  const names = new Set();
  for (const [key, value] of Object.entries(colours ?? {})) {
    const name = key === 'DEFAULT' ? prefix : (prefix ? `${prefix}-${key}` : key);
    if (value && typeof value === 'object') {
      for (const inner of flatten(value, name)) names.add(inner);
    } else if (name) {
      names.add(name);
    }
  }
  return names;
}

// Tailwind prints a rename warning on touching any of these, and reading
// the whole palette touches all five. Same colours under their new names.
const RENAMED = ['lightBlue', 'warmGray', 'trueGray', 'coolGray', 'blueGray'];

const VALID = new Set([
  ...flatten(tailwind.theme.extend.colors),
  ...flatten(Object.fromEntries(
    Object.entries(Object.getOwnPropertyDescriptors(defaultColors))
      .filter(([key]) => !RENAMED.includes(key))
      .map(([key, d]) => [key, d.value]),
  )),
  'transparent', 'current', 'inherit', 'white', 'black',
]);

function jsxFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...jsxFiles(path));
    else if (/\.jsx?$/.test(entry) && !/\.test\./.test(entry)) found.push(path);
  }
  return found;
}

/**
 * Class strings only: `className="..."`, `` `...` `` and `'...'` inside one.
 * Reading whole files matched prose in comments ("the tone is
 * `border-strong` rather than") and reported two phantom failures.
 */
function classStrings(src) {
  const out = [];
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  // Class names held in a const map, e.g. SIZES in TrendText.
  for (const m of src.matchAll(/(?:'|")((?:[a-z0-9:[\]/.%-]+ )+[a-z0-9:[\]/.%-]+)(?:'|")/g)) {
    out.push(m[1]);
  }
  return out;
}

test('EVERY COLOUR CLASS RESOLVES TO A TOKEN IN tailwind.config.js', () => {
  const dead = [];
  const pattern = new RegExp(
    `(?:^|\\s)(?:[a-z-]+:)*(${COLOUR_PREFIXES.join('|')})-([a-zA-Z0-9-]+)(?:/\\d+)?(?=$|\\s)`,
    'g',
  );

  // The two sweeps in classStrings overlap, so one bad class was reported
  // twice. A set keeps the message to one line per fault.
  const seen = new Set();
  for (const file of jsxFiles(SRC)) {
    for (const chunk of classStrings(readFileSync(file, 'utf8'))) {
      for (const [, prefix, suffix] of chunk.matchAll(pattern)) {
        if (VALID.has(suffix) || NOT_A_COLOUR.has(suffix)) continue;
        const line = `${relative(SRC, file)}  ${prefix}-${suffix}`;
        if (seen.has(line)) continue;
        seen.add(line);
        dead.push(line);
      }
    }
  }

  assert.deepEqual(
    dead,
    [],
    `These compile to nothing. Add the colour to tailwind.config.js, or the\n`
    + `suffix to NOT_A_COLOUR if it is a size or a style:\n  ${dead.join('\n  ')}`,
  );
});

/** The three that got through, named, so the fix cannot be undone quietly. */
test('the three invented tokens are gone and stay gone', () => {
  for (const name of ['surface-subtle', 'surface-hover', 'border-line']) {
    assert.ok(!VALID.has(name), `${name} was never a token`);
  }
  for (const file of jsxFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const name of ['bg-surface-subtle', 'bg-surface-hover', 'border-line ']) {
      assert.doesNotMatch(src, new RegExp(name), `${relative(SRC, file)} still has ${name}`);
    }
  }
});
