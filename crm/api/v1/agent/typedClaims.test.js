const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { sharedTools } = require('./tools/shared');

test('every context gives Diane the typed claims metadata tool', () => {
  const tool = sharedTools.find((candidate) => candidate.name === 'state_claims');
  assert.ok(tool, 'state_claims is missing');
  assert.deepEqual(tool.parameters.required, ['claims']);
});

test('the claims tool stores metadata on turn state and writes nothing', async () => {
  const tool = sharedTools.find((candidate) => candidate.name === 'state_claims');
  const turn = { wrote: new Map(), claims: [] };
  const claims = [{ kind: 'total', value: 80.65, currency: 'GBP', month: '2026-09' }];
  const result = await tool.handler({ claims, turn });
  assert.deepEqual(turn.claims, claims);
  assert.equal(result.typedClaims, true);
});

test('runAgent returns claims beside prose and keeps the prose guards as fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, 'runAgent.js'), 'utf8');
  assert.match(source, /checkClaims\(turnState\.claims, toolResults\)/);
  assert.match(source, /claims: turnState\.claims/);
  assert.match(source, /checkFigures\(raw, toolResults\)/);
  assert.match(source, /checkCounts\(raw, toolResults\)/);
  assert.match(source, /terminalComputed/);
});
