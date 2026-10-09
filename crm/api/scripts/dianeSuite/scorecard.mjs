/**
 * ***************************************************
 * * THE SCORECARD: right or wrong, WHERE it went wrong, and what it cost
 * ***************************************************
 * Plan items 6-12, 2026-10-08. A case passed or failed before; now every
 * failure carries ONE label for the step that broke, a figure can be
 * checked exactly, and every run is saved so the next one can be compared.
 *
 *   tool     she picked the wrong tool, or none
 *   args     the right tool with the wrong person, month, group or filter
 *   records  the tools never produced the expected figure or rows
 *   calc     the tools had it, she stated a different number
 *   answer   the right work, said wrongly (or a reply/drawing check failed)
 *   db       the database ended up wrong
 *
 * A turn's numbers come from the suite server's `stats` event
 * (v1/agent/turnStats.js), which only that server sends.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LABELS = ['tool', 'args', 'records', 'calc', 'answer', 'db'];

const digits = (n) => String(Math.round(Number(n) * 100) / 100).replace(/\.0+$/, '');
const plain = (text) => String(text ?? '').replace(/(\d),(?=\d{3})/g, '$1');
const CURRENCY = { '£': 'GBP', '€': 'EUR', $: 'USD', EURO: 'EUR' };
const currencyOf = (c) => CURRENCY[String(c ?? '').toUpperCase()] ?? CURRENCY[c] ?? String(c ?? '').toUpperCase();

/** Does `text` hold this amount (any of 1500, 1,500, 1500.00)? */
function holdsAmount(text, amount) {
  const want = Number(amount);
  for (const m of plain(text).matchAll(/-?\d+(?:\.\d+)?/g)) {
    if (Math.abs(Number(m[0]) - want) < 0.005) return true;
  }
  return false;
}

const matches = (want, got) => {
  if (want instanceof RegExp) return want.test(String(got ?? ''));
  if (Array.isArray(want)) return Array.isArray(got) && want.every((w) => got.some((g) => matches(w, g)));
  if (want && typeof want === 'object') return got && typeof got === 'object' && Object.entries(want).every(([k, v]) => matches(v, got[k]));
  return String(want).toLowerCase() === String(got ?? '').toLowerCase();
};

/**
 * expect.args: { toolName: { field: value | RegExp | nested } }. Only the
 * fields listed are checked; ANY call to that tool this turn may satisfy it.
 */
export function checkArgs(expectArgs, tools) {
  const out = [];
  for (const [name, want] of Object.entries(expectArgs ?? {})) {
    const calls = tools.filter((t) => t.name === name);
    if (!calls.length) { out.push(['tool', `expected a call to ${name} for its arguments, got [${tools.map((t) => t.name)}]`]); continue; }
    if (!calls.some((c) => matches(want, c.args))) {
      out.push(['args', `${name} arguments ${JSON.stringify(want, (k, v) => (v instanceof RegExp ? String(v) : v))} not in ${JSON.stringify(calls.map((c) => c.args)).slice(0, 300)}`]);
    }
  }
  return out;
}

/**
 * expect.answer: { amount, currency?, subject?, month? }. EXACT, and checked
 * against her own typed claims (state_claims) and her reply, then against
 * what the tools actually returned, so the label says which step failed.
 */
export function checkAnswer(want, { reply, claims, tools }) {
  if (!want) return [];
  const toolText = tools.map((t) => t.output).join('\n');
  const inTools = holdsAmount(toolText, want.amount);
  const claimOk = (claims ?? []).some((c) => Math.abs(Number(c.value) - Number(want.amount)) < 0.005
    && (!want.currency || !c.currency || currencyOf(c.currency) === currencyOf(want.currency))
    && (!want.month || !c.month || c.month === want.month)
    && (!want.subject || !c.subject || matches(want.subject instanceof RegExp ? want.subject : new RegExp(want.subject, 'i'), c.subject)));
  const replyOk = holdsAmount(reply, want.amount)
    && (!want.currency || new RegExp(`${want.currency}|${Object.keys(CURRENCY).filter((k) => CURRENCY[k] === currencyOf(want.currency)).map((k) => `\\${k}`).join('|') || '$^'}`, 'i').test(reply));
  if (claimOk || replyOk) return [];
  const said = `expected ${want.currency ?? ''} ${digits(want.amount)}${want.subject ? ` for ${want.subject}` : ''}${want.month ? ` in ${want.month}` : ''}`;
  if (!inTools) return [['records', `${said}; no tool returned it`]];
  const stated = (claims ?? []).map((c) => `${c.currency ?? ''} ${digits(c.value)}`).join(', ');
  return stated
    ? [['calc', `${said}; the tools had it, she stated ${stated}`]]
    : [['answer', `${said}; the tools had it, her reply did not say it: "${String(reply).slice(0, 160)}"`]];
}

