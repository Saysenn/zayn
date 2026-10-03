import CellInfo from './CellInfo';
import {
  paymentStartState, paymentStartReason, ifToggled, START_STATE, START_REASON,
} from '../../helpers/paymentStartState';

// ***************************************************
// * Why this payment start cell is this colour
// ***************************************************
//
// ONE COMPONENT FOR THE SHEET AND THE SETTINGS PREVIEW. The preview exists
// to teach the rule the sheet applies, so two copies of the words is two
// chances for the lesson and the thing being taught to disagree.
//
// THE REASON IS THE RULE THAT FIRED, not what the colour can mean. It read
// "Starts after this month, or ended before it" and left the reader to work
// out which, and the preview's row label said "Finished months ago" beside
// a GREEN cell because the label never moved when the toggle did.

export const COLOUR_WORD = {
  [START_STATE.RUNNING]: 'Green',
  [START_STATE.STARTED_THIS_MONTH]: 'Amber',
  [START_STATE.NOT_STARTED]: 'Red',
};

const MEANS = {
  [START_STATE.RUNNING]: 'Paying the whole month.',
  [START_STATE.STARTED_THIS_MONTH]: 'Part of the month only.',
  [START_STATE.NOT_STARTED]: 'Nothing owed.',
};

// Six words each. One line per rule in `paymentStartReason`, in its order.
const REASON = {
  // The only one that is a decision rather than a date. It says WHO, not
  // what, because "somebody set this" is the whole of the reason.
  [START_REASON.SPECIAL_CASE_DEAL]: 'Set to special case by hand',
  [START_REASON.STARTS_AFTER]: 'Starts after this month',
  [START_REASON.ENDED_BEFORE]: 'Ended before this month',
  [START_REASON.STARTS_INSIDE]: 'Starts inside this month',
  [START_REASON.ENDS_INSIDE]: 'Ends inside this month',
  [START_REASON.RUNNING]: 'Started before this month',
  [START_REASON.NO_START]: 'No start date, so every month',
};

/** The colour and the reason as words, for anything printing them inline. */
export function paymentStartWords(start, preset, end, useEndDate, specialCaseDeal = false) {
  const state = paymentStartState(start, preset, end, useEndDate, null, specialCaseDeal);
  return {
    state,
    word: COLOUR_WORD[state],
    means: MEANS[state],
    reason: REASON[paymentStartReason(start, preset, end, useEndDate, specialCaseDeal)],
  };
}

// NO PLACE IS NAMED. The same sentence is read in Settings, where the
// toggle is on screen, and on the master sheet, where it is not.
function toggleLine({ other, endedBefore }, useEndDate) {
  const becomes = COLOUR_WORD[other];
  const why = endedBefore ? 'This ended before the month.' : 'This ends inside the month.';
  return useEndDate
    ? `${why} Only the end date makes it ${becomes}. Leave the end date out and it is Green.`
    : `${why} The end date is out of the formula, so it stays Green. Include it and it is ${becomes}.`;
}

/**
 * WARNING, NOT INFO, WHEN THE TOGGLE WOULD MOVE THIS ROW, because that is
 * the case somebody has to act on: a deal that finished months ago sits
 * green, its amount stays in the month's total, and nothing on the row says
 * so. Every other row gets the quiet icon, so a cell without one never
 * reads as a cell with nothing to say.
 */
/**
 * The same explanation as WORDS, for a cell that already has an icon.
 *
 * ONE CELL, ONE ICON. The payment start cell carried two: a suggestion
 * offering a date, and this explaining the colour. Two marks side by side
 * in one cell is a key to learn before either can be read, so the cell that
 * has both stacks this INSIDE the other one. See dateSuggestions.
 */
export function paymentStartWhyParts({ start, preset, end, useEndDate, specialCaseDeal = false }) {
  const { word, means, reason } = paymentStartWords(start, preset, end, useEndDate, specialCaseDeal);
  // THE END DATE TOGGLE CANNOT MOVE THIS ROW once the switch is on: the
  // decision is asked before either date, so reporting what flipping the
  // setting would cost is a line about a rule that no longer applies here.
  const flip = specialCaseDeal ? null : ifToggled(start, preset, end, useEndDate);
  return {
    tone: flip ? 'warning' : 'info',
    label: `Why ${word}`,
    body: [`**${means}** ${reason}.`, ...(flip ? [toggleLine(flip, useEndDate)] : [])],
  };
}

export default function PaymentStartWhy(props) {
  const { tone, label, body } = paymentStartWhyParts(props);
  return <CellInfo tone={tone} label={label} body={body} />;
}
