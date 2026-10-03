#!/usr/bin/env node
/**
 * ***************************************************
 * * Talk to Diane from the terminal, for real
 * ***************************************************
 *
 * A SCRIPTED CONVERSATION against the real model and the real database, so
 * her answers can be READ rather than reasoned about. The unit tests pin
 * the tools; nothing pinned what she actually says with them, which is
 * where every fault in the live transcripts has been.
 *
 * IT REBUILDS HISTORY THE WAY THE BROWSER DOES, and that is the whole
 * reason it is not three lines. `AgentOverlay.jsx` commits cards, lists,
 * forms and the export panel to history as entries with their own shape,
 * and `runAgent` reads that history back: the open export panel is injected
 * from it, and `notTwice.list` compares against it. A harness that only
 * kept `reply` strings would test a Diane nobody uses.
 *
 * SPENDS REAL MONEY and reads the real sheet. Not part of `npm test`, and
 * never run without being asked.
 *
 *   node scripts/dianeChat.js v1/agent/scenarios/export.txt
 *   node scripts/dianeChat.js --say "give me the bank sheet for nexus"
 *
 * A scenario file is one admin turn per line. Blank lines and lines
 * starting with # are ignored.
 */
require('dotenv').config();

/**
 * ===============================
 * * ARMED BEFORE ANYTHING ELSE LOADS, AND THERE IS NO WAY PAST IT
 * ===============================
 *
 * This drives the REAL agent against the REAL database, so a scenario that
 * says 'update all the presets' updates all the presets. A test of Diane
 * already set three real INDIGO rows to a 2023 preset and took GBP 2,700
 * out of a month, found hours later.
 *
 * THIS WAS `if (!LIVE)` AND A `--live` FLAG, described as "the deliberate
 * way past it, for reading real figures back. It still refuses every
 * write." Both halves were wrong, and on 2026-09-06 a `--live` sweep wrote
 * to the sheet on the strength of that sentence.
 *
 *   The flag turned the write guard OFF and nothing else refused a write.
 *   It was never needed for reads either: scratchOnly patches create,
 *   update, remove and removeMany, and touches no read path at all.
 *
 * So the flag is gone rather than fixed. Reads are always live because
 * they always were; writes are always confined to ZZTEST, which is what
 * every write scenario already targets.
 */
require('../v1/testing/scratchOnly').arm();

const fs = require('node:fs');
const path = require('node:path');
const { runAgent } = require('../v1/agent/runAgent');
// The agent's own rule for a group heard in a sentence, slips included.
const { groupsHeardIn } = require('../v1/agent/tools/notAGroup');

const CONTEXT = 'master-sheet';

// How much of a tool's own summary to echo. Enough to check a figure or a
// count against her reply, short enough that a transcript stays readable.
const TOOL_ECHO = 260;

// What `runAgent` puts above a recomputed block. A reply that opens with it
// is announcing a restatement, which is the right answer to "are those
// accurate?" and never a repeat worth flagging.
const LOOKED_AGAIN = 'I ran it again and it has not moved.';

// ===============================
// * The transcript, as the export writes it
// ===============================
//
// Same shape as the downloaded conversation, so a run here and a real
// session can be diffed against each other.
const c = {
  admin: '\x1b[36m', diane: '\x1b[32m', tool: '\x1b[90m',
  bad: '\x1b[31m', warn: '\x1b[33m', off: '\x1b[0m',
};

