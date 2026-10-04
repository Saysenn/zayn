/**
 * WHAT A SUITE RUN COST, read off the suite server's own log.
 *
 *   SUITE_LOG=/tmp/suite.log node scripts/dianeSuite/run.mjs
 *   node scripts/dianeSuite/metrics.mjs /tmp/suite.log
 *
 * Per turn: model rounds, input / cached / output tokens, wall time. Plus
 * how often a guard sent her back (a retry is a whole extra round), so a
 * change can be judged on cost and speed as well as on passes.
 */
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: metrics.mjs <suite log>'); process.exit(1); }
const lines = fs.readFileSync(file, 'utf8').split('\n');

let turns = 0; let rounds = 0; let toolCalls = 0; let retries = 0;
let input = 0; let cached = 0; let output = 0; let modelMs = 0;
const turnMs = [];
let block = null;
const num = (line) => Number(String(line).split(':').pop().trim()) || 0;

for (const line of lines) {
  if (/diane: turn opened/.test(line)) { turns += 1; block = 'turn'; continue; }
  if (/diane: model round/.test(line)) { rounds += 1; block = 'round'; continue; }
  if (/diane: tool call/.test(line)) { toolCalls += 1; block = 'tool'; continue; }
  if (/WARN .*diane: (said|stated|a tool asked|answered|invented|used a filter|called a tool with)/.test(line)) retries += 1;
  if (/"url": "\/api\/v1\/master-sheet\/agent"/.test(line)) block = 'req';
  if (block === 'round') {
    if (/^\s+inputTokens:/.test(line)) input += num(line);
    else if (/^\s+cachedTokens:/.test(line)) cached += num(line);
    else if (/^\s+outputTokens:/.test(line)) output += num(line);
    else if (/^\s+ms:/.test(line)) modelMs += num(line);
  }
  if (block === 'req' && /^\s+responseTime:/.test(line)) { turnMs.push(num(line)); block = null; }
}

const avg = (n, d) => (d ? Math.round((n / d) * 10) / 10 : 0);
turnMs.sort((a, b) => a - b);
const out = {
  turns,
  modelRoundsPerTurn: avg(rounds, turns),
  toolCallsPerTurn: avg(toolCalls, turns),
  guardRetriesPerTurn: avg(retries, turns),
  inputTokensPerTurn: Math.round(input / (turns || 1)),
  cachedPct: input ? Math.round((cached / input) * 100) : 0,
  uncachedInputTokensPerTurn: Math.round((input - cached) / (turns || 1)),
  outputTokensPerTurn: Math.round(output / (turns || 1)),
  medianTurnMs: turnMs.length ? turnMs[Math.floor(turnMs.length / 2)] : 0,
  avgTurnMs: Math.round(turnMs.reduce((a, b) => a + b, 0) / (turnMs.length || 1)),
};
console.log(JSON.stringify(out, null, 2));
