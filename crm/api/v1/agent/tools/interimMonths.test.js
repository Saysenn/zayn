const test = require('node:test');
const assert = require('node:assert/strict');
const { masterSheetTools } = require('./masterSheet');

const say = masterSheetTools.find((tool) => tool.name === 'say');

test('a progress line cannot name months outside the current question', async () => {
  const result = await say.handler({
    text: "Checking Zayn's totals for May and June.",
    said: 'how much does Zayn owe last month and this month',
  });

  assert.equal(result.said, undefined);
  assert.match(result.summary, /skipped/i);
});

test('a progress line may name the two resolved months', async () => {
  const result = await say.handler({
    text: "Checking Zayn's totals for August and September.",
    said: 'how much does Zayn owe last month and this month',
  });

  assert.equal(result.said, "Checking Zayn's totals for August and September.");
});
