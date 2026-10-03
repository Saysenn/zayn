const { listTemplates } = require('../templates/xlsx');

// ***************************************************
// * WHERE THEY ARE IN BUILDING THE SHEET
// ***************************************************
//
// The gathering had no shape. She asked for a group, they answered
// something else, and there was nothing on screen saying an export was
// half built or what was still outstanding. "Where were we" had no answer
// because nobody was keeping one.
//
// DERIVED, NEVER STORED. A stage is done when the draft carries the answer,
// so it cannot drift from what the file will actually be. The only thing
// carried is `answered`, for the steps where NOTHING is a real answer:
// "every group" and "no colour" look identical to "not asked yet".

const STEP = Object.freeze({
  SHEET: 'sheet',
  GROUPS: 'groups',
  BREAKDOWN: 'breakdown',
  COLOUR: 'colour',
  DELIVERY: 'delivery',
  // LAST ON PURPOSE, and it costs no extra turn: there was already a final
  // "anything to change?" beat before building, and this gives it a
  // specific question instead of a vague one. Asked earlier it would be
  // noise, because the defaults are the boss's own set and almost always
  // right; asked here it is the moment somebody would notice a column they
  // did not want to send.
  COLUMNS: 'columns',
});

/** Human labels for a scope, so the tracker reads like a sentence. */
function scopeOf(draft) {
  const bits = [];
  if (draft.groups?.length) bits.push(draft.groups.join(', '));
  if (draft.method) bits.push(draft.method);
  if (draft.currency) bits.push(draft.currency);
  if (bits.length === 0) return 'every group';
  return bits.join(' · ');
}

/**
 * The steps, in order, each with what has been decided.
 *
 * @param {object} draft the normalised draft
 * @param {string[]} answered steps she has explicitly settled, for the ones
 *   where an empty answer is still an answer
 */
function stagesFor(draft, answered = []) {
  const said = new Set(answered);
  const label = listTemplates().find((t) => t.id === draft.template)?.label ?? draft.template;

  // Only offered when there is more than one group to split, which is the
  // same condition the route uses before it will make a zip at all.
  const splittable = (draft.groups?.length ?? 0) !== 1;

  const steps = [
    {
      id: STEP.SHEET,
      label: 'Sheet',
      value: label,
      // The template always has a value because it defaults, so this is
      // done only once they have actually said which one they want.
      done: said.has(STEP.SHEET),
    },
    {
      id: STEP.GROUPS,
      label: 'Groups',
      value: scopeOf(draft),
      // A GROUP IS PICKED, never resolved. It is a closed list off
      // filterOptions, so this step cannot be ambiguous the way a name was.
      done: said.has(STEP.GROUPS) || Boolean(draft.groups?.length),
    },
    {
      id: STEP.BREAKDOWN,
      label: 'Breakdown',
      value: (draft.breakdownDesign ?? 'none').replace(/-/g, ' '),
      done: said.has(STEP.BREAKDOWN),
    },
    {
      id: STEP.COLOUR,
      label: 'Colour',
      value: draft.primaryColor ?? 'default',
      done: said.has(STEP.COLOUR) || Boolean(draft.primaryColor),
    },
  ];

  if (splittable) {
    steps.push({
      id: STEP.DELIVERY,
      label: 'Delivery',
      // NAMED THE WAY THE ADMIN SAYS IT. 'one file' told nobody that a single
      // workbook already carries a tab per group, so 'multi tab' was heard as
      // 'multi file' and delivered a zip: the opposite of what was asked.
      value: draft.multiFile ? 'a file per group, zipped' : 'one file, a tab per group',
      done: said.has(STEP.DELIVERY) || Boolean(draft.multiFile),
    });
  }

  steps.push({
    id: STEP.COLUMNS,
    label: 'Columns',
    value: draft.hiddenColumns?.length
      ? `${draft.hiddenColumns.length} dropped`
      : 'the usual set',
    // Touching them at all settles it: somebody who has dropped a column
    // has plainly considered the question.
    done: said.has(STEP.COLUMNS) || Boolean(draft.columnsTouched),
  });

  const next = steps.find((s) => !s.done) ?? null;
  return {
    steps,
    // What she should be asking about RIGHT NOW, or null when the card is
    // ready to build. One question at a time is the whole point.
    next: next?.id ?? null,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
  };
}

/** Which steps this call settled, so the tracker moves as they answer. */
/**
 * ===============================
 * * WIDENING IS ONLY AN ANSWER IF THEY ASKED FOR IT
 * ===============================
 * `allGroups` settled the Groups step whoever set it, and she sets it
 * unprompted: "yeah I want the bank sheet" came back as "Switched the
 * document to Bank FOR EVERY GROUP", which marked Groups answered and
 * skipped a question nobody had answered. The card then could not be
 * rescoped, because the step it belonged to was gone.
 *
 * Naming groups is always an answer. Widening to all of them is an answer
 * only when their own words say so, and `said` is the one copy of those
 * words she cannot have edited on the way through.
 */
const SAID_EVERY_GROUP = /\b(all|every|everything|whole|entire|both|each)\b/i;

function answeredBy(args, before = []) {
  const now = new Set(before);
  if (args.template) now.add(STEP.SHEET);
  if (args.groups?.length) now.add(STEP.GROUPS);
  else if ((args.allGroups === true || args.everyGroup === true)
    && SAID_EVERY_GROUP.test(String(args.said ?? ''))) now.add(STEP.GROUPS);
  if (args.breakdownDesign) now.add(STEP.BREAKDOWN);
  if (args.primaryColor || args.secondaryColor || args.noColour === true) now.add(STEP.COLOUR);
  if (args.multiFile !== undefined && args.multiFile !== null) now.add(STEP.DELIVERY);
  if (args.hideColumns?.length || args.showColumns?.length || args.keepColumns === true) {
    now.add(STEP.COLUMNS);
  }
  return [...now];
}

module.exports = { stagesFor, answeredBy, scopeOf, STEP };
