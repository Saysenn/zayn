const reviewRepo = require('../../repos/monthlyReview.repo');
// Her answers refresh the pages as the page's own route does (v1/monthlyReview.js).
const { broadcast } = require('../../sockets/index');
const reviewed = (ids) => broadcast(null, 'master-sheet:changed', { action: 'reviewed', ids, via: 'agent' });
const { dueThisMonth, reviewReason, REVIEW_REASON } = require('../../shared/reviewQueue.helper');
const { currentMonth } = require('../../shared/presetMonth.helper');
// A day as words, without losing one to a timezone. See its banner.
const { dayText, monthText } = require('../../shared/dayText.helper');
// `fold` and `within` come from resolvePerson too, so the reach test below
// folds names exactly the way the resolver does. Two spellings of one rule
// is how a guard stops matching what it guards.
const { resolvePerson, fold, within } = require('./resolvePerson');
const { confirmFirst } = require('./confirmFirst');
const peopleRepo = require('../../repos/people.repo');
const { scopeArgs } = require('../resolveRequest');

/**
 * ***************************************************
 * * Diane answers the monthly review
 * ***************************************************
 *
 * ITS OWN FILE, never folded into tools/masterSheet.js. That file is
 * already thousands of lines, and a tool that can stop paying six people
 * buried in it is a tool nobody can find or test on its own.
 *
 * THREE TOOLS, ONE JOB EACH, and deliberately not one tool with a mode: a
 * single tool that answers one deal or forty depending on an argument is
 * one mistyped argument away from the wrong one, and the two need
 * different guards.
 *
 * THE SAME ROUTE THE PANEL USES, through the same repo. A second way to
 * write an answer is a second place for the rule to live, and this one
 * sets `stopped_on`. See docs/closure.md section 5.
 */

// The three answers, and what each one MEANS in the sentence she says back.
// The set itself is the repo's; this is only the wording.
const ANSWER_MEANS = {
  yes: 'still running, and it will be asked about again next month',
  final: 'paid in full this month, then it stops at the end of the month',
  no: 'already over, so it stops at the end of last month',
};

const { money, sumByCurrency, moneyPerCurrency } = require('../../shared/money.helper');

/**
 * ===============================
 * * WHICH PERSON, AND THE MISS THAT LOOKS LIKE AMBIGUITY
 * ===============================
 * Written once, because all three tools need it and the third copy is
 * where a guard gets dropped.
 *
 * THE POOL IS NARROWED BEFORE resolvePerson SEES IT, and that is the whole
 * trick. Every other caller hands it the result of `searchFuzzy`, which has
 * already dropped everyone the name does not reach. These tools hand it a
 * QUEUE, so a name nobody has fell through to "the whole list" and came
 * back `ambiguous` with two strangers' names in it: asked to mark Nathan
 * no, she would have said "Nathan matches 2 different people: Gloria;
 * Paddy", which is a question with no answer, and a bulk no one keystroke
 * away from stopping both of them.
 *
 * So the reach test happens here, in memory, the same two rules
 * resolvePerson itself uses: a prefix of the name, or a typo of it.
 *
 * @returns {{ rows: object[] } | { refusal: object }} empty rows is a MISS
 */
function reaches(row, wanted) {
  const name = fold(row.person_name);
  return name.startsWith(wanted) || wanted.startsWith(name) || within(name, wanted, TYPO_SLACK);
}

// The same rule resolvePerson uses: slack only on a name long enough that
// one letter cannot be a different person. "Zane" and "Zayn" are two people.
const TYPO_SLACK = 2;

/**
 * ===============================
 * * A SCOPE HIDING INSIDE THE NAME
 * ===============================
 * Live 2026-09-18, twice in one run: "gary kp done" arrived as person
 * "Gary KP", and "nathan kryptonia keep running" as person "Nathan
 * Kryptonia". The second is the dangerous one. There is no Nathan at
 * Kryptonia, so the scope was IGNORED and the name alone resolved to
 * Nathan on a completely different company in INDIGO, which the tool then
 * tried to write. Only `scratchOnly` stopped it.
 *
 * She has now put the scope in the wrong place three different ways, so
 * the schema is what is wrong. This reads a TRAILING run of words off the
 * name and, only when it exactly matches a company or a group ALREADY IN
 * THE POOL, treats it as the scope. Longest run first, so "Milkman Ltd"
 * beats "Milkman".
 *
 * IT CANNOT INVENT A SCOPE: the words have to match something in the queue
 * in front of it. A surname that happens to be a real company narrows to
 * that company, which is where that person's deal is anyway.
 */
function splitScopeFromName(name, pool) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { person: name, scope: null };
  const scopes = [...new Set(pool.flatMap((r) => [r.company, r.group_name].filter(Boolean)))];
  for (let take = words.length - 1; take >= 1; take -= 1) {
    const tail = words.slice(words.length - take).join(' ');
    const hit = scopes.find((s) => fold(s) === fold(tail));
    if (hit) return { person: words.slice(0, words.length - take).join(' '), scope: hit };
  }
  return { person: name, scope: null };
}

function narrowToPerson(rows, rawName, said, tail) {
  // The scope first, or a name carrying one resolves against the whole
  // queue and lands on a stranger.
  const split = splitScopeFromName(rawName, rows);
  const name = split.person;
  const pooled = split.scope
    ? rows.filter((r) => fold(r.company) === fold(split.scope) || fold(r.group_name) === fold(split.scope))
    : rows;
  return resolveWithin(pooled, name, said, tail);
}

