const test = require('node:test');
const assert = require('node:assert/strict');
const { namesList, asNews } = require('./liquidations');

// Her liquidation answers name every document; "update on" is news (2026-10-14).

test('DOCUMENTS NAMED IN FULL, the first eight then how many more', () => {
  assert.equal(namesList(['call notes.txt']), 'call notes.txt');
  assert.equal(namesList(['a.pdf', 'b.csv', 'c.txt']), 'a.pdf, b.csv and c.txt');
  const ten = Array.from({ length: 10 }, (_, i) => `doc ${i + 1}.pdf`);
  assert.equal(namesList(ten), `${ten.slice(0, 8).join(', ')} and 2 more`);
  assert.equal(namesList([]), '');
});

test('"ANY UPDATE ON QUARRY LANE" ASKS FOR NEWS; "update its deadline" is still a change', () => {
  assert.equal(asNews('any update on quarry lane'), 'any news on quarry lane', '"any" stays, so it is still a question');
  assert.equal(asNews('give me an update on pinecrest'), 'give me an news on pinecrest');
  assert.equal(asNews('updates on quarry lane?'), 'news on quarry lane?');
  assert.equal(asNews('update quarry lanes deadline to friday'), 'update quarry lanes deadline to friday');
});
