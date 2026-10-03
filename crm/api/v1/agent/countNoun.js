/**
 * ***************************************************
 * * A NUMBER FOLLOWED BY A THING IS COUNTING THINGS
 * ***************************************************
 *
 * "10 payable days on 2 deals" holds one value and one count, and telling
 * them apart is the same question in two guards:
 *
 *   checkDays      read the 2 as a second day count, flagged a correct
 *                  answer, and she retracted a figure she had every right
 *                  to say. 2026-09-23.
 *   confirmReplay  the bulk summary lists "(1 row)" per person, she never
 *                  repeats it, so every remembered confirmation looked
 *                  like a change the admin had not been shown and nothing
 *                  was ever applied. Same day, same list.
 *
 * The giveaway is the noun after the number. One definition, because two
 * copies of this would drift and each would be wrong in its own direction.
 *
 * NOT "days". A payable day count is itself a value, and the words around
 * it ("30 days") are exactly what the guards are reading.
 */
/**
 * ===============================
 * * "5 OF THEIR DEALS" IS STILL COUNTING DEALS
 * ===============================
 * The noun had to come straight after the number, so the rate preview's
 * own wording, "which is all 2 of their deals", read the 2 as a VALUE. She
 * never repeats a deal count, so a confirmed change to two people applied
 * to whichever of them happened to share a digit with her answer.
 * 2026-09-24. One determiner is allowed between, and nothing else.
 */
const FOLLOWED_BY_COUNT_NOUN = /^\s*\)?\s*(?:of\s+(?:their|the|these|those|his|her|its|them)\s+)?(deals?|rows?|people|persons?|handlers?|companies|company)\b/i;

module.exports = { FOLLOWED_BY_COUNT_NOUN };
