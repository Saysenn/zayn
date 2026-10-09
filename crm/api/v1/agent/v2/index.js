/**
 * ***************************************************
 * * DIANE V2: ONE MODEL, FIVE TOOLS, THE BOX
 * ***************************************************
 * The plan of 2026-10-09, built BESIDE v1 and switched on with
 * DIANE_V2=1, so the two can be scored on the same suite before anything
 * moves (scripts/dianeSuite, SUITE_DIANE=v2).
 *
 * What is different, and why:
 *   - A CURRENT MODEL through the Responses API. V1 is held on gpt-4.1
 *     because newer models refuse tools with reasoning on chat completions.
 *   - THE READS AS THEY ARE, the writes through one box (tools.js), and a
 *     short prompt (prompt.js): ~12k tokens a turn, not ~30k. The model is
 *     free to combine the reads; nothing rewrites what it asked for.
 *   - NO ROUTER CALLS before the model. Their replies to the box (yes,
 *     cancel, "skip 2", "undo 2", "retry") are read in code, which is
 *     where a fixed reply belongs; everything else is one model turn.
 *   - EVERY FIGURE STILL FROM CODE: v1's handlers do the reading and the
 *     writing, with their own guards, so nothing about money is relaxed.
 *
 * Same signature and result as v1's runAgent, so the route swaps one for
 * the other.
 */
// Watched, so the suite's scorecard counts v2's rounds and tokens as v1's.
const logger = require('../turnStats').watch(require('../../../configs/logger'));
const { getClient } = require('../chatClient');
const { resolveContext } = require('../contexts');
const { invokeTool } = require('../runAgent');
const evidence = require('../evidence');
const { TOOLS, READ_TOOLS, readTools } = require('./tools');
const { systemPrompt } = require('./prompt');
const box = require('./box');

const MODEL = process.env.DIANE_V2_MODEL || 'gpt-5.4';
const EFFORT = process.env.DIANE_V2_EFFORT || 'low';
const MAX_ROUNDS = 4;

/**
 * ***************************************************
 * * AUTO: THE SMALL MODEL FIRST, THE BIG ONE WHEN IT IS HARD
 * ***************************************************
 * His question 2026-10-09: "shouldn't it be smart enough to change model?"
 * DIANE_V2_MODEL=auto starts a turn on LIGHT and moves to FULL, decided in
 * code (a third model call to decide would cost what it saves):
 *   - before the call, a message that LOOKS hard: long, several asks in
 *     one, conditions ("except", "unless", "if"), comparisons and "why",
 *     or a correction to a waiting box
 *   - during the turn, a sign the small one is struggling: a reply with
 *     money in it and no tool behind it, a change nothing could preview, a
 *     tool refusing its arguments, a third round
 * The move keeps the tool calls and results so far (no read is repeated);
 * only the small model's private reasoning is left behind.
 */
const AUTO = MODEL === 'auto';
const LIGHT = process.env.DIANE_V2_LIGHT || 'gpt-5.4-mini';
const FULL = process.env.DIANE_V2_FULL || 'gpt-5.4';
const LOOKS_HARD = /\b(?:except|unless|if|but not|compare|compared|versus|vs|why|instead|whichever|both|each of|every one|all of them)\b|;|\?.+\?/i;
const looksHard = (said, boxWaiting) => boxWaiting || said.split(/\s+/).length > 25 || LOOKS_HARD.test(said)
  || (said.match(/\band\b|,/gi) ?? []).length >= 3;
const STRUGGLING = /^(?:NOTHING WAS PREVIEWED|Invalid|No tool called|Nothing found)/;
const MONEY = /(?:£|\$|€|\b(?:GBP|USD|EUR|AED)\b)\s?\d|\d[\d,]*(?:\.\d+)?\s?(?:GBP|USD|EUR|AED)\b/i;