function resolveWithin(rows, name, said, tail) {
  const wanted = fold(name);
  const pool = wanted ? rows.filter((row) => reaches(row, wanted)) : rows;
  if (pool.length === 0) return { rows: [] };

  const picked = resolvePerson(pool, name, said);
  if (picked.ambiguous) {
    return {
      refusal: {
        summary: `"${name}" matches ${picked.names.length} different people: `
          + `${picked.names.join('; ')}. ${tail}`,
        ambiguous: true,
      },
    };
  }
  return { rows: picked.rows };
}

/**
 * ===============================
 * * THE DATES COME FROM THE SERVER'S CLOCK, NEVER FROM HER
 * ===============================
 * Live transcript, 2026-09-16: asked when "final" would stop ZZ Paddy she
 * answered "the end of August" in SEPTEMBER, with no tool call. A wrong
 * date about money, stated confidently, from her own idea of the month.
 *
 * So the queue says both dates every time it is read. There is no other
 * tool to ask, and a question the tools cannot answer is a question she
 * answers from memory.
 */
function stopDates(period) {
  return `Final stops on ${dayText(reviewRepo.STOPS_AT.final(period))}. `
    + `No stops on ${dayText(reviewRepo.STOPS_AT.no(period))}.`;
}

/**
 * WHY A BLOCK IS IN THE QUEUE, said once for the whole company.
 *
 * Two things put a deal here, and a deal whose end date is months away is
 * here only because its company is winding down. Unsaid, she would read a
 * FUTURE date out as if it had passed.
 */
function whyHere(row) {
  const when = dayText(row.end_on);
  /**
   * HIS OWN WORD FIRST, because it is the most specific answer there is.
   * "Reviewed monthly" on the deal is him asking for this row by name; a
   * company in liquidation is a fact about the company, and a passed end
   * date is a fact about a date. Said in that order, the block header
   * tells somebody WHY they are being asked rather than implying a
   * deadline nobody set.
   */
  // THE ORDER IS shared/reviewQueue.helper's, not this file's. The sign-in
  // briefing splits the queue by the same three reasons, and two places
  // deciding which one wins is two answers to "why am I being asked".
  const reason = reviewReason(row);
  if (reason === REVIEW_REASON.LIQUIDATION) {
    return when ? `in liquidation, ends ${when}` : 'in liquidation, no end date';
  }
  /**
   * HIS OWN WORD FIRST when there is one. "Reviewed monthly" on the deal is
   * him asking for this row by name, which is a better answer than either
   * the company's status or a date: it says WHO asked.
   */
  if (reason === REVIEW_REASON.REVIEW) {
    if (row.end_note) return `his sheet says "${row.end_note}"`;
    return when ? `marked for review, ends ${when}` : 'marked for review';
  }
  return when ? `ended ${when}` : 'no end date';
}

/** One person under their company. The company and the date are above. */
function personLine(row) {
  const answered = row.answer ? `, answered ${row.answer}` : '';
  return `   ${row.person_name ?? '(no handler)'}, ${row.role_label}, `
    + `${row.currency ?? 'GBP'} ${money(row.monthly_amount)}${answered}`;
}

/**
 * The queue as numbered blocks, one per company.
 *
 * ORDER IS THE REPO'S, unanswered first: the work leads, and grouping must
 * not reshuffle it. A company takes the position of its first deal.
 */
function groupedLines(rows, from = 0) {
  /**
   * ===============================
   * * A COMPANY IS A COMPANY IN A GROUP, NEVER A BARE NAME
   * ===============================
   * This grouped on the company name alone, so one person holding four
   * Workforce deals across four groups printed FOUR IDENTICAL LINES:
   *
   *   Workforce, ended 1 Jan 2026
   *      Gloria, Closer, GBP 500.00
   *      Gloria, Closer, GBP 500.00      <- and two more
   *
   * Nothing on screen told them apart, so nobody could point at one, and
   * "gloria workforce" could not resolve to a single deal either. The
   * identity rule the rest of the CRM uses (`companyKeySql`) was the one
   * thing this list was not following.
   */
  const byCompany = new Map();
  for (const row of rows) {
    const key = `${row.company || row.group_name}|${row.group_name ?? ''}|${whyHere(row)}`;
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(row);
  }

  const out = [];
  // CONTINUOUS ACROSS THE HEADINGS, so "number 4" means one block. Three
  // sections each restarting at 1 gives three blocks called 1.
  let n = from;
  for (const [key, people] of byCompany) {
    n += 1;
    const [where, group, why] = key.split('|');
    // The group is dropped only when it IS the heading, which happens on a
    // row with no company at all.
    const scope = group && group !== where ? `${where}, ${group}` : where;
    out.push(`${n}. ${scope}, ${why}`);
    for (const row of people) out.push(personLine(row));
    out.push('');
  }
  // The trailing blank is a separator between blocks, not a line.
  if (out.at(-1) === '') out.pop();
  return out;
}

/**
 * ===============================
 * * AND THE BLOCKS SIT UNDER THE THREE REASONS
 * ===============================
 * His call 2026-09-21. Thirty deals in one list is one answer about three
 * different situations: a company winding down, a deal past its year and a
 * deal somebody asked for. Read as one run they are indistinguishable, and
 * the three need different answers.
 *
 * THE ORDER IS shared/reviewQueue.helper's, not this file's. The panel's
 * tabs and the sign-in briefing split the same queue the same way, and
 * three places deciding what a row IS is three answers.
 *
 * A HEADING WITH NOTHING UNDER IT IS NOT PRINTED. An empty "Liquidation"
 * says a company is winding down when none is.
 */
