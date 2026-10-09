const { getClient } = require('../chatClient');
const knowledge = require('./knowledge');
const repo = require('../../repos/hmrc.repo');
const { cisDeduction } = require('./cisCalc');
const logger = require('../../../configs/logger');
const { currentDay } = require('../../shared/presetMonth.helper');

// ***************************************************
// * DIANE, HMRC & CIS MODE
// ***************************************************
//
// His call 2026-10-10: "answer us like a true HMRC or CIS agent that is
// always there to guide us", as good as ChatGPT, but ours: grounded in
// GOV.UK and HMRC's own manuals (knowledge.js), with OUR notes read first,
// and frank about grey areas.
//
// One turn: the passages closest to the question are found by meaning, the
// full model answers from them with numbered sources, and may look again
// (search_more), work a CIS deduction out in code (cis_deduction), or keep
// a note of ours (remember_note). Money is never worked out by the model.

const MODEL = process.env.HMRC_MODEL || process.env.AI_MODEL || 'gpt-4.1';
const ROUNDS = 4;
const HISTORY = 12;

const SYSTEM = (today) => [
  'You are Diane in HMRC & CIS mode: a senior UK tax adviser who knows the Construction Industry Scheme, PAYE/RTI, National',
  'Insurance, employment status (IR35, off-payroll, agency and umbrella rules), employment intermediaries reporting, the VAT',
  'domestic reverse charge for construction, minimum wage, record keeping, Self Assessment for subcontractors, HMRC compliance',
  'checks and penalties. You work for a UK staffing business that supplies and pays workers (many under CIS). You are always',
  `there to guide them, warm but straight to the point. UK English. Today is ${today}.`,
  '',
  'HOW YOU ANSWER',
  '- The answer first, in one or two plain sentences. Then the detail they need: short "• " bullets, steps in order, the',
  '  deadline or form, what to watch out for. No walls of text. No "as an AI".',
  '- Ground every fact in the SOURCES given (GOV.UK pages, HMRC manuals, and OUR NOTES). Mark each fact with its source',
  '  number like [2] (code hides the numbers and shows the sources as links). NEVER write a "Sources" list or a web',
  '  address yourself. OUR NOTES are how this business does things: follow them, and say so, unless they break the law;',
  '  then say plainly what the law requires instead.',
  '- Rates, thresholds, penalty percentages and deadlines ONLY from the sources, word for word. If the sources do not hold',
  '  it, say which figure to check and where, and NEVER state a number from memory (a wrong penalty or rate is the worst',
  '  thing you can tell them). Say which tax year a figure is for.',
  '- If the sources do not cover it, say so, give your best general understanding clearly marked as such, and use',
  '  search_more with better words before giving up.',
  '- ANY CIS money (a deduction, the net payment, labour vs materials): ALWAYS call cis_deduction and use its figures.',
  '  Never do that sum yourself.',
  '- "Remember that…", "note that…", "our rule is…": save it with remember_note and confirm in one line.',
  '- When they TELL you how they do something ("we always…", "our workers…", "we pay them…") without asking you to save',
  '  it, answer, then ask in one short line at the end: "Want me to remember that?" (a "yes" next turn saves it).',
  '',
  'GREY AREAS AND "IS THIS ILLEGAL?"',
  '- They ask grey and even illegal-sounding questions ON PURPOSE, to make sure they do things the legal way. Answer them',
  '  frankly and fully: what the rule is, where the line sits, how HMRC would see it (careless, deliberate, deliberate and',
  '  concealed), the penalties and who is liable (contractor, director, umbrella, worker), and the legal way to get the',
  '  outcome they want. Never lecture, never refuse to explain the law.',
  '- Do NOT help carry out evasion: no fake or backdated invoices or records, hiding income or workers, false status',
  '  determinations, dodging verification or deductions, or misleading HMRC. If asked, say in one line that you will not',
  '  help with that part and why it matters to THEM, then give the compliant route.',
  '- For a high-stakes or unusual case, say once, briefly, that an accountant or HMRC should confirm it.',
].join('\n');

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_more',
      description: 'Search the HMRC/CIS knowledge again with different words when the sources given do not answer it.',
      parameters: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cis_deduction',
      description: 'Work out a CIS deduction and the net payment, in code. Amounts in GBP, excluding VAT.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          gross: { type: 'number', description: 'the invoice total excluding VAT' },
          materials: { type: ['number', 'null'], description: 'materials, plant hire, fuel and CITB levy the subcontractor paid for this job' },
          status: { type: 'string', enum: ['registered', 'unregistered', 'gross'], description: 'registered = 20%, unregistered or not verified = 30%, gross payment status = 0%' },
        },
        required: ['gross', 'materials', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember_note',
      description: 'Save a note of THEIR OWN knowledge or way of working, to be read first next time.',
      parameters: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'] },
    },
  },
];

