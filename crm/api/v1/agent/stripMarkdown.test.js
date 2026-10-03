const test = require('node:test');
const assert = require('node:assert/strict');

const { stripMarkdown } = require('./stripMarkdown');

test('keeps intentional plain-text bullets while removing markdown bullets', () => {
  assert.equal(stripMarkdown('• Acqua: GBP 700\n• Leadstone: GBP 800'),
    '• Acqua: GBP 700\n• Leadstone: GBP 800');
  assert.equal(stripMarkdown('- Acqua: GBP 700\n* Leadstone: GBP 800'),
    'Acqua: GBP 700\nLeadstone: GBP 800');
});