const REASON_HEADING = Object.freeze({
  [REVIEW_REASON.LIQUIDATION]: 'Liquidation',
  [REVIEW_REASON.REVIEW]: 'Marked for review',
  [REVIEW_REASON.PAST_END]: 'Past a year',
});

function groupedByReason(rows) {
  const out = [];
  let numbered = 0;
  for (const [reason, heading] of Object.entries(REASON_HEADING)) {
    const mine = rows.filter((row) => reviewReason(row) === reason);
    if (mine.length === 0) continue;
    if (out.length) out.push('');
    out.push(`${heading} (${mine.length})`);
    const block = groupedLines(mine, numbered);
    // The numbers are the blocks, not the deals: a block is a company in a
    // group, and its people sit under it unnumbered.
    numbered += block.filter((line) => /^\d+\. /.test(line)).length;
    out.push(...block);
  }
  return out;
}

/**
 * ===============================
 * * THE QUEUE. READ ONLY, and it needs no guard beyond that.
 * ===============================
 * It hands back the FINISHED SENTENCE, because a tool that computes a
 * figure hands back the finished sentence: the count and the money are
 * both things she has previously restated wrongly from raw rows.
 */
const listMonthlyReview = {
  name: 'list_monthly_review',
  description:
    'The deals the CRM is asking about this month: past their end date, not stopped, and whether each '
    + 'has been answered yet. Use this for any question about what needs reviewing, what is still '
    + 'unanswered, or whether a named deal is up for review. Read only, it changes nothing.',
  parameters: {
    type: 'object',
    properties: {
      person: { type: 'string', description: 'Narrow to one person, exactly as the admin wrote the name.' },
      group: { type: 'string' },
      company: { type: 'string' },
      onlyUnanswered: {
        type: 'boolean',
        description: 'True for just the work outstanding. Default false, which shows answered ones too.',
      },
    },
  },
  async handler(args = {}) {
    const period = currentMonth();
    /**
     * THE SCOPE IS FILTERED HERE, NOT IN SQL, and against BOTH columns.
     *
     * Live 2026-09-18: "gloria workforce ended" put Workforce in `group`,
     * which matches no group, so the query came back empty and the empty
     * branch below reported "everything for Gloria has been answered".
     * Four of her deals were unanswered. A wrong fact about somebody's
     * money, produced by her guessing which field a word belonged in.
     *
     * A scope word matches a company OR a group, the same way `entries`
     * resolves one. `unscoped` is kept so an empty result can tell a miss
     * apart from a finished queue.
     */
    const unscoped = await dueThisMonth(period, {
      answered: args.onlyUnanswered === true ? false : undefined,
    });
    const named = [args.group, args.company].filter(Boolean);
    const rows = named.reduce((pool, value) => pool.filter(
      (r) => fold(r.company) === fold(value) || fold(r.group_name) === fold(value),
    ), unscoped);

    // A SCOPE THAT MATCHED NOTHING IS NOT A FINISHED QUEUE. Saying it was
    // answered is the kind of zero that reads as a fact about the business.
    if (rows.length === 0 && named.length > 0 && unscoped.length > 0) {
      return {
        summary: `Nothing up for review this month is on ${named.join(' or ')}, so that name `
          + 'reaches no deal at all. It is not that they have been answered. Check the spelling, '
          + `or ask without it: ${unscoped.length} deals are up for review across the sheet.`,
      };
    }

    // The person filter is applied HERE, not in SQL, because it has to go
    // through resolvePerson: she cannot guess which person, and a LIKE in
    // the query would quietly pick one.
    let selected = rows;
    if (args.person) {
      const picked = narrowToPerson(
        rows, args.person, args.said, 'Ask which one before answering anything.',
      );
      if (picked.refusal) return picked.refusal;
      selected = picked.rows;
    }

    if (selected.length === 0) {
      /**
       * ===============================
       * * "NOTHING IS UP FOR REVIEW" AND "IT IS ALL ANSWERED" ARE NOT THE
       * * SAME FACT
       * ===============================
       * Live 2026-09-17: asked what was up for review in a group whose
       * three deals were all answered, she said "nothing is up for review
       * for ZZTEST". Three deals WERE up for review. They had answers.
       *
       * `onlyUnanswered` is what she asks with, so an empty result under
       * it means the work is done, not that the question was never asked.
       * Saying the wrong one leaves somebody believing a group has nothing
       * past its end date at all.
       */
      const scope = args.person || args.company || args.group;
      const where = scope ? ` for ${scope}` : '';
      const reply = args.onlyUnanswered === true
        ? `Everything up for review${where} has been answered this month.`
        : `Nothing is up for review${where} this month. `
          + 'A deal joins the list once its end date has passed, or its company starts winding down.';
      return { summary: reply, reply, computedReply: true };
    }

    const unanswered = selected.filter((row) => !row.answer);
    // THE MONEY, because the count alone is a nudge and the money is the
    // reason the question is being asked at all. Per currency, never one sum.
    const headline = `${unanswered.length} of ${selected.length} unanswered for `
      + `${monthText(period) ?? period}, ${moneyPerCurrency(sumByCurrency(unanswered, 'monthly_amount'))} a month.`;

    /**
     * ===============================
     * * GROUPED BY COMPANY, NUMBERED, AND NOT CUT
     * ===============================
     * It was one long sentence per deal, thirty six of them, each repeating
     * the company and the end date. Reported 2026-09-17: hard to read, and
     * a UI that then hid half of it behind "Show all 14 lines" cut the same
     * answer twice.
     *
     * THE GROUPING IS WHAT MAKES IT SHORT, not a cap. A company and its end
     * date are one fact about every deal on it, so they are said ONCE and
     * the people sit under them. Thirty six lines becomes about twelve
     * blocks, with nothing left out.
     *
     * So MAX_LISTED is gone. It existed because the old shape was a wall.
     */
    const full = [headline, stopDates(period), '', ...groupedByReason(selected)].join('\n');

    /**
     * DRAWN, in the sheet check's format (his call 2026-09-30): a section per
     * reason and one aligned row per deal. The bubble keeps the headline and
     * the stop dates; the card carries the rows, and she reads them all aloud.
     */
    const sections = Object.entries(REASON_HEADING)
      .map(([reason, label]) => ({ label, rows: selected.filter((row) => reviewReason(row) === reason) }))
      .filter((s) => s.rows.length > 0)
      .map(({ label, rows: mine }) => ({
        label,
        count: mine.length,
        rows: mine.map((row) => ({
          id: row.id,
          name: row.person_name ?? '(no handler)',
          where: [row.group_name, row.company].filter(Boolean).join(' · '),
          detail: [
            row.role_label,
            `${row.currency ?? 'GBP'} ${money(row.monthly_amount)}`,
            row.answer ? `answered ${row.answer}` : 'unanswered',
            whyHere(row),
          ].filter(Boolean).join(' · '),
          answered: Boolean(row.answer),
        })),
      }));

    return {
      summary: full,
      reply: `${headline}\n${stopDates(period)}`,
      computedReply: true,
      list: {
        kind: 'review',
        title: headline,
        note: stopDates(period),
        sections,
        rows: sections.flatMap((s) => s.rows),
      },
      period,
      // EVERY id, not just the listed ones. The cut is about what is worth
      // reading aloud, never about what the answer covers.
      dealIds: selected.map((row) => row.id),
    };
  },
};

