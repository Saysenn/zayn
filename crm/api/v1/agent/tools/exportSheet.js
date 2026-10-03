const repo = require('../../repos/masterSheetRows.repo');
const peopleRepo = require('../../repos/people.repo');
const settingsRepo = require('../../repos/settings.repo');
const { exportCardFor } = require('../../masterSheet/exportCard');
const {
  normalise, queryFor, linkFor, columnKeysFor,
} = require('../exportDraft');
const { fold, mentionedIn } = require('./resolvePerson');
// ONE rule for a guessed year. In shared/ rather than in the tools: a
// require between two tool files was a cycle, and a cycle means undefined.
const { farOffMonth, repairMonth } = require('../../shared/guessedYear.helper');
const { stagesFor, answeredBy } = require('../exportStages');
const { listTemplates } = require('../../templates/xlsx');
const { listBreakdownDesigns } = require('../../masterSheet/breakdowns');
const { listPaletteColors } = require('../../masterSheet/breakdowns/palette');

/**
 * Diane's opening choices are a smaller product surface than the Export
 * modal. Keep the order here because this is also the order of the cards.
 * Division stays visible so the planned shape is clear, but it cannot be
 * selected until it is released for conversational exports.
 */
const DIANE_TEMPLATE_IDS = Object.freeze([
  'master-sheet',
  'monthly-sheet',
  'bank',
  'cash',
  'expensing',
  'division-sheet',
]);

function dianeTemplates() {
  const templates = new Map(listTemplates().map((template) => [template.id, template]));
  return DIANE_TEMPLATE_IDS.map((id) => {
    const template = templates.get(id);
    if (id !== 'division-sheet') return template;
    return { ...template, disabled: true, availability: 'Coming soon' };
  }).filter(Boolean);
}

const availableDianeTemplates = () => dianeTemplates().filter((template) => !template.disabled);

/**
 * A COLUMN BY THE NAME A HUMAN SAYS IT.
 *
 * They say "door number" and "accepting postals"; the keys are
 * `door_number` and `accepting_postals`. Matched loosely against the
 * template's OWN column list rather than a list typed here, so a column
 * added to a document is hideable the day it appears.
 */
function columnKey(said, template) {
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = fold(said);
  if (!wanted) return null;
  const keys = columnKeysFor(template);
  return keys.find((k) => fold(k) === wanted)
    ?? keys.find((k) => fold(k).includes(wanted) || wanted.includes(fold(k)))
    ?? null;
}

/**
 * ***************************************************
 * * She builds a sheet WITH them, not for them
 * ***************************************************
 *
 * READ ONLY, and that is the whole reason this is cheap: generating a file
 * writes nothing, so it is the one large capability that needs no confirm
 * step. KEEP IT THAT WAY. No "export and mark them paid".
 *
 * SHE DOES NOT PRODUCE A FILE, SHE PRODUCES THE LINK THAT PRODUCES ONE.
 * `/export/xlsx` is a GET whose entire input is the query string, behind
 * the same admin cookie the chat uses, so there is nothing to store, expire
 * or clean up and her file is the modal's file.
 *
 * IT OPENS A SESSION, IT DOES NOT EXPORT. "Give me the sheet" is the start
 * of building a document, not a command with a missing argument. Six
 * defaults were chosen for them and they have seen none of them, so the
 * panel IS the answer. See docs/plans/diane-export.md.
 */

/**
 * THE WHOLE CARD IN ONE CALL.
 *
 * It was a live panel that re-counted on every tick, which is a form in a
 * chat window and worse than a form in a dialog. The flow is now: talk it
 * through, see ONE card, agree, build. So this returns everything that
 * card draws, in a single round trip, and nothing changes underneath it.
 */
async function draftResult(draft, { note = '' } = {}) {
  const query = queryFor(draft);
  // ONE BUILDER, TWO CALLERS. `/export/card` redraws exactly this from the
  // same query when the page reloads or the data changes underneath, so
  // the card after a refresh cannot differ from the card before it.
  const card = await exportCardFor(query);
  // The tracker travels with the card, so the screen can show how far in
  // they are and she can ask about ONE outstanding thing at a time.
  const stages = stagesFor(draft, draft.answered);
  return {
    draft, query, ...card, stages, link: linkFor(draft), note,
    // THE CHOICES, SERVED. She named breakdown designs that do not exist
    // ("simple, detailed, full") because nothing ever gave her the list.
    // The card offers these to click; she offers the same ones to say.
    options: {
      templates: dianeTemplates(),
      designs: listBreakdownDesigns(),
      colors: listPaletteColors(),
    },
  };
}

