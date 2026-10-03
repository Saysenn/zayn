import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * The white screen the build cannot see
 * ***************************************************
 *
 * `Cannot access 'defaultBreakdown' before initialization`. A `useEffect`
 * read a `const` declared BELOW it, `const` is not hoisted, and the
 * dependency array threw on the first render. esbuild does not check it, so
 * the build was green and the page was dead.
 *
 * Source text, not an import: these components pull in React and the query
 * client, and what is pinned is the declaration order.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..');

function everyJsx(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) everyJsx(full, out);
    else if (entry.name.endsWith('.jsx')) out.push(full);
  }
  return out;
}

/**
 * ***************************************************
 * * A COMPONENT THE FILE NEVER DEFINES
 * ***************************************************
 *
 * `ProfileField is not defined`. A refactor split a page and truncated the
 * file, taking two helper components off the end with it. esbuild does not
 * resolve JSX identifiers, so the build was green, the tests were green,
 * and the page threw the moment it rendered.
 *
 * Every capitalised tag has to be imported or declared in the same file.
 * That is the whole rule, and it is exactly the fault it was written for.
 */
function undefinedComponents(source) {
  const known = new Set();

  // Imports: default, named and namespace, all three shapes at once.
  for (const m of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]/g)) {
    for (const name of m[1].match(/[A-Za-z_$][\w$]*/g) ?? []) known.add(name);
  }
  // Declarations, at any indentation: `function X(`, `const X =`, and the
  // `export default function X(` a page's own component uses.
  for (const m of source.matchAll(/(?:function|const|class)\s+([A-Z][\w$]*)/g)) known.add(m[1]);

  /**
   * A COMPONENT ARRIVING BY DESTRUCTURING, which the file renders and
   * correctly never imports because something hands it over:
   *
   *   ({ icon: Icon }) => …        passed in as a prop
   *   const { Icon } = verdict      pulled out of a local config object
   *   const { Component: Template } = templateFor(…)
   *
   * Only patterns that BIND a name count. A capitalised value sitting in
   * an ordinary object literal is not excused, or the check would start
   * accepting the very thing it is looking for.
   */
  const BINDINGS = [
    /(?:const|let|var)\s*\{([^}]*)\}\s*=/g,   // destructured from anything
    /function\s+\w+\s*\(\s*\{([^}]*)\}/g,     // named function parameters
    /\(\s*\{([^}]*)\}\s*\)\s*=>/g,            // arrow parameters
  ];
  for (const pattern of BINDINGS) {
    for (const m of source.matchAll(pattern)) {
      for (const name of m[1].match(/\b[A-Z][\w$]*/g) ?? []) known.add(name);
    }
  }

  const used = new Set();
  for (const m of source.matchAll(/<([A-Z][\w$]*)/g)) used.add(m[1]);

  // `<Foo.Bar>` is Foo's business, so only the root has to be in scope.
  return [...used].filter((name) => !known.has(name.split('.')[0]));
}

test('EVERY COMPONENT A FILE RENDERS IS ONE IT CAN SEE', () => {
  const broken = [];
  for (const file of everyJsx()) {
    const missing = undefinedComponents(fs.readFileSync(file, 'utf8'));
    if (missing.length) broken.push(`${path.basename(file)}: ${missing.join(', ')}`);
  }
  assert.deepEqual(broken, [], `these render something they never imported or declared:\n${broken.join('\n')}`);
});

/**
 * Identifiers used in a dependency array before their own `const`.
 *
 * PARAMETERS ARE SKIPPED. One file can hold several components, and a name
 * that is a prop in one and a `const` in another is not a dead zone, it is
 * two scopes. Scoping by regex is not worth it; ignoring anything that is a
 * parameter somewhere in the file kills that whole class of false alarm and
 * still catches the real one, which was never a parameter.
 */
