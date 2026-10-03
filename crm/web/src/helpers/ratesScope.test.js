import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * A component that USES cryptoPercent must BIND it
 * ***************************************************
 *
 * THE BUG THIS EXISTS FOR, twice in two days. A prop was added to a
 * wrapper's signature while the thing reading it lived in a component
 * further down the file. It parsed, every source test passed, and the page
 * threw "percentagesTable is not defined" the moment it opened.
 *
 * `cryptoPercent` is the same shape of risk: it is read inside deal cards
 * and handler rows that are separate components from the page around them.
 *
 * PLAIN `includes`, never a built regex. A previous version of this guard
 * escaped \b into a literal backspace, matched nothing, and passed against
 * a file broken on purpose.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const PAGES = path.join(here, '..', 'pages');

const FILES = ['MasterSheetPage.jsx', 'PersonDetailPage.jsx', 'CompanyDetailPage.jsx'];
const NAME = 'cryptoPercent';

function componentsIn(file) {
  const text = fs.readFileSync(path.join(PAGES, file), 'utf8');
  const starts = [...text.matchAll(/^(?:export default )?(?:const \w+ = memo\()?function (\w+)[ (]/gm)];
  return starts.map((m, i) => ({
    name: m[1],
    body: text.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : text.length),
  }));
}

/** Is the name used on its own, rather than as `something.cryptoPercent`? */
function usesFreely(text) {
  let at = text.indexOf(NAME);
  while (at !== -1) {
    if (text[at - 1] !== '.') return true;
    at = text.indexOf(NAME, at + 1);
  }
  return false;
}

test('every component reading cryptoPercent binds it', () => {
  let checked = 0;
  for (const file of FILES) {
    for (const { name, body } of componentsIn(file)) {
      const params = body.slice(0, body.indexOf(') {') + 1);
      const rest = body.slice(params.length);
      // A FREE IDENTIFIER, never a property. `data?.cryptoPercent` reads a
      // field off something already in scope and needs no binding of its
      // own; a bare `cryptoPercent` does. Checked by the character before
      // it rather than a regex, for the reason in the header.
      if (!usesFreely(rest)) continue;
      checked += 1;
      const bound = params.includes(NAME)
        || rest.includes(`const ${NAME}`)
        || rest.includes(`let ${NAME}`);
      assert.ok(bound, `${file} > ${name} uses "${NAME}" but never binds it: it throws at render`);
    }
  }
  // Zero means the walk matched nothing and every assertion was skipped,
  // which is exactly how the first version of this passed.
  assert.ok(checked >= 3, `expected several uses to check, saw ${checked}`);
});

test('and the master sheet actually hands it to each row', () => {
  const page = fs.readFileSync(path.join(PAGES, 'MasterSheetPage.jsx'), 'utf8');
  assert.ok(page.includes('cryptoPercent={cryptoPercent}'), 'SheetRow must receive it');
});
