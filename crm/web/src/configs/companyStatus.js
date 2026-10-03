/**
 * ***************************************************
 * * CONTRACT: the five company statuses
 * ***************************************************
 *
 * MIRRORED, NEVER IMPORTED. The server's half is
 * api/v1/repos/companies.repo.js `COMPANY_STATUS`, and migration 059 has
 * the same five in a CHECK. The two codebases share no file, so each
 * states the set and pins its own half (web/src/configs/companyStatus.test.js).
 *
 * THIS IS THE ONLY THING THE UI MAY CALL STATUS. Payment period and pay
 * status are two other facts that have been called it, and collapsing them
 * is how a deal once read Ended beside a green payment start cell.
 */

export const COMPANY_STATUS = Object.freeze({
  ACTIVE: 'active',
  // His own word, from the end date column of his September sheet. It
  // means trading and expected to keep trading, so it behaves exactly like
  // ACTIVE for money and differs only in what it SAYS. Its deals carry no
  // end date, and the cell says why rather than sitting blank.
  GOING_CONCERN: 'going_concern',
  // HIS CALL 2026-09-21: "the company is subject for monthly review". NOT
  // liquidation, and the difference is money. Liquidation is a negotiation
  // with a settlement and an amount set per deal; this only says ask me
  // about this company every month. Both ask through the CHECKLIST.
  REVIEW: 'review',
  LIQUIDATION: 'liquidation',
  DISSOLVED: 'dissolved',
  CLOSED: 'closed',
});

// Both terminal, and they stop every deal identically. They differ only in
// what they SAY happened, which is why there are two: one company ceased to
// exist, the other we walked away from, and an audit asks which.
export const TERMINAL_STATUS = Object.freeze(['dissolved', 'closed']);

export const isTerminalStatus = (status) => TERMINAL_STATUS.includes(status);

/**
 * ===============================
 * * THE TWO THAT ASK ABOUT THEIR DEALS EVERY MONTH
 * ===============================
 * Both open the checklist, and both ask the same way: per deal, never
 * across the whole company. That is the 2026-09-21 change, his call. The
 * queue used to sweep in every live deal on a liquidating company, so the
 * checklist promised "ticked deals join the Review list" and unticking one
 * removed nothing.
 *
 * Mirrors api/v1/repos/companies.repo REVIEWED_MONTHLY.
 */
export const ASKS_MONTHLY = Object.freeze([COMPANY_STATUS.LIQUIDATION, COMPANY_STATUS.REVIEW]);

export const asksMonthly = (status) => ASKS_MONTHLY.includes(status);

/**
 * ===============================
 * * AND GOING CONCERN ASKS A DIFFERENT QUESTION ABOUT THE SAME DEALS
 * ===============================
 * His call 2026-09-22: the ticked deals are the ones that carry his word
 * "Going concern" in their end date cell, and therefore have no end date.
 * The rest keep their dates.
 *
 * NOT THE SAME LIST AS ASKS_MONTHLY, and the names have to stay apart.
 * Liquidation and Review ask "which deals do I want asked about every
 * month"; this asks "which deals have no end date". One name covering both
 * would put Going concern deals into the monthly review, which is the one
 * thing it must not do: `endNote.helper` reads his word as
 * `reviewMonthly: false` precisely because a blank end date is what it
 * already means.
 */
export const ASKS_DEALS = Object.freeze([...ASKS_MONTHLY, COMPANY_STATUS.GOING_CONCERN]);

export const asksDeals = (status) => ASKS_DEALS.includes(status);

// What each one means for the money, shown under the picker so nobody has
// to remember which of the four still pays.
export const COMPANY_STATUS_OPTIONS = Object.freeze([
  { value: 'active', label: 'Active', means: 'Trading, paying in full.' },
  {
    value: 'going_concern',
    label: 'Going concern',
    means: 'Trading and expected to keep trading. Paying in full, with no end date.',
  },
  {
    value: 'review',
    label: 'Review',
    means: 'Paying in full, and asked about every month. You choose which deals.',
  },
  {
    value: 'liquidation',
    label: 'Liquidation',
    means: 'Winding down. Still paying, at amounts you set per deal.',
  },
  {
    value: 'dissolved',
    label: 'Dissolved',
    means: 'Legally gone. Every deal stops and moves to the Archive.',
  },
  {
    value: 'closed',
    label: 'Closed',
    means: 'We ended it. Every deal stops and moves to the Archive.',
  },
]);

export const COMPANY_STATUS_MEANS = Object.freeze(
  Object.fromEntries(COMPANY_STATUS_OPTIONS.map((o) => [o.value, o.means])),
);

// The word on its own, for a page header or a subtitle. Same source as the
// picker, so a status cannot be spelled one way in a dropdown and another
// above the page it belongs to.
export const COMPANY_STATUS_LABEL = Object.freeze(
  Object.fromEntries(COMPANY_STATUS_OPTIONS.map((o) => [o.value, o.label])),
);
