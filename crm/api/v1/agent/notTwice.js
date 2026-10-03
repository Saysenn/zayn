/**
 * ***************************************************
 * * She must not say the same sentence twice
 * ***************************************************
 *
 * Real transcript. Asked "are you sure that is correct?" she repeated her
 * previous line word for word. Asked which Gloria, told "the Gloria one",
 * she asked the identical question again, and again after that.
 *
 * The second case was a genuine loop in the tool (fixed: an exact name now
 * ends the question). The first was not a bug at all — re-running the tool
 * and getting the same figure is exactly right. Saying it in the same words
 * is what makes it read as a broken machine rather than a person who has
 * just checked.
 *
 * PROMPTING IS NOT A GUARD. persona.js already says "Vary the words every
 * time. The same sentence twice in one session is the thing to avoid", and
 * she said it three times running.
 *
 * NOTHING IS REWRITTEN HERE. It reports a repeat; the caller asks her to
 * say it again differently, with every figure unchanged.
 */

/** Wording only: case, punctuation and spacing are not the sentence. */
function fold(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Below this a match is coincidence, not repetition: "Yes." and "Done."
// are fine to say twice and are the whole reply.
const SHORTEST = 40;

/**
 * NEARLY the same is the same, because a loop never repeats exactly.
 *
 * Real transcript: "five rows close to Gloria Difference" then "five rows
 * close to Gloria Diference". One character apart, so a byte comparison
 * saw two different sentences and the loop ran on. What the admin sees is
 * the identical question twice.
 *
 * 0.8, placed BETWEEN the two measured cases rather than beside either.
 * The real loop pair scores 0.878. The closest honest pair, one person in
 * two different months, scores 0.684. Sitting at 0.8 leaves headroom on
 * both sides; at 0.85 one honest reply would have been a hair from being
 * called a repeat.
 */
const NEARLY = 0.8;

/** Shared words, both ways, so a longer reply cannot swallow a shorter. */
function sameness(a, b) {
  if (a === b) return 1;
  const words = (t) => t.split(' ').filter(Boolean);
  const left = words(a);
  const right = new Set(words(b));
  if (left.length === 0) return 0;

  const shared = left.filter((w) => right.has(w)).length;
  // Length matters too, or "yes" inside a paragraph would score 1.
  return (shared / left.length) * (Math.min(left.length, right.size) / Math.max(left.length, right.size));
}

/**
 * Is this reply the last thing she already said?
 *
 * ONLY THE MOST RECENT assistant turn. Coming back to a figure ten minutes
 * later and stating it the same way is ordinary; saying it twice in a row
 * is the fault.
 *
 * @param {string} reply
 * @param {Array<{role: string, content: string}>} history
 */
function saidAlready(reply, history = []) {
  const folded = fold(reply);
  if (folded.length < SHORTEST) return false;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn?.role !== 'assistant') continue;
    // The most recent one decides, so the loop stops here either way.
    return sameness(fold(turn.content), folded) >= NEARLY;
  }
  return false;
}

module.exports = { saidAlready, fold, sameness, SHORTEST, NEARLY };
