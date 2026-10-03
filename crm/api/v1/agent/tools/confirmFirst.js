/**
 * ***************************************************
 * * THE TWO CALL SHAPE, for anything that cascades
 * ***************************************************
 *
 * The rule in `.claude/CLAUDE.md`: a tool that WRITES needs the two call
 * shape if it can touch more than one row. `bulk_update_master_sheet` had
 * it. `rename_company` did not, and it rewrites every deal it reaches.
 *
 * THEIR DESCRIPTIONS SAID "ALWAYS CONFIRM FIRST" and that is not a guard.
 * Real transcript: asked to rename a company she asked "shall I go ahead?"
 * without calling anything, was never answered, and on the next turn
 * described the deals as already carrying the new name. The database
 * disagreed. She had invented the confirmation AND its result.
 *
 * With this, the first call CANNOT change anything and says so in its own
 * words, so there is nothing for her to misreport.
 */

/**
 * @param {boolean} confirmed  the tool's own `confirmed` argument
 * @param {object} preview
 * @param {string} preview.act     what would happen, in her words
 * @param {number} preview.count   how many rows it reaches
 * @param {string} preview.noun    'deal' / 'row', singularised here
 * @param {string} [preview.plural] where adding an "s" is wrong. It said
 *   "2 companys" the first time a noun ending in y came through, in the
 *   preview for the widest write in the CRM.
 * @param {string} [preview.keeps] what SURVIVES, which every confirm must say
 * @param {string[]} [preview.lines] THE LIST ITSELF, one row per line, when
 *   a count is not enough to judge by. A mixed act ("this one final, that
 *   one ended") cannot be confirmed from a number: the admin has to see
 *   which deal got which answer, or a single wrong line is invisible.
 *   Relayed VERBATIM, never summarised, for the same reason.
 * @returns {object|null} the summary to return, or null to proceed
 */
function confirmFirst(confirmed, {
  act, count, noun = 'deal', plural, keeps = '', lines = null, identity = null,
}) {
  if (confirmed === true) return null;

  const many = plural ?? `${noun}s`;
  const rows = `${count} ${count === 1 ? noun : many}`;
  const listed = Array.isArray(lines) && lines.length > 0;
  const block = listed ? `\n\n${lines.join('\n')}` : '';
  /**
   * ===============================
   * * THE LINES ARE VERBATIM. THE REST IS NOT.
   * ===============================
   * "Relay the block above EXACTLY as written" was read as "relay ALL of
   * this", so she opened an answer with "NOTHING HAS BEEN CHANGED YET, and
   * nothing will be until you say yes" and read the instructions addressed
   * to her out to the admin. Live 2026-09-24. It is machine output with a
   * question at the end.
   *
   * The two halves are separated: the LIST may not move, because one wrong
   * line is invisible in a summary of it. Everything around the list is
   * hers to say.
   */
  const how = listed
    ? 'THE LINES ABOVE GO OUT WORD FOR WORD, every one of them: do not summarise, reorder or '
      + 'drop a line, because a list they cannot read line by line is one they agree to without '
      + 'reading. EVERYTHING ELSE IS YOURS TO SAY. Do not repeat this paragraph, do not open '
      + 'with "nothing has been changed yet", and do not read these instructions out. One short '
      + 'sentence of your own, then the lines, then ask them to confirm.'
    : 'Say what it would do and the COUNT in one sentence of your own, then ask them to '
      + 'confirm. Do not read this paragraph out.';

  return {
    summary: `NOTHING HAS BEEN CHANGED YET, and nothing will be until they say yes.\n\n`
      + `This would ${act}, touching ${rows}.${keeps ? ` ${keeps}` : ''}${block}\n\n`
      + `${how} `
      + 'DO NOT describe it as done, and do not describe the data as though it already '
      + 'were: it is unchanged. If they agree, call this again with confirmed true.',
    pending: true,
    /**
     * WHAT THIS CHANGE IS, apart from the instructions wrapped around it.
     *
     * `confirmReplay` re-issues a pending call once the admin agrees, and
     * may only do so when the change matches the answer they were replying
     * to. Reading that out of `summary` meant reading the words addressed
     * to HER as though they described the change: "Say what it would do
     * and the COUNT in one sentence" put COUNT among the facts, her answer
     * never contained it, and nothing was ever replayed.
     *
     * So the identifying half is handed over rather than parsed back out.
     * The act, the figures and the count; no instructions.
     */
    // `identity` when the act carries a figure that is context, not choice.
    confirming: identity ?? `${act} ${rows}${block}`,
    /**
     * THE LIST ITSELF, so a guard can check she relayed it.
     *
     * Handed back structurally rather than parsed out of the block: the
     * summary also carries the instructions to her, and reading those as
     * list items is the mistake `confirming` was added to undo.
     */
    lines: listed ? [...lines] : null,
  };
}

module.exports = { confirmFirst };
