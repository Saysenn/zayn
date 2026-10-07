const { DISABLED, CANNOT } = require('./disabledTools');

/**
 * ***************************************************
 * * WHAT SHE SAYS SHE CAN DO, BUILT FROM WHAT SHE ACTUALLY HAS
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-22. Asked what she could help with, she offered
 * "even helping with exports". She cannot export: `export_sheet` has been
 * off since 2026-09-09 and its description already says so in capitals.
 * In the same breath she left out that she can change a company's STATUS,
 * close one, and mark which of its deals are reviewed every month.
 *
 * BOTH HALVES ARE THE SAME FAULT. There was no list, so she answered from
 * a general sense of her job: she invented a capability she does not have
 * and forgot three she does.
 *
 * A HAND WRITTEN LIST IN THE PROMPT WOULD BE THE SAME BUG WITH A DELAY.
 * The day a tool is added or turned off, the sentence stops being true and
 * nothing goes red. So the block is COMPUTED from the tool list she is
 * actually handed, and `capabilities.test.js` refuses any tool that no
 * area claims: a new tool is a red test, not a silent omission.
 */

/**
 * ===============================
 * * THE AREAS, IN THE ORDER SHE SHOULD SAY THEM
 * ===============================
 * Money first, tidying last, the same order the sign-in briefing uses.
 *
 * `tools` is the whole point: the label is only printed when at least one
 * of its tools survived `withDisabled`, so turning a whole area off
 * removes it from what she claims without anybody editing prose.
 */
const AREAS = Object.freeze([
  {
    label: 'read the master sheet: find deals, show one in full, total a month, break a total '
      + 'down, compare two months, audit it for gaps, and show the Standard, Bank, Cash or Crypto sheet',
    tools: [
      'filter_master_sheet', 'summarize_deals', 'find_and_show_details', 'get_master_sheet_row_details',
      'total_master_sheet', 'breakdown_master_sheet', 'compare_months', 'audit_master_sheet',
      'explain_preset_rules', 'show_sheet_preset',
    ],
  },
  {
    label: 'change the master sheet: add a new deal, amend one deal or many, undo a change, and say '
      + 'what changed recently',
    tools: [
      'add_deal', 'update_master_sheet_row', 'bulk_update_master_sheet', 'delete_master_sheet_row',
      'undo_master_sheet_change', 'recent_master_sheet_changes',
    ],
  },
  {
    label: 'end a deal or put one back, and read the Archive',
    tools: ['stop_deal', 'resume_deal', 'list_stopped_deals'],
  },
  {
    // It had no area, so asked what she could do she never said it. 2026-10-03.
    label: 'schedule a change or a company closure for a later month, say what is scheduled, and '
      + 'call one off before it runs',
    tools: ['park_for_month', 'list_parked_work', 'cancel_parked_work'],
  },
  {
    label: 'the dead list: who has no live deal left, and one person\'s history company by company',
    tools: ['list_dead_people', 'dead_person_details'],
  },
  {
    label: 'the monthly review: say what is up for review, and answer one deal or many',
    tools: ['list_monthly_review', 'answer_monthly_review', 'bulk_answer_monthly_review'],
  },
  {
    /**
     * THE HALF SHE LEFT OUT. She named "sorting out companies", which is
     * vague enough to mean nothing: the admin could not tell from it that
     * she can put a company into liquidation or close it, which are the
     * two that move money.
     */
    label: 'companies: list them, rename one, correct its tier, old group or notes, change its '
      + 'STATUS (active, going concern, liquidation, dissolved, closed), close or reopen one or '
      + 'several, and mark which of its deals are reviewed every month',
    tools: [
      'list_companies', 'active_companies', 'update_company', 'bulk_update_companies',
      'bulk_close_companies', 'rename_company',
    ],
  },
  {
    label: "people: correct a person's details and their add on or fee",
    tools: ['update_person'],
  },
  {
    label: 'concerns anybody has raised',
    tools: ['list_concerns'],
  },
  {
    label: 'the conversion rates, and what a month was converted at',
    tools: ['check_rates', 'exchange_rate'],
  },
  {
    label: 'what was said in an earlier conversation: find it, show one in full, and delete old ones',
    tools: ['recall_past_conversations', 'show_past_conversation', 'delete_past_conversations'],
  },
  {
    label: 'whether the backup ran',
    tools: ['backup_status'],
  },
]);

/**
 * Tools that are not a capability anybody would ask about.
 *
 * `say` and `state_claims` are how she TALKS; `fill_form` and
 * `edit_deal_form` type into a form the CRM opened. Naming any of them in
 * an answer about what she can do would describe the plumbing.
 *
 * Listed rather than ignored so the completeness test stays honest: a tool
 * is either in an area, in here, or the test goes red.
 */
const INTERNAL = Object.freeze(['say', 'state_claims', 'fill_form', 'edit_deal_form']);

/**
 * The block appended to the workspace prompt.
 *
 * @param {Array<{name: string}>} tools exactly what she is handed this
 *   request, AFTER `withDisabled`.
 */
function capabilityBlock(tools = []) {
  const has = new Set(tools.map((t) => t.name));
  // An area survives if any of its tools did. A label with nothing behind
  // it is the invented capability this file exists to stop.
  const can = AREAS.filter((area) => area.tools.some((name) => has.has(name)));

  // TURNED OFF, not absent: she still HOLDS these tools, which is why she
  // reads them as things she can offer. The refusal text is his and is
  // already written, so only the short phrase is needed here.
  const cannot = Object.keys(DISABLED).filter((name) => has.has(name) && CANNOT[name]);
  const phrases = [...new Set(cannot.map((name) => CANNOT[name]))];

  return [
    'WHAT YOU CAN DO. Asked what you can help with, answer from THIS list and nothing else.',
    'Never from a general sense of your job, and never a capability you cannot name a tool for.',
    '',
    ...can.map((area) => `- ${area.label}`),
    '',
    'WHAT YOU CANNOT DO. You still hold these tools and they refuse. Never offer them, never say',
    'you can "help with" them, and never include them when you list what you can do:',
    '',
    ...(phrases.length > 0 ? phrases.map((phrase) => `- ${phrase}`) : ['- nothing is turned off right now']),
  ].join('\n');
}

module.exports = { capabilityBlock, AREAS, INTERNAL };