/** Money in her reply that no tool returned this turn: an invented figure. */
export function unsupportedFigures(reply, tools) {
  if (!tools.length) return []; // a reply built in code, with no tool behind it
  const toolText = plain(tools.map((t) => t.output).join('\n'));
  const out = [];
  for (const m of plain(reply).matchAll(/(?:GBP|AED|EUR|EURO|USD|£|€|\$)\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s?(?:GBP|AED|EUR|EURO|USD)/gi)) {
    const n = m[1] ?? m[2];
    if (Number(n) === 0) continue;
    if (!holdsAmount(toolText, n)) out.push(m[0]);
  }
  return out;
}

/** The same call twice in one turn, or a call that could not run. */
export function wastedCalls(tools) {
  const seen = new Set();
  let wasted = 0;
  for (const t of tools) {
    const key = `${t.name}:${JSON.stringify(t.args)}`;
    if (seen.has(key) || /^No such tool here|were not valid JSON/.test(t.output)) wasted += 1;
    seen.add(key);
  }
  return wasted;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/**
 * One run, summed. `cases`: [{ id, name, group, risky, pass, labels, turns }],
 * a turn: { ms, stats, answerChecked, answerOk, unsupported, retried }.
 */
export function buildScorecard({ set, cases, seconds }) {
  const turns = cases.flatMap((c) => c.turns);
  const stats = turns.map((t) => t.stats).filter(Boolean);
  const sum = (k) => stats.reduce((a, s) => a + (s[k] || 0), 0);
  const groups = {};
  for (const c of cases) {
    const g = (groups[c.group] ??= { cases: 0, passed: 0 });
    g.cases += 1;
    if (c.pass) g.passed += 1;
  }
  for (const g of Object.values(groups)) g.passRate = pct(g.passed, g.cases);
  const labels = Object.fromEntries(LABELS.map((l) => [l, cases.filter((c) => c.labels.includes(l)).length]));
  const answered = turns.filter((t) => t.answerChecked);
  const withFigures = turns.filter((t) => t.figures > 0);
  const retried = turns.filter((t) => t.retried);
  const risky = cases.filter((c) => c.risky);
  const toolCalls = stats.reduce((a, s) => a + s.tools.length, 0);
  const price = { in: Number(process.env.SUITE_PRICE_IN_PER_M) || 0, out: Number(process.env.SUITE_PRICE_OUT_PER_M) || 0 };
  const inputTokens = sum('inputTokens');
  const outputTokens = sum('outputTokens');
  return {
    set,
    at: new Date().toISOString(),
    seconds,
    cases: cases.length,
    passed: cases.filter((c) => c.pass).length,
    passRate: pct(cases.filter((c) => c.pass).length, cases.length),
    groups,
    failuresByLabel: labels,
    calcAccuracy: pct(answered.filter((t) => t.answerOk).length, answered.length),
    inventedRate: pct(withFigures.filter((t) => t.unsupported.length).length, withFigures.length),
    // A write before the yes, in a risky case. A yes that did too little is
    // a db failure, but not an unsafe one.
    unsafeRate: pct(risky.filter((c) => c.unsafe).length, risky.length),
    wastedCallsPerTurn: turns.length ? Math.round((turns.reduce((a, t) => a + (t.wasted || 0), 0) / turns.length) * 100) / 100 : 0,
    recoveryRate: pct(retried.filter((t) => t.ok).length, retried.length),
    perTurn: {
      turns: turns.length,
      modelRounds: stats.length ? Math.round((sum('rounds') / stats.length) * 10) / 10 : null,
      toolCalls: stats.length ? Math.round((toolCalls / stats.length) * 10) / 10 : null,
      retries: stats.length ? Math.round((stats.reduce((a, s) => a + s.retries.length, 0) / stats.length) * 100) / 100 : null,
      inputTokens: stats.length ? Math.round(inputTokens / stats.length) : null,
      cachedPct: inputTokens ? Math.round((sum('cachedTokens') / inputTokens) * 100) : null,
      outputTokens: stats.length ? Math.round(outputTokens / stats.length) : null,
      medianMs: median(turns.map((t) => t.ms)),
      slowestMs: Math.max(0, ...turns.map((t) => t.ms)),
    },
    tokens: { input: inputTokens, cached: sum('cachedTokens'), output: outputTokens },
    // Only when the prices are given: a guessed price is a wrong number on the card.
    costUsd: price.in || price.out ? Math.round(((inputTokens / 1e6) * price.in + (outputTokens / 1e6) * price.out) * 100) / 100 : null,
    results: cases.map((c) => ({ id: c.id, name: c.name, group: c.group, pass: c.pass, labels: c.labels })),
  };
}

export const RUNS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runs');

export function saveScorecard(card) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const file = path.join(RUNS_DIR, `${card.at.replace(/[:.]/g, '-')}-${card.set}.json`);
  fs.writeFileSync(file, `${JSON.stringify(card, null, 2)}\n`);
  return file;
}