const lastSaid = (history) => String([...(history ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '').trim();

/** Their conversation, as the model reads it: words, plus what was on screen. */
function inputFrom(history) {
  const recent = (history ?? []).filter((m) => m.role === 'user' || m.role === 'assistant').slice(-14);
  return recent.map((m) => {
    let content = String(m.content ?? '');
    if (m.list?.kind === 'plan' && m.list.plan?.box) {
      const p = m.list.plan;
      content = `[change preview, ${p.status}: ${p.steps.map((s) => `${s.n}. ${s.person ?? ''} ${(s.lines ?? []).map((l) => l.detail).filter(Boolean).join('; ')}${s.result ? (s.result.ok ? ' (done)' : ' (not done)') : ''}`).join(' | ').slice(0, 1500)}]`;
    } else if (m.list) content = `${content}\n[on screen: ${m.list.title ?? 'a list'}, ${(m.list.rows ?? []).length} rows]`.trim();
    else if (m.card) content = `${content}\n[on screen: ${m.card.name ?? 'a deal'}'s deal card]`.trim();
    return { role: m.role, content: content || '…' };
  });
}

const UNDO_ITEMS = /^\s*undo\s+(?:items?\s+|numbers?\s+|#)?(\d+(?:\s*(?:,|and|&)\s*\d+)*)\s*$/i;
const RETRY = /^\s*(?:retry|try (?:again|the failed ones?)|redo the failed)\b/i;

async function runAgentV2(history, contextName = 'master-sheet', onEvent) {
  const context = resolveContext(contextName);
  const turnState = { wrote: new Map(), claims: [], autoConfirm: undefined };
  const invoke = async (name, args) => invokeTool(context.tools, name, JSON.stringify(args), history, onEvent, turnState);
  /**
   * THE YES TO THE BOX, applied as v1 applies its own held call: marked, so
   * v1's yes-guards (which look for the preview in her last reply) know this
   * yes IS to something. Without it the writes were quietly not confirmed
   * and "mark kiran vale paid" + yes changed nothing (2026-10-09).
   */
  const invokeHeld = async (name, args) => {
    turnState.applyingHeld = true;
    try { return await invoke(name, args); } finally { turnState.applyingHeld = false; }
  };
  const said = lastSaid(history);
  const done = (reply, extra = {}) => ({ reply, changedRowIds: [], context: context.key, claims: [], ...extra });

  // ---------- THEIR REPLY TO THE BOX, read in code ----------
  const waiting = box.pendingBox(history);
  if (waiting) {
    const answer = box.readReply(said, waiting);
    if (answer.kind === 'cancel') {
      onEvent?.({ type: 'list', list: box.planCard({ ...waiting, status: 'cancelled' }) });
      return done('Okay, cancelled. Nothing changed.');
    }
    if (answer.kind === 'all' || (answer.kind === 'skip' && answer.run)) {
      const plan = answer.kind === 'skip' ? { ...waiting, steps: waiting.steps.map((s) => (answer.steps.includes(s.n) ? { ...s, skipped: true } : s)) } : waiting;
      const ran = await box.apply(plan, { invoke: invokeHeld });
      onEvent?.({ type: 'list', list: box.planCard(ran) });
      return done(box.doneReply(ran), { changedRowIds: ran.steps.flatMap((s) => (s.lines ?? []).map((l) => l.id)).filter(Boolean) });
    }
    if (answer.kind === 'skip') {
      const plan = { ...waiting, steps: waiting.steps.map((s) => (answer.steps.includes(s.n) ? { ...s, skipped: true } : s)) };
      onEvent?.({ type: 'list', list: box.planCard(plan) });
      return done(`Left out ${answer.steps.join(' and ')}. Say yes for the rest, or cancel.`);
    }
    if (answer.kind === 'view') {
      onEvent?.({ type: 'list', list: box.planCard(waiting) });
      return done('Here it is again. Nothing has changed yet: say yes, "skip 2", or cancel.');
    }
    // A correction: the model proposes again, with the box in front of it.
  }

  // ---------- "UNDO 2 AND 5" and "RETRY", against the last finished box ----------
  const finished = box.lastDoneBox(history);
  if (finished && UNDO_ITEMS.test(said)) {
    const numbers = UNDO_ITEMS.exec(said)[1].split(/\s*(?:,|and|&)\s*/).map(Number).filter(Boolean);
    const out = await box.undoItems(finished, numbers);
    return done(out.reply);
  }
  if (finished && RETRY.test(said)) {
    const again = box.retryPlan(finished);
    if (!again) return done('Nothing failed last time, so there is nothing to retry.');
    onEvent?.({ type: 'list', list: box.planCard(again) });
    return done(`Here are the ${again.steps.length} that did not go through, again. Say yes to try them.`);
  }

  // ---------- "WHERE DID THAT COME FROM?", in code ----------
  if (evidence.asked(history)) {
    const shown = await evidence.explain(history).catch(() => null);
    if (shown) return done(shown);
  }

  // ---------- ONE MODEL TURN ----------
  const roster = await require('../../repos/people.repo').filterOptions().catch(() => ({}));
  const input = [
    { role: 'system', content: systemPrompt({ people: (roster.people ?? []).map((p) => p.name), groups: roster.groups, companies: roster.companies }) },
    ...inputFrom(history),
  ];
  const client = getClient();
  const tools = [...readTools(context), ...TOOLS];
  let model = AUTO ? (looksHard(said, Boolean(waiting)) ? FULL : LIGHT) : MODEL;
  let toolRan = false;
  const moveUp = (why) => {
    if (!AUTO || model === FULL) return false;
    logger.info({ from: model, to: FULL, why }, 'diane: moved to the bigger model');
    model = FULL;
    /**
     * WHAT THE SMALL ONE LOOKED UP, AS WORDS. Its reasoning is its own, and
     * the API refuses a tool call whose reasoning item is missing, so
     * dropping only the reasoning broke the turn ("no reply", 2026-10-09).
     * The calls and their results go to the big one as one note instead:
     * nothing is looked up twice.
     */
    const done = [];
    const outputs = new Map(input.filter((x) => x.type === 'function_call_output').map((x) => [x.call_id, x.output]));
    for (const x of input) if (x.type === 'function_call') done.push(`${x.name}(${x.arguments}) returned:\n${outputs.get(x.call_id) ?? '(nothing)'}`);
    for (let i = input.length - 1; i >= 0; i -= 1) {
      if (['reasoning', 'function_call', 'function_call_output'].includes(input[i].type)) input.splice(i, 1);
    }
    if (done.length) input.push({ role: 'user', content: `[Already looked up this turn, for you to use]\n${done.join('\n\n').slice(0, 12000)}` });
    return true;
  };
  const [result, usedIds] = await evidence.collect(async () => {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      if (round === 2) moveUp('third round');
      // eslint-disable-next-line no-await-in-loop
      const res = await client.responses.create({ model, input, tools, reasoning: { effort: EFFORT } });
      logger.info({
        model, ms: undefined, inputTokens: res.usage?.input_tokens, cachedTokens: res.usage?.input_tokens_details?.cached_tokens,
        outputTokens: res.usage?.output_tokens, toolCalls: res.output.filter((o) => o.type === 'function_call').map((o) => o.name),
      }, 'diane: model round');
      const calls = res.output.filter((o) => o.type === 'function_call');
      if (!calls.length) {
        // money said with no tool behind it: the small one is guessing
        if (!toolRan && MONEY.test(res.output_text ?? '') && moveUp('money with no tool')) continue;
        return { reply: res.output_text || 'Sorry, I lost my thread there. Could you say that again?' };
      }
      input.push(...res.output);
      let struggled = false;
      for (const call of calls) {
        const args = (() => { try { return JSON.parse(call.arguments || '{}'); } catch { return {}; } })();
        // eslint-disable-next-line no-await-in-loop
        const out = await runTool(call.name, args, { invoke, history, onEvent, said });
        toolRan = true;
        // A FINISHED ANSWER IN CODE ends the turn: no second model call to
        // reword a figure that is already right.
        if (out.final) return out.final;
        if (STRUGGLING.test(out.text)) struggled = true;
        input.push({ type: 'function_call_output', call_id: call.call_id, output: out.text.slice(0, 8000) });
      }
      if (struggled) moveUp('a tool could not use what it was given');
    }
    return { reply: 'That took me more steps than it should. Could you put it another way?' };
  });
  return done(result.reply, { ...(result.extra ?? {}), ...(usedIds.length ? { evidence: usedIds } : {}) });
}

/**
 * One of the five tools. `final` ends the turn with a reply built in code;
 * `text` goes back to the model.
 */
async function runTool(name, args, { invoke, history, onEvent, said }) {
  // A READ, called as the model chose it: no arguments rewritten.
  if (READ_TOOLS.includes(name)) {
    const result = await invoke(name, args);
    if (result?.list) onEvent?.({ type: 'list', list: result.list });
    if (result?.check) onEvent?.({ type: 'check', check: result.check });
    if (name === 'find_and_show_details') for (const card of result?.cards ?? []) onEvent?.({ type: 'card', card });
    const text = String(result?.summary ?? result?.reply ?? '');
    // A FINISHED ANSWER IN CODE is said as it is, with no second model call.
    if (result?.computedReply && result?.reply) return { final: { reply: result.reply } };
    return { text: text || 'Nothing found.' };
  }
  if (name === 'change') {
    const { plan, asks } = await box.preview(args.changes, { invoke, said });
    if (!plan) return { text: `NOTHING WAS PREVIEWED. ${asks.join(' ')} Say that to them, briefly, and ask what you need.` };
    onEvent?.({ type: 'list', list: box.planCard(plan) });
    return { final: { reply: box.previewReply(plan, asks) } };
  }
  if (name === 'undo') {
    const finished = box.lastDoneBox(history);
    if (args.items?.length && finished) return { final: await box.undoItems(finished, args.items) };
    const result = await invoke('undo_master_sheet_change', {
      ...(args.last ? { last: args.last } : {}), ...(args.people?.length ? { people: args.people } : {}),
      ...(args.group ? { group: args.group } : {}), ...(args.except?.length ? { except: args.except } : {}),
    });
    if (result?.list) onEvent?.({ type: 'list', list: result.list });
    return { text: String(result?.reply ?? result?.summary ?? '') };
  }
  if (name === 'export') {
    const result = await invoke('export_sheet', { ...(args.template ? { template: args.template } : {}), ...(args.groups?.length ? { groups: args.groups } : {}), ...(args.month ? { month: args.month } : {}) });
    // The panel, drawn the way v1 draws it: they finish the export there.
    if (result?.exportSession) onEvent?.({ type: 'export-session', session: result.exportSession });
    return { text: String(result?.reply ?? result?.summary ?? '') };
  }
  if (name === 'explain') {
    const shown = await evidence.explain(history).catch(() => null);
    return { final: { reply: shown ?? 'There was no figure just before this to explain.' } };
  }
  return { text: `No tool called ${name}.` };
}

module.exports = { runAgentV2, inputFrom, MODEL };
