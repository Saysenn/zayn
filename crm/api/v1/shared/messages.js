/**
 * The server's user-facing words, where more than one route says them.
 *
 * DELIBERATELY NOT EVERY MESSAGE. Two kinds of string come out of these
 * routes and only one of them belongs in a file like this:
 *
 *   PROSE a human reads          -> here. "That sheet parsed to zero rows",
 *                                   "Nothing matches that selection". These
 *                                   are read by an admin mid-task and are
 *                                   worth wording carefully.
 *
 *   PARAMETER VALIDATION         -> stays inline, next to the check that
 *                                   produces it. "ids must be a non-empty
 *                                   array" only ever fires when a client
 *                                   sends malformed input, and reading it a
 *                                   file away from the `if` that throws it
 *                                   makes both harder to follow.
 *
 * The test used for what landed here: is it repeated, or would somebody
 * open a file specifically to reword it? Six were repeated across fourteen
 * call sites, which is how "Company not found" ends up with three slightly
 * different spellings.
 *
 * ---- what is deliberately NOT here ----
 * `masterSheet/exportWarnings.js` keeps its own text. Each scenario there
 * is a detection rule, its words and its fix as one object, and splitting
 * the words out would put them a file away from the condition that decides
 * whether anyone ever sees them.
 */

// The confirm phrases live in settings.js, which owns the routes that check
// them. Passed in rather than imported, so this file depends on nothing.
const messages = {

  // ── repeated across routes ───────────────────────────────────────────

  notFound: {
    company: 'Company not found',
    person: 'Person not found',
    row: 'Row not found',
    expense: 'Expense not found',
    // Not dead: never had a deal, or holds a live one again.
    deadPerson: 'Not on the dead list',
  },

  // ── a company's status ───────────────────────────────────────────────

  // Whitelisted where tier deliberately is not: this one decides whether
  // every deal on the company stops.
  notACompanyStatus: (status) => (
    `"${status}" is not a company status. It is active, liquidation, dissolved or closed.`
  ),

  // A DEAL has three, and they are the three a LIVE arrangement can be.
  // Stopping one is the Stop button, not a status: we do not dissolve a
  // deal, we end it. His call 2026-09-22.
  notADealStatus: (status) => (
    `"${status}" is not a deal status. It is active, going concern or reviewed monthly.`
  ),

  // ── the monthly review ───────────────────────────────────────────────

  notAnAnswer: (answer) => (
    `"${answer}" is not an answer. It is yes, final or no.`
  ),

  // Says what is wrong rather than "not found": the deal exists, it is
  // simply not one the CRM is asking about this month.
  notUnderReview:
    'That deal is not up for review this month, so there is nothing to answer. '
    + 'Only deals past their end date are asked about.',

  // ── ending a deal ────────────────────────────────────────────────────

  // Says what to do instead, not just no. Reopening the company brings back
  // every deal its closure stopped, together, which is the point.
  resumeTheCompany: (company) => (
    `${company || 'That company'} is closed, so this deal stays stopped. `
    + 'Reopen the company and its deals come back together.'
  ),

  // ── uploading ────────────────────────────────────────────────────────

  noFile: 'No file received',

  notXlsx: (filename) => `${filename} isn't an .xlsx file`,

  // The commonest real failure: a sheet whose header row is missing or
  // renamed parses to nothing. Says what to check rather than just failing,
  // because "0 rows" alone reads as the CRM being broken.
  parsedNothing:
    'That sheet parsed to zero rows, so nothing was changed. Check it has a header row '
    + 'with Group/Role/Name columns.',

  // ===============================
  // * EXPENSES HAS ITS OWN, AND THEY ARE TWO DIFFERENT PROBLEMS
  // ===============================
  // It was borrowing the master sheet's, which tells somebody importing
  // expenses to check for Group/Role/Name columns that have nothing to do
  // with the file they are holding.
  //
  // NO HEADER and NO ROWS need different answers: one is the wrong file,
  // the other is the right file with nothing in it. "Zero rows" for both
  // sends you looking at the wrong half.
  expenses: {
    noHeader: (headers) =>
      'No expenses header row found in that file. It needs a row naming at least two of: '
      + `${headers.join(', ')}. Export a month first if you want the exact shape.`,
    noRows:
      'That file has the right columns and no expense rows under them, so there is nothing '
      + 'to import. An exported month with no expenses in it looks exactly like this.',
  },

  // ── exporting ────────────────────────────────────────────────────────

  nothingMatches: 'Nothing matches that selection',

  // ── settings, the two destructive ones ───────────────────────────────

  typeToConfirm: (phrase) => `Type "${phrase}" exactly to confirm.`,

  // ── Diane ────────────────────────────────────────────────────────────
  //
  // HER VOICE, NOT THE API'S. Every other message here is the CRM talking;
  // these two are Diane, and they are the only place an error is written in
  // character. Keep them that way: a sudden "Bad Request" from her reads as
  // a different system answering.

  agent: {
    tooMuchAtOnce:
      'That was a bit much for me to take in at once, lovely. Could you send it in two halves?',
    unreachable:
      "I can't reach my thinking bit at the moment, sweetheart. Give me a minute and try again?",
    leftAlone: "Okay, I've left it. Nothing changed.",
    // Keyed by aiStatus.js AI_LOCK. The page says it too, from its own copy.
    locked: {
      no_key: 'Diane is switched off: no AI key is set up on the server.',
      no_credit: 'Diane is switched off: the AI account has no balance left.',
      bad_key: 'Diane is switched off: the AI provider refused the key.',
    },
  },
};

module.exports = { messages };
