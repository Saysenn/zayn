const { randomUUID } = require('node:crypto');
const companiesRepo = require('../../repos/companies.repo');
const { applyCompanyStatus, wouldStop, wouldResume } = require('../../shared/companyStatus.helper');
const { confirmFirst } = require('./confirmFirst');
const { broadcast } = require('../../sockets/index');
const { asksUndo, undoSentence, USE_UNDO } = require('../undoIntent');
const { notACompany } = require('./notAGroup');

/**
 * ***************************************************
 * * Diane changes MANY companies at once
 * ***************************************************
 *
 * Two tools, and they are separate on purpose. `bulk_update_companies`
 * changes what the CRM HOLDS about a company (tier, old group, notes) and
 * stops nothing. `bulk_close_companies` ENDS them, and every deal on every
 * one of them with it.
 *
 * A single tool with a mode would be one mistyped argument between "tidy
 * up six tiers" and "stop paying forty people". Same reasoning that keeps
 * `answer_monthly_review` apart from its bulk.
 *
 * BOTH TAKE confirmFirst. Even the harmless one reaches many rows, and the
 * rule is that a write touching more than one row takes the two call
 * shape. See docs/diane.md.
 */

// Shared, so an amount she says here and one she says elsewhere cannot be
// written two ways. See shared/money.helper.js.
const { money, moneyPerCurrency } = require('../../shared/money.helper');

// A bulk act that reaches everything is never what somebody meant, and a
// cap she cannot see is worse than a refusal. This is a REFUSAL: it says
// how many matched and asks them to narrow it.
const MAX_COMPANIES = 25;

const fold = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * WHICH COMPANIES, AND SHE MAY NOT INVENT ONE.
 *
 * Every name is matched against the companies that exist. An unmatched one
 * is REPORTED, never quietly skipped: "I updated 5 of 6" with no word about
 * the sixth is the shape of answer that hides a typo in somebody's pay.
 */
/**
 * ===============================
 * * A TYPO IS A QUESTION, NOT A MISSING COMPANY
 * ===============================
 * The admin's audit 2026-09-30: "close Acqa and Leadstone" came back "No
 * company called acqa", flat, when Acqua was one letter away. The single
 * company reads have asked "did you mean" since `notACompany`; the writes
 * never did, and a write is where a typo costs most.
 *
 * `corrections` carries its sentence per unmatched name, in the spelling
 * they used. EMPTY WHEN THE LIST CANNOT BE READ: `notACompany` stays
 * silent when it cannot tell, and the caller then falls back to reporting
 * the name as not touched, which is what it always did.
 */
/**
 * The names in "close A, B and C": only for a sentence that opens with the
 * act, so a question that merely mentions companies is never parsed.
 */