/**
 * ===============================
 * * ONE DEAL, ONE ANSWER
 * ===============================
 * `resolvePerson` because she cannot guess which person, and the queue is
 * exactly where a wrong guess stops somebody's income.
 *
 * NO confirmFirst HERE, and that is a decision: this reaches one deal, she
 * has to name it, and the two call shape on a single named row is a round
 * trip that trains everyone to say yes without reading. The bulk tool below
 * is the one that cascades.
 */
const answerMonthlyReview = {
  name: 'answer_monthly_review',
  // IT CAN STOP A DEAL, so she may say one was stopped. See checkClaimedWrite.js.
  stops: true,
  writes: true,
  description:
    'Answer the monthly review for ONE deal. "yes" keeps it running, "final" pays it this month then '
    + 'stops it at the end of the month, "no" stops it at the end of last month. Only works on a deal '
    + 'that is actually up for review this month.',
  parameters: {
    type: 'object',
    properties: {
      person: { type: 'string', description: 'Whose deal, exactly as the admin wrote the name.' },
      company: { type: 'string', description: 'Which company, when the person holds more than one.' },
      /**
       * ONE COMPANY CAN BE FOUR DEALS. A person holding the same company
       * in four groups was unreachable: this tool refused at two deals and
       * the bulk tool answered all four. A refusal with no exit.
       */
      group: { type: 'string', description: 'Which group, when the person holds the same company in more than one.' },
      answer: { type: 'string', enum: ['yes', 'final', 'no'] },
    },
    required: ['person', 'answer'],
  },
  async handler(rawAnswerArgs = {}) {
    // READ THE REQUEST FIRST, like every other door. An answer here writes
    // `stopped_on`, so reaching the wrong deal stops the wrong pay.
    const args = await scopeArgs(rawAnswerArgs, peopleRepo);
    const period = currentMonth();
    /**
     * THEIR OWN WORDS, THE SAME LIST THE BULK TOOL READS. "Ended" was an
     * answer to one tool and not an answer to the other, so the same
     * sentence worked or was refused depending on which she reached for.
     * One vocabulary, `ANSWER_WORDS`.
     */
    const answer = readAnswer(args.answer);
    if (!answer) {
      return { summary: `"${args.answer}" is not an answer. It is yes, final or no.` };
    }

    /**
     * ===============================
     * * THE SCOPE IS NARROWED HERE, AGAINST BOTH COLUMNS
     * ===============================
     * Live 2026-09-18, the third time this shape has bitten: "Gloria at
     * Workforce in MILKMAN final" filtered in SQL by exact column, matched
     * nothing, and she reported "Gloria has nothing up for review this
     * month". Gloria had FOUR. A false statement about somebody's money,
     * produced by the tool punishing her for putting a word in the field
     * it did not expect.
     *
     * `unscoped` is kept so a miss can be told from a finished queue.
     */
    const unscoped = await dueThisMonth(period, {});
    const named = [args.company, args.group].filter(Boolean);
    const rows = named.reduce((pool, value) => pool.filter(
      (r) => fold(r.company) === fold(value) || fold(r.group_name) === fold(value),
    ), unscoped);

    const picked = narrowToPerson(
      rows, args.person, args.said, 'Ask which one. Do not answer for any of them yet.',
    );
    if (picked.refusal) return picked.refusal;
    const found = picked.rows;
    if (found.length === 0) {
      // A SCOPE THAT MISSED IS NOT AN EMPTY QUEUE. Check the wider list
      // before saying they have nothing: the two read identically to the
      // admin and only one of them is true.
      const anywhere = narrowToPerson(unscoped, args.person, args.said, '');
      if (named.length > 0 && !anywhere.refusal && anywhere.rows.length > 0) {
        const where = anywhere.rows.map((r) => [r.company, r.group_name].filter(Boolean).join(' in '));
        return {
          summary: `NOTHING HAS BEEN CHANGED. ${args.person} has no deal on `
            + `${named.join(' or ')} that is up for review, but they DO have `
            + `${anywhere.rows.length}: ${where.join('; ')}. Ask which of those they meant.`,
          ambiguous: true,
        };
      }
      return {
        summary: `${args.person} has nothing up for review this month, so there is nothing to answer. `
          + 'Only deals past their end date are asked about. Say that, and do not claim to have changed anything.',
      };
    }
    /**
     * SEVERAL OF THEIR DEALS NAMED IN ONE MESSAGE IS THE BULK ACT, turned back BEFORE
     * the first write. Caught only on the second call, "keep B running, C final" had
     * already written B, so the two could never be one act. 2026-09-28.
     */
    if (!(args.turn?.reviewed?.size > 0)) {
      const theirs = narrowToPerson(unscoped, args.person, args.said, '').rows ?? [];
      // Their last two messages: on "yes" the deals were named one message back. 2026-09-28.
      const saidFold = fold(args.saidRecent ?? args.said);
      // DIFFERENT COMPANIES, not rows: one company in four groups is named once.
      const namedCompanies = [...new Set(theirs
        .filter((r) => fold(r.company).length >= 3 && saidFold.includes(fold(r.company)))
        .map((r) => r.company))];
      if (namedCompanies.length >= 2) {
        return {
          summary: `NOTHING HAS BEEN CHANGED. That message answers for several of `
            + `${args.person}'s deals (${namedCompanies.join(', ')}), so it is ONE act: `
            + 'call bulk_answer_monthly_review with `entries`, one entry per deal with the answer they '
            + 'gave for it, so it is confirmed and written together.',
        };
      }
    }
    // ONE PERSON CAN STILL BE SEVERAL DEALS. Answering all of them off one
    // unqualified name is the bulk act wearing the single tool's face, so
    // it asks which company instead.
    if (found.length > 1) {
      // COMPANY AND GROUP, because the same company in four groups is four
      // deals and naming the company alone cannot separate them. Without
      // the group this listed one name four times and offered no way out.
      const where = found.map((row) => [row.company, row.group_name].filter(Boolean).join(' in '));
      return {
        summary: `${args.person} has ${found.length} deals up for review: ${where.join('; ')}. `
          + 'Ask which one, naming the company AND the group, or use the bulk tool if they '
          + 'meant all of them.',
        ambiguous: true,
      };
    }

    const deal = found[0];

    /**
     * ===============================
     * * A SECOND ANSWER IN ONE TURN IS ONE ACT, NOT TWO
     * ===============================
     * Live 2026-09-18: "Gloria at Workforce in MILKMAN final, Gloria at
     * Workforce in NEXUS ended" was answered with TWO calls to this tool.
     * That is two writes, two chances to stop half way, and nothing to
     * undo as one act, on the queue where a wrong answer stops somebody's
     * income.
     *
     * `entries` exists for exactly this and she went past it. A DESCRIPTION
     * IS NOT A ROUTE, so the second one is turned back with the tool that
     * does the lot. Same shape as `secondPersonInTurn` on the master sheet.
     */
    const already = args.turn?.reviewed;
    if (already?.size > 0 && !already.has(deal.id)) {
      const first = [...already.values()][0];
      return {
        summary: 'NOTHING HAS BEEN CHANGED on this deal. That message answers for MORE THAN ONE '
          + `deal (${first.person} on ${first.where}, and now ${deal.person_name} on `
          + `${deal.company || deal.group_name}), and this tool does one at a time.\n\n`
          + 'Call bulk_answer_monthly_review with `entries` instead, ONE ENTRY PER INSTRUCTION, '
          + 'including the one already written above. It previews every deal, takes one '
          + 'confirmation and undoes as a single act.',
      };
    }

    const { stoppedOn } = await reviewRepo.answerOne(deal.id, period, answer, 'diane');
    reviewed([deal.id]);
    if (args.turn) {
      args.turn.reviewed = args.turn.reviewed ?? new Map();
      args.turn.reviewed.set(deal.id, {
        person: deal.person_name, where: deal.company || deal.group_name,
      });
    }
    const stops = stoppedOn
      ? ` It stops on ${stoppedOn} and moves to the Archive.`
      : ' Nothing was stopped.';
    const reply = `${deal.person_name} on ${deal.company || deal.group_name}: answered `
      + `${answer}, ${ANSWER_MEANS[answer]}.${stops}`;

    return { summary: reply, reply, computedReply: true, dealId: deal.id, stoppedOn };
  },
};

