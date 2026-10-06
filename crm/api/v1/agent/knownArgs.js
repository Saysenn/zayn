/**
 * ***************************************************
 * * A FILTER SHE DOES NOT HAVE IS REFUSED, NEVER IGNORED
 * ***************************************************
 *
 * Every tool handler spreads its arguments into a repo call, and a repo
 * destructures the keys it knows. So a parameter that does not exist is
 * dropped in silence, the query runs UNFILTERED, and the rows that come
 * back are the whole sheet described as the answer to a narrower question.
 *
 *   filter_master_sheet({ location: 'Manchester' })
 *     -> every row on the sheet
 *     -> "here are the 96 rows in Manchester"
 *
 * This is the same fault as the missing `endWhen` and the missing
 * `paymentStartWhen`, one layer down: she does not refuse when a filter is
 * absent, she reaches for something that exists and the answer is confident
 * and wrong. There it was the wrong column; here it is no column at all.
 *
 * SO THE ARGUMENTS ARE CHECKED AGAINST THE SCHEMA, once, for every tool.
 * A tool cannot forget to do this and a new tool gets it for nothing.
 *
 * IT NAMES WHAT SHE COULD HAVE USED, because a bare refusal makes her try
 * the same invented name again. The near-miss list is what turns a refusal
 * into a working second attempt.
 */

// Injected by runAgent AFTER this check, never sent by the model. Listed
// so that adding one here is a deliberate act rather than a hole.
const INJECTED = ['said', 'saidRecent', 'priorAnswer', 'open', 'onProgress', 'turn'];

/** Folded for comparison, so `payment_method` reads as `paymentMethod`. */
const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The parameters that look like what she tried, so the refusal is useful.
 * A prefix either way catches `end`/`endWhen` and `method`/`paymentMethod`.
 */
function nearestTo(wrong, allowed) {
  const want = fold(wrong);
  return allowed.filter((k) => {
    const has = fold(k);
    return has.startsWith(want) || want.startsWith(has) || has.includes(want) || want.includes(has);
  });
}

/**
 * @returns {string|null} the refusal to hand back, or null when every
 *   argument is real.
 */
