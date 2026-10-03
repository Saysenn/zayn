const peopleRepo = require('../../repos/people.repo');
const { fold, mentionedIn, within } = require('./resolvePerson');

/**
 * ***************************************************
 * * A GROUP THAT DOES NOT EXIST IS NOT AN EMPTY GROUP
 * ***************************************************
 *
 * Filter on a group the sheet does not have and SQL returns nothing. The
 * zero notes cover the month, the filter and dropped people; none of them
 * covers a name that was never real. So she says "nothing owed", and
 * NOTHING OWED IS INDISTINGUISHABLE FROM A FACT ABOUT THE BUSINESS.
 *
 * `notAPerson` answers a different question. It asks what a word IS, and
 * returns something only when the word turns out to be a real group or
 * company. When the word is real but empty it says nothing, which is
 * correct, and when the word is not real at all it also says nothing,
 * which is the hole.
 *
 * THIS IS THE ONE THAT BITES ON DATA NOBODY HAS SEEN. Today's group names
 * are in her prompt and in the admin's head. Load a new sheet and the
 * first wrong answer is a confident zero for a group that was renamed.
 *
 * Groups and companies are closed lists off `filterOptions`, so this is a
 * fact rather than a guess.
 */

// How many real values to name before the list is worth more than it says.
// It REPORTS when it cuts: a cap you cannot see is the bug.
const NAMED_MAX = 40;

// A typo is a similar LENGTH. Containment alone would call "Gloria" a near
// miss for "Gloria - Workforce", which is a different thing entirely.
const LENGTH_SLACK = 2;

/**
 * Edit distance as well as containment, because containment cannot see a
 * SUBSTITUTION: "INDIG0" and "INDIGO" contain neither the other.
 *
 * Looser than the person rule on purpose. A near miss here produces a
 * QUESTION and never a resolution, so a false one costs a clarification.
 * The person version resolves, which is why it stays strict.
 */
const NEAR_EDITS = 2;

const regexEscape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Exact group names in the admin's own sentence. This corrects a model
 * argument such as MILKMAN when the sentence plainly says MANBAT. It never
 * fuzzes and therefore never silently changes one valid group into another.
 */
function groupsMentionedIn(said, list = []) {
  const text = String(said ?? '');
  const found = [];
  for (const group of list) {
    const name = String(group ?? '').trim();
    if (!name) continue;
    if (fold(name) === 'allgroups') {
      // "all groups" normally means every group. The real group is named
      // by the singular phrase "all group" or "ALL GROUPS group".
      if (/\ball group\b|\ball groups group\b/i.test(text)) found.push(name);
      continue;
    }
    const pattern = regexEscape(name).replace(/\s+/g, '\\s+');
    if (new RegExp(`(^|[^a-z0-9])${pattern}(?=$|[^a-z0-9])`, 'i').test(text)) found.push(name);
  }
  return [...new Set(found)];
}

async function exactGroupsMentioned(said) {
  let list = [];
  try {
    list = (await peopleRepo.filterOptions())?.groups ?? [];
  } catch {
    return [];
  }
  return groupsMentionedIn(said, list);
}

/**
 * The groups the admin NAMED: exact, or one unique slip ("milman"). One definition
 * for every reader, or the month path dropped the group the scope had found. 2026-09-28.
 */
function groupsHeardIn(said, list) {
  const exact = groupsMentionedIn(said, list);
  if (exact.length > 0) return exact;
  const close = groupsWithinSlip(said, list);
  return close.length === 1 ? close : [];
}

async function groupsHeard(said) {
  try {
    return groupsHeardIn(said, (await peopleRepo.filterOptions())?.groups ?? []);
  } catch {
    return [];
  }
}

/**
 * @param {'group'|'company'} kind which list to check against
 * @param {string} name the value that matched no rows
 * @returns {Promise<string|null>} a correction, or null when the value is
 *   REAL and the zero has some other cause. Null is the important half:
 *   claiming a real group is missing is the same fault pointing the other
 *   way.
 */
