const rowsRepo = require('../../repos/masterSheetRows.repo');
// A stop or resume refreshes the pages as the page's own routes do (v1/masterSheet.js).
const { broadcast } = require('../../sockets/index');
function moved(action, row) {
  broadcast(null, 'master-sheet:changed', { action, id: row.id, via: 'agent' });
  broadcast(null, 'assignments:changed', {
    groupName: row.group_name, company: row.company, personName: row.person_name,
  });
}
const { currentDay } = require('../../shared/presetMonth.helper');
// A day as words, without losing one to a timezone. See its banner.
const { dayText } = require('../../shared/dayText.helper');
const { resolvePerson, fold, within } = require('./resolvePerson');
const { resolveDealScope } = require('./notAGroup');
const { whatSeparates, dealsWhere } = require('./whichDeal');
const peopleRepo = require('../../repos/people.repo');
const { scopeArgs } = require('../resolveRequest');
const { confirmFirst } = require('./confirmFirst');

/**
 * ***************************************************
 * * Diane ends a deal, and puts one back
 * ***************************************************
 *
 * ITS OWN FILE, never tools/masterSheet.js. That file is thousands of
 * lines and a tool that stops somebody's pay has to be findable.
 *
 * STOP IS NOT DELETE. The row stays and moves to the Archive: its history
 * is payroll, and the months it was paid in are already in the snapshots.
 * She must say that rather than "done", because a stop that reads like a
 * deletion is the sentence that makes somebody stop trusting the answer.
 *
 * See docs/closure.md and docs/diane.md.
 */

// Shared, so an amount she says here and one she says elsewhere cannot be
// written two ways. See shared/money.helper.js.
const { money, sumByCurrency, moneyPerCurrency } = require('../../shared/money.helper');
const { ratedRows } = require('../../shared/ratedRows.helper');

// What the Archive prints, in her words. The wire values are the repo's.
const REASON_WORDS = {
  stopped_by_hand: 'stopped by hand',
  review_no: 'answered no at review',
  review_final: 'final month at review',
  company_closed: 'its company closed',
};

/** One person under their company. The company and the date are above. */
function personLine(row) {
  return `   ${row.person_name ?? '(no handler)'}, ${row.role_label}, `
    + `${row.currency ?? 'GBP'} ${money(row.monthly_amount)}`;
}

/**
 * The Archive as numbered blocks, one per company and stop.
 *
 * SAME SHAPE AS THE REVIEW QUEUE, and the same reason: it was one long
 * sentence per deal repeating the company, the date and the reason on
 * every row. Grouping says each of those once.
 *
 * THE REASON IS PART OF THE KEY, not just the date. Two deals on one
 * company stopped on the same day for different reasons are two different
 * facts, and merging them would print one reason over both.
 */
function groupedLines(rows) {
  const byCompany = new Map();
  for (const row of rows) {
    const reason = REASON_WORDS[row.stopped_reason] ?? row.stopped_reason;
    const key = `${row.company || row.group_name}|${dayText(row.stopped_on)}|${reason}`;
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(row);
  }

  const out = [];
  let n = 0;
  for (const [key, people] of byCompany) {
    n += 1;
    const [where, when, reason] = key.split('|');
    out.push(`${n}. ${where}, stopped ${when}, ${reason}`);
    for (const row of people) out.push(personLine(row));
    out.push('');
  }
  if (out.at(-1) === '') out.pop();
  return out;
}

/**
 * ===============================
 * * WHICH DEAL, AND THE TWO WAYS IT GOES WRONG
 * ===============================
 * The same shape monthlyReview.js uses, and for the same reason: these
 * tools hand `resolvePerson` a LIST rather than a fuzzy search, so a name
 * matching nobody falls through to "everybody" flagged `matched: false`.
 *
 * The pool is narrowed FIRST, so a miss is a miss rather than an ambiguity
 * between two strangers.
 */
const TYPO_SLACK = 2;

/**
 * "a", "a and b", "a, b and c". A plural filter joined itself with
 * JavaScript's default comma and printed "Reliapay,KP,Kryptonia", which
 * reads as one company with a strange name.
 */