function unknownArgs(tool, args) {
  const allowed = Object.keys(tool?.parameters?.properties ?? {});
  // A tool that declares no parameters takes none, but several are called
  // with an empty object and must not be refused for it.
  if (allowed.length === 0) return null;

  const wrong = Object.keys(args ?? {}).filter(
    (k) => !allowed.includes(k) && !INJECTED.includes(k),
  );
  if (wrong.length === 0) return null;

  /**
   * ===============================
   * * AN ARGUMENT THAT BELONGS TO ANOTHER TOOL NAMES THAT TOOL
   * ===============================
   * Seen 2026-09-23 in `scripts/dianeChat.js`. Told "yes, go ahead" to a
   * pending three person edit, she re-issued it as
   * `update_master_sheet_row` carrying `perPerson`, and the refusal listed
   * twenty filters that tool DOES take without mentioning the one tool
   * that takes the argument she sent. She then wandered off into three
   * unrelated lookups and the agreed change was never made.
   *
   * A wrong argument is usually the right argument on the wrong tool, so
   * the refusal says which tool it is.
   */
  // An increment on a rate for named people is their PROFILE: the bulk tool
  // has no delta, and refusing it sent her off asking for a group. 2026-09-25.
  const OWNED_BY = {
    perPerson: 'bulk_update_master_sheet',
    set: 'bulk_update_master_sheet',
    addonPercentDelta: 'update_person',
    feePercentDelta: 'update_person',
  };

  // SEVERAL PEOPLE on a one deal tool: the right tool depends on the field,
  // and a bare refusal cost six calls on "add 3% to orla and ines". 2026-09-25.
  const SEVERAL = '"people" is several people, and this tool edits ONE deal. A RATE for them is '
    + 'update_person with people; any other field is bulk_update_master_sheet with people.';

  // AN AMOUNT ADDED has one door: she sent "payableAmountDelta" to the one
  // deal tool, was refused, and told the admin it could not be done. 2026-09-25.
  const ADDED = /^(?:add|(?:payableAmount|monthlyAmount|payableDays)Delta)$/;
  const ADD_DOOR = 'An amount ADDED is `add: { monthlyAmount: N }` (payableAmount only when they said '
    + 'payable): on update_master_sheet_row for one deal, or bulk_update_master_sheet perPerson for '
    + 'several. It can be done.';

  // ON A READ TOOL it pointed nowhere, and "end Dov's review deals" ended in
  // "I can't filter by person". 2026-09-25.
  const PEOPLE_READ = '"people" is not taken here. ONE person is `q` with their name. Deals up for '
    + 'review are list_monthly_review, and ending them is bulk_answer_monthly_review, both with person.';

  /**
   * ===============================
   * * AND ONE PERSON ON A READ TOOL IS `q`, NOT AN IMPOSSIBILITY
   * ===============================
   * Live 2026-09-29. She sent `person` to `filter_master_sheet`, which has
   * no such argument, and the closing line below told her to say plainly
   * that she could not narrow by it. She did:
   *
   *   "I can't filter by people and group together, darling. I can find
   *    Zayn Milkman or deals in MILKMAN, but not both at once."
   *
   * NONE OF THAT IS TRUE. `q` searches the name and sits beside `group`,
   * so a person in a group is one call. A refusal that produces a false
   * statement about the CRM is worse than the wrong argument it caught,
   * because the admin believes it.
   */
  const PERSON_READ = '"person" is not taken here, and that does NOT mean a person cannot be '
    + 'narrowed to. `q` IS their name and it works BESIDE `group`, so one person in one group is '
    + 'one call: send q with the name and keep the group. Do NOT tell them this cannot be done.';

  const lines = wrong.map((k) => {
    if (k === 'people' && tool.writes) return SEVERAL;
    if (k === 'people') return PEOPLE_READ;
    if (k === 'person' && !tool.writes) return PERSON_READ;
    if (ADDED.test(k) && tool.name !== 'bulk_update_master_sheet') return `"${k}": ${ADD_DOOR}`;
    const owner = OWNED_BY[k] && OWNED_BY[k] !== tool.name ? OWNED_BY[k] : null;
    if (owner) {
      return `"${k}" belongs to ${owner}, not ${tool.name}. `
        + `Call ${owner} instead, with the same arguments.`;
    }
    const near = nearestTo(k, allowed);
    return near.length > 0
      ? `"${k}" is not a filter. Did you mean ${near.join(' or ')}?`
      : `"${k}" is not a filter on ${tool.name}.`;
  });

  return `NOTHING WAS SEARCHED. ${lines.join(' ')}\n\n`
    + `The only ones that exist are: ${allowed.join(', ')}.\n\n`
    + 'A filter that does not exist is IGNORED by the query, so the answer would have been the '
    + 'whole sheet described as something narrower. Call it again with a real one, or tell them '
    + 'plainly that you cannot narrow by that and offer the closest thing you can.';
}

/**
 * A field sent beside `set` instead of inside it is MOVED in, never refused.
 * "Give everyone at co B a 1% fee" sent feePercent as a filter and ended in "I can't". 2026-09-25.
 */
function foldIntoSet(tool, args) {
  const top = tool?.parameters?.properties ?? {};
  const settable = top.set?.properties;
  if (!settable || !args || args.perPerson) return args;
  const stray = Object.keys(args).filter((k) => !top[k] && settable[k] && !INJECTED.includes(k));
  if (stray.length === 0) return args;
  const out = { ...args, set: { ...(args.set ?? {}) } };
  for (const k of stray) {
    if (out.set[k] === undefined) out.set[k] = args[k];
    delete out[k];
  }
  return out;
}

/**
 * THE SEARCH WORD IS `q` EVERYWHERE BUT ONE TOOL, which calls it `name`. Sent as `q`
 * there, "show me nexus deals" was refused and she asked what Nexus is. 2026-09-28.
 * Moved, never refused, the same as foldIntoSet.
 */
function foldSearchWord(tool, args) {
  const top = tool?.parameters?.properties ?? {};
  if (!args || top.q || !top.name || args.q == null || args.name != null) return args;
  const { q, ...rest } = args;
  return { ...rest, name: q };
}

module.exports = { unknownArgs, foldIntoSet, foldSearchWord, INJECTED };