async function unknownScope(kind, name, said = '') {
  /**
   * ===============================
   * * A PLURAL FILTER REACHED A CHECK WRITTEN FOR ONE NAME
   * ===============================
   * Live 2026-09-24. `group` is plural, so a list arrived here as an
   * ARRAY, `fold` ran over the whole thing, and "MILKMAN,MANBAT" became
   * "milkmanmanbat": a name that exists nowhere. The correction said the
   * group was missing and listed the real ones, and she relayed it as:
   *
   *   "You mentioned MILKMAN and MANBAT groups, but only MANBAT and
   *    MILKMAN exist exactly like that."
   *
   * A sentence that says the same two names both do and do not exist.
   * Neither half was hers to invent; the folded array was.
   *
   * SO EACH NAME IS ASKED SEPARATELY, and a list where every name is real
   * returns null, exactly as a single real name does. Only the genuinely
   * missing ones reach the correction.
   */
  const asked = (Array.isArray(name) ? name : [name])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  if (asked.length > 1) {
    const missing = [];
    for (const one of asked) {
      // eslint-disable-next-line no-await-in-loop
      const out = await unknownScope(kind, one, said);
      if (out) missing.push(one);
    }
    // EVERY ONE OF THEM IS REAL, so the zero has some other cause. Saying
    // anything here is what produced the contradiction.
    if (missing.length === 0) return null;
    // One bad name in a list is still one bad name: answer for it alone,
    // so the correction names what is actually wrong.
    return unknownScope(kind, missing[0], said);
  }

  const wanted = fold(asked[0] ?? '');
  if (!wanted) return null;

  /**
   * ===============================
   * * NO LIST IS NOT AN EMPTY LIST
   * ===============================
   *
   * An empty or unreadable `filterOptions` is not evidence the group is
   * missing, it is evidence we cannot tell. Accusing on it turned every
   * legitimate zero into "the sheet is empty" the moment the lookup was
   * unavailable, which is a louder wrong answer than the one it replaces.
   *
   * Same doctrine as `checkFigures`: nothing to check against means stay
   * silent, never guess. A read path must not fail because a hint failed.
   */
  let list = [];
  let people = [];
  try {
    const options = await peopleRepo.filterOptions();
    list = (kind === 'group' ? options?.groups : options?.companies) ?? [];
    people = options?.people ?? [];
  } catch {
    return null;
  }
  if (list.length === 0) return null;
  /**
   * A PERSON SENT AS A COMPANY OR GROUP. Live 2026-09-30: after a company
   * list, "how much is juno park owed" arrived as company "Juno Park" and
   * was answered "no company called Juno Park". They are a person.
   */
  if (!list.some((v) => fold(v) === wanted)) {
    const person = people.find(({ name }) => fold(name) === wanted);
    if (person) {
      return `NOTHING WAS LOOKED UP. "${person.name}" is a PERSON on the sheet, not a ${kind}. `
        + `Call this again with person "${person.name}" and no ${kind}. Do NOT tell them it is not a ${kind}.`;
    }
  }

  // IT EXISTS. The zero is real and belongs to something else.
  if (list.some((v) => fold(v) === wanted)) return null;

  const near = list.filter((v) => {
    const c = fold(v);
    if (Math.abs(c.length - wanted.length) > LENGTH_SLACK) return false;
    return mentionedIn(c, wanted) || mentionedIn(wanted, c) || within(c, wanted, NEAR_EDITS);
  });

  /**
   * ===============================
   * * A NAME THEY NEVER SAID IS ONE SHE INVENTED
   * ===============================
   * Asked "which group grows the most next month?" she answered "The groups
   * ALPHA, BETA and GAMMA do not exist on the sheet." Nobody had said those
   * words. She made three names up, queried them, and relayed the refusal
   * as though the admin had asked about them.
   *
   * Same doctrine as `resolvePerson`: `said` is the admin's own sentence,
   * the one copy she cannot have edited on the way through. If the name is
   * not in it, the correction has to say she invented it and forbid
   * repeating it, or she hands the invention back as a finding.
   */
  /**
   * ===============================
   * * THE INVENTED NAME IS NOT IN THE CORRECTION
   * ===============================
   * It used to open `YOU INVENTED THE GROUP "ALPHA"` and then tell her not
   * to repeat it. Live 2026-09-07, asked "break that down by group", she
   * read that correction for three invented names and answered "The groups
   * ALPHA, BETA and GAMMA do not exist on the sheet".
   *
   * An instruction not to say a word, with the word supplied, is prompting
   * doing a guard's job. She cannot echo a name she was never handed, so
   * the name is left out entirely. The real list is still given, because
   * that is what the next question has to be built from.
   */
  const invented = Boolean(said) && !mentionedIn(fold(said), wanted);
  const head = invented
    ? `The ${kind} you passed is not on the sheet and THEY NEVER SAID IT, so it is one you `
      + `supplied. Do NOT name it back to them and do NOT report a missing ${kind}: naming it `
      + 'at all tells them they asked something they did not. Ask which they meant.'
    : `There is NO ${kind.toUpperCase()} called "${asked[0]}" on the sheet. This is not an `
      + `empty ${kind}, it is a ${kind} that does not exist, so do NOT report a zero and do NOT `
      + 'say nobody is owed. That would read as a fact about the business.';

  /**
   * SHE CANNOT GUESS, STRUCTURALLY, so a near miss is offered and never
   * applied. One candidate still gets a question: silently answering for a
   * different group is the fault this exists to prevent.
   */
  if (near.length === 1) {
    return `${head} The closest is "${near[0]}". Ask whether they meant that, and answer `
      + 'nothing until they say.';
  }
  if (near.length > 1) {
    return `${head} These are close: ${near.join(', ')}. Ask which one they meant, giving the `
      + 'names EXACTLY as written, and answer nothing until they say.';
  }

  const shown = list.slice(0, NAMED_MAX);
  const cut = list.length > shown.length
    ? ` (${shown.length} of ${list.length} listed)`
    : '';
  return `${head} The ${kind}s that DO exist are${cut}: ${shown.join(', ')}. Ask which they `
    + 'meant, giving the names EXACTLY as written.';
}