/**
 * ===============================
 * * ONE ANSWER ACROSS MANY, AND THE TWO CALL SHAPE IS MANDATORY
 * ===============================
 * A bulk No STOPS PAYING REAL PEOPLE. "Always confirm first" in a
 * description is not a guard: asked to rename a company she asked "shall I
 * go ahead?", was never answered, and on the next turn described the change
 * as done. That is the incident `confirmFirst` exists for.
 *
 * SHE CANNOT ANSWER FOR A DEAL THAT IS NOT IN THE QUEUE. The scope is built
 * from the queue itself rather than from the sheet, so "mark them all no"
 * physically cannot reach a deal nobody was being asked about.
 */
const bulkAnswerMonthlyReview = {
  name: 'bulk_answer_monthly_review',
  // IT CAN STOP A DEAL, so she may say one was stopped. See checkClaimedWrite.js.
  stops: true,
  writes: true,
  description:
    'Answer the monthly review the SAME way for every deal in a named scope: a group, a company, one '
    + 'person with several deals, or everything unanswered. Always call with confirmed false first, '
    + 'say what it would do and the count, and only call again with confirmed true once they agree.',
  parameters: {
    type: 'object',
    properties: {
      answer: { type: 'string', enum: ['yes', 'final', 'no'] },
      group: { type: 'string' },
      company: { type: 'string' },
      person: { type: 'string' },
      everything: {
        type: 'boolean',
        description: 'True only when they asked for every unanswered deal with no scope at all.',
      },
      /**
       * ONE MESSAGE, DIFFERENT ANSWERS. Use this whenever the admin gives
       * more than one instruction, whatever the scopes are.
       */
      entries: {
        type: 'array',
        description: 'One per instruction they gave. "Alex Example ALPHA final, Blake Example Northstar Care ended" is TWO entries. Use this instead of calling the tool twice.',
        items: {
          type: 'object',
          properties: {
            answer: { type: 'string', description: 'yes, final or no. Their own word is fine: continue, ongoing, ended, stop, done.' },
            /**
             * SPLIT THE PHRASE. "Zayn milkman final" is a NAME and a SCOPE,
             * and putting the whole thing in `person` costs a round trip
             * while she asks which of his deals was meant.
             */
            person: { type: 'string', description: 'The PERSON ONLY, exactly as they wrote it. Never the company or group as well: "Alex Example ALPHA" is person "Alex Example" and scope "ALPHA", two fields.' },
            company: { type: 'string', description: 'A company OR a group name. Either field accepts either kind, so put the scope word here when you are not sure which it is.' },
            group: { type: 'string', description: 'A group OR a company name. Either field accepts either kind.' },
            dealId: { type: 'integer', description: 'Only when a row id came back from a search in this same conversation.' },
          },
          required: ['answer'],
        },
      },
      confirmed: {
        type: 'boolean',
        description: 'False on the first call, which changes nothing. True only after they said yes.',
      },
    },
  },
  async handler(args = {}) {
    const period = currentMonth();
    if (Array.isArray(args.entries) && args.entries.length > 0) {
      return answerEntries(args, period);
    }
    if (!args.answer) {
      return {
        summary: 'No answer and no entries were given, so there is nothing to do. '
          + 'Ask what they want set, and on which deals.',
      };
    }
    if (!reviewRepo.ANSWERS.includes(args.answer)) {
      return { summary: `"${args.answer}" is not an answer. It is yes, final or no.` };
    }

    const scoped = Boolean(args.group || args.company || args.person);
    if (!scoped && args.everything !== true) {
      return {
        summary: 'That would answer every unanswered deal on the sheet and no scope was given. '
          + 'Ask which group, company or person they meant.',
      };
    }

    // Only the UNANSWERED. Re-answering a decision somebody already made,
    // because a wider word swept it up, is the surprise a bulk act must
    // never contain.
    const rows = await dueThisMonth(period, {
      group: args.group || undefined,
      company: args.company || undefined,
      answered: false,
    });

    let selected = rows;
    if (args.person) {
      const picked = narrowToPerson(
        rows, args.person, args.said, 'Ask which one. Nothing has been changed.',
      );
      if (picked.refusal) return picked.refusal;
      selected = picked.rows;
    }

    /**
     * ===============================
     * * ONE NAMED PERSON IS NOT A BULK ACT
     * ===============================
     * Live transcript, 2026-09-16: "ZZ Gloria is still going, mark it yes"
     * and she reached for THIS tool, which previewed FOUR deals. Had the
     * admin said yes to a sentence about one person, four would have been
     * answered.
     *
     * The prompt already said one deal is the other tool. PROMPTING IS NOT
     * A GUARD, so this refuses instead, and it is the exact mirror of the
     * single tool refusing when a name reaches two deals.
     */
    if (args.person && selected.length === 1 && !args.group && !args.company) {
      const deal = selected[0];
      return {
        summary: `${args.person} has ONE deal up for review, on `
          + `${deal.company || deal.group_name}. That is answer_monthly_review, not this one. `
          + 'Nothing has been changed. Call that tool instead.',
      };
    }

    if (selected.length === 0) {
      const scope = args.person || args.company || args.group || 'the sheet';
      return {
        summary: `Nothing is unanswered for ${scope} this month, so there is nothing to change. `
          + 'Say that, and do not report anything as done.',
      };
    }

    const total = moneyPerCurrency(sumByCurrency(selected, 'monthly_amount'));
    const pending = confirmFirst(args.confirmed, {
      act: `answer "${args.answer}" for every unanswered deal in that scope, `
        + `${total} a month between them, which means each one is ${ANSWER_MEANS[args.answer]}`,
      count: selected.length,
      noun: 'deal',
      keeps: args.answer === 'yes'
        ? 'Nothing stops: they stay on the master sheet and are asked again next month.'
        : 'The rows are kept and move to the Archive, with every month already paid untouched.',
    });
    if (pending) return pending;

    const stopped = [];
    for (const row of selected) {
      const { stoppedOn } = await reviewRepo.answerOne(row.id, period, args.answer, 'diane');
      if (stoppedOn) stopped.push({ name: row.person_name, on: stoppedOn });
    }
    reviewed(selected.map((row) => row.id));

    // THE COUNT IS THE SURPRISE, and so is what it stopped. Reporting "done"
    // without either is the shape of answer that hides a mistake.
    const headline = `Answered ${args.answer} for ${selected.length} `
      + `${selected.length === 1 ? 'deal' : 'deals'}, ${total} a month between them.`;
    const dates = [...new Set(stopped.map((item) => item.on))];
    const tail = stopped.length === 0
      ? 'Nothing was stopped.'
      : `${stopped.length} stop on ${dates.join(' and ')} and move to the Archive.`;
    const reply = `${headline} ${tail}`;

    return {
      summary: reply,
      reply,
      computedReply: true,
      answered: selected.map((row) => row.id),
      stopped,
    };
  },
};

