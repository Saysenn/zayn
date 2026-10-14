const { getClient } = require('../chatClient');
const knowledge = require('./knowledge');
const playbook = require('./playbook');
const repo = require('../../repos/hmrc.repo');
const { cisDeduction } = require('./cisCalc');
const logger = require('../../../configs/logger');
const { currentDay } = require('../../shared/presetMonth.helper');
const liquidationsRepo = require('../../repos/liquidations.repo');
const docIndex = require('../../shared/liquidationDocIndex');

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
// a note of ours, and OUR PLAYBOOK first of all (playbook.js). Money is never worked out by the model.

const MODEL = process.env.HMRC_MODEL || process.env.AI_MODEL || 'gpt-4.1';
const ROUNDS = 4;
const HISTORY = 12;

const SYSTEM = (today) => [
  'You are Diane in LAWYER MODE: a senior UK business lawyer and tax adviser. You know the Construction Industry Scheme,',
  'PAYE/RTI, National Insurance, employment status (IR35, off-payroll, agency and umbrella rules), employment intermediaries',
  'reporting, the VAT domestic reverse charge, minimum wage, HMRC compliance checks and penalties, AND UK employment law,',
  'contracts, company law and directors\' duties, data protection (UK GDPR), right to work, and health and safety. You work for',
  'a UK staffing business that supplies and pays workers (many under CIS). You are always there to guide them, warm but',
  `straight to the point. UK English. Today is ${today}.`,
  '',
  'OUR PLAYBOOK COMES FIRST',
  '- OUR PLAYBOOK is how THIS business actually does things: its processes, internal ways and how things work here. It is',
  '  internal and only for them. Read it FIRST; when it covers the question, answer from it ("Our playbook says…").',
  '- It is THEIR record of what they ACTUALLY do. Save and update it exactly as they say it, whatever it says: never refuse,',
  '  never water it down, never add your opinion to it. If they then ASK about it, answer frankly: what we do, what the law',
  '  says, and the real risk, in plain words, no lecture.',
  '- Several entries that disagree (an old way and a new one): say so in one line, use the most recently updated, and ask',
  '  which is current.',
  '- SAVING (they ask to save, keep, note or remember something; they tell you a process; they send a document to keep;',
  '  they say a process CHANGED: "we now…", "from now on…", "we no longer…", "step 3 is now…"): call save_to_playbook.',
  '  Code checks for an entry on the same thing: if there is one, it gives you its text and you call update_playbook with',
  '  the WHOLE new text (its current text with their change made, nothing else dropped). Nothing is saved until they say yes.',
  '- To change a named entry ("update our onboarding", "change the payroll process"), read_playbook it first if its text is',
  '  not in the SOURCES, then update_playbook. To take one out, remove_from_playbook.',
  '',
  'HOW YOU ANSWER',
  '- Answer THEIR LATEST message only. Earlier messages are context: never repeat an answer you already gave.',
  '- The answer first, in one or two plain sentences. Then the detail they need: short "• " bullets, steps in order, the',
  '  deadline or form, what to watch out for. No walls of text. No "as an AI".',
  '- Ground every fact in the SOURCES given (OUR PLAYBOOK, OUR NOTES, GOV.UK pages, HMRC manuals). Mark each fact with its source',
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
  '- "Remember that…", "note that…", "our rule is…": save_to_playbook (it asks them first).',
  '- When they TELL you how they do something ("we always…", "our workers…", "we pay them…") without asking you to save',
  '  it, answer, then ask in one short line at the end: "Want me to remember that?" (a "yes" next turn saves it).',
  '- For general law beyond tax, the SOURCES may not hold it: say so, give your general understanding clearly marked as such,',
  '  and for anything high-stakes say a solicitor should confirm it.',
  '',
  'GREY AREAS AND "IS THIS ILLEGAL?"',
  '- They ask grey and even illegal-sounding questions ON PURPOSE. Answer them frankly, fully and without bias: what the rule',
  '  is, where the line sits, how HMRC or a court would see it (careless, deliberate, deliberate and concealed), the penalties',
  '  and who is liable (contractor, director, umbrella, worker), and the legal way to get the outcome they want. Never',
  '  lecture, never moralise, never refuse to explain the law, never soften a fact to be polite.',
  '- Do NOT help carry out evasion: no fake or backdated invoices or records, hiding income or workers, false status',
  '  determinations, dodging verification or deductions, or misleading HMRC. If asked, say in one line that you will not',
  '  help with that part and why it matters to THEM, then give the compliant route.',
  '- For a high-stakes or unusual case, say once, briefly, that an accountant or HMRC should confirm it.',
  '',
  'OUR COMPANIES IN LIQUIDATION (read only, his call 2026-10-13)',
  '- OUR LIQUIDATIONS below lists every company of ours in liquidation: stage, deadline, liquidator, next action, last',
  '  contact and its documents. COMPANY DOCUMENT sources are passages from those documents (letters, petitions, notices,',
  '  statements). Use them to guide them: what a letter asks for, what is due when, what happens next, what the law says',
  '  about it. Name the document a fact came from, and mark it with its source number like any other.',
  '- To find more in their documents use search_company_documents; to read one whole, read_company_document.',
  '- You CANNOT change anything here: no stage, deadline, note, document or status. If they ask, say it is done in',
  '  master sheet mode or on the Liquidations page, in one line.',
].join('\n');

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_company_documents',
      description: 'Search the documents of our companies in liquidation (letters, petitions, notices, statements) by meaning. Read only.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { query: { type: 'string' }, company: { type: 'string', description: 'One company, if they named one.' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_company_document',
      description: 'Read one of a company\'s documents in full, or list its documents when no file is named. Read only.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { company: { type: 'string' }, file: { type: 'string', description: 'Its name or part of it.' } },
        required: ['company'],
      },
    },
  },
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
      name: 'save_to_playbook',
      description: 'Propose saving how this business does something to OUR PLAYBOOK, exactly as they say it. Code checks for an entry on the same thing first, and saves only on their yes.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          section: { type: 'string', description: 'A short section: "Payroll", "Onboarding", "CIS", "Contracts", "Expenses", "Our ways"…' },
          title: { type: 'string', description: 'What this entry is, in a few words' },
          text: { type: 'string', description: 'The process in full, in their words, tidied but never changed in meaning; "" when it is the document they sent' },
          from_document: { type: 'boolean', description: 'true when it is the document attached to their message' },
          also_new: { type: 'boolean', description: 'true only when code said a similar entry exists AND this is truly a separate process' },
        },
        required: ['section', 'title', 'text', 'from_document', 'also_new'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_playbook',
      description: 'Propose changing an entry of OUR PLAYBOOK (its #id). Give the WHOLE new text: its current text with their change made. Saved only on their yes.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'integer' }, section: { type: 'string' }, title: { type: 'string' }, text: { type: 'string', description: 'the whole new text' }, change: { type: 'string', description: 'what changes, in one short line ("pay day: Friday → Thursday")' } },
        required: ['id', 'section', 'title', 'text', 'change'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_playbook',
      description: 'Read one entry of OUR PLAYBOOK in full, by its #id.',
      parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'integer' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_from_playbook',
      description: 'Propose removing an entry of OUR PLAYBOOK (by its #id). Removed only on their yes.',
      parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'integer' } }, required: ['id'] },
    },
  },
];