function deadZones(source) {
  // SIGNATURES ONLY. Matching `=>` followed by a brace also swallows every
  // arrow BODY, which quietly turns each name inside one into a parameter
  // and the scanner then finds nothing at all.
  const params = new Set();
  const SIGNATURES = [
    /function\s+\w+\s*\(\s*\{([^}]*)\}/g,
    /\(\s*\{([^}]*)\}\s*\)\s*=>/g,
  ];
  for (const pattern of SIGNATURES) {
    for (const m of source.matchAll(pattern)) {
      for (const name of m[1].match(/[A-Za-z_$][\w$]*/g) ?? []) params.add(name);
    }
  }

  const declaredAt = new Map();
  for (const m of source.matchAll(/^ {2}const (?:\{ [^}]+ \}|\[?[\w, ]+\]?) = /gm)) {
    for (const name of (m[0].match(/[A-Za-z_$][\w$]*/g) ?? []).slice(1)) {
      if (!declaredAt.has(name)) declaredAt.set(name, m.index);
    }
  }

  const found = [];
  for (const dep of source.matchAll(/\}, \[([^\]]*)\]\);/g)) {
    for (const name of dep[1].match(/[A-Za-z_$][\w$]*/g) ?? []) {
      if (params.has(name)) continue;
      const at = declaredAt.get(name);
      if (at !== undefined && at > dep.index) found.push(name);
    }
  }
  return found;
}

test('no component reads a const declared below it', () => {
  const files = everyJsx();
  assert.ok(files.length > 50, `only found ${files.length} components to scan`);

  const broken = files
    .map((f) => ({ file: path.relative(SRC, f), names: deadZones(fs.readFileSync(f, 'utf8')) }))
    .filter((r) => r.names.length > 0);

  assert.deepEqual(broken, [], broken.map((b) => `${b.file}: ${b.names.join(', ')}`).join(' | '));
});

test('it CATCHES the bug it was written for', () => {
  // Guards the guard. A scanner that quietly matches nothing passes too,
  // and the first version of this one did exactly that.
  const bug = [
    'function X() {',
    '  const [a, setA] = useState(null);',
    '  useEffect(() => { setA(later); }, [later]);',
    '  const later = useSomething();',
    '}',
  ].join('\n');
  assert.deepEqual(deadZones(bug), ['later']);
});

test('a prop in one component and a const in another is NOT a dead zone', () => {
  // ImportDiffModal.jsx: `rows` is a prop of NotInFileNote and a const in
  // the modal below it. Two scopes, one file, no bug.
  const fine = [
    'function Note({ rows }) {',
    '  useEffect(() => { read(rows); }, [rows]);',
    '}',
    'function Modal({ preview }) {',
    '  const { rows } = preview;',
    '}',
  ].join('\n');
  assert.deepEqual(deadZones(fine), []);
});

/** React hooks used in a file that never imported them. */
function missingHookImports(source) {
  const imported = new Set();
  for (const m of source.matchAll(/import \{([^}]*)\} from '(?:react|react-router-dom)'/g)) {
    for (const name of m[1].match(/[A-Za-z_$][\w$]*/g) ?? []) imported.add(name);
  }
  const used = new Set(source.match(/\buse[A-Z]\w*(?=\()/g) ?? []);

  const REACT = ['useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useContext', 'useReducer', 'useId', 'useLayoutEffect'];
  return REACT.filter((h) => used.has(h) && !imported.has(h));
}

test('no component uses a React hook it never imported', () => {
  // Same class as the dead zone: a ReferenceError on render, invisible to
  // the build. `useEffect` was used in SettingsPage while only `useState`
  // was imported, and the build was green.
  const broken = everyJsx()
    .map((f) => ({ file: path.relative(SRC, f), missing: missingHookImports(fs.readFileSync(f, 'utf8')) }))
    .filter((r) => r.missing.length > 0);

  assert.deepEqual(broken, [], broken.map((b) => `${b.file}: ${b.missing.join(', ')}`).join(' | '));
});

test('it CATCHES a hook used without its import', () => {
  const bug = "import { useState } from 'react';\nfunction X() { useEffect(() => {}, []); }";
  assert.deepEqual(missingHookImports(bug), ['useEffect']);
  const fine = "import { useEffect, useState } from 'react';\nfunction X() { useEffect(() => {}, []); }";
  assert.deepEqual(missingHookImports(fine), []);
});