function namesInList(said) {
  const m = /^\s*(?:please\s+)?(?:close|shut(?:\s+down)?|dissolve|reopen)\s+(.+?)[.!?]*\s*$/i.exec(String(said ?? ''));
  if (!m) return [];
  return m[1]
    .replace(/\b(?:companies|company|both|the|all|of)\b/gi, ' ')
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

async function resolveCompanies(names, said = '') {
  // Their own spelling, kept beside the folded key, so a correction quotes
  // what they typed rather than its lowercased shadow.
  const spelled = new Map();
  for (const name of names ?? []) {
    const key = fold(name);
    if (key && !spelled.has(key)) spelled.set(key, String(name).trim());
  }
  const wanted = [...spelled.keys()];
  const all = await companiesRepo.names();
  const known = new Map(
    (Array.isArray(all) ? all : []).map((entry) => {
      const name = entry?.name ?? entry;
      return [fold(name), name];
    }),
  );

  const found = [];
  const missing = [];
  for (const key of wanted) {
    if (known.has(key)) found.push({ key, name: known.get(key) });
    else missing.push(key);
  }
  const corrections = [];
  for (const key of missing) {
    // eslint-disable-next-line no-await-in-loop
    const wrong = await notACompany(spelled.get(key), said);
    if (wrong) corrections.push(wrong);
  }
  return { found, missing, corrections };
}

/**
 * ONE UNKNOWN NAME STOPS THE WHOLE ACT. Writing the five it knew and asking
 * about the sixth afterwards is two acts where they asked for one, and the
 * sixth is usually one of the five they meant, misspelled.
 */
function unknownRefusal(corrections, missing) {
  // "Reliapay will close, but Quickeam..." read as though one was going
  // ahead. Nothing is, until every name is settled. 2026-09-30.
  return `NOTHING HAS BEEN CHANGED, for any of them, not even the names that DO exist. ${corrections.join(' ')}`
    + `${groupNotCompany(missing)} Do NOT say any company will close, is closing, is ready to close or is set to close: say nothing was `
    + 'changed yet, and ask about the name that did not match.';
}

function missingLine(missing) {
  if (missing.length === 0) return '';
  return ` No company called ${missing.map((m) => `"${m}"`).join(', ')}, so `
    + `${missing.length === 1 ? 'it was' : 'they were'} not touched.`;
}

/**
 * ===============================
 * * A GROUP NAME IS NOT A MISSING COMPANY
 * ===============================
 * Live 2026-09-18: "close everything in manbat" reached this tool and came
 * back "No company called manbat". True, and useless: MANBAT is a GROUP
 * with three companies on it, and the admin was told their word meant
 * nothing rather than that they had aimed one level too high.
 *
 * A REFUSAL WITH NO EXIT is the thing that sends her looking for another
 * tool to force it through. This gives the exit: name the group, say what
 * is on it, and say which tool actually answers the sentence they typed.
 */
function groupNotCompany(missing) {
  if (missing.length === 0) return '';
  /**
   * STATED AS A CONDITION, not looked up. `notAGroup` would answer it
   * exactly, and it queries the database: a refusal path is the worst
   * place to add a round trip, and it hung this file's own tests the
   * moment it went in. The sentence is true either way and gives the exit.
   */
  return ' If one of those is a GROUP rather than a company, closing a group is not a thing: '
    + 'name the companies on it instead. And if they meant the monthly review, that is '
    + 'bulk_answer_monthly_review, which does take a group.';
}

/**
 * ===============================
 * * THE TIDY UP. IT STOPS NOTHING.
 * ===============================
 * `status` is deliberately NOT a parameter here. Ending a company is the
 * other tool, and letting this one carry a status would put the widest
 * write in the CRM inside the tool whose description says it is a tidy up.
 */
const bulkUpdateCompanies = {
  name: 'bulk_update_companies',
  // IT CAN STOP A DEAL, so she may say one was stopped. See checkClaimedWrite.js.
  stops: true,
  writes: true,
  description:
    'Set the SAME tier, old group or notes on several companies at once. This changes only what '
    + 'the CRM holds about them and stops no deals. Always call with confirmed false first, say '
    + 'the count and what would change, and only call again with confirmed true once they agree. '
    + 'To end companies, that is bulk_close_companies.',
  parameters: {
    type: 'object',
    properties: {
      companies: {
        type: 'array', items: { type: 'string' },
        description: 'The companies, exactly as the admin named them.',
      },
      tier: { type: 'string', description: 'Free text, as the sheet writes it. Empty string clears it.' },
      oldGroup: { type: 'string', description: "His own earlier group name. NEVER one of our groups. Empty string clears it." },
      notes: { type: 'string' },
      confirmed: {
        type: 'boolean',
        description: 'False on the first call, which changes nothing. True only after they said yes.',
      },
    },
    required: ['companies'],
  },
  async handler(args = {}) {
    const fields = Object.fromEntries(
      ['tier', 'oldGroup', 'notes']
        .filter((key) => args[key] !== undefined && args[key] !== null)
        .map((key) => [key, args[key]]),
    );
    if (asksUndo(undoSentence(args))) return { summary: USE_UNDO };
    if (Object.keys(fields).length === 0) {
      return { summary: 'Nothing to change. Ask whether they mean the tier, the old group or the notes.' };
    }

    const { found, missing, corrections } = await resolveCompanies(args.companies, args.said);
    if (corrections.length > 0) return { summary: unknownRefusal(corrections, missing) };
    if (found.length === 0) {
      return {
        summary: `None of those companies exist.${missingLine(missing)}`
          + `${groupNotCompany(missing)} `
          + 'Say so, and do not report anything as done.',
      };
    }
    if (found.length > MAX_COMPANIES) {
      return {
        summary: `That reaches ${found.length} companies, more than the ${MAX_COMPANIES} this `
          + 'tool will change at once. Ask them to narrow it. Nothing has been changed.',
      };
    }

    const what = Object.entries(fields)
      .map(([key, value]) => `${key === 'oldGroup' ? 'old group' : key} to `
        + `${value === '' ? 'nothing' : `"${value}"`}`)
      .join(', ');

    const pending = confirmFirst(args.confirmed, {
      act: `set ${what}`,
      count: found.length,
      noun: 'company',
      plural: 'companies',
      keeps: 'No deal stops and no money moves: this changes only what the CRM holds about them.',
    });
    if (pending) return pending;

    const changed = [];
    // ONE ACT, ONE BATCH: "undo that" puts every company in it back together.
    const stamp = { via: 'diane', batchId: randomUUID() };
    for (const company of found) {
      // PER COMPANY, not one statement. Each goes through the same update
      // the page uses, so the three state rule (a value, cleared, or not
      // mentioned) applies exactly as it does on one.
      // eslint-disable-next-line no-await-in-loop
      const saved = await companiesRepo.update(company.key, fields, stamp);
      if (saved) changed.push(saved.name);
    }
    // The Companies page was never told, and the runtime reads this broadcast as the write. 2026-09-28.
    if (changed.length > 0) broadcast(null, 'companies:changed', { action: 'updated', via: 'agent' });

    const reply = `${changed.length} ${changed.length === 1 ? 'company' : 'companies'}: ${what}. `
      + `${changed.join(', ')}.${missingLine(missing)} Nothing stopped.`;
    return { summary: reply, reply, computedReply: true, companies: changed };
  },
};

/**
 * ===============================
 * * THE ONE THAT ENDS THEM, AND EVERY DEAL WITH THEM
 * ===============================
 * This is the widest write in the CRM: one call can stop dozens of people
 * being paid. So the preview says the COUNT OF COMPANIES, the COUNT OF
 * DEALS and the MONEY, all before anything is written.
 *
 * DISSOLVED AND CLOSED ARE BOTH OFFERED because they are not the same
 * fact: one company ceased to exist, the other we walked away from, and an
 * audit asks which. LIQUIDATION IS NOT HERE: it stops nothing and it opens
 * a panel where amounts are set per deal, which is not a bulk act.
 */
/**
 * ===============================
 * * AND THE UNDO, because a bulk act needs one
 * ===============================
 * Reopening was one company per call while closing took twenty five, so
 * undoing a mistake cost twenty five confirmations and there was no single
 * act to point at afterwards. It is the SAME column moving the other way,
 * through the same cascade, so it belongs in the same tool rather than in a
 * second one that would have to repeat every guard.
 *
 * The name still says close. That is the act this tool is for; `active` is
 * its reverse, and renaming the tool would move a model facing contract
 * for a word.
 */
const REOPEN = 'active';
const ENDINGS = ['closed', 'dissolved'];
/**
 * ===============================
 * * AND THE TWO MARKS THAT STOP NOTHING
 * ===============================
 * The admin's audit 2026-09-30: "put all of NEXUS's companies on monthly
 * review" was one company per call, through update_company, because this
 * tool only knew endings. Going concern and review are both STILL PAYING:
 * going concern behaves exactly like active for money, and review only
 * says ask me about this company every month.
 *
 * STILL PREVIEWED, because it is still many companies in one sentence, and
 * because a company that was CLOSED comes back to life on either one: the
 * cascade resumes what its closure stopped, the same as `active` does.
 *
 * REVIEW TICKS NO DEAL. Which deals are reviewed monthly is chosen per deal
 * on each company's status screen (see REVIEWED_MONTHLY in the repo), so
 * the preview and the reply both say none were ticked here.
 *
 * Liquidation stays out, for the reason above: its amounts are per deal.
 */
const MARKS = ['going_concern', 'review'];
const BULK_STATUSES = [...ENDINGS, REOPEN, ...MARKS];
const MARK_LABEL = { going_concern: 'going concern', review: 'under monthly review' };
const MARK_KEEPS = {
  going_concern: 'No deal stops and no amount changes: a going concern is paid exactly like '
    + 'an active company.',
  review: 'No deal stops and no amount changes. Which of their deals are reviewed monthly is '
    + 'ticked per deal on each company\'s status screen, and this ticks none of them.',
};

const bulkCloseCompanies = {
  name: 'bulk_close_companies',
  // IT CAN STOP A DEAL, so she may say one was stopped. See checkClaimedWrite.js.
  stops: true,
  writes: true,
  description:
    'End several companies at once, or put several back. Every live deal on a company being ended '
    + 'STOPS and moves to the Archive. "closed" means we ended it, "dissolved" means it legally '
    + 'ceased to exist; both stop the deals and differ only in what they record. "active" REOPENS '
    + 'them, bringing back every deal their closure stopped. "going_concern" and "review" MARK '
    + 'them and stop nothing: use review for "put these companies on monthly review". Always '
    + 'call with confirmed false first, read out the company count, the deal count and the money, '
    + 'and only call again with confirmed true once they agree.',
  parameters: {
    type: 'object',
    properties: {
      companies: {
        type: 'array', items: { type: 'string' },
        description: 'The companies, exactly as the admin named them.',
      },
      status: {
        type: 'string', enum: BULK_STATUSES,
        description: 'closed if we ended it, dissolved if it legally ceased to exist, active to '
          + 'reopen it and bring back the deals its closure stopped. going_concern (trading, no '
          + 'end date) and review (asked about every month) stop nothing.',
      },
      confirmed: {
        type: 'boolean',
        description: 'False on the first call, which changes nothing. True only after they said yes.',
      },
    },
    required: ['companies', 'status'],
  },
  async handler(args = {}) {
    if (!BULK_STATUSES.includes(args.status)) {
      return {
        summary: `"${args.status}" is not one of these. It is closed, or dissolved, or active to `
          + 'put them back, or going_concern or review to mark them. Liquidation is not an '
          + 'ending: it keeps paying, at amounts set per deal, and it is set one company at a time.',
      };
    }
    const reopening = args.status === REOPEN;
    const marking = MARKS.includes(args.status);

    /**
     * A NAME THEY SAID AND SHE LEFT OUT. Live 2026-09-30: "close reliapay
     * and quickeam" previewed Reliapay alone. Quickeam is no company, and
     * nothing said so. Every name in their list goes through the same check.
     */
    const passed = (args.companies ?? []).map(fold);
    const dropped = namesInList(args.said)
      .filter((n) => !passed.some((p) => p === fold(n) || fold(n).includes(p) || p.includes(fold(n))));
    const { found, missing, corrections } = await resolveCompanies([...(args.companies ?? []), ...dropped], args.said);
    if (corrections.length > 0) {
      // THE SENTENCE IS FIXED, not hers: "Reliapay is ready to be closed"
      // read as under way while nothing was. 2026-09-30.
      const near = corrections.map((c) => /closest is "([^"]+)"/.exec(c)?.[1]).find(Boolean);
      const typed = namesInList(args.said).find((n) => missing.includes(fold(n))) ?? missing[0];
      return {
        summary: unknownRefusal(corrections, missing),
        reply: `Nothing has been closed. I don't have a company called "${typed}"`
          + `${near ? `. Did you mean ${near}?` : '. Which company did you mean?'}`,
        computedReply: true,
      };
    }
    if (found.length === 0) {
      return {
        summary: `None of those companies exist.${missingLine(missing)}`
          + `${groupNotCompany(missing)} `
          + 'Say so, and do not report anything as done.',
      };
    }
    if (found.length > MAX_COMPANIES) {
      return {
        summary: `That reaches ${found.length} companies, more than the ${MAX_COMPANIES} this `
          + 'tool will close at once. Ask them to narrow it. Nothing has been changed.',
      };
    }

    // THE COUNT AND THE MONEY BEFORE ANYTHING IS WRITTEN. A bulk close that
    // only reports afterwards is a number nobody could have checked, and a
    // reopen owes the same number: both move somebody's pay.
    let deals = 0;
    let amount = 0;
    let currency = 'GBP';
    for (const company of found) {
      // A MARK PUTS BACK ONLY WHAT A CLOSURE STOPPED, and only on a company
      // that is closed now: the cascade resumes nothing on one still open.
      // eslint-disable-next-line no-await-in-loop
      const closedNow = marking && ENDINGS.includes((await companiesRepo.findByKey(company.key))?.status);
      if (marking && !closedNow) continue;
      // eslint-disable-next-line no-await-in-loop
      const ahead = reopening || marking ? await wouldResume(company.name) : await wouldStop(company.name);
      deals += ahead.count;
      amount += ahead.money;
      if (ahead.count > 0) currency = ahead.currency;
    }

    const word = { dissolved: 'dissolve', closed: 'close', [REOPEN]: 'reopen' }[args.status];
    const markAct = () => `mark them ${MARK_LABEL[args.status]}`
      + (deals > 0
        ? `, which also PUTS BACK ${deals} ${deals === 1 ? 'deal' : 'deals'} a closure stopped, `
          + `${currency} ${money(amount)} a month`
        : '');
    const pending = confirmFirst(args.confirmed, {
      act: marking ? markAct() : reopening
        ? `${word} them and PUT BACK ${deals} ${deals === 1 ? 'deal' : 'deals'} their closure `
          + `stopped, ${currency} ${money(amount)} a month`
        : `${word} them and STOP ${deals} live ${deals === 1 ? 'deal' : 'deals'} on them, `
          + `${currency} ${money(amount)} a month`,
      count: found.length,
      noun: 'company',
      plural: 'companies',
      keeps: marking ? MARK_KEEPS[args.status] : reopening
        // ONLY WHAT THE CLOSURE STOPPED. A deal stopped by hand beforehand
        // was its own decision and stays stopped, and saying so here is the
        // difference between a reopen and an undelete.
        ? 'Only the deals their closure stopped come back. Anything stopped by hand, or by a '
          + 'monthly review, stays in the Archive and has to be resumed on its own.'
        : 'Every row is kept and moves to the Archive. Months already paid are untouched, '
          + 'and setting a company back to active brings its deals back together.',
    });
    if (pending) return pending;

    const done = [];
    let moved = 0;
    // Whether ANY of them moved a page other than this one. One broadcast
    // for the batch, not one per company.
    let touchedTheSheet = false;
    for (const company of found) {
      // THE SHARED CASCADE, the same one the page uses. Calling the repo
      // directly here is how her closes stopped nothing while the page's
      // stopped everybody.
      // eslint-disable-next-line no-await-in-loop
      const result = await applyCompanyStatus(company.key, { status: args.status, via: 'diane' });
      done.push(result.company?.name ?? company.name);
      moved += (reopening || marking ? result.deals?.resumed : result.deals?.stopped)?.length ?? 0;
      touchedTheSheet = touchedTheSheet || Boolean(result.deals) || result.reviewQueueChanged;
    }

    // IT BROADCAST NOTHING. This stops or resumes every deal on several
    // companies at once, which is the widest write in the CRM, and the
    // Master Sheet, People and the Review button were all left stale until
    // a reload. Same fault as the single status write. Found 2026-09-21.
    broadcast(null, 'companies:changed', { action: 'updated', via: 'agent' });
    if (touchedTheSheet) {
      broadcast(null, 'master-sheet:changed', { action: 'company-status', via: 'agent' });
      broadcast(null, 'people:changed', { action: 'company-status', via: 'agent' });
    }

    const companyWord = done.length === 1 ? 'company' : 'companies';
    const dealWord = moved === 1 ? 'deal' : 'deals';
    const marked = () => `${done.length} ${companyWord} marked ${MARK_LABEL[args.status]}: `
      + `${done.join(', ')}. No deal stopped.`
      + `${moved > 0 ? ` ${moved} ${dealWord} a closure had stopped came back on the master sheet.` : ''}`
      + `${args.status === 'review' ? ' No deal was ticked for the monthly review: that is chosen per deal on each company\'s status screen.' : ''}`
      + `${missingLine(missing)}`;
    const reply = marking ? marked() : reopening
      ? `${done.length} ${companyWord} reopened: ${done.join(', ')}. ${moved} ${dealWord} back on `
        + `the master sheet.${missingLine(missing)}`
      : `${done.length} ${companyWord} ${args.status}: ${done.join(', ')}. ${moved} ${dealWord} `
        + `stopped and moved to the Archive.${missingLine(missing)} Every month already paid is `
        + 'untouched.';
    return {
      summary: reply, reply, computedReply: true, companies: done, moved,
    };
  },
};