const notAGroup = (name, said = '') => unknownScope('group', name, said);
const notACompany = (name, said = '') => unknownScope('company', name, said);

/**
 * A COMPANY SENT AS A GROUP, re-homed off the sheet's own lists: a group of
 * that name still wins. "Total for ZZ Rate Co B" came back "no such group",
 * and the retry answered with another person's total. 2026-09-25.
 */
async function companySentAsGroup(args) {
  let options;
  try {
    options = await peopleRepo.filterOptions();
  } catch {
    return { args, question: null };
  }
  const wanted = fold(args.group);
  // A SENT GROUP ONE SLIP FROM A REAL ONE is that one: she passed "milman", nothing
  // matched it, and the month path dropped it as never named. 2026-09-28.
  const groups = options?.groups ?? [];
  if (!groups.some((g) => fold(g) === wanted)) {
    const slip = groupsWithinSlip(args.group, groups);
    if (slip.length === 1) return companySentAsGroup({ ...args, group: slip[0] });
  }
  if (groups.some((g) => fold(g) === wanted)) {
    // THE GROUP REPEATED AS A COMPANY is dropped, never refused as a missing
    // company: "total for ZZTEST" came back "no company ZZTEST". 2026-09-28.
    const companies = (Array.isArray(args.company) ? args.company : [args.company]).filter(Boolean);
    const real = new Set((options?.companies ?? []).map(fold));
    const kept = companies.filter((c) => fold(c) !== wanted || real.has(fold(c)));
    if (kept.length === companies.length) return { args, question: null };
    return { args: { ...args, company: kept.length > 0 ? kept : undefined }, question: null };
  }
  const company = (options?.companies ?? []).find((c) => fold(c) === wanted);
  return company
    ? { args: { ...args, group: undefined, company: [company] }, question: null }
    : { args, question: null };
}

