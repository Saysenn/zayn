const { fold, personMentionedIn } = require('./tools/resolvePerson');
const { whatSeparates, dealsWhere } = require('./tools/whichDeal');
const {
  splitPersonAndGroup, splitPersonAndCompany, groupsHeardIn,
} = require('./tools/notAGroup');
const { isSetInstructionRecent } = require('./setIntent');

/**
 * ***************************************************
 * * READ THE REQUEST BEFORE ACTING ON IT
 * ***************************************************
 *
 * His call 2026-09-29, after five rounds of the same shape in one session.
 * Every one was a separate patch on a separate door:
 *
 *   "add 100 to zayn milkman"      a group glued into the name. Fixed on
 *                                  the read doors, missed on the write one.
 *   "deduct 100"                   a bare number written as a percentage.
 *   "100 aed"                      a value handed back, which lost both the
 *                                  scope and the fact it was a change.
 *   "yes"                          an agreement to a question offering two
 *                                  readings, which answers neither.
 *   "deduct 100 to zayn in milkman" a person and a group, reported to the
 *                                  admin as something the CRM cannot do.
 *
 * FOUR OF THE FIVE WERE THE RIGHT TOOL WITH A WRONG ARGUMENT. She was never
 * confused about what to call; she was confused about what was meant. So
 * the fix is not fewer tools, it is reading the request FIRST, in ONE
 * order, in ONE place, before anything is looked up or written.
 *
 * ---- the order, and it does not vary ----
 *
 *   1. WHO      the person, with any group split out of their name
 *   2. WHERE    the group, from this turn or the last
 *   3. WHETHER  is this still the change they asked for, or a new question
 *   4. WHICH    the one deal that reaches, or the one question that finds it
 *
 * The unit of a figure is the fifth and it is NOT here: it needs the row's
 * current value, so it belongs where that is known (`rateChange.unitNotSaid`,
 * called from `settleRates`). Everything above runs before a row exists.
 *
 * ---- it resolves or it asks. it never guesses ----
 *
 * Every exit is either a resolved target or exactly one question naming the
 * readings. A guess here is somebody else's money, and `resolvePerson`
 * carries the same rule one level up for the same reason.
 *
 * ---- and it holds no state ----
 *
 * The turn's bookkeeping (a held question, a plan waiting on an answer)
 * stays with the caller. This answers "what did they mean", which is the
 * same answer whoever is asking and whatever happened last turn.
 */

/**
 * WHO and WHERE, off the arguments and their own words.
 *
 * `options` is `peopleRepo.filterOptions()`, passed in rather than fetched:
 * a caller that already has it should not pay for a second read, and a test
 * should not need a database to ask what a sentence means.
 *
 * @returns {{ person: string, group: string|undefined, isChange: boolean }}
 */
function readRequest(args = {}, options = {}) {
  const said = args.said ?? '';
  const saidRecent = args.saidRecent ?? '';
  const isChange = isSetInstructionRecent(said, saidRecent);

  const person = args.targetPerson ?? args.person ?? '';
  const given = args.targetGroup ?? args.group;
  const company = args.targetCompany ?? args.company;
  if (!person || given) return { person, group: given, company, isChange };

  // 1. A GROUP GLUED INTO THE NAME comes out of it. "Zayn Milkman" is a
  //    person and a group, and nobody is called that.
  const split = splitPersonAndGroup(person, options);
  if (split) return { person: split.person, group: split.group, company, isChange };

  /**
   * 1b. OR A COMPANY, the same fault with a different list. "zayn
   *     workforce" is one name and two things.
   *
   * Only where they passed no company of their own, and `splitPersonAndCompany`
   * carries a third guard the group one does not need: a company whose name
   * reaches a handler is never taken out, so "Gloria - Workforce" survives.
   */
  if (!company) {
    const byCompany = splitPersonAndCompany(person, options);
    if (byCompany) {
      return { person: byCompany.person, group: undefined, company: byCompany.company, isChange };
    }
  }

  /**
   * 2. FAILING THAT, A GROUP THEY SAID. This turn wins; only when they
   *    named none at all does it look back a turn.
   *
   * The look back is what "100 aed" needed: the amount was on that line and
   * the deal was on the one before it, and a change that forgets which is a
   * change to the wrong deal.
   */
  const groups = options?.groups ?? [];
  const here = groupsHeardIn(said, groups);
  /**
   * ONLY A LINE ABOUT THIS PERSON. Live 2026-09-30: "show me the deals in
   * milkman" then "how much is drew owed" answered Drew's MILKMAN deal only,
   * and after a MILKMAN company list "change drew's monthly" said he had no
   * such deal. An earlier line lends its group only when it named them too.
   */
  const aboutThem = String(saidRecent).split('\n').filter((line) => personMentionedIn(line, person));
  const heard = here.length > 0 ? here : groupsHeardIn(aboutThem.join('\n'), groups);
  // Exactly one. Two is a question, not a scope.
  if (heard.length !== 1) return { person, group: undefined, company, isChange };
  /**
   * UNLESS THAT WORD IS PART OF THEIR OWN NAME.
   *
   * "add 100 to milkman jones" names a PERSON, and the group MILKMAN is
   * inside that name. `splitPersonAndGroup` above refuses to take a whole
   * name apart, and this is the same rule for the sentence: a word that is
   * their name is them being precise, not a scope.
   *
   * Caught by its own test rather than by him, which is the point of
   * having one. 2026-09-29.
   */
  if (groupsHeardIn(person, heard).length > 0) return { person, group: undefined, company, isChange };
  /**
   * AND A WORD THAT IS BOTH A GROUP AND A COMPANY IS NEITHER, here.
   *
   * "Gloria's deals on Acqua or Nexus" names two COMPANIES she holds, and
   * NEXUS is also a group. Taken as the group it narrowed to the wrong
   * half of her deals without asking. `companySentAsGroup` has always
   * handled that collision by ASKING which; guessing it silently in a
   * scope step is the same fault one layer earlier. Caught by
   * monthlyReview's own tests, 2026-09-29.
   */
  const companies = options?.companies ?? [];
  if (companies.some((c) => fold(c) === fold(heard[0]))) {
    return { person, group: undefined, company, isChange };
  }
  return { person, group: heard[0], company, isChange };
}