const cut = (t, n) => String(t ?? '').slice(0, n);

const LABEL = { playbook: 'OUR PLAYBOOK', note: 'OUR NOTE', govuk: 'GOV.UK', doc: 'COMPANY DOCUMENT' };

/**
 * OUR LIQUIDATIONS, short: one line a company, so she always knows them.
 * Read only. Empty when there are none (or the tables are not there yet).
 */
async function liquidationsOutline() {
  try {
    const rows = await liquidationsRepo.list();
    if (!rows.length) return '';
    const lines = [];
    for (const r of rows.slice(0, 40)) {
      // eslint-disable-next-line no-await-in-loop
      const { docs } = await liquidationsRepo.details(r.id);
      lines.push([
        r.company_name,
        r.stage ? r.stage.replace(/_/g, ' ') : 'stage not set',
        r.deadline ? `deadline ${String(r.deadline).slice(0, 10)}` : null,
        r.liquidator ? `liquidator ${r.liquidator}` : null,
        r.next_action ? `next: ${cut(r.next_action, 120)}` : null,
        r.instructions ? `instructions: ${cut(r.instructions, 160)}` : null,
        r.last_comm ? `last contact ${String(r.last_comm.said_on).slice(0, 10)}: ${cut(r.last_comm.body, 160)}` : null,
        docs.length ? `documents: ${docs.map((d) => d.file_name).join(', ')}` : 'no documents',
      ].filter(Boolean).join(' · '));
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

/** Their documents' passages that answer this, as sources. Only good matches. */
async function documentSources(query, { company = null, limit = 6 } = {}) {
  try {
    const keys = company ? [String(company).trim().replace(/\s+/g, ' ').toLowerCase()] : null;
    const hits = await docIndex.search(query, { companyKeys: keys, limit: limit * 2 });
    const best = hits[0]?.score ?? 0;
    return hits.filter((h) => h.score >= 0.3 && h.score >= best - 0.15).slice(0, limit).map((h) => ({
      id: `doc-${h.id}`, kind: 'doc', title: `${h.company_name}: ${h.file_name}`, text: h.text, url: null, updated_on: null,
    }));
  } catch {
    return [];
  }
}
function sourcesBlock(found) {
  return found.map((c, i) => `[${i + 1}] ${LABEL[c.kind] ?? 'GOV.UK'}${c.kind === 'playbook' && c.topic ? ` · ${c.topic}` : ''} · ${c.title}${c.updated_on ? ` · updated ${String(c.updated_on).slice(0, 10)}` : ''}\n${cut(c.text, 2200)}`).join('\n\n');
}

/**
 * ===============================
 * * A PLAYBOOK CHANGE WAITS FOR THEIR YES
 * ===============================
 * What she proposed, held here by who asked, until their next message: a
 * yes saves it, anything else drops it. Held in code, not in her words, so
 * a long document is saved whole and exactly as sent. Ten minutes.
 */
const waiting = new Map();
const HOLD_MS = 10 * 60 * 1000;
const keyOf = (user) => String(user ?? 'admin');
const YES = /^(?:y|ya|yes|yep|yeah|yup|sure|ok(?:ay)?|please|pls|go on|go ahead|do it|save it|save|confirm|correct)\b[\s!.,]*(?:please|pls|thanks|thank you|save it|do it)?[\s!.]*$/i;
const UNDO = /^\s*(?:undo(?: that| it)?|take (?:that|it) back|scrap that|put it back)\b[\s!.]*$/i;
// A PROCESS THAT CHANGED, said as a fact, never a question: "we now pay on Thursdays", "from now on…", "step 3 is now…"
const CHANGE_SAID = /^(?![^?]*\?\s*$)(?!\s*(?:what|how|why|when|who|which|is|are|do|does|can|could|should|would|will)\b)[\s\S]*\b(?:we now|now we|from now on|going forward|from today|we no longer|we don'?t \w+ anymore|(?:has|have) changed|is now|are now|instead of|new process|new policy|changed (?:our|the))\b/i;
// THE TITLE IS NOT THE TEXT'S FIRST LINE (test 2026-10-12: "Onboarding process: steps and timing - Right to work…")
const untitled = (text, title) => {
  const t = String(text ?? '').trim();
  const head = String(title ?? '').trim();
  return head && t.toLowerCase().startsWith(head.toLowerCase()) ? t.slice(head.length).replace(/^[\s:.\-–—]+/, '').trim() || t : t;
};
// close enough to an entry to be the same thing (cosine, embeddings)
const SAME_ENTRY = 0.55;
// asked to take something out of the playbook
const REMOVE_ASK = /^(?:(?:please|pls|can you|could you|ok(?:ay)?|actually)[\s,]+)*(?:remove|delete|drop|take out|get rid of|bin)\b[^?]*\b(?:playbook|process|policy|rule|entry|procedure|that one)\b/i;
// asked in so many words to keep something: "save this as our process", "add this to our playbook", "remember that our…"
const SAVE_ASK = /\b(?:save|add|put|keep|record|store)\b[^.?!]{0,40}\b(?:process|playbook|policy|procedure|way|rule|document|this|that)\b|\b(?:remember|note) that\b|\bto (?:our|the) playbook\b/i;
const lastAttachment = (history) => [...history].reverse().find((m) => m.role === 'user' && m.attachment?.text)?.attachment ?? null;

/**
 * @param {object[]} history the chat, as the CRM sends it
 * @param {(e: object) => void} send event stream
 */
async function hmrcTurn(history, send, { user = null } = {}) {
  const openai = getClient();
  if (!openai) return { reply: 'I can\'t reach my reading service right now, so I can\'t answer HMRC questions. Try again in a minute.' };
  const asked = String([...history].reverse().find((m) => m.role === 'user')?.content ?? '').trim();
  if (!asked) return { reply: 'Ask me anything about HMRC, CIS, PAYE, employment law, contracts or how we do things here.' };
  const t0 = Date.now();
  const lastHers = String([...history].reverse().find((m) => m.role === 'assistant' && typeof m.content === 'string')?.content ?? '');
  /**
   * A YES TO HER OWN OFFER ("Want me to remember that?", "…save the legal
   * version to our playbook?"): the save tool, forced, and saved at once
   * when nothing like it is there (they already said yes).
   */
  const yesToOffer = YES.test(asked) && /\b(?:remember|save|keep|playbook)\b[^?]*\?\s*$/i.test(lastHers.trim());
  /**
   * THEIR YES TO A PLAYBOOK CHANGE she proposed: done here, in code.
   */
  const held = waiting.get(keyOf(user));
  waiting.delete(keyOf(user));
  const live = held && Date.now() - held.at < HOLD_MS;
  // "NO" to it: said plainly, nothing saved
  if (live && /^(?:no|nope|nah|cancel|don'?t|do not|leave it|never ?mind|forget it|scrap (?:it|that))\b[\s!.]*(?:thanks|thank you)?[\s!.]*$/i.test(asked)) {
    return { reply: 'Okay, nothing saved.', claims: [] };
  }
  // A YES WITH A CHANGE ("yes but call it X", "save it under Payroll", "ok and add step 5"): proposed again with it
  const amend = live && !YES.test(asked) && (/^(?:y|ya|yes|yeah|yep|ok(?:ay)?|sure)\b[\s,]+/i.test(asked)
    || /\b(?:call it|name it|title it|under (?:the )?\w+|in (?:the )?\w+ section|put it in|add (?:that|a step|step)|change (?:the )?(?:title|section|name))\b/i.test(asked)) ? held : null;
  if (held && Date.now() - held.at < HOLD_MS && YES.test(asked)) {
    if (held.kind === 'add') {
      const out = await playbook.add({ ...held.entry, by: user });
      logger.info({ playbook: out.id, passages: out.passages }, 'diane lawyer: saved to the playbook on their yes');
      return { reply: `Saved to our playbook, under ${out.section}: "${out.title}". I'll read it first from now on. Say "undo that" to take it back, or change it in Settings → Diane.`, claims: [] };
    }
    if (held.kind === 'edit') {
      const out = await playbook.edit(held.id, held.entry, user);
      return { reply: out ? `Updated in our playbook: "${held.entry.title}". Say "undo that" to put the old version back.` : 'That entry is gone, so nothing changed.', claims: [] };
    }
    if (held.kind === 'undo') {
      const out = await playbook.undo(held.change, user);
      return { reply: out ? `Put back: ${{ add: 'the new entry is taken out', edit: 'the old version is back', remove: 'the entry is back' }[out.undid]}.` : 'That change is already put back.', claims: [] };
    }
    if (held.kind === 'remove') {
      const out = await playbook.remove(held.id, user);
      return { reply: out ? `Removed from our playbook: "${held.title}". Say "undo that" to bring it back.` : 'That entry was already gone.', claims: [] };
    }
  }
  // "UNDO THAT" right after a playbook change: the last one they made, put back
  /**
   * ONLY THE CHANGE SHE JUST REPORTED (test 2026-10-12: "undo that" after
   * her QUESTION "Remove X from our playbook?" took out an older, unrelated
   * entry). Her last message must say a change was made, and the change put
   * back is that one: theirs, the newest, within the last half hour.
   */
  if (UNDO.test(asked) && /\b(?:Saved to|Updated in|Removed from) our playbook\b|^Saved\b|Put back:/i.test(lastHers)) {
    const recent = (c) => Date.now() - new Date(c.at).getTime() < 30 * 60 * 1000;
    const last = (await repo.playbookHistory(20)).find((c) => !c.undone_at && c.action !== 'undo' && recent(c) && String(c.by_user ?? '') === String(user ?? ''));
    const out = last ? await playbook.undo(last.id, user) : null;
    return { reply: out ? `Put back: ${{ add: 'the new entry is taken out', edit: 'the old version is back', remove: 'the entry is back' }[out.undid]}.` : 'There was nothing of yours to put back in the playbook.', claims: [] };
  }
  /**
   * "UNDO THAT" WITH SOMETHING ELSE IN BETWEEN: asked, never guessed (test
   * 2026-10-12: she said a rule "will be removed" with nothing held). Their
   * newest playbook change of the last half hour, named, waits for a yes.
   */
  if (UNDO.test(asked)) {
    const recent = (c) => Date.now() - new Date(c.at).getTime() < 30 * 60 * 1000;
    const last = (await repo.playbookHistory(20)).find((c) => !c.undone_at && c.action !== 'undo' && recent(c) && String(c.by_user ?? '') === String(user ?? ''));
    if (!last) return { reply: 'You haven\'t changed anything in our playbook in the last half hour, so there is nothing to put back. Tell me which entry, and I\'ll change it.', claims: [] };
    const what = { add: 'saving', edit: 'the change to', remove: 'removing' }[last.action];
    waiting.set(keyOf(user), { kind: 'undo', change: last.id, at: Date.now() });
    return { reply: `Do you mean take back ${what} "${last.title ?? last.after?.title ?? 'that entry'}"?`, claims: [] };
  }

  /**
   * LAWYER MODE READS OUR LIQUIDATIONS, IT NEVER CHANGES THEM (his call
   * 2026-10-13). Asked to remove, rename, save or set something on a company
   * in liquidation or its documents, she offered to (suite run 1): said here
   * in code instead, the same way every time.
   */
  if (!/\bplaybook|process|policy|procedure|rule\b/i.test(asked)
    && /^(?:(?:please|pls|can you|could you|ok(?:ay)?|now)[\s,]+)*(?:remove|delete|rename|save|upload|attach|set|change|update|move|put|mark|log|add|clear)\b/i.test(asked)) {
    const names = (await liquidationsRepo.list().catch(() => [])).map((r) => r.company_name.toLowerCase());
    const about = /\b(?:liquidat\w*|documents?|docs?|files?|letters?|petition|stage|deadline|liquidator|notes?)\b/i.test(asked)
      || names.some((n) => n.length > 2 && asked.toLowerCase().includes(n));
    if (about) {
      return {
        reply: 'In lawyer mode I only read our liquidations and their documents, I can\'t change them. Switch to Master sheet mode and ask me there, or do it on the Liquidations page.',
        claims: [],
      };
    }
  }

  send({ type: 'tool', name: 'hmrc_search' });

  // the question in its context: a follow up ("and if they're not verified?") carries the one before
  const prior = history.filter((m) => m.role === 'user').slice(-3, -1).map((m) => m.content).join(' ');
  const query = prior && asked.length < 80 ? `${prior}\n${asked}` : asked;
  /**
   * OUR PLAYBOOK FIRST (his call 2026-10-12): its closest passages lead the
   * sources, before notes and GOV.UK, and she always knows what it holds.
   */
  const [ours, outline, liqOutline, docs] = await Promise.all([
    knowledge.findPlaybook(query, { k: 6 }).catch(() => []),
    playbook.outline().catch(() => ''),
    liquidationsOutline(),
    documentSources(query),
  ]);
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
  // THEIR OWN DOCUMENTS after the playbook, before GOV.UK: they are the case.
  found = [...ours, ...docs, ...found];
  const doc = lastAttachment(history.slice(-1));
  if (!found.length && !doc && !liqOutline) {
    return { reply: 'My lawyer-mode knowledge is empty, so I have nothing reliable to answer from yet. Load it in Settings → Diane (or run `node scripts/hmrcIngest.js`), or save our own processes to our playbook.' };
  }

  const talk = history.slice(-HISTORY - 1, -1)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && !/^\[/.test(m.content))
    .map((m) => ({ role: m.role, content: cut(String(m.content).replace(/\n+\**\s*(?:sources|references)\s*:?\**\s*\n[\s\S]*$/i, ''), 2500) }));
  const messages = [
    { role: 'system', content: `${SYSTEM(currentDay())}\n\nOUR LIQUIDATIONS\n${liqOutline || '(no company of ours is in liquidation)'}\n\nWHAT OUR PLAYBOOK HOLDS (#id section: title)\n${outline || '(nothing saved yet)'}${amend ? `\n\nYOUR PROPOSAL THAT WAITED (they answered it with a change; propose it again with their change made${amend.id ? `, entry #${amend.id}` : ''}):\nsection: ${amend.entry?.section ?? ''}\ntitle: ${amend.entry?.title ?? amend.title ?? ''}\ntext: ${cut(amend.entry?.body ?? '', 6000)}` : ''}` },
    ...talk,
    { role: 'user', content: `SOURCES\n${sourcesBlock(found)}${doc ? `\n\nTHE DOCUMENT THEY SENT (${doc.filename})\n${cut(doc.text, 20000)}` : ''}\n\nTHEIR LATEST MESSAGE (answer this one only; anything answered before stays answered)\n${cut(asked, 4000)}` },
  ];

  let reply = '';
  let usage = { in: 0, out: 0 };
  // SET BY A TOOL for the round after it: "an entry exists" must lead to an update (or a save as new), never prose
  let forceNext = null;
  /**
   * ONE PROPOSAL A TURN, THE FIRST ONE STANDS (test 2026-10-12: "replace the
   * old onboarding" proposed an update AND a removal; the removal overwrote
   * the update, and their yes removed a different entry).
   */
  let proposed = null;
  const propose = (p) => {
    if (proposed) return false;
    proposed = p;
    waiting.set(keyOf(user), p);
    return true;
  };
  const ONE_AT_A_TIME = 'ONE CHANGE AT A TIME: another change already waits for their yes this turn. Do not ask about this one now; mention it in one line as the next step.';
  for (let round = 0; round < ROUNDS; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    // CIS MONEY IN THE QUESTION: the first round must work it out in code
    const sums = round === 0 && /[£]\s?\d|\b\d[\d,]*(?:\.\d+)?\s?(?:pounds|gbp)\b/i.test(asked) && /\b(?:cis|deduct\w*|subcontract\w*|net pay|labour|materials)\b/i.test(asked);
    /**
     * "SAVE THIS AS OUR PROCESS…" GOES THROUGH THE TOOL (test 2026-10-12: she
     * wrote the preview herself, nothing was held, and the yes saved nothing).
     */
    // and a yes to her own offer, a change to a process said as a fact, or a yes with a change to her proposal
    const saves = round === 0 && (SAVE_ASK.test(asked) || CHANGE_SAID.test(asked) || yesToOffer || amend);
    const tool = amend?.kind === 'edit' ? 'update_playbook' : amend?.kind === 'remove' ? null : 'save_to_playbook';
    // "REMOVE OUR HOLIDAY POLICY": the remove tool, never an essay about removing it
    const removes = round === 0 && REMOVE_ASK.test(asked);
    const choice = sums ? { type: 'function', function: { name: 'cis_deduction' } }
      : removes ? { type: 'function', function: { name: 'remove_from_playbook' } }
        : saves && tool ? { type: 'function', function: { name: tool } } : (forceNext ?? 'auto');
    forceNext = null;
    const res = await openai.chat.completions.create({ model: MODEL, temperature: 0, messages, tools: TOOLS, tool_choice: choice });
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
      } else if (call.function.name === 'search_company_documents') {
        send({ type: 'tool', name: 'hmrc_search' });
        // eslint-disable-next-line no-await-in-loop
        const more = (await documentSources(String(args.query ?? asked), { company: args.company, limit: 6 })).filter((c) => !found.some((f) => f.id === c.id));
        const from = found.length;
        found = [...found, ...more];
        out = more.length ? sourcesBlock(more).replace(/^\[(\d+)\]/gm, (m, n) => `[${Number(n) + from}]`) : 'Nothing in their documents matches that.';
      } else if (call.function.name === 'read_company_document') {
        // eslint-disable-next-line no-await-in-loop
        out = await readCompanyDocument(args);
      } else if (call.function.name === 'cis_deduction') {
        out = JSON.stringify(cisDeduction(args));
      } else if (call.function.name === 'save_to_playbook') {
        const title = cut(args.title, 140) || 'Our process';
        const body = args.from_document ? String(doc?.text ?? lastAttachment(history)?.text ?? '') : untitled(String(args.text ?? ''), title);
        const entry = { section: cut(args.section, 60) || 'Our ways', title, body };
        // AN ENTRY ON THE SAME THING ALREADY: an update, never a second copy
        // eslint-disable-next-line no-await-in-loop
        const like = body.trim() && !args.also_new ? (await knowledge.findPlaybook(`${entry.title}\n${body.slice(0, 3000)}`, { k: 3 }).catch(() => []))[0] : null;
        // eslint-disable-next-line no-await-in-loop
        const existing = like && like.score >= SAME_ENTRY ? await repo.playbookEntry(like.source_id) : null;
        if (!body.trim()) {
          out = 'NOTHING TO SAVE: no text and no document. Ask them what to save.';
        } else if (existing?.active) {
          forceNext = 'required';
          out = `AN ENTRY ON THIS ALREADY EXISTS: #${existing.id} "${existing.title}" (${existing.section}), last updated ${String(existing.updated_at ?? '').slice(0, 10)}. ITS TEXT NOW:\n${cut(existing.body, 12000)}\n\n`
            + 'If what they said changes, adds to or replaces it, call update_playbook with its id and the WHOLE new text (this text with their change made, nothing else dropped). '
            + 'Only if it is truly a separate process, call save_to_playbook again with also_new true. '
            + 'If it says nothing the entry does not already say, call read_playbook on it (nothing changes) and tell them it is already saved.';
        } else if (yesToOffer) {
          // they already said yes to her offer: saved now
          // eslint-disable-next-line no-await-in-loop
          const saved = await playbook.add({ ...entry, by: user });
          out = `SAVED as #${saved.id}, under "${saved.section}", titled "${saved.title}". Tell them in one line, and that "undo that" takes it back. No comment on it.`;
        } else {
          out = !propose({ kind: 'add', entry, at: Date.now() }) ? ONE_AT_A_TIME : `NOT SAVED YET. It waits for their yes. Tell them in two short lines what will be saved: under "${entry.section}", titled "${entry.title}", ${body.length > 600 ? `the whole ${args.from_document ? 'document' : 'text'} (${body.split(/\s+/).length} words)` : 'what they said'}, with a one line summary. No comment, warning or opinion about it: it is their record. End with exactly: "Save this to our playbook?"`;
        }
      } else if (call.function.name === 'update_playbook') {
        // eslint-disable-next-line no-await-in-loop
        const e = await repo.playbookEntry(Number(args.id));
        const text = untitled(String(args.text ?? ''), cut(args.title, 140) || e?.title);
        if (!e?.active) {
          out = `There is no entry #${args.id}. Use an id from the outline.`;
        } else if (text.length < e.body.length * 0.5 && !/\b(?:rewrite|replace|whole|entire|new version|from scratch|instead of all)\b/i.test(asked)) {
          // A WHOLE TEXT, NOT JUST THE CHANGE: half the entry was about to be lost
          out = `YOUR TEXT IS MUCH SHORTER than entry #${e.id} (${text.length} vs ${e.body.length} characters): give the WHOLE new text, its current text with their change made. Its text now:\n${cut(e.body, 12000)}`;
        } else {
          const entry = { section: cut(args.section, 60) || e.section, title: cut(args.title, 140) || e.title, body: text };
          out = !propose({ kind: 'edit', id: e.id, entry, change: cut(args.change, 300), at: Date.now() }) ? ONE_AT_A_TIME : `NOT CHANGED YET. Tell them in one or two short lines what changes in "${e.title}" (${cut(args.change, 300) || 'the change'}). No comment, warning or opinion about it. End with exactly: "Update this in our playbook?"`;
        }
      } else if (call.function.name === 'read_playbook') {
        // eslint-disable-next-line no-await-in-loop
        const e = await repo.playbookEntry(Number(args.id));
        out = e?.active ? `#${e.id} ${e.section}: ${e.title} (updated ${String(e.updated_at ?? '').slice(0, 10)})\n${cut(e.body, 12000)}` : `There is no entry #${args.id}.`;
      } else if (call.function.name === 'remove_from_playbook') {
        // eslint-disable-next-line no-await-in-loop
        const e = await repo.playbookEntry(Number(args.id));
        if (!e?.active) {
          out = `There is no entry #${args.id}.`;
        } else {
          out = !propose({ kind: 'remove', id: e.id, title: e.title, at: Date.now() }) ? ONE_AT_A_TIME : `NOT REMOVED YET. End with exactly: "Remove '${e.title}' from our playbook?"`;
        }
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
  // ONLY WHAT WAS SAID is marked told: the wording-only ones, and the three
  // shown; a 4th or 5th real change waits for her next answer (code review
  // 2026-10-10: they were marked told and never mentioned)
  const said = new Set(worth.map((c) => c.id));
  await repo.markTold(untold.filter((c) => said.has(c.id) || /^wording only/i.test(String(c.summary ?? ''))).map((c) => c.id)).catch(() => {});
  if (worth.length) {
    const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'recently');
    const lines = worth.map((c) => `• ${c.title} (updated ${day(c.new_updated_on ?? c.created_at)}): ${c.summary}`);
    reply = `Heads-up, GOV.UK changed ${worth.length === 1 ? 'a page' : `${worth.length} pages`} I rely on:\n${lines.join('\n')}\n\n${reply}`;
  }
  logger.info({ ms: Date.now() - t0, tokensIn: usage.in, tokensOut: usage.out, sources: found.length, cited: cited.length }, 'diane hmrc: answered');
  return { reply, sources, claims: [] };
}

/** One company's documents listed, or one read whole. Read only. */
async function readCompanyDocument({ company, file = '' } = {}) {
  const key = String(company ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const rows = await liquidationsRepo.list().catch(() => []);
  const row = rows.find((r) => r.company_key === key || r.company_name.toLowerCase() === key)
    ?? rows.find((r) => r.company_key.includes(key) || key.includes(r.company_key));
  if (!row) return `No company called "${company}" is in liquidation. Ours are: ${rows.map((r) => r.company_name).join(', ') || 'none'}.`;
  const { docs } = await liquidationsRepo.details(row.id);
  if (!docs.length) return `${row.company_name} has no documents.`;
  const want = String(file ?? '').trim().toLowerCase();
  const hits = want ? docs.filter((d) => d.file_name.toLowerCase().includes(want)) : [];
  if (!want || hits.length !== 1) {
    return `${row.company_name}'s documents: ${docs.map((d) => `${d.file_name} (${d.read_status === 'read' ? 'readable' : d.read_status})`).join('; ')}.`
      + (want ? ` ${hits.length ? 'More than one' : 'None'} matches "${file}": ask which.` : '');
  }
  const full = await liquidationsRepo.docWithText(hits[0].id);
  if (!full?.text) return `${hits[0].file_name} has no readable text (${full?.read_error ?? full?.read_status ?? 'not read'}).`;
  return `${row.company_name}: ${hits[0].file_name}\n${cut(full.text, 20000)}`;
}

module.exports = { hmrcTurn, SYSTEM };
