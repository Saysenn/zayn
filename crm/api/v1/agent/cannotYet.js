/**
 * ***************************************************
 * * SHE MUST NOT OFFER WHAT SHE HAS NO TOOL FOR
 * ***************************************************
 *
 * Asked "now can you forecast now?" she answered "Forecasting sounds
 * exciting, darling! What exactly do you want to forecast: payments next
 * month, total income for a group, or something else?"
 *
 * She cannot forecast anything. There is no tool, no stored month to look
 * back at, and the snapshots table is not even migrated yet. She offered
 * three kinds of it and invited the admin to pick one.
 *
 * This is the same rule as "she must not claim to have done what she did
 * not do", one step earlier: she must not claim she CAN. An offer is a
 * promise, and the next turn has to break it.
 *
 * IT RETIRES ITSELF. Each entry names the tool that would make the offer
 * true. The day that tool exists in her context the guard stops firing, so
 * this cannot become a rule that outlives the gap it describes.
 *
 * SCOPED TO A PROMISE, not to the word. "I cannot forecast yet" contains
 * "forecast" and must pass; only an offer or a claim of ability is caught.
 */

// What she must not offer, and the tool that would let her.
const PROMISES = [
  {
    what: 'forecasting',
    // `snapshot_month`, `compare_months` and `trend` are specified in
    // docs/diane.md and deliberately not built. See the month snapshots.
    tool: 'compare_months',
    subject: /\b(forecast(ing|s|ed)?|project(ion|ions|ed)?|predict(ion|ions|ed)?|trend(s)?|next (month|quarter|year)|coming months?|months? ahead)\b/i,
    instead: 'You CANNOT forecast, project or predict anything. There is no stored history to '
      + 'look back at yet, so there is nothing to work from. Say that plainly in ONE sentence, '
      + 'say what you CAN do instead (this month\'s figures, a total, a filtered list), and do '
      + 'NOT ask them which kind of forecast they want.',
  },
  {
    what: 'past months',
    tool: 'compare_months',
    subject: /\b(compare (it |them )?(to|with|against) (last|previous|another) month|last month'?s? (figures|totals|sheet)|month on month|since last month|versus last month)\b/i,
    instead: 'You CANNOT compare months. Only the sheet as it stands right now is stored, so an '
      + 'earlier month is not there to compare against. Say so plainly and offer this month\'s '
      + 'figures instead. Do NOT offer to look it up.',
  },
];

/**
 * SHE IS OFFERING OR CLAIMING, rather than declining.
 *
 * "I cannot forecast yet" and "there is no forecasting" have to pass, or
 * the guard fires on the very sentence it is asking for and the turn
 * cannot end.
 */
const DECLINING = /\b(cannot|can't|cant|could not|couldn't|unable|no tool|not able|do not have|don't have|dont have|there is no|there's no|not yet|nothing stored|no history)\b/i;

// A bare `which` caught "her payment starts next month, WHICH is why
// nothing is owed yet", an ordinary sentence about a preset. The offer
// words have to be the ones that actually offer.
const OFFERING = /\b(would you like|shall i|want me to|i can |i could |happy to|let me |which (one|kind|sort|of these|would|do you)|what (kind|sort|exactly)|sounds? (exciting|good|fun|interesting)|tell me more)\b/i;

/**
 * @param {string} reply what she is about to say
 * @param {object[]} tools the tools this context actually gave her
 * @returns {{ok: boolean, missing: object|null}}
 */
function cannotYet(reply, tools = []) {
  const text = String(reply ?? '');
  if (!text) return { ok: true, missing: null };

  const have = new Set((tools ?? []).map((t) => t?.name).filter(Boolean));

  for (const p of PROMISES) {
    // The tool exists, so the offer is honest and this entry is spent.
    if (have.has(p.tool)) continue;
    if (!p.subject.test(text)) continue;
    // Declining is the answer we want, in any wording.
    if (DECLINING.test(text)) continue;
    // Mentioning it in passing is not a promise; offering it is.
    if (!OFFERING.test(text)) continue;
    return { ok: false, missing: p };
  }

  return { ok: true, missing: null };
}

module.exports = { cannotYet, PROMISES };