/**
 * THE MONTH IN WORDS, because she got it wrong converting it herself.
 *
 * Real transcript: the card read `2026-08` and she said "the bank sheet for
 * September 2026". The file was right and her sentence was not, which is
 * the half a person acts on. Handed "August 2026" there is nothing to
 * convert and nothing to get wrong.
 */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthInWords(month) {
  const [year, mm] = String(month ?? '').split('-');
  const name = MONTH_NAMES[Number(mm) - 1];
  return name ? `${name} ${year}` : String(month ?? '');
}

/** The sentence the panel is introduced with. Counts, never adjectives. */
function summarise(draft, preview, fileName, {
  built = false, changed = [], stages, realGroups = [], columns = [], droppedYear = null,
  repairedFrom = null,
} = {}) {
  const label = listTemplates().find((t) => t.id === draft.template)?.label ?? draft.template;
  const where = draft.groups.length ? ` for ${draft.groups.join(', ')}` : '';
  const people = preview.people === 1 ? '1 person' : `${preview.people} people`;
  const rows = preview.rows === 1 ? '1 row' : `${preview.rows} rows`;

  if (preview.rows === 0) {
    return `NOTHING MATCHES that${where}, so there is no file to make. Say so plainly, give the `
      + 'reason, and offer to widen it. Do NOT offer to build an empty one.';
  }

  // SAYING GO IS THE END OF THE SESSION. She described the panel back three
  // times to an admin saying "go export it", because building was a button
  // she could not press and she had nothing else to do with the word.
  if (built) {
    return `BUILT. ${fileName} is downloading now: ${label}${where}, ${monthInWords(draft.month)}, `
      + `${rows}, ${people}. Say ONE line naming the file and what is in it, and say `
      + `${monthInWords(draft.month)}, which is the month it IS. `
      + 'It is done, so do NOT ask them to say go again and do NOT describe the panel.';
  }

  const moved = changed.length ? `You just changed: ${changed.join(', ')}. ` : '';

  /**
   * THE COUNT IS SAID ONCE, NOT EVERY TURN.
   *
   * Handed the same head each time she opened three replies in a row with
   * "The bank sheet for NEXUS in September 2026 has 2 rows and 2 people".
   * That is the reflex fault again: nothing was wrong with the sentence,
   * only with hearing it four times. After the first card they can SEE the
   * count, so the turn is worth only what changed and the next question.
   */
  const first = stages.done === 0 && changed.length === 0;

  /**
   * SHE ASKED FOR A YEAR NOBODY SAID, AND THE CARD REFUSED IT.
   *
   * Live: "the september sheet" became 2023, the guard dropped it, the card
   * and the FILE were both correct at 2026-09, and she then announced "I
   * switched the sheet to September 2023" and built "the bank sheet for
   * September 2023". Everything was right except the half a person reads.
   *
   * The guard is silent by design; the sentence must not be.
   */
  const yearNote = droppedYear
    ? `\n\nYOU ASKED FOR ${monthInWords(droppedYear)} and they never said that year, so the card `
      + `is ${monthInWords(draft.month)}. Say the month it ACTUALLY is, and ask which year they `
      + 'meant. Do NOT describe it as the month you asked for.'
    : '';

  /**
   * REPAIRED IS STILL NOT WHAT SHE ASKED FOR.
   *
   * The year she guessed is now corrected rather than thrown away, so the
   * card and the file are right. Her own argument still said 2023, and
   * narrating an argument instead of the card is the whole fault: the file
   * was correct and the sentence announcing it was not.
   */
  const fixedNote = repairedFrom
    ? `\n\nYOU ASKED FOR ${monthInWords(repairedFrom)}. They named the month and not the year, so `
      + `the card is ${monthInWords(draft.month)}, which is the nearest one. Say `
      + `${monthInWords(draft.month)}. Do NOT say ${monthInWords(repairedFrom)}.`
    : '';

  const head = `THE CARD IS ON THEIR SCREEN: ${label}${where}, ${monthInWords(draft.month)}, `
    + `${rows}, ${people}, saving as ${fileName}.${yearNote}${fixedNote}\n\n`
    + `Step ${stages.done + (stages.next ? 1 : 0)} of ${stages.total}. ${moved}`
    + (first
      ? 'Say ONE short line naming the shape and the count, then '
      : 'DO NOT repeat the shape and the count: you have already said them and they are on the '
        + 'card. Open with what CHANGED, or go straight to the question. Never open two replies '
        + 'the same way. Then ');

  /**
   * ONE QUESTION, AND THE SERVER PICKS IT.
   *
   * Left to decide for herself she asked two things at once, or none, or
   * about columns that were already right. The outstanding step is derived
   * from the draft, so the order is the same every time and nothing is
   * asked twice.
   */
  /**
   * ===============================
   * * THE OPTIONS ARE ON SCREEN. DO NOT READ THEM OUT.
   * ===============================
   *
   * Every question used to recite its list: "master sheet, sheet for a
   * month, expensing, cash, or bank?". A list in a sentence is not a choice,
   * and the same choices are sitting under the question as buttons. The
   * admin's word for it was confusing.
   *
   * The list still travels, because "what are my options" has to be
   * answerable and because SHE MUST NEVER INVENT ONE. She told an admin the
   * breakdowns were "none, simple, detailed and full"; three of those do
   * not exist. So: given, never recited.
   */
  const ASK = {
    sheet: 'ASK WHICH SHAPE, in ONE short question. They are on screen as buttons, so do NOT '
      + `list them. Selectable choices are: ${availableDianeTemplates().map((t) => t.label).join(', ')}. `
      + 'Division Sheet is visible but marked Coming soon and cannot be selected. Name the '
      + 'choices only if they ask what the options are. Crypto is the bank shape filtered to '
      + 'coin, and there is no driver sheet yet: say either only if it comes up.',
    groups: `ASK WHICH GROUP, in ONE short question, or all of them. They are on screen as buttons, so do NOT list them. THE GROUPS ARE: ${realGroups.join(', ')}, and no others. A sheet is by GROUP: if they name a PERSON, say you build by group now and ask which group that person is in. Do not raise the month, it is already this one.`,
    breakdown: `ASK WHICH BREAKDOWN, in ONE short question. Each one is on screen with its own description, so do NOT list them or describe them. THE DESIGNS ARE, and there are no others: ${listBreakdownDesigns().map((d) => `"${d.label}" (${d.id})`).join(', ')}. None is one of them.`,
    colour: `ASK WHAT COLOUR, in ONE short question, and say they can skip it. The swatches are on screen, so do NOT name the colours. THEY ARE: ${listPaletteColors().map((c) => c.label).join(', ')}.`,
    delivery: 'ASK ONE WORKBOOK WITH A TAB PER GROUP, or a SEPARATE FILE PER GROUP zipped, in ONE '
      + 'short question. Both are on screen as buttons. "Multi tab" is the FIRST one: a single '
      + 'workbook already has a tab per group. Only worth asking because more than one group is '
      + 'in scope. '
      // SHE INVENTED A RESTRICTION. Asked for separate files on the bank
      // sheet she said "that is not available for the bank sheet" and "one
      // file is the only option", both untrue. A limit she made up is worse
      // than a wrong setting: they stop asking for something they can have.
      + 'BOTH ARE AVAILABLE ON EVERY SHAPE. There is no template that supports one and not the '
      + 'other, and you must never say there is. If they ask for separate files, set multiFile '
      + 'true and let the card show the zip.',
    // THIS IS ALSO THE BUILD OFFER, which is why it is last and why it
    // costs no extra turn. Asked any earlier it would be noise: the
    // defaults are the boss's own set for that document and almost always
    // right. Asked here it is the moment somebody notices a column they
    // did not want to send.
    columns: `ASK WHETHER ANY COLUMN SHOULD COME OUT, in ONE short question, and say you are ready to build otherwise. EVERY COLUMN IS LISTED ON THE CARD with a checkbox, so do NOT read them back. They are, and there are no others: ${columns.map((c) => c.header).join(', ')}. This is the last question: if they say go, build it; if they name columns, use hideColumns; if they say the columns are fine, pass keepColumns true.`,
  };

  if (stages.next) {
    return `${head}${ASK[stages.next]}\n\n`
      + 'ONE THING AT A TIME, and KEEP IT SHORT: a question, not a menu. Everything you could '
      + 'list is already on the card in front of them. Do not ask about anything further down '
      + 'the list, do NOT read the card back, and do not offer to build until every step is '
      + 'settled.';
  }

  return `${head}Everything is settled. `
    + 'ASK IF ANYTHING SHOULD CHANGE before you build it. Do NOT read the card back: the columns, '
    + 'the breakdown, the colour and the warnings are all on it. When they are happy, call this '
    + 'again with build true. Nothing is built until they say so.';
}