/**
 * Resolve the noun before querying. "NEXUS deals" describes a group when
 * NEXUS exists only in the group list, even if the model placed it in the
 * company argument. If both lists contain the same name, the admin must
 * choose unless they already said which one.
 */
// A group name this long survives one letter out without meeting another.
const SLIP_MIN_LENGTH = 5;

/** Groups one letter away from a word in the sentence. */
function groupsWithinSlip(said, groups) {
  const words = String(said ?? '').split(/[^a-z0-9]+/i).map(fold).filter((w) => w.length >= SLIP_MIN_LENGTH - 1);
  return [...new Set(groups.filter((g) => fold(g).length >= SLIP_MIN_LENGTH
    && words.some((w) => w !== fold(g) && within(w, fold(g), 1))))];
}

/** Does this word reach anybody on the roster, whole name or forename? */
function reachesPerson(word, people = []) {
  const wanted = fold(word);
  if (!wanted) return false;
  return people.some(({ name }) => {
    const words = [fold(name), ...String(name ?? '').split(/\s+/).map(fold)].filter(Boolean);
    return words.some((w) => w.startsWith(wanted) || wanted.startsWith(w) || within(w, wanted, 1));
  });
}

/**
 * ***************************************************
 * * A PERSON AND THEIR GROUP GLUED INTO ONE ARGUMENT
 * ***************************************************
 *
 * Live 2026-09-29. "add 100 to zayn milkman" arrived as person "Zayn
 * Milkman". Nobody is called that, the search found nothing, and she told
 * the admin one of his own handlers did not exist. The next line, "zayn
 * from milkman", worked: the preposition kept the two words apart.
 *
 * `personSentAsGroup` cannot catch it and should not try. Zayn REACHES that
 * value (it starts with his name), which is exactly the test that stops it
 * turning a real person into a group.
 *
 * THE SPLIT IS ONLY MADE WHEN BOTH HALVES ARE REAL: one group named as
 * whole words inside the value, and a remainder that reaches somebody on
 * the roster. Anything else is left exactly as sent. Inventing a split is
 * the same fault as inventing a name, one step earlier.
 *
 * @returns {{ person: string, group: string }|null}
 */
function splitPersonAndGroup(person, options) {
  const asked = String(person ?? '').trim();
  if (!asked) return null;

  const people = options?.people ?? [];
  // THEY WERE PRECISE. A value that IS somebody's whole name is never split,
  // even where a group name sits inside it.
  if (people.some(({ name }) => fold(name) === fold(asked))) return null;

  const named = groupsMentionedIn(asked, options?.groups ?? []);
  if (named.length !== 1) return null;

  const group = named[0];
  const rest = withoutWords(asked, group);

  // "milkman" on its own is `personSentAsGroup`'s case, not this one.
  if (!rest || !reachesPerson(rest, people)) return null;
  return { person: rest, group };
}

