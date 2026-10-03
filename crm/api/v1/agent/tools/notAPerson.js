const peopleRepo = require('../../repos/people.repo');
const { fold, mentionedIn } = require('./resolvePerson');
// ONE DEFINITION of the person-and-group split. No cycle: notAGroup reaches
// resolvePerson, as this file does, and never back to here.
const { splitPersonAndGroup } = require('./notAGroup');

/**
 * ***************************************************
 * * "NEXUS" IS NOT A MISSING PERSON, IT IS A GROUP
 * ***************************************************
 *
 * Live transcript. "Show me bank details of nexus" and "show me all deals
 * of nexus" both came back:
 *
 *   "There are no deals for Nexus on the master sheet. Would you like me
 *    to add a deal for Nexus?"
 *
 * NEXUS is a group with six rows in front of her. In the same session
 * "exus" got "did you mean EXUS?".
 *
 * THE TOOL WAS NOT WRONG. Nobody is CALLED Nexus, so the person search
 * found nothing and said so honestly. She picked the wrong tool, and the
 * answer gave her nothing to correct herself with, so she offered to
 * CREATE something that already existed. That is the worst reply available:
 * it tells the boss his data is missing.
 *
 * THIRD TIME THIS SHAPE HAS BITTEN, after the invented group list and the
 * invented breakdown designs. `export_sheet` already reads a group passed
 * as a company and says so; this is the same correction for every tool that
 * takes a NAME.
 *
 * Groups and companies are closed lists off `filterOptions`, so this is a
 * fact rather than a guess.
 */

/**
 * @param {string} name the word she searched for and did not find
 * @returns {string|null} what it actually is, or null when the word really
 *   does match nothing on the sheet
 */
async function notAPerson(name) {
  const wanted = fold(name);
  if (!wanted) return null;

  const options = await peopleRepo.filterOptions();
  const { groups = [], companies = [] } = options;

  /**
   * A REAL PERSON IS NEVER "NOT A PERSON". Live 2026-09-30: Gab is a
   * person AND a company. A group carried over from an earlier line hid
   * him, and she said "Gab is a company, not a person".
   */
  const person = (options.people ?? []).find(({ name: n }) => fold(n) === wanted);
  /**
   * STOPPED IS NOT MISSING. Live 2026-09-30: a fee for Sertan (stopped) got
   * "the group or company you named did not match", and a delete for Casey
   * (stopped) got "could not find anyone named Casey Test". Both deals were
   * in the Archive, which is the answer.
   */
  // eslint-disable-next-line global-require
  const rowsRepo = require('../../repos/masterSheetRows.repo');
  const archived = ((await rowsRepo.findAll({ stopped: true, q: name, pageSize: 20 }).catch(() => null))?.rows ?? [])
    .filter((r) => fold(r.person_name) === wanted);
  if (archived.length > 0) {
    const live = await rowsRepo.searchFuzzy({ q: name }).then((rs) => rs.filter((r) => fold(r.person_name) === wanted)).catch(() => []);
    if (live.length === 0) {
      const where = archived.map((r) => `${r.company || 'no company'} in ${r.group_name}`).join('; ');
      return `NOTHING HAS BEEN CHANGED. ${archived[0].person_name} has no live deal: `
        + `${archived.length === 1 ? 'their only deal is' : 'their deals are'} STOPPED and in the Archive (${where}). `
        + 'Say exactly that, and ask whether to resume it first. Do NOT say they were not found, '
        + 'do NOT mention a group or company not matching, and change nobody else.';
    }
  }
  if (person) {
    return `"${person.name}" IS A PERSON on the sheet. Nothing matched only because of the group or `
      + `company the call carried. Call it again with person "${person.name}" and NO group or company `
      + 'unless they named one this message. Do NOT say they are not a person.';
  }

  /**
   * ===============================
   * * A PERSON AND THEIR GROUP IN ONE WORD
   * ===============================
   * "add 100 to zayn milkman" arrived as person "Zayn Milkman". Nobody is
   * called that, so this function was reached with a value that is two real
   * things glued together, and every branch below it asks "what is this ONE
   * thing?". It answered null and she reported a missing handler.
   *
   * ONE DEFINITION with the scope resolver's, in notAGroup: the same split
   * that rewrites the arguments on the filter and bulk paths produces the
   * correction on the read paths, which have no scope step to rewrite.
   */
  const split = splitPersonAndGroup(name, options);
  if (split) {
    return `"${name}" IS TWO THINGS: the person ${split.person} and the GROUP ${split.group}. `
      + `Nobody is called "${name}" and nothing is missing from the sheet. Call the tool again `
      + `with person ${split.person} and group ${split.group}. Do NOT say anyone was not found `
      + 'and do NOT offer to add anybody.';
  }

  const exact = (list) => list.find((v) => fold(v) === wanted);
  const group = exact(groups);
  const company = exact(companies);

  const say = (kind, value, how) => `"${name}" IS NOT A PERSON, it is the ${kind} ${value}. `
    + `Nothing is missing from the sheet. Answer their question with ${how}, and do NOT offer to `
    + 'add anything: it already exists. Do not apologise for the sheet.';

  // WHICHEVER TOOL FITS THE QUESTION: naming filter_master_sheet sent "what was
  // stopped in ZZTEST" there twice, and it only holds live deals. 2026-09-28.
  const stopped = (arg) => `list_stopped_deals with ${arg} if they asked what ended or was stopped, otherwise `;
  if (group) return say('GROUP', group, `${stopped(`group ${group}`)}filter_master_sheet, group ${group}`);
  if (company) {
    return say('COMPANY', company,
      `${stopped(`company ${company}`)}filter_master_sheet, searchField company, q ${company}`);
  }

  /**
   * A TYPO STILL LANDS, which is what "exus" was.
   *
   * Only when it reaches ONE thing. Two candidates is a real question and
   * she should ask it, not have one picked for her.
   */
  // A TYPO IS A SIMILAR LENGTH. Containment is not: "Gloria" sits inside
  // the company "Gloria - Workforce" and is a real person, so matching on
  // containment alone would tell somebody their own handler is a company.
  const typo = (candidate) => {
    const c = fold(candidate);
    return Math.abs(c.length - wanted.length) <= 2
      && (mentionedIn(c, wanted) || mentionedIn(wanted, c));
  };

  const near = [
    ...groups.filter(typo).map((g) => ['GROUP', g, `filter_master_sheet, group ${g}`]),
    ...companies.filter(typo)
      .map((c) => ['COMPANY', c, `filter_master_sheet, searchField company, q ${c}`]),
  ];

  if (near.length === 1) {
    const [kind, value, how] = near[0];
    return `"${name}" is not a person, and the closest thing on the sheet is the ${kind} `
      + `${value}. Say that is what you think they meant, answer with ${how}, and do NOT offer `
      + 'to add anything.';
  }

  return null;
}

module.exports = { notAPerson };