/**
 * ===============================
 * * THE COMPANIES THEMSELVES, BY STATUS. READ ONLY.
 * ===============================
 * "Who is on a company in liquidation" could only be answered through the
 * DEALS, which reports rows and never names a company, so the answer was
 * "no deals" where it should have been a list of companies and who is on
 * them. `active_companies` is per group and says nothing about status.
 *
 * The repo has taken `status`, `group` and a name search since the closure
 * work. Nothing new is queried here.
 *
 * LIQUIDATION IS STILL PAYING and the sentence has to say so, or a list of
 * companies under that heading reads as a list of companies that have
 * stopped.
 */
const STATUS_MEANS = {
  active: 'trading',
  // His own word. Trading and expected to keep trading, so it pays exactly
  // like active and differs only in what it SAYS: its deals carry no end
  // date on purpose rather than by omission.
  going_concern: 'trading and expected to keep trading, with no end date',
  // IN THE ENUM AND NOWHERE ELSE, until the audit 2026-09-30: she could
  // filter by it and had no sentence for what it meant. Not liquidation:
  // nothing here sets an amount.
  review: 'STILL PAYING, and asked about every month, with the deals reviewed chosen one by one',
  liquidation: 'winding down and STILL BEING PAID, at amounts set per deal',
  closed: 'ended, and every deal on it stopped',
  dissolved: 'legally ceased to exist, and every deal on it stopped',
};