function listNames(names) {
  const list = (names ?? []).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

function reaches(row, wanted) {
  const name = fold(row.person_name);
  return name.startsWith(wanted) || wanted.startsWith(name) || within(name, wanted, TYPO_SLACK);
}

function narrowToPerson(rows, name, said, tail) {
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

/** One live deal for a named person, or the reason there is not one. */
async function oneLiveDeal(rawArgs, verb) {
  // READ THE REQUEST FIRST, like every other door. "stop zayn milkman's
  // deal" arrives as one name that is a person AND a group, and without
  // this it reaches nobody. Covers stop_deal and resume_deal at once.
  const {
    person, company, group, said,
  } = await scopeArgs(rawArgs, peopleRepo);
  const { rows } = await rowsRepo.findAll({
    company: company || undefined,
    group: group || undefined,
    pageSize: 500,
  });
  const picked = narrowToPerson(rows, person, said, `Ask which one. Nothing has been ${verb}.`);
  if (picked.refusal) return picked;

  if (picked.rows.length === 0) {
    return {
      refusal: {
        summary: `${person} has no live deal${company ? ` on ${company}` : ''}. `
          + 'Say that, and do not claim to have changed anything.',
      },
    };
  }
  // ONE PERSON CAN HOLD SEVERAL. Acting on all of them off one unqualified
  // name is a bulk act wearing a single tool's face.
  if (picked.rows.length > 1) {
    /**
     * ===============================
     * * COMPANY AND GROUP, OR THE LIST IS THE SAME NAME FOUR TIMES
     * ===============================
     * Live 2026-09-18: this printed "Gloria holds 4 live deals: Workforce,
     * Workforce, Workforce, Workforce. Ask which company they mean." The
     * company is what all four SHARE; the group is what separates them, so
     * the question had no answerable form and the list said nothing.
     *
     * Third place this shape has been found. A company is a company IN A
     * GROUP, and any list of one person's deals has to say both.
     */
    // ONE DEFINITION with the update path's, in `whichDeal`: this had the
    // rule and the card list did not, so the same question came back wrong
    // on another door. 2026-09-29.
    const by = whatSeparates(picked.rows);
    return {
      refusal: {
        summary: `${person} holds ${picked.rows.length} live deals: ${dealsWhere(picked.rows)}. `
          + `Ask which ${by ? by.toUpperCase() : 'one'} they mean, naming the company and the `
          + `group. Nothing has been ${verb}.`,
        ambiguous: true,
      },
    };
  }
  return { deal: picked.rows[0] };
}

/**
 * ===============================
 * * STOP. ONE NAMED DEAL, PREVIEWED, AND IT SAYS WHAT SURVIVES.
 * ===============================
 * It was one call with no preview. His test list of 2026-09-29 says the
 * confirm has to name what survives, and a stop takes a deal out of every
 * month from today, which is money. It is not on autoConfirm's allow list
 * (`stops`), so auto mode never skips this one.
 */
// "delete his deal" reached stop_deal and was answered "stopped". A delete
// is its own tool and its own promise (it cannot be undone), so it is never
// quietly swapped for a stop.
const SAYS_DELETE = /\b(?:delete|deleting|erase|wipe)\b/i;
const stopDeal = {
  name: 'stop_deal',
  // IT CAN STOP A DEAL, so she may say one was stopped. See checkClaimedWrite.js.
  stops: true,
  writes: true,
  description:
    'End ONE deal. The row is kept and moves to the Archive, out of the master sheet and out of '
    + 'every month from today onward. Use this when somebody says a deal is over. It is not a '
    + 'deletion and it is reversible with resume_deal.',
  parameters: {
    type: 'object',
    properties: {
      person: { type: 'string', description: 'Whose deal, exactly as the admin wrote the name.' },
      company: { type: 'string', description: 'Which company, when they hold more than one.' },
      group: { type: 'string', description: 'Which group, when they hold the SAME company in more than one.' },
      confirmed: { type: 'boolean', description: 'True only after they have agreed to the stop this tool said was pending.' },
    },
    required: ['person'],
  },
  async handler(args = {}) {
    if (SAYS_DELETE.test(String(args.said ?? '')) && !/\bstop\b/i.test(String(args.said ?? ''))) {
      return {
        summary: 'NOTHING HAS BEEN CHANGED. They said DELETE, not stop. That is delete_master_sheet_row, '
          + 'which removes the row and its history and cannot be undone. Call it; it asks them first.',
      };
    }
    // "resume kiran's deal" reached this tool and previewed a STOP. 2026-09-29.
    if (/\b(?:resume|reopen|restart|unstop|bring (?:[\w'’-]+ ){0,4}back|put (?:[\w'’-]+ ){0,4}back)\b/i.test(String(args.said ?? ''))
      && !/\bstop\b/i.test(String(args.said ?? ''))) {
      return {
        summary: 'NOTHING HAS BEEN CHANGED. They asked to RESUME a deal, not stop one. That is '
          + 'resume_deal. Call it.',
      };
    }
    const found = await oneLiveDeal(args, 'stopped');
    if (found.refusal) return found.refusal;

    const { deal } = found;
    const where = [deal.company, deal.group_name].filter(Boolean).join(' in ');
    const pending = confirmFirst(args.confirmed, {
      act: 'stop this deal',
      count: 1,
      lines: [`${deal.person_name} on ${where}: stops from ${dayText(currentDay())}, out of this month onward`],
      keeps: 'WHAT SURVIVES: the row itself and all its history, kept in the Archive; every month '
        + 'already paid, untouched. It can be resumed later (say to them "you can ask me to resume it", never a tool name). Say both halves.',
    });
    if (pending) return pending;
    // THE SERVER DATES IT. A backdated stop rewrites a month that has
    // already been paid, and she has no business choosing that day.
    const row = await rowsRepo.stop(deal.id, {
      on: currentDay(),
      reason: rowsRepo.STOPPED_REASON.BY_HAND,
      via: 'diane',
    });
    if (!row) return { summary: 'That deal could not be stopped. Nothing has been changed.' };
    moved('stopped', row);

    // COMPANY AND GROUP: one person often holds the same company in two groups.
    const reply = `${deal.person_name} on ${[deal.company, deal.group_name].filter(Boolean).join(' in ')} is stopped from `
      + `${dayText(row.stopped_on)}. The row is kept and has moved to the Archive, out of this `
      + 'month onward. Every month already paid is untouched.';
    return { summary: reply, reply, computedReply: true, dealId: deal.id };
  },
};

/**
 * Resume. The Archive's only write.
 *
 * IT CAN BE REFUSED, and the refusal is an instruction: a deal a company
 * closure stopped stays stopped, because putting it back on a company that
 * is gone is the one resume that makes the sheet wrong.
 */
const resumeDeal = {
  name: 'resume_deal',
  // IT CHANGES DATA. See setIntent.js.
  writes: true,
  description:
    'Put a stopped deal back on the master sheet. Works on a deal stopped by hand or by a monthly '
    + 'review. A deal stopped because its COMPANY closed cannot be resumed on its own: reopen the '
    + 'company instead, and every deal its closure stopped comes back together.',
  parameters: {
    type: 'object',
    properties: {
      person: { type: 'string', description: 'Whose deal, exactly as the admin wrote the name.' },
      company: { type: 'string' },
      group: { type: 'string', description: 'Which group, when they hold the SAME company in more than one.' },
    },
    required: ['person'],
  },
  async handler(rawResumeArgs = {}) {
    /**
     * ONLY WHEN THEY ASKED. Live 2026-09-30: "set casey test's fee to 3%"
     * found her deal stopped, and she resumed it on her own. A fee change is
     * not a resume. A "yes" to her own offer carries the offer in saidRecent.
     */
    const heard = `${rawResumeArgs.said ?? ''}\n${rawResumeArgs.saidRecent ?? ''}`;
    if (rawResumeArgs.said !== undefined && !rawResumeArgs.confirmed
      && !/\b(?:resum\w*|reopen\w*|restart\w*|reinstat\w*|un-?stop\w*|bring\w* (?:[\w'’-]+ ){0,4}back|put (?:[\w'’-]+ ){0,4}back|back on)\b/i.test(heard)
      && !/^\s*(?:y|yes|yeah|yep|ok|okay|sure|go ahead|do it)\b/i.test(String(rawResumeArgs.said))) {
      return {
        summary: 'NOTHING HAS BEEN CHANGED. They did not ask to resume a deal. If a deal they asked '
          + 'about is stopped, SAY SO and ask whether to resume it; never resume one on your own.',
      };
    }
    // READ THE REQUEST FIRST. It reads the ARCHIVE rather than the live
    // sheet, so it cannot share `oneLiveDeal` and needs its own call.
    // A GROUP SENT AS A COMPANY first, the way the Archive read does it:
    // "pino's nexus deal" came in as company NEXUS and found nothing. 2026-10-03.
    const scope = await resolveDealScope(rawResumeArgs);
    if (scope.question) return { summary: scope.question };
    const args = await scopeArgs(scope.args, peopleRepo);
    const { rows } = await rowsRepo.findAll({
      stopped: true,
      company: args.company || undefined,
      group: args.group || undefined,
      pageSize: 500,
    });
    const picked = narrowToPerson(rows, args.person, args.said, 'Ask which one. Nothing has been resumed.');
    if (picked.refusal) return picked.refusal;

    if (picked.rows.length === 0) {
      return {
        summary: `${args.person} has no stopped deal${args.company ? ` on ${args.company}` : ''}. `
          + 'Say that, and do not claim to have changed anything.',
      };
    }
    if (picked.rows.length > 1) {
      // COMPANY AND GROUP, from `whichDeal` like every other door. The same
      // list that printed one name four times on stop_deal: the company is
      // what they share, the group is what tells them apart.
      const by = whatSeparates(picked.rows);
      return {
        summary: `${args.person} has ${picked.rows.length} stopped deals: `
          + `${dealsWhere(picked.rows)}. Ask which ${by ? by.toUpperCase() : 'one'} they mean, `
          + 'naming the company and the group. Nothing has been resumed.',
        ambiguous: true,
      };
    }

    const deal = picked.rows[0];
    // THE ONE REFUSAL, checked before the write so the sentence is about
    // what to do rather than about a failure.
    if (deal.stopped_reason === rowsRepo.REOPEN_THE_COMPANY) {
      return {
        summary: `${deal.person_name}'s deal was stopped because ${deal.company} closed, so it `
          + 'cannot be resumed on its own. Tell them to reopen the company, and every deal its '
          + 'closure stopped comes back together. Nothing has been changed.',
      };
    }

    const row = await rowsRepo.resume(deal.id, { via: 'diane' });
    if (!row) return { summary: 'That deal could not be resumed. Nothing has been changed.' };
    moved('resumed', row);

    const reply = `${deal.person_name} on ${[deal.company, deal.group_name].filter(Boolean).join(' in ')} is back on the `
      + 'master sheet and counts toward this month again.';
    return { summary: reply, reply, computedReply: true, dealId: deal.id };
  },
};

/**
 * ===============================
 * * THE ARCHIVE, READ ONLY
 * ===============================
 * "What did we stop in August, and why" needed the page. It NAMES THE
 * REASON on every line, because four things stop a deal and they are not
 * interchangeable: a hand stop, a review answered no, a final month and a
 * company closing.
 */
const listStoppedDeals = {
  name: 'list_stopped_deals',
  description:
    'Deals that have ENDED and are in the Archive: who, what they were on, when they stopped and '
    + 'why. Use this for any question about what was stopped, ended, archived or closed. Read '
    + 'only, it changes nothing.',
  parameters: {
    type: 'object',
    properties: {
      person: { type: 'string' },
      group: { type: 'string' },
      company: { type: 'string' },
      from: { type: 'string', description: 'YYYY-MM-DD. Stopped on or after this day.' },
      to: { type: 'string', description: 'YYYY-MM-DD. Stopped on or before this day.' },
      reason: {
        type: 'string',
        enum: ['stopped_by_hand', 'review_no', 'review_final', 'company_closed'],
      },
    },
  },
  async handler(rawArgs = {}) {
    // A group sent as a company: "stopped in ZZTEST" came back as nothing. 2026-09-28.
    const scope = await resolveDealScope(rawArgs);
    if (scope.question) return { summary: scope.question };
    const args = scope.args;
    const { rows, total } = await rowsRepo.findAll({
      stopped: true,
      group: args.group || undefined,
      company: args.company || undefined,
      stoppedFrom: args.from || undefined,
      stoppedTo: args.to || undefined,
      stoppedReason: args.reason || undefined,
      pageSize: 500,
    });

    let selected = rows;
    if (args.person) {
      const picked = narrowToPerson(rows, args.person, args.said, 'Ask which one.');
      if (picked.refusal) return picked.refusal;
      selected = picked.rows;
    }

    if (selected.length === 0) {
      /**
       * ===============================
       * * "Nothing stopped for Reliapay,KP,Kryptonia matches that."
       * ===============================
       * Live 2026-09-24, and wrong twice in one line.
       *
       * THE ARRAY WENT IN RAW. `company` is plural, so a list joined
       * itself with JavaScript's default comma and no spaces. It reads as
       * one company with a strange name.
       *
       * AND IT CONTRADICTED THE PANEL DIRECTLY ABOVE IT, which had just
       * drawn three matching deals. Both were true: those deals are PAST
       * THEIR END DATE, and none of them is STOPPED. The sentence never
       * said which question it had answered, so the admin was left with
       * one screen saying three and the next saying none.
       */
      const named = [args.person, args.company, args.group]
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .map((v) => String(v ?? '').trim())
        .filter(Boolean);
      const scope = listNames(named);
      const reply = scope
        ? `Nothing is stopped for ${scope}.`
        : 'Nothing has been stopped that matches that.';
      return {
        summary: `${reply} SAY WHICH QUESTION THIS ANSWERED. A deal PAST ITS END DATE is not a `
          + 'stopped deal: it is running and due for review, which is why a list of those can '
          + 'show rows while this shows none. If they were asking about deals past a year, say '
          + 'so and answer from the review list instead of reporting nothing.',
        reply,
        computedReply: true,
      };
    }

    // RATED, and PER CURRENCY. It printed the raw wage, and added GBP to AED. 2026-09-28.
    const rated = await ratedRows(selected);
    const headline = `${rated.length} stopped deal${rated.length === 1 ? '' : 's'}, `
      + `${moneyPerCurrency(sumByCurrency(rated, 'monthly_amount'))} a month between them.`;

    // GROUPED, NOT CUT. The company, the day and the reason are one fact
    // about every deal in a block, so they are said once and nothing is
    // left out. See groupedLines.
    const full = [headline, '', ...groupedLines(rated)].join('\n');

    // DRAWN (his call 2026-09-30): a section per company and stop, a row per
    // deal. The bubble keeps the headline; the card carries the rest.
    const blocks = new Map();
    for (const row of rated) {
      const reason = REASON_WORDS[row.stopped_reason] ?? row.stopped_reason;
      const label = `${row.company || row.group_name} · stopped ${dayText(row.stopped_on)} · ${reason}`;
      if (!blocks.has(label)) blocks.set(label, []);
      blocks.get(label).push(row);
    }

    return {
      summary: full,
      reply: headline,
      computedReply: true,
      list: {
        kind: 'report',
        title: headline,
        sections: [...blocks].map(([label, mine]) => ({
          label,
          count: mine.length,
          rows: mine.map((row) => ({
            id: row.id,
            name: row.person_name ?? '(no handler)',
            where: row.group_name,
            detail: `${row.role_label} · ${row.currency ?? 'GBP'} ${money(row.monthly_amount)}`,
          })),
        })),
        rows: rated.map((row) => ({ id: row.id, name: row.person_name })),
      },
      dealIds: selected.map((row) => row.id),
      total,
    };
  },
};

const closureTools = [stopDeal, resumeDeal, listStoppedDeals];

module.exports = {
  closureTools, stopDeal, resumeDeal, listStoppedDeals,
  narrowToPerson, groupedLines, REASON_WORDS,
};