/**
 * ***************************************************
 * * ONE MESSAGE, MANY SCOPES, DIFFERENT ANSWERS
 * ***************************************************
 *
 * The review is dictated, not clicked:
 *
 *   zayn milkman final
 *   zayn indigo continue
 *   paddy workforce ended
 *   close everything in manbat
 *
 * Every scope already existed and every ANSWER was one value across all of
 * them, so that message was four separate calls, four confirmations, four
 * chances to stop half way and nothing to undo as one act. Same shape
 * `perPerson` closed on the master sheet, except the entry is keyed on the
 * DEAL: one person can want different answers in two groups.
 *
 * SHE NEVER CLASSIFIES THE SCOPE. The fields she fills in ARE the scope.
 *
 * ---- and she takes her time ----
 * Every fragment is resolved against the queue in ONE pass before anything
 * is shown, so the admin sees the whole picture once instead of being sent
 * back for one correction at a time.
 */

// The words the admin actually says, mapped to the three stored answers.
// Hers to interpret; this exists so a value that is nearly right is
// refused by name rather than written.
const ANSWER_WORDS = Object.freeze({
  yes: 'yes', continue: 'yes', ongoing: 'yes', keep: 'yes', running: 'yes',
  final: 'final', last: 'final',
  no: 'no', ended: 'no', end: 'no', stop: 'no', stopped: 'no', done: 'no', close: 'no',
});