const exportSheet = {
  name: 'export_sheet',
  description:
    'Open the EXPORT PANEL and start building a sheet with them. Use it for "give me the bank '
    + 'sheet for BETA", "the cash run for August", "export", "I need a file", "who is paid in '
    + 'crypto as a sheet". READ ONLY: it writes nothing and builds nothing, it puts the choices '
    + 'on screen with a live count so they can see the document before it exists. '
    + 'NEVER guess a filter they did not say. Pass only what they told you and leave the rest '
    + 'to the panel\'s own defaults. '
    + 'CRYPTO IS NOT A TEMPLATE: use template "bank" with method "crypto". '
    + 'If they name people, put the names in `people` and let this resolve them; an unresolvable '
    + 'name refuses the whole export rather than quietly leaving somebody out.',
  parameters: {
    type: 'object',
    properties: {
      template: {
        type: 'string',
        enum: availableDianeTemplates().map((t) => t.id),
        description: 'The document SHAPE. Omit for the month sheet, which is the usual one.',
      },
      month: { type: 'string', description: 'YYYY-MM. Omit for this month; never carry an old one forward.' },
      groups: {
        type: 'array',
        items: { type: 'string' },
        description: 'One or more groups, e.g. ALPHA. Omit to leave the scope as it is; use '
          + '`allGroups` to WIDEN it back to every group.',
      },
      /**
       * WIDENING IS ITS OWN ACT, because omitting is not clearing.
       *
       * A card set to MILKMAN and INDIGO, then "actually no, all of them":
       * she sent no `groups` at all, which merges as "unchanged", so the
       * card stayed on two groups and she confirmed it back as though it
       * had widened. Clearing needed an explicit empty array and nothing
       * told her that.
       *
       * Worse here than elsewhere because "ALL GROUPS" is a REAL group on
       * this sheet, so "all of them" is genuinely ambiguous and she has to
       * be able to say which one she meant.
       */
      allGroups: {
        type: 'boolean',
        description: 'TRUE means EVERY group, clearing whatever groups are on the card. Use it '
          + 'for "all of them", "the whole sheet", "every group". NOTE: "ALL GROUPS" is also the '
          + 'name of one real group; if they mean that ONE group, put it in `groups` instead.',
      },
      // KEPT SO A NAMED SET IS REFUSED OUT LOUD. Removing it entirely would
      // leave her improvising: a sheet by person is no longer a thing, and
      // she has to say so rather than quietly exporting a group instead.
      people: {
        type: 'array',
        items: { type: 'string' },
        description: 'DO NOT USE. A sheet is by GROUP now, never by a hand picked set of people. '
          + 'If they name people, ask which GROUP those people are in instead.',
      },
      company: { type: 'string' },
      method: { type: 'string', enum: ['cash', 'bank', 'crypto'] },
      currency: { type: 'string', description: 'GBP, AED, EURO, USD' },
      status: { type: 'string', enum: ['active', 'ended', 'not_started'] },
      needsReview: { type: 'boolean' },
      multiFile: {
        type: 'boolean',
        description: 'TRUE means one SEPARATE FILE PER GROUP, delivered as a zip. FALSE, the default, '
          + 'means ONE FILE WITH A TAB PER GROUP. "Multi tab", "tabs", "one workbook" and "all in '
          + 'one file" are all FALSE: a single workbook already has a tab per group, and setting this '
          + 'true for them delivers the opposite of what they asked. "Separate files", "a file each" '
          + 'and "zip" are TRUE. Does nothing on a single group.',
      },
      // THE PANEL IS STEERABLE BY VOICE, so the shape options are here too.
      // Without them "make it blue" or "no breakdowns" had nowhere to land
      // and she would have had to tell them to use the mouse.
      breakdownDesign: {
        type: 'string',
        description: 'The breakdown block\'s shape. "none" is one of the designs, NOT a separate '
          + 'off switch: "no breakdowns" means this set to none.',
      },
      // NO COUNT IN THE WORDS. It said "the five palette colours" and there
      // were six, because a number in prose goes stale the moment one is
      // added. The allow list is the palette itself, see COLOR_IDS.
      primaryColor: { type: 'string', description: 'A palette colour id, e.g. blue. Paints the header band' },
      secondaryColor: { type: 'string', description: 'A palette colour id. Paints the tints, including an amount out of the month' },
      // HIDE AND SHOW, never an include list. "Uncheck the door number" is
      // one word from them; an include list would have made it twenty three.
      hideColumns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Columns to REMOVE from the sheet, as the admin says them ("door number", '
          + '"sort code", "accepting postals"). Adds to whatever is already hidden. Use this for '
          + '"uncheck X", "drop X", "I do not need X". A required column cannot be hidden.',
      },
      showColumns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Columns to bring BACK, for "put the phone number back" or "actually keep X".',
      },
      build: {
        type: 'boolean',
        description: 'TRUE only when they have said to go ahead: "go", "build it", "export it", '
          + '"yes do it". It downloads the file and ENDS the session. Never true on the first '
          + 'call, and never true because you think the panel looks finished.',
      },
      // PAUSE AND CANCEL ARE DIFFERENT ACTS and each says what survives,
      // the same rule Delete and Remove already follow. They were buttons
      // only, so "pause that" reached nothing and she had to pretend.
      pause: {
        type: 'boolean',
        description: 'TRUE for "pause that", "hold on", "later", "not now", "leave it for now". '
          + 'It KEEPS every choice and collapses the panel to a chip. Say what is kept.',
      },
      // SAYING "ANY COLOUR" IS AN ANSWER, and it looks
      // exactly like silence in the draft. Without these the tracker asked
      // the same step forever because nothing ever landed in it.
      noColour: {
        type: 'boolean',
        description: 'TRUE when they said they do not mind, any colour, skip it. It settles the '
          + 'COLOUR step and leaves the default.',
      },
      keepColumns: {
        type: 'boolean',
        description: 'TRUE when they looked at the columns and want them as they are: "those are '
          + 'fine", "leave them", "all of them". It settles the COLUMNS step and changes nothing.',
      },
      cancel: {
        type: 'boolean',
        description: 'TRUE for "forget it", "cancel that", "never mind", "drop it". The panel '
          + 'GOES. Nothing was written and no file was built, so there is nothing to undo and no '
          + 'confirm to ask for. Never guess between this and pause: keeping is not dropping.',
      },
    },
  },

  async handler(args) {
    /**
     * A BARE NAME IS ALMOST ALWAYS A GROUP.
     *
     * "Give me the bank sheet for Nexus" was read as a COMPANY, matched
     * nothing, and she told them no such company existed while NEXUS sat
     * there as a group. The admin had to say "I mean group, Nexus group".
     *
     * Corrected in code rather than in the description, because the cost of
     * getting it wrong is a flat denial of something that plainly exists.
     */
    const args2 = { ...args };
    let corrected = null;
    const { groups: realGroups = [] } = await peopleRepo.filterOptions();

    /**
     * A GROUP SHE WAS NOT GIVEN IS AN INVENTED FILTER.
     *
     * Live transcript. Told "carry on" she called this with
     * `groups: ['INDIGO']`, a group nobody had mentioned, and the card
     * narrowed from 21 rows to 9. A sheet quietly missing twelve rows looks
     * exactly like a sheet that never had them.
     *
     * So a group must be in what they SAID, or already on the open card.
     * Checked here rather than asked for in the prompt, because "pass only
     * what they said" was already in the prompt when this happened.
     */
    // NO ADMIN TEXT MEANS NOTHING TO CHECK AGAINST. `runAgent` always
    // injects it; a caller that does not is not in a position to be
    // second-guessed, and dropping a filter blind would be worse than the
    // fault this catches.
    const invented = !args.said ? [] : (args2.groups ?? []).filter((g) => {
      const onCard = (args.open?.groups ?? []).some((k) => fold(k) === fold(g));
      return !onCard && !mentionedIn(fold(args.said), fold(g));
    });
    if (invented.length > 0) {
      args2.groups = (args2.groups ?? []).filter((g) => !invented.includes(g));
    }
    if (args2.company && !args2.groups?.length) {
      const { groups = [], companies = [] } = await peopleRepo.filterOptions();
      const said = String(args2.company).trim().toLowerCase();
      const isCompany = companies.some((c) => String(c).trim().toLowerCase() === said);
      const asGroup = groups.find((g) => String(g).trim().toLowerCase() === said);
      // Only when it is NOT also a company. A name that is both is
      // genuinely ambiguous and the admin's own word wins.
      if (!isCompany && asGroup) {
        corrected = asGroup;
        args2.groups = [asGroup];
        args2.company = null;
      }
    }

    /**
     * A SHEET IS DESCRIBED BY ITS GROUPS, and picking people is gone.
     *
     * It used to take a list of names. Two reasons it went:
     *
     * THE AND TRAP. `applyFilters` INTERSECTS group and personId, so
     * "everyone in INDIGO plus Gloria from MILKMAN" matched nothing at all.
     * One question with two ways to answer it, and one of those quietly
     * handed over an empty file.
     *
     * AND A WHOLE CLASS OF GUESSWORK. Every name went through
     * `resolvePerson`, which can refuse the export, ask which Gloria, or be
     * handed a name she had shortened. A group is a closed list off
     * `filterOptions`: picked, never resolved, never ambiguous.
     *
     * The export MODAL keeps person filtering. It is a form, so the AND is
     * visible and an empty result is obviously the filter's doing.
     */
    if ((args2.people ?? []).length > 0) {
      return {
        summary: 'A SHEET IS BY GROUP, not by person. Say you cannot build one from a hand '
          + 'picked set of people any more, name the groups those people are in, and ask which '
          + 'group or groups they want. Nothing was opened and nothing was built.',
      };
    }

    /**
     * SHE EDITS THE PANEL THAT IS OPEN, not a fresh one.
     *
     * `open` is the live draft, sent back by the client each turn. Without
     * it every call started from nothing: asked to hide three columns she
     * had no idea what the other twenty were, so she claimed to have done
     * it, called no tool, and the screen did not move.
     */
    const open = args.open ?? null;

    /**
     * PAUSE AND CANCEL SHORT CIRCUIT. Neither recounts, neither rebuilds,
     * and both need a panel to be open: "forget the sheet" with nothing
     * open is a misread, and acting on it would look like something
     * happened.
     */
    if (args.cancel === true || args.pause === true) {
      if (!open) {
        return {
          summary: 'There is NO export panel open, so there is nothing to pause or drop. Say so '
            + 'in one line and ask if they meant to start one.',
        };
      }
      if (args.cancel === true) {
        return {
          summary: 'The export panel is GONE. Nothing was written and no file was built, so there '
            + 'is nothing to undo. Say that in one short line: what did NOT happen is the '
            + 'reassurance worth giving. Do not ask them to confirm, it is already done.',
          exportCancel: true,
        };
      }
      return {
        summary: 'PARKED, and every choice is kept. It is on their screen as a chip they can tap. '
          + 'Say it is kept and how to bring it back ("the sheet", "carry on"), in one line.',
        exportPause: true,
      };
    }

    const base = open ? { ...open, ...args2 } : args2;

    /**
     * A NEW TEMPLATE MEANS A NEW PRESET, or the rows are the old ones.
     *
     * The preset is DERIVED from the template, but an open card already
     * carries one, and spreading it over kept it. Switching a month sheet
     * to the bank sheet therefore kept `expensing`, which filters nothing:
     * NEXUS came out at SIX rows, its whole group, when the bank run is
     * TWO. A payout file with four extra people on it.
     *
     * Dropped so `normalise` derives it again, unless they named a preset
     * on this very turn.
     */
    if (open && args2.template && args2.template !== open.template && !args2.preset) {
      delete base.preset;
    }

    // HIDE AND SHOW ACCUMULATE against what is already hidden. "Uncheck the
    // door number" is one word from them and must not require the other
    // twenty three.
    const template = args2.template ?? open?.template;
    const hidden = new Set(open?.hiddenColumns ?? []);
    const changed = [];

    for (const said of args.hideColumns ?? []) {
      const key = columnKey(said, template);
      if (key) { hidden.add(key); changed.push(`hid ${said}`); }
    }
    for (const said of args.showColumns ?? []) {
      const key = columnKey(said, template);
      if (key && hidden.delete(key)) changed.push(`brought back ${said}`);
    }
    base.hiddenColumns = [...hidden];
    // Their choice only counts as theirs once they have made one. Until
    // then the template's own set is the default and it re-derives when the
    // template changes.
    base.columnsTouched = Boolean(open?.columnsTouched) || changed.length > 0;

    if (corrected) changed.push(`read ${args.company} as the ${corrected} GROUP, not a company`);

    /**
     * A TEMPLATE SWITCH IS NEVER A SIDE EFFECT.
     *
     * Asked only to uncheck three columns she also sent `template:
     * bank-details`, and the file quietly became NEXUS - BANK DETAILS. The
     * admin asked about columns; the DOCUMENT changed underneath them.
     *
     * It cannot be refused here: switching template while hiding a column
     * is a legitimate thing to ask for. So it is REPORTED, loudly enough
     * that she has to say it and they can catch it.
     */
    if (open && args2.template && args2.template !== open.template) {
      const was = listTemplates().find((t) => t.id === open.template)?.label ?? open.template;
      const now = listTemplates().find((t) => t.id === args2.template)?.label ?? args2.template;
      changed.push(`SWITCHED THE DOCUMENT from ${was} to ${now}, which you must say out loud`);
    }

    // WHERE THEY ARE IN BUILDING IT. Derived from the draft, plus the
    // steps she has settled, for the ones where "every group" and "no
    // colour" are real answers that look like silence.
    base.answered = answeredBy(args, open?.answered ?? []);
    if (invented.length > 0) changed.push(`IGNORED the group ${invented.join(', ')}, which nobody asked for`);

    /**
     * A GUESSED YEAR BUILDS AN EMPTY FILE.
     *
     * "The September sheet" with no year became September 2024 on a read
     * and answered zero. Here it is worse: it produces a WORKBOOK, named
     * for that month, with nothing in it, and a file is harder to disbelieve
     * than a sentence. Dropped rather than refused, so the export they
     * meant still happens. Same rule as the totals: see farOffMonth.
     */
    // THIS TURN'S month, never the one already on the card. `base` is the
    // open draft merged with this call, so checking it would drop a month
    // set two turns ago and silently re-date the export on an unrelated
    // "make it blue". Caught by test:drift, which is what it is for.
    // REPAIRED FIRST. "The august sheet" is the nearest August, not the
    // 2024 she wrote and not this month either. Only a month word she
    // cannot place falls through to the drop.
    let droppedYear = null;
    let repairedFrom = null;
    if (args2.month) {
      const fixed = repairMonth(args2.month, args.said);
      if (fixed) {
        if (fixed !== args2.month) repairedFrom = args2.month;
        base.month = fixed;
      } else if (farOffMonth(args2.month, args.said)) {
        droppedYear = args2.month;
        delete base.month;
      }
    }

    // WIDENING IS ITS OWN ACT. Omitting `groups` means "unchanged", so
    // "all of them" left the card on the two it already had.
    // `everyGroup` is accepted as a legacy alias for sessions opened before
    // `allGroups` became the single public flag. Either spelling must both
    // clear the filter and settle the Groups step.
    if (args.allGroups === true || args.everyGroup === true) {
      base.groups = [];
      changed.push('every group');
    }

    /**
     * ===============================
     * * "MULTI TAB" IS ONE FILE, AND WORDING DID NOT FIX IT
     * ===============================
     *
     * A single workbook ALREADY carries a tab per group, which is
     * `multiFile: false`. Asked for "multi tab only" she set it TRUE and
     * delivered a zip: the opposite. I rewrote the parameter description
     * and the card wording, and she did it again on the next live run.
     *
     * Prompting is not a guard. TABS are the one word that cannot mean
     * separate files, so when they say it, the flag is forced.
     */
    if (args.multiFile === true && /\btabs?\b/i.test(String(args.said ?? ''))
      && !/\b(separate|per group|each|zip|zipped)\b/i.test(String(args.said ?? ''))) {
      base.multiFile = false;
      changed.push('one file with a tab per group, which is what tabs means');
    }

    // ONE SETTING, READ ONCE, so her default columns match the export
    // modal's. With the end date deciding what a month owes, a file without
    // that column shows a red payment start and no reason for it.
    const useEndDate = Boolean((await settingsRepo.get()).color_uses_end_date);
    const draft = normalise(base, { useEndDate });
    const result = await draftResult(draft);
    // The real groups ride along for the card's picker, same list she is
    // told to name. One source, two places it is offered.
    result.options.groups = realGroups;
    if (result.preview.rows === 0) {
      return { summary: summarise(draft, result.preview, result.fileName) };
    }

    // BUILDING IS AN ACT, and it ends the session. The download happens in
    // the browser, so this flags it rather than doing it: the file is a GET
    // the client already knows how to fetch with progress.
    const built = args.build === true;

    /**
     * ===============================
     * * A BUILD MAY NOT CHANGE THE DOCUMENT
     * ===============================
     *
     * Live: the card on screen was the BANK sheet over every group, as a
     * zip. "Can we proceed with the export, please?" produced
     * `MILKMAN - MASTER SHEET - 2026-09.xlsx`. A different shape and a
     * different scope, from a sentence that changed neither.
     *
     * "Proceed", "go" and "build it" are agreement to WHAT IS ON SCREEN.
     * Anything else arriving on the same call is her filling in blanks, and
     * the admin has no way to notice: they asked for the file they were
     * looking at and got a different one with a plausible name.
     *
     * So a build that also moves the shape or the scope REFUSES and asks.
     * Changing them is a perfectly good request; it is just not this one,
     * and it costs a turn to say so.
     */
    if (built && open) {
      const movedShape = args2.template && args2.template !== open.template;
      const before = [...(open.groups ?? [])].sort().join(',');
      const after = [...(draft.groups ?? [])].sort().join(',');
      const movedScope = Boolean(args2.groups?.length) && before !== after;

      if (movedShape || movedScope) {
        const wasLabel = listTemplates().find((t) => t.id === open.template)?.label ?? open.template;
        const nowLabel = listTemplates().find((t) => t.id === draft.template)?.label ?? draft.template;
        return {
          summary: 'NOTHING HAS BEEN BUILT. The card on their screen is the '
            + `${wasLabel}${open.groups?.length ? ` for ${open.groups.join(', ')}` : ' for every group'}, `
            + `and this call would build the ${nowLabel}`
            + `${draft.groups?.length ? ` for ${draft.groups.join(', ')}` : ' for every group'} instead. `
            + 'Saying "go" or "proceed" means the file they are LOOKING AT. Ask which they meant: '
            + 'build the card as it stands, or change it first and then build. Do not do both in '
            + 'one step.',
        };
      }
    }

    return {
      summary: summarise(draft, result.preview, result.fileName, { built, changed, stages: result.stages, realGroups, columns: result.columns, droppedYear, repairedFrom }),
      // THE FINISHED CARD, in one call. It draws only what is in here:
      // the settings, the columns the file will carry with their real
      // headers, five real rows and the warnings. Nothing to fetch, nothing
      // to re-count, nothing to change underneath them.
      exportSession: { ...result, build: built },
    };
  },
};

module.exports = { exportSheet, draftResult, summarise, dianeTemplates };