function turnsFrom(argv) {
  const sayAt = argv.indexOf('--say');
  if (sayAt !== -1) return argv.slice(sayAt + 1).filter((a) => !a.startsWith('--'));

  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) return [];
  return fs.readFileSync(path.resolve(file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * ONE TURN, with the client's own history handling.
 *
 * Every branch here mirrors a handler in AgentOverlay.jsx. When one of
 * those changes this has to change with it, which is the cost of testing
 * the real thing rather than a simplified one.
 */
async function turn(history, text, seen) {
  history.push({ role: 'user', content: text });
  console.log(`\n${c.admin}ADMIN:${c.off} ${text}`);

  const events = [];
  // PER TURN, because "she answered without looking" is a question about
  // one turn. A session total cannot tell you which turn had nothing.
  const thisTurn = [];
  // What each tool actually SAID this turn. The audit needs it: a figure is
  // only checkable against the text it was supposed to come from.
  const thisResults = [];
  let thisShape = null;
  const result = await runAgent(history, CONTEXT, (e) => {
    events.push(e);

    if (e.type === 'tool' && e.name) {
      console.log(`${c.tool}  · ${e.name}${c.off}`);
      seen.tools.push(e.name);
      thisTurn.push(e.name);
    }

    /**
     * ===============================
     * * WHAT THE TOOL ACTUALLY SAID, NOT JUST THAT IT RAN
     * ===============================
     * A run printed the tool NAMES and her reply, and nothing in between.
     * Asked to judge "INDIGO has 39 deals" against three filter calls, the
     * only evidence on screen was two list sizes, so a correct answer and
     * an invented one looked identical. The summaries are where every
     * count and figure she quotes comes from.
     */
    if (e.type === 'tool-result' && e.result) {
      const text = String(e.result.summary ?? e.result.say ?? e.result.reply ?? '')
        .replace(/\s+/g, ' ').trim();
      thisResults.push({ name: e.name, text, rows: e.result.rows?.length ?? e.result.list?.rows?.length ?? 0 });
      if (text) console.log(`${c.tool}    → ${text.slice(0, TOOL_ECHO)}${text.length > TOOL_ECHO ? '…' : ''}${c.off}`);
    }

    if (e.type === 'message' && e.text) {
      history.push({ role: 'assistant', content: e.text });
      console.log(`${c.diane}DIANE:${c.off} ${e.text}`);
    }

    // `name`, not `title`. Reading the wrong field logged four
    // "[showed undefined's deal]" lines and the audit then flagged them as
    // four repeated openings, which is a harness bug reported as hers.
    if (e.type === 'card' && e.card) {
      history.push({
        role: 'assistant',
        content: `[showed ${e.card.name}'s deal #${e.card.id}]`,
        card: e.card,
      });
      console.log(`${c.tool}  [card: ${e.card.name} #${e.card.id}]${c.off}`);
    }

    if (e.type === 'list' && e.list) {
      history.push({
        role: 'assistant',
        content: `[listed ${e.list.rows.length} deals: ${
          e.list.rows.map((r) => `#${r.id} ${r.name}`).join(', ')}]`,
        list: e.list,
      });
      console.log(`${c.tool}  [list: ${e.list.rows.length} deals]${c.off}`);
    }

    if (e.type === 'form' && e.form) {
      history.push({ role: 'assistant', content: `[${e.form.title} form shown]`, form: e.form });
      console.log(`${c.tool}  [form: ${e.form.title}]${c.off}`);
    }

    // PAUSED or DROPPED, said out loud rather than clicked. A pause keeps
    // the entry so the next turn can still find the draft; a cancel must
    // make it unfindable, or "start again" would resume the dead one.
    if (e.type === 'export-pause' || e.type === 'export-cancel') {
      const dropped = e.type === 'export-cancel';
      const at = history.map((m) => Boolean(m.exportSession) && !m.cancelled).lastIndexOf(true);
      if (at !== -1) {
        history[at] = dropped
          ? { role: 'assistant', content: '[export cancelled]', cancelled: true }
          : { ...history[at], paused: true };
      }
      console.log(`${c.tool}  [export ${dropped ? 'CANCELLED' : 'PAUSED'}]${c.off}`);
      seen.panels.push({ fileName: dropped ? 'cancelled' : 'paused', rows: null, hidden: [], build: false });
    }

    // THE EXPORT PANEL. Replaced in place, exactly as the overlay does, so
    // the open draft `runAgent` injects on the next turn is the right one.
    if (e.type === 'export-session' && e.session) {
      const { fileName, preview, draft, columns = [], build } = e.session;
      // The COUNT, not the list. Mirrors AgentOverlay's own line.
      const chosen = draft?.columnsTouched ? ', columns chosen by hand' : '';
      const line = `[export card: ${fileName}, ${preview?.rows ?? 0} rows, ${columns.length} columns${chosen}]`;
      const at = history.map((m) => Boolean(m.exportSession) && !m.cancelled).lastIndexOf(true);
      const entry = { role: 'assistant', content: line, exportSession: e.session };
      if (at === -1) history.push(entry); else history[at] = { ...history[at], ...entry };

      console.log(`${c.tool}  ${line}${build ? ' BUILT' : ''}${c.off}`);
      // THE TEMPLATE, not the filename. A filename carries the group too,
      // so narrowing BANK to NEXUS - BANK read as the document changing
      // shape when only the rows had. The shape is what the file IS.
      thisShape = draft.template;
      seen.panels.push({ fileName, rows: preview?.rows, hidden: draft.hiddenColumns ?? [], build });
    }
  });

  if (result.reply) {
    history.push({ role: 'assistant', content: result.reply });
    console.log(`${c.diane}DIANE:${c.off} ${result.reply}`);
  }
  seen.turns.push({
    said: text, reply: result.reply ?? '', tools: thisTurn, results: thisResults, shape: thisShape,
  });
  return { result, events };
}

// ===============================
// * What went wrong, said out loud
// ===============================
//
// Not assertions. These are the faults that have actually reached a live
// transcript, so a run reports them rather than leaving somebody to notice.
function audit(history, seen) {
  const found = [];

  // Her PROSE only. A run of cards is four bracketed placeholder lines and
  // they are not things she said, so comparing them found four repeats
  // that never happened.
  const prose = history
    .filter((m) => m.role === 'assistant' && !m.card && !m.list && !m.form && !m.exportSession)
    .map((m) => m.content ?? '');

  /**
   * ===============================
   * * A RESTATED FIGURE IS NOT A REPEATED OPENING
   * ===============================
   * This is about her VOICE: two replies in a row starting the same way
   * read as a machine. It is not about the figures, and it fired three
   * times on one run where every pair was legitimate: "milkman is owed GBP
   * 22…" asked twice in different words, and one where her own "I ran it
   * again and it has not moved" was doing exactly its job.
   *
   * A restatement that ANNOUNCES itself is the correct answer to "are those
   * accurate?", so it is skipped. Only an unannounced repeat is the fault.
   */
  const openings = prose
    .filter((line) => !line.startsWith(LOOKED_AGAIN))
    // A computed verdict opens the answer to a yes or no by rule, not by voice.
    .filter((line) => !/^(?:Yes|No|Partly)\./.test(line))
    .map((s) => s.split(/[,.!?\n]/)[0].trim().toLowerCase())
    .filter(Boolean);
  for (let i = 1; i < openings.length; i += 1) {
    if (openings[i] && openings[i] === openings[i - 1]) {
      found.push(`opened two replies the same way: "${openings[i]}"`);
    }
  }

  /**
   * A FACT ABOUT THE DATA, ASSERTED WITH NO TOOL CALL.
   *
   * Asked "are there any open concerns?" she answered "there are none"
   * without calling `list_concerns`. She happened to be right. Next time
   * the answer is whatever the model assumes, and it reads identical.
   */
  const NOTHING = /\b(there are no|there is no|nothing (has|is|was)|no open|none (are|is|of))\b/i;
  // `review`, `stopped` and `archive` added 2026-09-16: "X is not up for
  // review this month" is a claim about the sheet and she made it with no
  // tool call. It only tripped this at all because it said "deal".
  const ABOUT = /\b(concern|deal|row|person|people|company|companies|change|payment|invoice|review|stopped|archive)/i;
  for (const t of seen.turns) {
    if (t.tools.length > 0) continue;
    if (NOTHING.test(t.reply) && ABOUT.test(t.reply)) {
      found.push(`asserted a fact with NO tool call: "${t.reply.slice(0, 60)}…"`);
    }
  }

  /**
   * SHE SAID THE SCREEN CHANGED AND CALLED NOTHING.
   *
   * Checked PER TURN, because a session total lets a claim hide behind an
   * unrelated tool call two turns earlier. That is how "the sheet is
   * paused" and "the export was cancelled" both got through: five tools
   * ran that session, neither on the turn that mattered.
   */
  // AN ACT SHE PERFORMED, never a STATE she is reporting. "The panel is
  // closed now" is her reading the transcript, which is exactly right and
  // needs no tool; "it has been cancelled" is a claim that she did it.
  // Flagging the first made a correct answer look like the fault.
  const CLAIMED = new RegExp([
    'i (have |just )?(unchecked|hidden|removed|changed|updated|set|paused|parked|cancelled)',
    "i've (unchecked|hidden|removed|changed|updated|set|paused|parked|cancelled)",
    // "deleted" was missing, and that is how "the company has been deleted
    // and 3 deals are now without a company" got through having called
    // nothing at all, with the wrong count as well.
    '(has|have) been (paused|cancelled|dropped|built|hidden|removed|deleted|renamed|merged)',
    "(i|i've) (just )?(deleted|renamed|merged|undone|reverted)",
    'is now (paused|cancelled|parked|hidden)',
  ].join('|'), 'i');

  for (const t of seen.turns) {
    if (t.tools.length > 0) continue;
    if (CLAIMED.test(t.reply)) {
      found.push(`claimed the screen changed with NO tool call: "${t.reply.slice(0, 60)}…"`);
    }
  }

  // ASKED FOR A GO THEY HAD ALREADY GIVEN, which needs the ADMIN's previous
  // turn to judge. Flagging every "say go when you're ready" caught the
  // perfectly good one on the turn the panel opens, and a noisy audit is an
  // audit nobody reads.
  history.forEach((m, i) => {
    if (m.role !== 'assistant' || !/just say go|say go when/i.test(m.content ?? '')) return;
    const asked = [...history.slice(0, i)].reverse().find((p) => p.role === 'user');
    if (asked && /\b(go|export it|proceed|do it|build it)\b/i.test(asked.content)) {
      found.push('asked them to say go AFTER they said it');
    }
  });

  // THE DOCUMENT CHANGED UNDERNEATH THEM. A filename that switches shape
  // between panel updates without the admin asking for a different one.
  /**
   * THE DOCUMENT CHANGED WITHOUT THEM ASKING.
   *
   * Only when they did NOT name a shape that turn. Changing it because
   * they said "the bank sheet" is the feature; changing it while they
   * asked about columns is the fault, and flagging both made the check
   * fire on every ordinary session.
   */
  const SHAPE_WORDS = /\b(master|month|division|expensing|cash|bank|crypto|breakdown|sheet|export)\b/i;
  seen.turns.forEach((t, i) => {
    const prev = seen.turns[i - 1];
    if (!prev?.shape || !t.shape || t.shape === prev.shape) return;
    if (!SHAPE_WORDS.test(t.said)) {
      found.push(`the document changed shape without being asked: ${prev.shape} then ${t.shape}`);
    }
  });

  if (/awww/i.test(prose[0] ?? '')) found.push('opened the conversation with "Awww"');

  found.push(...turnFaults(seen.turns));
  return found;
}

/**
 * ***************************************************
 * * THE FAULTS A 30 TURN TRANSCRIPT ACTUALLY CONTAINED
 * ***************************************************
 *
 * Every one of these was in a run this file reported as "nothing flagged"
 * on 2026-09-07. A harness that prints faults and passes them is a harness
 * nobody can trust twice, so each incident becomes an assertion here.
 *
 * These are the LAST net. Each has a guard in the agent that should catch
 * it first; this exists for the day one of those guards stops firing, and
 * for the fault nobody has written a guard for yet.
 */

// A figure she stated. Deliberately not every digit: a bare "2 deals" is
// checked by the count rule, and a year is not money.
const MONEY = /\b(?:GBP|AED|EURO|EUR|USD|\$|£|€)\s?[\d,]+(?:\.\d+)?/i;
const MONEY_MONTH = /\bfor\s+(?:the\s+month\s+of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const ASKS_PAST = /\b(?:past|last|previous|earlier|ago|so far|did we|have we)\b/i;
const ASKS_RANK = /\b(?:who|which|whose)\b[\s\S]*\b(?:most|biggest|largest|highest|top|best)\b/i;
// What she says when she is naming something back as not existing.
const ABSENT = /\b(?:no group named|no company named|do(?:es)? not exist|there is no (?:group|company))\b/i;
const NAMED = /"([^"]{2,40})"|\b([A-Z][A-Z0-9 ]{2,30})\b/g;

const fold = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Names she reports as absent, so they can be checked against what was said. */
function namesCalledAbsent(reply) {
  if (!ABSENT.test(reply)) return [];
  const out = new Set();
  for (const m of String(reply).matchAll(NAMED)) {
    const name = (m[1] ?? m[2] ?? '').trim();
    if (name && !/^(NO|THE|AND|NOT|GBP|AED|EURO|USD)$/i.test(name)) out.add(name);
  }
  return [...out];
}

function turnFaults(turns = []) {
  const found = [];
  const short = (text) => String(text).replace(/\s+/g, ' ').slice(0, 70);

  turns.forEach((turn, index) => {
    const reply = String(turn.reply ?? '');
    const said = String(turn.said ?? '');
    const ran = turn.tools.length > 0;
    const toolText = (turn.results ?? []).map((r) => r.text).join(' ');

    // A FIGURE WITH NO TOOL CALL. The worst fault in the transcript: two
    // months of totals invented off the previous answer.
    if (!ran && MONEY.test(reply)) {
      found.push(`stated money with NO tool call: "${short(reply)}…"`);
    }
    // The same for a month, which can be a claim carrying no digits at all
    // ("owed nothing for October").
    if (!ran && MONEY_MONTH.test(reply)) {
      found.push(`answered FOR a month with no tool call: "${short(reply)}…"`);
    }

    // A NAME SHE WAS NEVER GIVEN, reported back as missing. "The groups
    // ALPHA, BETA and GAMMA do not exist on the sheet."
    for (const name of namesCalledAbsent(reply)) {
      if (!fold(said).includes(fold(name)) && !fold(toolText).includes(fold(name))) {
        found.push(`called "${name}" missing and nobody said it`);
      }
    }

    /**
     * A SCOPE NOBODY ASKED FOR. "For ALL GROUPS:" on a whole sheet question.
     *
     * Two false positives cost this its first run, and both are worth
     * keeping out: "For September 2026:" is a MONTH heading, not a scope,
     * and "For Gloria Difference, Zayn:" is several names of which the
     * admin said each in turn. So months are skipped and each name is
     * checked on its own, against the last few things they said.
     */
    const scope = /^For ([^:\n]{2,40}):/m.exec(reply)?.[1];
    const isMonth = scope && /^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}$/i.test(scope.trim());
    if (scope && !isMonth && scope !== 'the whole sheet') {
      // EVERY line they have said, not the last two. "his total" after
      // "zayn" three turns back is not an invented scope, and "nobody said
      // it" has to mean nobody, ever.
      const saidSoFar = turns.slice(0, index + 1).map((t) => t.said).join(' ');
      const heard = fold(saidSoFar);
      const unsaid = scope.split(',').map((name) => name.trim())
        .filter((name) => name && !heard.includes(fold(name)) && groupsHeardIn(saidSoFar, [name]).length === 0);
      if (unsaid.length > 0) found.push(`narrowed to "${unsaid.join(', ')}" and nobody said it`);
    }

    // NOTHING CONVERTS TO ZERO.
    if (/\bUSD 0\b/.test(reply)) found.push(`converted nothing to "USD 0": "${short(reply)}…"`);

    // A PAST QUESTION ANSWERED WITH A FUTURE YEAR.
    if (ASKS_PAST.test(said) && !/\bnext|coming|ahead|forecast\b/i.test(said)) {
      const years = [...reply.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
      const thisYear = new Date().getUTCFullYear();
      if (years.some((year) => year > thisYear)) {
        found.push(`answered a question about the PAST with ${Math.max(...years)}`);
      }
    }

    // A SUPERLATIVE WITH NOTHING TO RANK.
    if (ASKS_RANK.test(said) && MONEY.test(reply)
      && !(turn.results ?? []).some((r) => r.rows > 1)) {
      found.push(`answered "${short(said)}" with a figure and nothing ranked`);
    }

    // THE SAME ANSWER TWICE, word for word.
    const before = turns[index - 1]?.reply ?? '';
    if (reply && before && reply.trim() === before.trim()) {
      found.push(`repeated the previous answer word for word: "${short(reply)}…"`);
    }
  });

  return found;
}

(async () => {
  const turns = turnsFrom(process.argv.slice(2));
  if (turns.length === 0) {
    console.error('Give a scenario file or --say "your turn". See docs/run-it.md.');
    process.exit(1);
  }

  const history = [];
  const seen = { tools: [], panels: [], turns: [] };

  for (const text of turns) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await turn(history, text, seen);
    } catch (err) {
      console.error(`${c.bad}TURN FAILED:${c.off} ${err.message}`);
      break;
    }
  }

  const found = audit(history, seen);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${turns.length} turns · ${seen.tools.length} tool calls · ${seen.panels.length} panel updates`);
  if (seen.tools.length) console.log(`tools: ${[...new Set(seen.tools)].join(', ')}`);
  if (found.length === 0) {
    console.log('nothing flagged');
    process.exit(0);
  }
  console.log(`${c.warn}flagged:${c.off}`);
  for (const f of found) console.log(`  · ${f}`);
  // A NON ZERO EXIT. It printed the faults and exited 0, so a run could be
  // read as green while a transcript under it contained eleven of them.
  // Nothing that prints a fault may report success.
  process.exit(1);
})();