const cut = (t, n) => String(t ?? '').slice(0, n);

function sourcesBlock(found) {
  return found.map((c, i) => `[${i + 1}] ${c.kind === 'note' ? 'OUR NOTE' : 'GOV.UK'} · ${c.title}${c.updated_on ? ` · updated ${String(c.updated_on).slice(0, 10)}` : ''}\n${cut(c.text, 2200)}`).join('\n\n');
}

/**
 * @param {object[]} history the chat, as the CRM sends it
 * @param {(e: object) => void} send event stream
 */
async function hmrcTurn(history, send, { user = null } = {}) {
  const openai = getClient();
  if (!openai) return { reply: 'I can\'t reach my reading service right now, so I can\'t answer HMRC questions. Try again in a minute.' };
  const asked = String([...history].reverse().find((m) => m.role === 'user')?.content ?? '').trim();
  if (!asked) return { reply: 'Ask me anything about HMRC, CIS, PAYE or employment status.' };
  const t0 = Date.now();
  /**
   * "YES" TO HER "WANT ME TO REMEMBER THAT?": saved here, in code. Left to
   * the model it said "I'll save this note" and saved nothing (test
   * 2026-10-10). What she offered is what is kept, with what they told her.
   */
  const lastHers = String([...history].reverse().find((m) => m.role === 'assistant' && typeof m.content === 'string')?.content ?? '');
  const offer = /Want me to remember (?:that )?([^?\n]*)\?\s*$/i.exec(lastHers.trim());
  if (offer && /^(?:y|ya|yes|yep|yeah|yup|sure|ok(?:ay)?|please|pls|go on|do it|save it)\b[\s!.]*(?:please|pls|thanks)?[\s!.]*$/i.test(asked)) {
    const told = String([...history].reverse().filter((m) => m.role === 'user')[1]?.content ?? '').trim();
    const what = offer[1].trim() || told;
    const title = what.replace(/^(?:that\s+)?(?:you|we)\s+/i, '').replace(/^\w/, (c) => c.toUpperCase()).slice(0, 100);
    const saved = await knowledge.index({ kind: 'note', title, body: `${what.replace(/^\w/, (c) => c.toUpperCase())}.${told && told !== what ? `\n\nAs they told me: "${told.slice(0, 1500)}"` : ''}`, topic: 'ours', addedBy: user ?? null });
    logger.info({ note: saved.id }, 'diane hmrc: saved a note on their yes');
    return { reply: `Saved to our notes: ${what}. I'll read it first from now on. You can change or remove it in Settings, under Diane.`, claims: [] };
  }
  send({ type: 'tool', name: 'hmrc_search' });

  // the question in its context: a follow up ("and if they're not verified?") carries the one before
  const prior = history.filter((m) => m.role === 'user').slice(-3, -1).map((m) => m.content).join(' ');
  const query = prior && asked.length < 80 ? `${prior}\n${asked}` : asked;
  let found = await knowledge.find(query, { k: 8 });
  /**
   * TODAY'S PAGES, NOT LAST WEEK'S (his call 2026-10-10): the GOV.UK pages
   * this answer will use are checked first; any that changed are taken in
   * and the search runs again on the new text. At most 1.5 seconds.
   */
  if (found.length) {
    const changed = await knowledge.freshen(found.filter((c) => c.kind === 'govuk').map((c) => c.url));
    if (changed.length) {
      knowledge.forget();
      found = await knowledge.find(query, { k: 8 });
      logger.info({ changed }, 'diane hmrc: pages changed on GOV.UK, answered from the new text');
    }
  }
  if (!found.length) {
    return { reply: 'My HMRC knowledge is empty, so I have nothing reliable to answer from yet. Load it in Settings → Diane → HMRC & CIS knowledge (or run `node scripts/hmrcIngest.js`).' };
  }

  const talk = history.slice(-HISTORY - 1, -1)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && !/^\[/.test(m.content))
    .map((m) => ({ role: m.role, content: cut(String(m.content).replace(/\n+\**\s*(?:sources|references)\s*:?\**\s*\n[\s\S]*$/i, ''), 2500) }));
  const messages = [
    { role: 'system', content: SYSTEM(currentDay()) },
    ...talk,
    { role: 'user', content: `SOURCES\n${sourcesBlock(found)}\n\nTHEIR QUESTION\n${cut(asked, 4000)}` },
  ];

  let reply = '';
  let usage = { in: 0, out: 0 };
  for (let round = 0; round < ROUNDS; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    // CIS MONEY IN THE QUESTION: the first round must work it out in code
    const sums = round === 0 && /[£]\s?\d|\b\d[\d,]*(?:\.\d+)?\s?(?:pounds|gbp)\b/i.test(asked) && /\b(?:cis|deduct\w*|subcontract\w*|net pay|labour|materials)\b/i.test(asked);
    const res = await openai.chat.completions.create({ model: MODEL, temperature: 0, messages, tools: TOOLS, tool_choice: sums ? { type: 'function', function: { name: 'cis_deduction' } } : 'auto' });
    usage = { in: usage.in + (res.usage?.prompt_tokens ?? 0), out: usage.out + (res.usage?.completion_tokens ?? 0) };
    const msg = res.choices?.[0]?.message ?? {};
    messages.push({ role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls?.length) { reply = String(msg.content ?? '').trim(); break; }
    for (const call of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* empty */ }
      let out;
      if (call.function.name === 'search_more') {
        send({ type: 'tool', name: 'hmrc_search' });
        // eslint-disable-next-line no-await-in-loop
        const more = (await knowledge.find(String(args.query ?? asked), { k: 6 })).filter((c) => !found.some((f) => f.id === c.id));
        const from = found.length;
        found = [...found, ...more];
        out = more.length ? sourcesBlock(more).replace(/^\[(\d+)\]/gm, (m, n) => `[${Number(n) + from}]`) : 'Nothing new found.';
      } else if (call.function.name === 'cis_deduction') {
        out = JSON.stringify(cisDeduction(args));
      } else if (call.function.name === 'remember_note') {
        // eslint-disable-next-line no-await-in-loop
        const saved = await knowledge.index({ kind: 'note', title: cut(args.title, 120) || 'Our note', body: cut(args.text, 8000), topic: 'ours', addedBy: user ?? null });
        out = `Saved as note #${saved.id}. It is read first from now on, and can be edited in Settings → Diane.`;
      } else {
        out = 'unknown tool';
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: cut(out, 12000) });
    }
  }
  if (!reply) reply = 'I couldn\'t put an answer together from my HMRC sources this time. Ask it another way, or more specifically.';

  // THE SOURCES IT CITED, as links under the answer
  const cited = [...new Set([...reply.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
    .filter((n) => found[n - 1]).sort((a, b) => a - b);
  /**
   * CLEAN, LIKE CHATGPT (his call 2026-10-10: "[1] things" in the text): the
   * markers and any sources list or address it wrote are taken out; the
   * sources travel beside the answer and open from a button under it.
   */
  reply = reply
    .replace(/\n+\**\s*(?:sources|references)\s*:?\**\s*\n[\s\S]*$/i, '')
    .replace(/\s?\[\d+\](?:\s*\[\d+\])*/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]+([.,;:])/g, '$1')
    .trim();
  // NOT IN HER WORDS (his call 2026-10-10: links in the text were not
  // clickable and were read aloud): the chat draws them as links under it
  // one line per page: two passages of one guide (or one guide at two addresses) are one source
  const sources = cited.map((n) => found[n - 1])
    .filter((c, i, all) => all.findIndex((x) => x.title === c.title) === i)
    .map((c, i) => ({ n: i + 1, title: c.title, url: c.kind === 'note' ? null : c.url, updatedOn: c.updated_on ? String(new Date(c.updated_on).toISOString()).slice(0, 10) : null }));
  /**
   * WHAT CHANGED ON GOV.UK, SAID ONCE (his call 2026-10-10): pages updated
   * since the last time she said so, a line each, above this answer.
   * Wording-only changes are marked as told without a word.
   */
  const untold = await repo.untoldChanges(5).catch(() => []);
  const worth = untold.filter((c) => !/^wording only/i.test(String(c.summary ?? ''))).slice(0, 3);
  await repo.markTold(untold.map((c) => c.id)).catch(() => {});
  if (worth.length) {
    const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'recently');
    const lines = worth.map((c) => `• ${c.title} (updated ${day(c.new_updated_on ?? c.created_at)}): ${c.summary}`);
    reply = `Heads-up, GOV.UK changed ${worth.length === 1 ? 'a page' : `${worth.length} pages`} I rely on:\n${lines.join('\n')}\n\n${reply}`;
  }
  logger.info({ ms: Date.now() - t0, tokensIn: usage.in, tokensOut: usage.out, sources: found.length, cited: cited.length }, 'diane hmrc: answered');
  return { reply, sources, claims: [] };
}

module.exports = { hmrcTurn, SYSTEM };