// The statuses that are nouns, said as English. "No company is review" was
// the next sentence waiting to happen once review reached the description.
const READS_AS = {
  liquidation: 'in liquidation',
  going_concern: 'a going concern',
  review: 'under monthly review',
};

// The page's own words, a deliberate mirror of web configs/companyStatus.js.
const STATUS_LABEL = {
  active: 'Active',
  going_concern: 'Going concern',
  review: 'Review',
  liquidation: 'Liquidation',
  dissolved: 'Dissolved',
  closed: 'Closed',
};

/**
 * ===============================
 * * THE LIST, DRAWN, so she does not have to read it
 * ===============================
 * Audit 2026-09-30: every company came back as a paragraph she read aloud,
 * twenty lines of names, counts and tiers. The master sheet's filter has
 * drawn its rows as a bubble for months; this is the same event with a
 * company in each row, and a link to its page.
 *
 * `href` IS THE PAGE'S OWN KEY: the folded name, which is what
 * `/companies/:key` reads. Never the display spelling.
 *
 * PER CURRENCY, NEVER BLENDED, same rule as every total in the CRM.
 */
function companyRow(c) {
  const deals = Number(c.deal_count) || 0;
  const handlers = Number(c.handler_count) || 0;
  const amount = moneyPerCurrency(c.monthly_totals);
  return {
    id: c.name,
    name: c.name,
    status: c.status,
    statusLabel: STATUS_LABEL[c.status] ?? c.status,
    groups: Array.isArray(c.groups) ? c.groups.filter(Boolean).join(', ') : '',
    dealsText: `${deals} ${deals === 1 ? 'deal' : 'deals'}, ${handlers} ${handlers === 1 ? 'handler' : 'handlers'}`,
    amount,
    tier: c.tier ?? '',
    oldGroup: c.old_group ?? '',
    href: `/companies/${encodeURIComponent(c.ckey ?? fold(c.name))}`,
  };
}

