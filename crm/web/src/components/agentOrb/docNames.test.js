import test from 'node:test';
import assert from 'node:assert/strict';
import { splitDocNames } from './docNames.js';

// The documents she names open (his call 2026-10-14).

const L = (name, docId) => ({ name, docId, liquidationId: 1 });

test('EVERY NAMED DOCUMENT IS A LINK, the words between stay words', () => {
  const text = 'documents: call notes.txt, creditors list.csv, HMRC petition.pdf';
  const out = splitDocNames(text, [L('call notes.txt', 1), L('creditors list.csv', 2), L('HMRC petition.pdf', 3)]);
  assert.deepEqual(out.filter((p) => p.link).map((p) => p.text), ['call notes.txt', 'creditors list.csv', 'HMRC petition.pdf']);
  assert.equal(out.map((p) => p.text).join(''), text, 'nothing lost or added');
});

test('THE LONGER NAME WINS: "creditors list.csv" is not "list.csv"', () => {
  const out = splitDocNames('see creditors list.csv', [L('list.csv', 1), L('creditors list.csv', 2)]);
  assert.deepEqual(out.filter((p) => p.link).map((p) => p.link.docId), [2]);
});

test('NO LINKS, NO CHANGE; a name inside a longer word is not a link', () => {
  assert.deepEqual(splitDocNames('No documents yet.', []), [{ text: 'No documents yet.' }]);
  const out = splitDocNames('oldnotes.txt is not notes.txt', [L('notes.txt', 1)]);
  assert.equal(out.filter((p) => p.link).length, 1);
  assert.equal(out.find((p) => p.link).text, 'notes.txt');
});
