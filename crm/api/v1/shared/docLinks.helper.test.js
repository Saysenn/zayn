const test = require('node:test');
const assert = require('node:assert/strict');
const { matchDocLinks } = require('./docLinks.helper');

// A document she names opens (his call 2026-10-14): only real names link.

const doc = (id, name, company, liq = 1) => ({ id, liquidation_id: liq, file_name: name, mime: 'text/plain', company_name: company });

test('THE NAMES IN HER ANSWER, matched to the real documents', () => {
  const docs = [doc(1, 'call notes.txt', 'ZZ Harbour Test Ltd'), doc(2, 'creditors list.csv', 'ZZ Harbour Test Ltd'), doc(3, 'unrelated.pdf', 'Other Ltd', 2)];
  const out = matchDocLinks('ZZ Harbour Test Ltd · documents: call notes.txt, creditors list.csv', docs);
  assert.deepEqual(out.map((l) => l.docId).sort(), [1, 2]);
  assert.equal(out[0].url, `/api/v1/liquidations/1/docs/${out[0].docId}`);
});

test('A WORD IS NOT A DOCUMENT, and part of a name is not the name', () => {
  const docs = [doc(1, 'list.csv', 'A Ltd'), doc(2, 'notes', 'A Ltd')];
  assert.deepEqual(matchDocLinks('see creditorslist.csv and the notes', docs), []);
  assert.deepEqual(matchDocLinks('no file names here', docs), []);
});

test('SAME NAME AT TWO COMPANIES: the one the answer names, else none', () => {
  const docs = [doc(1, 'petition.pdf', 'Quarry Lane Ltd', 1), doc(2, 'petition.pdf', 'Brightwell Ltd', 2)];
  assert.deepEqual(matchDocLinks('Quarry Lane Ltd has petition.pdf', docs).map((l) => l.docId), [1]);
  assert.deepEqual(matchDocLinks('there is a petition.pdf', docs), []);
});

test('SAME NAME TWICE AT ONE COMPANY (uploaded again): the newest opens', () => {
  const docs = [doc(5, 'call (transcript).txt', 'A Ltd', 1), doc(9, 'call (transcript).txt', 'A Ltd', 1)];
  assert.deepEqual(matchDocLinks('documents: call (transcript).txt', docs).map((l) => l.docId), [9]);
});