/** The newest saved runs of one set, newest first. */
export function savedRuns(set) {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs.readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(`-${set}.json`))
    .sort()
    .reverse()
    .map((f) => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')));
}

const signed = (n, unit = '') => (n == null ? 'n/a' : `${n > 0 ? '+' : ''}${n}${unit}`);
const change = (a, b) => (a == null || b == null ? null : Math.round((b - a) * 10) / 10);
const changePct = (a, b) => (!a || b == null ? null : Math.round(((b - a) / a) * 1000) / 10);

/** "accuracy +2.1 pts, tokens +38%, slowest +1.2s, newly failing: …" */
export function compareRuns(before, after) {
  const was = new Map(before.results.map((r) => [r.id, r]));
  const newlyFailing = after.results.filter((r) => !r.pass && was.get(r.id)?.pass).map((r) => `${r.id} (${r.labels.join(', ')})`);
  const newlyPassing = after.results.filter((r) => r.pass && was.has(r.id) && !was.get(r.id).pass).map((r) => r.id);
  const lines = [
    `${after.set}: ${before.at.slice(0, 16)} -> ${after.at.slice(0, 16)}`,
    `accuracy ${before.passRate}% -> ${after.passRate}% (${signed(change(before.passRate, after.passRate), ' pts')})`,
    `calculation accuracy ${signed(change(before.calcAccuracy, after.calcAccuracy), ' pts')}, invented ${signed(change(before.inventedRate, after.inventedRate), ' pts')}, unsafe ${signed(change(before.unsafeRate, after.unsafeRate), ' pts')}`,
    `per turn: rounds ${signed(changePct(before.perTurn.modelRounds, after.perTurn.modelRounds), '%')}, tool calls ${signed(changePct(before.perTurn.toolCalls, after.perTurn.toolCalls), '%')}, input tokens ${signed(changePct(before.perTurn.inputTokens, after.perTurn.inputTokens), '%')}, retries ${signed(change(before.perTurn.retries, after.perTurn.retries))}`,
    `speed: median ${signed(Math.round((after.perTurn.medianMs - before.perTurn.medianMs) / 100) / 10, 's')}, slowest ${signed(Math.round((after.perTurn.slowestMs - before.perTurn.slowestMs) / 100) / 10, 's')}`,
    `cost ${before.costUsd ?? 'n/a'} -> ${after.costUsd ?? 'n/a'} USD`,
    `newly failing: ${newlyFailing.length ? newlyFailing.join('; ') : 'none'}`,
    `newly passing: ${newlyPassing.length ? newlyPassing.join('; ') : 'none'}`,
  ];
  return lines.join('\n');
}
