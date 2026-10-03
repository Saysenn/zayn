const test = require('node:test');
const assert = require('node:assert/strict');
const { repairMissingSummaries } = require('./summaryRecovery');
const { SUMMARY_VERSION } = require('./summarise');

test('old and missing summaries are repaired into structured memory', async () => {
  const seen = [];
  const memory = {
    text: 'The company tier was confirmed.',
    topics: ['Company tier'],
    decisions: ['Keep the tier.'],
    corrections: [], preferences: [], unresolved: [], version: SUMMARY_VERSION,
  };
  const repaired = await repairMissingSummaries(2, {
    repo: {
      needingSummary: async (limit, version) => {
        seen.push({ limit, version });
        return ['one'];
      },
      messagesFor: async () => [{ role: 'user', content: 'Keep it.' }],
      setSummary: async (id, text, data) => seen.push({ id, text, data }),
    },
    summarise: async () => memory,
  });

  assert.equal(repaired, 1);
  assert.deepEqual(seen[0], { limit: 2, version: SUMMARY_VERSION });
  assert.equal(seen[1].data.decisions[0], 'Keep the tier.');
});