function readAnswer(raw) {
  const word = fold(raw);
  return ANSWER_WORDS[word] ?? (reviewRepo.ANSWERS.includes(word) ? word : null);
}

/** Person, company, group and role, so two deals never read the same. */
function dealLine(row, verdict) {
  const who = row.person_name ?? '(no handler)';
  const where = [row.company, row.group_name].filter(Boolean).join(', ');
  const money$ = `${row.currency ?? 'GBP'} ${money(row.monthly_amount)}`;
  return `   ${who}, ${where}, ${row.role_label ?? 'no role'}, ${money$}   ${verdict}`;
}

/**
 * One entry, resolved against the queue.
 *
 * Nothing here reads the master sheet. The scope is built FROM the queue,
 * so a wide word physically cannot reach a deal nobody was being asked
 * about.
 */
function resolveEntry(entry, unanswered, said) {
  let pool = unanswered;
  if (entry.dealId != null) pool = pool.filter((r) => r.id === Number(entry.dealId));
  /**
   * ===============================
   * * A SCOPE WORD IS TRIED AS BOTH, BECAUSE SHE SHOULD NOT HAVE TO CLASSIFY
   * ===============================
   * Live 2026-09-18: "zayn milkman final" arrived as company "Milkman".
   * MILKMAN is a GROUP, there is no company of that name, so the entry
   * matched nothing and was reported back as "not up for review" when the
   * deal was sitting in the queue.
   *
   * The whole promise of `entries` is that the fields she fills in ARE the
   * scope and she never has to decide which kind a word is. Matching each
   * one against the column it was put in made her decide after all, and
   * punished her silently for getting it wrong.
   *
   * So a scope value matches EITHER column. Narrowing by both together
   * still works, because each one is applied in turn.
   */
  const scoped = (rows, value) => rows.filter(
    (r) => fold(r.company) === fold(value) || fold(r.group_name) === fold(value),
  );
  if (entry.group) pool = scoped(pool, entry.group);
  if (entry.company) pool = scoped(pool, entry.company);

  if (!entry.person) return { rows: pool };

  const picked = narrowToPerson(pool, entry.person, said, '');
  if (picked.refusal) return { rows: [], undecided: picked.refusal.summary.trim() };
  /**
   * A SCOPE WITH NO PERSON ANSWERS ALL OF IT: naming a company or a group
   * means the whole of it. A PERSON plus a scope that still reaches
   * several is somebody aiming at one deal and missing, so it asks.
   */
  if (picked.rows.length > 1) {
    const where = picked.rows.map((r) => [r.company, r.group_name].filter(Boolean).join(' in '));
    return { rows: [], undecided: `reaches ${picked.rows.length} deals: ${where.join('; ')}` };
  }
  return { rows: picked.rows };
}

function describeEntry(entry) {
  const parts = [entry.person, entry.company, entry.group].filter(Boolean);
  if (entry.dealId != null) parts.push(`#${entry.dealId}`);
  return `${parts.join(' ')} ${entry.answer}`.trim();
}

/**
 * THE FIXED SHAPE, EVERY TIME, whatever they typed.
 *
 * Groups, then what needs deciding, then what matched nothing, then the
 * totals. A confirmation you cannot skim is one you say yes to blindly, so
 * the order never changes with the message.
 *
 * EVERY DEAL ON ITS OWN LINE. Not "all 6 deals": a count hides which six,
 * and the untouched ones in a group somebody named are exactly what they
 * need to see before saying yes.
 */