/**
 * ===============================
 * * WHICH ONE DEAL, or the one question that would find it
 * ===============================
 *
 * `narrow` is the caller's row matcher, injected: which columns identify a
 * deal is the master sheet's business, and this file decides only what to
 * DO with the answer. That seam is also what lets every case below be
 * tested without a database.
 *
 * @param {object[]} rows   every deal the person holds
 * @param {object} args     the tool's arguments, carrying `said`
 * @param {function} narrow (rows, args) => { rows, targeted, missing }
 * @returns {{ deal: object } | { ask: 'which'|'missing', ... }}
 */
function pickDeal(rows, args = {}, narrow) {
  const held = rows ?? [];
  if (held.length === 0) return { ask: 'missing', missing: null, rows: held };

  const narrowed = narrow ? narrow(held, args) : { rows: held, targeted: false, missing: null };

  /**
   * THE ROWS THE REQUEST ACTUALLY REACHES, never everything they hold.
   *
   * A group or a company they NAMED is the answer to "which one", so
   * asking it again is a question with no work in it. Two deals held, one
   * of them named, and a card list on a sentence that left nothing to
   * choose: that is what put a chooser on "add 100 to zayn milkman".
   */
  const reached = narrowed.targeted && narrowed.rows.length > 0 ? narrowed.rows : held;

  // They named something and NOTHING matched it. Not a typo to correct:
  // the company, the group and the role have all been checked.
  if (narrowed.missing) {
    return { ask: 'missing', missing: narrowed.missing, rows: held };
  }

  if (reached.length === 1) return { deal: reached[0] };

  /**
   * SEVERAL LEFT, so it asks, and it asks on the field that actually
   * DIFFERS. "Which company?" over two deals both at Workforce is a
   * question whose answer narrows nothing, which is the dead end this
   * whole file exists to avoid. See whichDeal.
   */
  return {
    ask: 'which',
    rows: reached,
    by: whatSeparates(reached),
    where: dealsWhere(reached),
  };
}

/**
 * ===============================
 * * THE FRONT DOOR, for a tool that names its scope `person` / `group`
 * ===============================
 * `readRequest` is pure and takes the sheet's lists; this fetches them and
 * writes the answer back onto the arguments. One call at the top of a
 * handler is all it takes to route a tool through the same reading every
 * other door uses.
 *
 * IT ONLY EVER FILLS A GAP. A scope they passed themselves is untouched,
 * so this can never narrow a request further than it was already narrowed.
 *
 * NOT FOR A TOOL THAT CREATES. `add_deal` is handed the name of somebody
 * who may not exist yet, and taking a group out of a name that is about to
 * become a person is how the wrong person gets created. The split refuses
 * unless the remainder reaches somebody real, so it would mostly be safe;
 * "mostly" is not a reason to run it on a create.
 */
async function scopeArgs(args = {}, peopleRepo) {
  if (!args.person || args.people?.length) return args;
  let options;
  try {
    options = await peopleRepo.filterOptions();
  } catch {
    return args;
  }
  const read = readRequest(args, options);
  const out = { ...args };
  if (read.person && read.person !== args.person) out.person = read.person;
  if (read.group && !args.group) out.group = read.group;
  if (read.company && !args.company) out.company = read.company;
  return out;
}

/** The question itself, so every door asks it the same way. */
function whichQuestion(who, picked) {
  const by = picked.by ? picked.by.toUpperCase() : 'ONE';
  return `NOTHING HAS BEEN CHANGED. ${who} holds ${picked.rows.length} deals: ${picked.where}. `
    + `They did not say which, so ask which ${by} they mean, naming the company and the group. `
    + 'Say nothing else until they answer.';
}

module.exports = {
  readRequest, pickDeal, whichQuestion, scopeArgs,
};
