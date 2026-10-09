/**
 * ***************************************************
 * * ONE TURN, MEASURED: for the suite's scorecard, and nothing else
 * ***************************************************
 * Plan item 10, 2026-10-08. The suite has to see what she DID, not only
 * what she said: every tool call with its arguments and what came back,
 * every model round with its tokens, every guard that sent her back.
 *
 * OFF UNLESS DIANE_TRACE_EVENTS=1, which only the suite's own server sets
 * (scripts/dianeSuite/run.mjs). Off, nothing is collected and the browser's
 * stream is exactly what it was.
 *
 * ONE TURN AT A TIME PER REQUEST: an AsyncLocalStorage store, so the suite's
 * parallel cases never share numbers.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const store = new AsyncLocalStorage();
const on = () => process.env.DIANE_TRACE_EVENTS === '1';

/** Runs `fn` with a fresh record. Resolves to [its result, the record or null]. */
async function run(fn) {
  if (!on()) return [await fn(), null];
  const stats = { rounds: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, modelMs: 0, retries: [], tools: [] };
  const result = await store.run(stats, fn);
  return [result, stats];
}

const current = () => (on() ? store.getStore() : undefined);

function round({ inputTokens = 0, cachedTokens = 0, outputTokens = 0, ms = 0 } = {}) {
  const s = current();
  if (!s) return;
  s.rounds += 1;
  s.inputTokens += inputTokens || 0;
  s.cachedTokens += cachedTokens || 0;
  s.outputTokens += outputTokens || 0;
  s.modelMs += ms || 0;
}

// A guard sending her back is a WARN whose message starts "diane:" (the
// same lines metrics.mjs counts). Read off the logger, not 47 call sites.
function warn(message) {
  const s = current();
  if (s && /^diane: /.test(String(message))) s.retries.push(String(message).slice(7));
}

function tool({ name, rawArgs, ms, result }) {
  const s = current();
  if (!s) return;
  let args;
  try { args = JSON.parse(rawArgs || '{}'); } catch { args = { unparsed: String(rawArgs ?? '').slice(0, 500) }; }
  // The turn's own bookkeeping rides in the args; it is not what she sent.
  delete args.turn;
  s.tools.push({
    name,
    args,
    ms,
    pending: Boolean(result?.pending),
    rows: Array.isArray(result?.rows) ? result.rows.length : undefined,
    // What came back, as text: where an exact figure is looked for.
    output: [
      typeof result?.summary === 'string' ? result.summary : '',
      typeof result?.reply === 'string' ? result.reply : '',
      ...(Array.isArray(result?.lines) ? result.lines : []),
    ].join('\n').slice(0, 6000),
  });
}

/**
 * The logger, with warn and the model round read on the way past. Every
 * call still goes to pino unchanged.
 */
function watch(logger) {
  return new Proxy(logger, {
    get(target, key) {
      if (key === 'warn') return (obj, msg, ...rest) => { warn(typeof obj === 'string' ? obj : msg); return target.warn(obj, msg, ...rest); };
      if (key === 'info') {
        return (obj, msg, ...rest) => {
          if (msg === 'diane: model round') round(obj);
          return target.info(obj, msg, ...rest);
        };
      }
      const v = target[key];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

module.exports = { run, current, tool, watch, on };
