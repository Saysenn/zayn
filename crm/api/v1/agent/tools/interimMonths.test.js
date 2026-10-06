const test = require('node:test');
const assert = require('node:assert/strict');
const { masterSheetTools } = require('./masterSheet');
const { currentMonth } = require('../../shared/presetMonth.helper');

// THE RESOLVED MONTHS MOVE WITH THE CALENDAR. A hard "August and September"
// failed from 1 October. 2026-10-06.
const monthWord = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
const [y, m] = currentMonth().split('-').map(Number);
const LAST = monthWord(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`);
const THIS = monthWord(currentMonth());

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
    text: `Checking Zayn's totals for ${LAST} and ${THIS}.`,
    said: 'how much does Zayn owe last month and this month',
  });

  assert.equal(result.said, `Checking Zayn's totals for ${LAST} and ${THIS}.`);
});