/** The value with `name` taken out of it, as whole words. */
function withoutWords(value, name) {
  const pattern = new RegExp(`(^|[^a-z0-9])${regexEscape(name).replace(/\s+/g, '\\s+')}(?=$|[^a-z0-9])`, 'ig');
  return String(value).replace(pattern, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * ===============================
 * * AND THE SAME FOR A COMPANY, which is a different risk
 * ===============================
 * "zayn workforce" is the same fault as "zayn milkman" and was left out of
 * the first fix on purpose: a COMPANY name can BE a person's name on this
 * sheet ("Gloria - Workforce" is a company and Gloria is a real handler),
 * so splitting on the company list can take a real name apart.
 *
 * THREE GUARDS, where the group split needs one:
 *   the whole value is nobody's name        (as the group split)
 *   the remainder reaches somebody          (as the group split)
 *   AND the part taken out is not itself a person's name
 *
 * That third one is what keeps "Gloria - Workforce" whole.
 */
function splitPersonAndCompany(person, options) {
  const asked = String(person ?? '').trim();
  if (!asked) return null;

  const people = options?.people ?? [];
  if (people.some(({ name }) => fold(name) === fold(asked))) return null;

  const named = groupsMentionedIn(asked, options?.companies ?? []);
  if (named.length !== 1) return null;

  const company = named[0];
  // The company's own name reaches a handler, so this is a person called
  // after a company and not a person AND a company.
  if (reachesPerson(company, people)) return null;

  const rest = withoutWords(asked, company);
  if (!rest || !reachesPerson(rest, people)) return null;
  return { person: rest, company };
}

/**
 * A GROUP SENT AS A PERSON: "milman total last august" arrived as person "milman". 2026-09-28.
 * Moved only when nobody on the roster reaches the word AND their sentence names that group.
 */
function personSentAsGroup(args, options) {
  const wanted = fold(args.person);
  if (!wanted || args.people?.length) return args;
  if (reachesPerson(wanted, options?.people)) return args;
  const heard = groupsHeardIn(args.said, options?.groups ?? []);
  const group = heard.length === 1 && groupsHeardIn(args.person, heard).length === 1 ? heard[0] : null;
  if (!group) return args;
  const { person, ...rest } = args;
  return { ...rest, group };
}

/**
 * ***************************************************
 * * THE SAME SPLIT, FOR THE DOOR THAT WRITES
 * ***************************************************
 *
 * `update_master_sheet_row` names its scope `targetPerson` / `targetGroup`,
 * so `resolveDealScope` cannot be pointed at it and the first fix for
 * "add 100 to zayn milkman" missed the ONE path it was reported on. It
 * caught every read and no write. Found again 2026-09-29, same sentence.
 *
 * TWO THINGS, in this order, and both are his rule: on a change, a word in
 * the request that IS a group on the sheet must be treated as one before
 * anything is looked up or refused.
 *
 *   1. A group glued into the person argument comes out of it.
 *   2. Failing that, a group named anywhere in the SENTENCE scopes the
 *      change, when the call carried none.
 *
 * NARROWING IS THE SAFE DIRECTION. A scope that is wrong can only fail to
 * find the deal, and that failure names the deals they DO hold; a scope
 * left off writes to a row nobody pointed at.
 */
async function splitTargetScope(rawArgs = {}) {
  const args = rawArgs;
  if (!args.targetPerson || args.targetGroup) return args;

  let options;
  try {
    options = await peopleRepo.filterOptions();
  } catch {
    return args;
  }

  // THE ORDER IS `resolveRequest`'S, not a second copy of it. Required
  // here rather than at the top: that file reads this one for the split,
  // and the cycle only resolves if one side asks at call time.
  // eslint-disable-next-line global-require
  const { readRequest } = require('../resolveRequest');
  const read = readRequest(args, options);
  if (!read.group && !read.company) return args;
  return {
    ...args,
    targetPerson: read.person,
    ...(read.group ? { targetGroup: read.group } : {}),
    ...(read.company ? { targetCompany: read.company } : {}),
  };
}

async function resolveDealScope(rawArgs = {}) {
  let args = rawArgs;
  /**
   * "ALL" IS NO GROUP. Live 2026-09-30: "how many deals do we have?" came in
   * as group "all" and was answered "ALL GROUPS or a specific one?". A bare
   * all/every/any means the whole sheet. A real group with its own name
   * (even one called "ALL GROUPS") is untouched: only these words, alone.
   */
  if (typeof args.group === 'string' && /^\s*(?:all|every|everything|any|\*)\s*$/i.test(args.group)) {
    const { group, ...rest } = args;
    args = rest;
  }
  if (args.person && !args.people?.length) {
    try {
      const options = await peopleRepo.filterOptions();
      /**
       * THE SAME ORDER THE WRITE DOOR USES, and from the same file.
       *
       * Every read door already came through here; the first fix for
       * "add 100 to zayn milkman" then taught the WRITE door the rule
       * separately, which is how one sentence needed fixing twice. Both
       * call `readRequest` now, so a rule added there reaches every door
       * at once. 2026-09-29.
       */
      // eslint-disable-next-line global-require
      const { readRequest } = require('../resolveRequest');
      const read = readRequest(args, options);
      if (read.person && read.person !== args.person) args = { ...args, person: read.person };
      if (read.group && !args.group) args = { ...args, group: read.group };
      if (read.company && !args.company) args = { ...args, company: [read.company] };
      if (args.said) args = personSentAsGroup(args, options);
    } catch { /* person as sent */ }
  }
  if (args.group) return companySentAsGroup(args);

  const companyValues = (Array.isArray(args.company) ? args.company : [args.company])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);

  // A GROUP IN THEIR WORDS, dropped from the call: "total for ZZTEST" was
  // answered for the whole sheet. 2026-09-28. Exactly one group, and nothing else scoped.
  const unscoped = companyValues.length === 0 && !args.q && !args.person && !args.people?.length
    && args.id == null && !args.ids?.length;
  if (unscoped && args.said) {
    let groups = [];
    try { groups = (await peopleRepo.filterOptions())?.groups ?? []; } catch { /* unscoped as sent */ }
    // Exact, or one unique slip: "milman total last august" answered the whole sheet.
    const named = groupsHeardIn(args.said, groups);
    if (named.length === 1) return { args: { ...args, group: named[0] }, question: null };
  }
  const fromQuery = companyValues.length === 0 && typeof args.q === 'string' && args.q.trim();
  const scopesAsked = fromQuery ? [args.q.trim()] : companyValues;
  if (scopesAsked.length !== 1) return { args, question: null };

  let options;
  try {
    options = await peopleRepo.filterOptions();
  } catch {
    return { args, question: null };
  }

  const said = String(args.said ?? '');
  const namedGroup = /\bgroup\b/i.test(said);
  const namedCompany = /\bcompan(?:y|ies)\b/i.test(said);
  const wanted = fold(scopesAsked[0]);
  // Models often preserve the user's noun inside the value and send
  // company="Nexus Group". The closed group list stores that as NEXUS.
  const wantedGroup = namedGroup ? wanted.replace(/group$/, '') : wanted;
  const company = (options?.companies ?? []).find((value) => fold(value) === wanted);
  // A slip counts too, unless the word is a real company: "milman" answered "For milman". 2026-09-28.
  const slipped = company ? [] : groupsWithinSlip(scopesAsked[0], options?.groups ?? []);
  const group = (options?.groups ?? []).find((value) => fold(value) === wantedGroup)
    ?? (slipped.length === 1 ? slipped[0] : undefined);
  if (!group) {
    return company && fromQuery
      ? { args: { ...args, q: undefined, company: [company] }, question: null }
      : { args, question: null };
  }

  if (company && !namedGroup && !namedCompany) {
    return {
      args: null,
      question: `${scopesAsked[0]} is both a group and a company. Ask whether they mean the `
        + 'group or the company before showing any deals.',
    };
  }
  if (company && namedCompany && !namedGroup) {
    return fromQuery
      ? { args: { ...args, q: undefined, company: [company] }, question: null }
      : { args, question: null };
  }

  return {
    args: { ...args, group, company: undefined, ...(fromQuery ? { q: undefined } : {}) },
    question: null,
  };
}

module.exports = {
  notAGroup, notACompany, unknownScope, resolveDealScope,
  splitPersonAndGroup, splitPersonAndCompany, splitTargetScope,
  exactGroupsMentioned, groupsMentionedIn, groupsHeard, groupsHeardIn, NAMED_MAX,
};
