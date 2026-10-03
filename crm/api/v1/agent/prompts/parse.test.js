const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * ***************************************************
 * * A PROMPT IS PROSE INSIDE CODE, and it breaks like code
 * ***************************************************
 *
 * A backtick typed into masterSheet.js closed its template literal. The
 * file stopped parsing, and `npm test` reported it as THREE FAILING UPLOAD
 * TESTS, because those load the tool chain transitively. The signal named
 * the wrong file entirely.
 *
 * These load each prompt on its own, so the next one says which file and
 * what is wrong with it.
 */

const DIR = __dirname;
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

test('every prompt file parses on its own', () => {
  assert.ok(FILES.length > 0, 'no prompt files found at all');
  for (const file of FILES) {
    assert.doesNotThrow(
      () => require(path.join(DIR, file)),
      `${file} does not parse. A stray backtick or \${ inside a template literal is the usual cause.`,
    );
  }
});

test('every prompt exports a non-empty string', () => {
  // An export that came back undefined would leave her with no rules at
  // all, and nothing else would notice: the model just answers worse.
  for (const file of FILES) {
    const mod = require(path.join(DIR, file));
    const strings = Object.entries(mod).filter(([, v]) => typeof v === 'string');
    assert.ok(strings.length > 0, `${file} exports no prompt string`);
    for (const [name, value] of strings) {
      assert.ok(value.trim().length > 50, `${file} exports ${name} but it is nearly empty`);
    }
  }
});

test('no prompt carries an UNRESOLVED template placeholder', () => {
  // `${foo}` inside a prompt that was pasted rather than interpolated
  // reaches the model as literal characters and reads as a bug to it.
  for (const file of FILES) {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');
    const inPrompt = src.match(/\$\{[^}]*\}/g) ?? [];
    for (const found of inPrompt) {
      // Real interpolation is fine. A placeholder naming something that is
      // not a variable in scope is what this catches.
      assert.ok(
        !/\$\{\s*(TODO|FIXME|name|value|x)\s*\}/i.test(found),
        `${file} has an unresolved placeholder: ${found}`,
      );
    }
  }
});

test('THE CONTEXT ASSEMBLES, which is what actually reaches her', () => {
  // The prompts parsing is not the same as the context building. This is
  // the string the model is sent.
  const { resolveContext } = require('../contexts');
  const ctx = resolveContext('master-sheet');
  assert.ok(ctx.prompt.length > 1000, 'the assembled prompt is suspiciously short');
  assert.ok(ctx.tools.length > 0, 'she has no tools');
  // Every tool needs the four fields the API requires, or the call 400s
  // at request time rather than here.
  for (const t of ctx.tools) {
    assert.equal(typeof t.name, 'string', 'a tool with no name');
    assert.ok(t.description?.length > 10, `${t.name} has no description`);
    assert.equal(typeof t.parameters, 'object', `${t.name} has no parameters`);
    assert.equal(typeof t.handler, 'function', `${t.name} has no handler`);
  }
});

test('the model context uses placeholders, never identifiers from the live sheet', () => {
  const { resolveContext } = require('../contexts');
  const { PROMPT_PLACEHOLDERS } = require('../promptPlaceholders');
  const ctx = resolveContext('master-sheet');
  const modelContext = [
    ctx.prompt,
    ...ctx.tools.flatMap((tool) => [tool.description, JSON.stringify(tool.parameters)]),
  ].join('\n');

  for (const live of ['Gloria', 'Nicola', 'Zayn', 'Paddy', 'Abe', 'INDIGO', 'MILKMAN', 'NEXUS', 'Acqua']) {
    assert.doesNotMatch(modelContext, new RegExp(`\\b${live}\\b`, 'i'), `live identifier in model context: ${live}`);
  }
  for (const placeholder of Object.values(PROMPT_PLACEHOLDERS).flat()) {
    assert.match(modelContext, new RegExp(`\\b${placeholder}\\b`), `unused prompt placeholder: ${placeholder}`);
  }
});