function previewLines(decided, untouched, undecided, missed, period) {
  const byGroup = new Map();
  const add = (row, verdict) => {
    const key = row.group_name || '(no group)';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(dealLine(row, verdict));
  };
  for (const { row, answer } of decided) {
    add(row, answer === 'yes'
      ? 'continue, no change'
      : `${answer}, stops ${dayText(reviewRepo.STOPS_AT[answer](period))}`);
  }
  for (const row of untouched) add(row, 'not touched');

  const out = [];
  for (const [group, lines] of byGroup) {
    out.push(group);
    out.push(...lines);
    out.push('');
  }
  if (undecided.length > 0) {
    out.push('NEEDS A DECISION');
    for (const item of undecided) out.push(`   "${item.said}" ${item.why}`);
    out.push('');
  }
  if (missed.length > 0) {
    out.push('MATCHED NOTHING');
    for (const item of missed) out.push(`   "${item}" is not up for review this month.`);
    out.push('');
  }
  if (out.at(-1) === '') out.pop();
  return out;
}

/**
 * The `entries` path. Resolve everything, show everything, write nothing
 * until they say so.
 */
async function answerEntries(args, period) {
  const read = args.entries.map((entry) => ({ ...entry, answer: readAnswer(entry.answer) }));
  const unreadable = read.filter((e) => !e.answer);
  if (unreadable.length > 0) {
    return {
      summary: `NOTHING HAS BEEN CHANGED. These are not answers: `
        + `${unreadable.map((e) => `"${e.answer ?? ''}"`).join(', ')}. `
        + 'Every line has to be yes, final or no. Ask which they meant.',
    };
  }

  const unanswered = await dueThisMonth(period, { answered: false });
  const decided = [];
  const undecided = [];
  const missed = [];
  // Deal id -> the answer already claimed for it, so a second entry
  // reaching the same row with a DIFFERENT answer is caught by name.
  const claimed = new Map();

  for (const entry of read) {
    const { rows, undecided: why } = resolveEntry(entry, unanswered, args.said);
    if (why) { undecided.push({ said: describeEntry(entry), why }); continue; }
    if (rows.length === 0) { missed.push(describeEntry(entry)); continue; }
    for (const row of rows) {
      const already = claimed.get(row.id);
      if (already && already !== entry.answer) {
        return {
          summary: 'NOTHING HAS BEEN CHANGED. Two of those say different things about the '
            + `same deal: ${row.person_name}, ${row.company ?? row.group_name}, `
            + `${row.group_name} is set to both "${already}" and "${entry.answer}". `
            + 'Ask which one they meant, then send the whole list again.',
        };
      }
      if (already) continue;
      claimed.set(row.id, entry.answer);
      decided.push({ row, answer: entry.answer });
    }
  }

  if (decided.length === 0) {
    const lines = previewLines([], [], undecided, missed, period);
    return {
      summary: ['Nothing in that reaches a deal that is up for review, so nothing has changed.',
        ...lines].join('\n'),
    };
  }

  // The rest of a group somebody named. "Close manbat" and "close 3 of
  // manbat" must not read the same.
  const touchedGroups = new Set(decided.map(({ row }) => row.group_name));
  const untouched = unanswered.filter(
    (row) => touchedGroups.has(row.group_name) && !claimed.has(row.id),
  );

  const total = moneyPerCurrency(sumByCurrency(decided.map(({ row }) => row), 'monthly_amount'));
  const stops = decided.filter(({ answer }) => answer !== 'yes').length;
  const lines = previewLines(decided, untouched, undecided, missed, period);
  const tally = `${decided.length} change, ${untouched.length} untouched, `
    + `${total} a month. ${stops} stop.`;

  const pending = confirmFirst(args.confirmed, {
    act: 'answer the monthly review exactly as listed above',
    count: decided.length,
    noun: 'deal',
    keeps: 'The rows are kept and any that stop move to the Archive, with every month '
      + 'already paid untouched.',
    lines: [...lines, '', tally],
  });
  if (pending) return pending;

  const stopped = [];
  const failed = [];
  for (const { row, answer } of decided) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { stoppedOn } = await reviewRepo.answerOne(row.id, period, answer, 'diane');
      if (stoppedOn) stopped.push({ name: row.person_name, on: stoppedOn });
    } catch {
      failed.push(row);
    }
  }
  const written = decided.filter(({ row }) => !failed.includes(row)).map(({ row }) => row.id);
  if (written.length > 0) reviewed(written);

  // A ROW THAT DID NOT TAKE IS NAMED, never averaged into a count.
  const head = `Answered ${decided.length - failed.length} of ${decided.length} deals, `
    + `${total} a month.`;
  const tail = stopped.length === 0
    ? 'Nothing was stopped.'
    : `${stopped.length} stop on ${[...new Set(stopped.map((s) => s.on))].join(' and ')} `
      + 'and move to the Archive.';
  const bad = failed.length === 0 ? '' : `\n${failed.length} DID NOT TAKE: `
    + `${failed.map((r) => `${r.person_name}, ${r.company ?? r.group_name}`).join('; ')}. `
    + 'Do NOT report those as done.';
  const reply = `${head} ${tail}${bad}`;

  return {
    summary: reply,
    reply,
    computedReply: true,
    answered: decided.filter(({ row }) => !failed.includes(row)).map(({ row }) => row.id),
    stopped,
  };
}

const monthlyReviewTools = [listMonthlyReview, answerMonthlyReview, bulkAnswerMonthlyReview];

module.exports = {
  monthlyReviewTools, listMonthlyReview, answerMonthlyReview, bulkAnswerMonthlyReview,
  ANSWER_MEANS, groupedLines, narrowToPerson,
};
