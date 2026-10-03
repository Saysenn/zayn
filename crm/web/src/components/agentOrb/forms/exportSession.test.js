import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ***************************************************
 * * The export CARD: it draws, it does not decide
 * ***************************************************
 *
 * IT WAS A FORM AND THE FORM WAS THE MISTAKE. Twenty four checkboxes, a
 * colour picker and a delivery toggle inside a chat window is a modal done
 * worse. Worse still, it re-counted on every tick and wrote its state back
 * into history, which dragged itself off screen while somebody read it.
 *
 * The flow is now: talk it through, see ONE card, agree, build. This card
 * arrives finished in a single tool result. It fetches nothing, decides
 * nothing, and cannot move under the reader.
 */

const HERE = new URL('./ExportSession.jsx', import.meta.url);
const src = readFileSync(HERE, 'utf8');

// Comments are prose about the design, not behaviour. Only real code counts.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

test('THE FIGURES ARE REBUILT, never remembered', () => {
  // She drew the card and that was true then. It stops being true the
  // moment anybody edits a row, and a count on a document about to be
  // sent must not be a snapshot. So the query is kept and the numbers
  // come back from the server: on mount, which covers a reload, and
  // again whenever the sheet changes.
  assert.ok(code.includes('exports.card(query)'), 'the card stopped refreshing itself');
  assert.ok(code.includes("useSocketEvent('master-sheet:changed'"), 'it ignores a live change');
  assert.ok(/useEffect\(\(\) => \{ setLive\(null\); refresh/.test(code), 'it does not refresh on mount');
});

test('a failed refresh KEEPS what she drew rather than blanking it', () => {
  // Stale is worse than fresh and far better than empty: the last thing
  // that was true still tells them what the document is.
  assert.ok(code.includes('const card = live ? { ...session, ...live } : session'), 'a failed refresh would blank the card');
  assert.ok(/\.catch\(\(\) => \{\}\)/.test(code), 'a refresh failure is not swallowed');
});

test('a successful refresh keeps the stages and served choices', () => {
  // /export/card refreshes volatile figures only. It does not return the
  // agent workflow, so replacing the session with it hides the options
  // Diane just asked the admin to choose from.
  assert.ok(code.includes('const card = live ? { ...session, ...live } : session'));
});

test('it still holds no controls: only the figures come from the server', () => {
  // The refresh is not a licence to become a panel again.
  assert.ok(!code.includes('exports.columns('), 'it is fetching its own lists again');
  assert.ok(!code.includes('exports.templates('), 'it is fetching its own lists again');
});

test('IT IS NOT A FORM. No inputs, no local state, no patching', () => {
  // The form was the mistake: twenty four checkboxes in a chat window is a
  // modal done worse. What came back is not the form.
  for (const control of ['type="checkbox"', 'type="month"', '<select', 'toggleColumn', 'patch(']) {
    assert.ok(!code.includes(control), `the form came back: ${control}`);
  }
});

test('every CHOICE it offers sends a sentence, so there is one path', () => {
  // One question is on the table at a time, so the card can offer that
  // step's answers as chips. Clicking says the same thing they could have
  // typed: the tool sees one kind of input and records it one way.
  assert.ok(code.includes('onSay('), 'the choices stopped speaking');
  assert.ok(/step === 'breakdown'/.test(code) && /step === 'colour'/.test(code), 'a step lost its choices');
  // ONLY the outstanding step. Rendering them all is the form again.
  assert.ok(code.includes('step={stages?.next}'), 'it is offering every step at once');
});

test('the CHOICES are served, never written into the card', () => {
  // She told an admin the breakdown designs were "none, simple, detailed
  // and full". Three of those do not exist, because nothing had ever given
  // her the list. The card must not repeat that mistake.
  assert.ok(code.includes('options.designs'), 'the designs are not coming from the server');
  assert.ok(code.includes('options.colors'), 'the colours are not coming from the server');
  assert.ok(code.includes('options.groups'), 'the groups are not coming from the server');
  for (const invented of ['simple', 'detailed', 'with-usd', 'standard']) {
    assert.ok(!new RegExp(`['"]${invented}['"]`).test(code), `"${invented}" is written into the card`);
  }
});

test('a breakdown is offered with its DESCRIPTION, not just its id', () => {
  // "with usd table" tells nobody what they are choosing.
  assert.ok(code.includes('d.description'), 'the descriptions are gone');
});

test('it hardcodes no template, column, design or colour', () => {
  // Everything it draws is served, so a template added in
  // v1/templates/xlsx/ reaches her the day it exists.
  // The QUOTED id exactly. A substring match called the socket event name
  // `master-sheet:changed` a hardcoded template, which it is not.
  for (const id of ['master-sheet', 'monthly-sheet', 'bank-details', 'with-usd-table']) {
    assert.ok(!new RegExp(`['"]${id}['"]`).test(code), `"${id}" is written into the card`);
  }
  for (const key of ['payable_amount', 'person_name', 'sort_code']) {
    assert.ok(!code.includes(key), `"${key}" is written into the card`);
  }
});

test('the COLUMNS it lists are the ones the file will carry', () => {
  // Drawn from the tool's own resolved list, with the document's headers,
  // so the card and the workbook cannot name different columns.
  assert.ok(code.includes('columns.map((c) => c.header)'), 'it stopped listing the real headers');
});

test('the completed export card has NO DATA TABLE', () => {
  assert.ok(!code.includes('<table'), 'the row preview is making the completed card long again');
  assert.ok(!code.includes('rows.map'), 'preview rows are still being rendered without a table');
  assert.ok(!code.includes('formatDate'), 'date formatting survived only for the removed preview');
});

test('warnings use the SERVER\'S own field names', () => {
  // The other half is api/v1/masterSheet/exportWarnings.test.js. Guessed
  // names rendered a row of blanks once.
  for (const field of ['w.text', 'w.severity', 'w.group', 'w.kind']) {
    assert.ok(code.includes(field), `the card stopped reading ${field}`);
  }
  for (const guessed of ['w.title', 'w.message', 'w.rowIds']) {
    assert.ok(!code.includes(guessed), `the guessed field ${guessed} came back`);
  }
});

test('nothing builds until they say so, and never twice', () => {
  assert.ok(code.includes('session.build'), 'saying go does nothing');
  assert.ok(code.includes('builtRef'), 'a re-render can download the same file twice');
  assert.ok(!code.includes('exports.xlsx('), 'the card downloads behind the overlay');
});

test('the exit is on screen, and it says changing is a sentence', () => {
  assert.ok(/Tell me what to change/.test(src), 'the standing line is gone');
  assert.ok(code.includes('onPause') && code.includes('onCancel'));
});