const listCompanies = {
  name: 'list_companies',
  description:
    'Companies by STATUS, with who is on them: active, going_concern, review, liquidation, closed or dissolved. Use it '
    + 'for "which companies are in liquidation", "what have we closed", "is anything winding '
    + 'down", "which companies are on monthly review", for what tier or old group a company has, and for the same question inside ONE group. Narrow with group for "which companies '
    + 'in ALPHA are closed", or with name for one company. Liquidation and review are STILL PAYING. READ '
    + 'ONLY. For the deals on a company use filter_master_sheet instead.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'array',
        items: { type: 'string', enum: Object.values(companiesRepo.COMPANY_STATUS) },
        description: 'One or more statuses, in ONE array. Leave it out for every company.',
      },
      group: { type: 'string', description: 'One group, if they named one.' },
      name: { type: 'string', description: 'One company, if they asked about a specific one.' },
    },
  },
  async handler(rawArgs = {}) {
    // "which companies are in baker" came as name BAKER, and answered "no
    // company called baker". A group sent as the name IS the group. 2026-09-30.
    let args = rawArgs;
    if (args.name && !args.group) {
      // eslint-disable-next-line global-require
      const groups = await require('../../repos/masterSheetRows.repo').distinctGroups().catch(() => []);
      const group = groups.find((g) => g.toLowerCase() === String(args.name).trim().toLowerCase());
      if (group) args = { ...args, name: undefined, group };
    }
    const wanted = (args.status ?? []).filter(Boolean);
    // The repo takes ONE status. Several is several reads, deduped on the
    // company key: a company has one status, so it cannot appear twice.
    const asked = wanted.length > 0 ? wanted : [null];
    const byKey = new Map();
    for (const status of asked) {
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await companiesRepo.findAll({
        status: status || undefined,
        group: args.group || undefined,
        q: args.name || undefined,
        pageSize: MAX_COMPANIES * 4,
      });
      for (const row of rows) if (!byKey.has(row.ckey)) byKey.set(row.ckey, row);
    }

    const found = [...byKey.values()];
    const where = args.group ? ` in ${args.group}` : '';
    const which = wanted.length > 0 ? wanted.join(' or ') : 'any status';
    // "No company is liquidation" was the sentence. These are nouns, not
    // adjectives, and only two of the four read as one.
    const reads = wanted.length > 0
      ? wanted.map((s) => READS_AS[s] ?? s).join(' or ')
      : 'on the sheet';

    if (found.length === 0) {
      const reply = args.name
        ? `There is no company called "${args.name}"${where}.`
        : `No company${where} is ${reads}.`;
      return {
        summary: `${reply} Say exactly that and nothing wider: it is a fact about this question, `
          + 'not about what the sheet holds.',
        reply,
        computedReply: true,
      };
    }

    // NAMED, with who is on them and what it MEANS. A count on its own is
    // the answer nobody can check.
    const lines = found.map((c) => {
      const handlers = `${c.handler_count} ${c.handler_count === 1 ? 'handler' : 'handlers'}`;
      const settled = c.liquidation_total != null
        ? `, settlement ${money(c.liquidation_total)}`
        : '';
      const groups = Array.isArray(c.groups) && c.groups.length > 0 ? ` (${c.groups.join(', ')})` : '';
      // Said either way: asked the tier, she answered "not set" from a line that never carried it.
      const tier = c.tier ? `, tier ${c.tier}` : ', no tier';
      const oldGroup = c.old_group ? `, old group ${c.old_group}` : '';
      return `  ${c.name}${groups}: ${c.status}${tier}${oldGroup}, ${c.deal_count} `
        + `${c.deal_count === 1 ? 'deal' : 'deals'}, ${handlers}${settled}`;
    });

    const meanings = [...new Set(found.map((c) => c.status))]
      .map((s) => `${s} means ${STATUS_MEANS[s] ?? s}`)
      .join('. ');

    /**
     * SHORT, BECAUSE THE LIST IS DRAWN. The lines stay, for reference only:
     * a follow up about one company's tier is answered from them. The
     * liquidation sentence stays too, because a spoken "3 companies in
     * liquidation" without it still reads as three that have stopped.
     */
    const count = `${found.length} ${found.length === 1 ? 'company' : 'companies'}`;
    /**
     * THE SENTENCE IS BUILT, not hoped for. "NEXUS has 3 companies" left out
     * that one was in liquidation and still paying, though she was told she
     * MUST say it. Counted by status, still-paying ones named. 2026-09-30.
     */
    const byStatus = new Map();
    for (const c of found) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
    const PAYING = new Set(['liquidation', 'review', 'going_concern']);
    // "1 in liquidation", never "1 liquidation": the status as a phrase.
    const PHRASE = {
      active: 'active', going_concern: 'on going concern', review: 'under review',
      liquidation: 'in liquidation', dissolved: 'dissolved', closed: 'closed',
    };
    const parts = [...byStatus].map(([s, n]) => `${n} ${PHRASE[s] ?? (STATUS_LABEL[s] ?? s).toLowerCase()}`
      + `${PAYING.has(s) ? ' (still paying)' : ''}`);
    // A FEW ARE NAMED: "1 company: 1 on going concern" left them to find
    // which one in the list. 2026-10-03.
    const named = found.length <= 3
      ? ` (${found.map((c) => c.name).join(', ')})`
      : '';
    const reply = `${count}${where}${named}: ${parts.join(', ')}.`;
    return {
      reply,
      computedReply: true,
      summary: `${count}${where}, ${which}, ALREADY LISTED ON SCREEN with their groups, deals, `
        + 'handlers and monthly amounts. Do NOT list them again in text. Say ONE sentence with '
        + 'the count and what they have in common, then STOP. If any is in LIQUIDATION or under '
        + 'REVIEW you MUST say it is still being paid: a list under that heading reads as a list '
        + 'of companies that have stopped, and that is money somebody would not chase.\n\n'
        + `${meanings}.\n\nFor your reference only:\n${lines.join('\n')}`,
      list: {
        kind: 'companies',
        title: `${count}${where}${wanted.length > 0 ? `, ${wanted.map((s) => STATUS_LABEL[s] ?? s).join(' or ')}` : ''}`,
        rows: found.map(companyRow),
      },
      companies: found.map((c) => ({
        name: c.name, status: c.status, deals: c.deal_count, handlers: c.handler_count,
      })),
    };
  },
};

const companyTools = [bulkUpdateCompanies, bulkCloseCompanies, listCompanies];

module.exports = {
  companyTools, bulkUpdateCompanies, bulkCloseCompanies, listCompanies, resolveCompanies, MAX_COMPANIES,
};
