// ***************************************************
// * WHEN A MID-TURN LINE REACHES THE SCREEN
// ***************************************************

/**
 * `say` puts a line on screen and lets the round carry on, so a lookup
 * taking four seconds is not four seconds of nothing. TWO SHAPES ARE NOT
 * THAT, and both were rules in the tool's own description until one of
 * them was ignored in front of the admin.
 *
 * Live 2026-09-18, one word in:
 *
 *   hi
 *   "The master sheet is looking ready for your commands, darling. What
 *    shall we do today?"                                    <- `say`
 *   "Hello there! What can I help you with in the master sheet today?"
 *                                            <- the reply, the same again
 *
 * PROMPTING IS NOT A GUARD. The description already said not to ask
 * through it; a sentence cannot enforce itself.
 *
 * ---- where this is decided ----
 * `runAgent` owns the emit, so it owns the refusal: a suppressed line has
 * to be reported to the model as NOT SHOWN, or it believes the admin has
 * already heard it and leaves it out of the reply as well. That is how one
 * duplicate becomes a missing answer.
 */

/**
 * A QUESTION MARK INSIDE THE SENTENCE IS NOT THE ASK. "Ready? Let me
 * check." is a line before work. What the text ENDS on is the ask, so an
 * emoji, a bracket or a quote after it still counts.
 */
const ASKS = /\?["')\]\s]*$/;

const NOT_DELIVERED = 'NOT DELIVERED. Nothing was shown and nothing was spoken, so the admin '
  + 'has NOT seen or heard this line.';

const NO_WORK = `${NOT_DELIVERED} It was your only call this round, so there was no lookup for `
  + 'it to cover and nothing to wait for. A line before work, with no work, is just your answer '
  + 'arriving early. Say it in your reply instead, once.';

const IT_ASKS = `${NOT_DELIVERED} You cannot ask and work at the same time: a question is an `
  + 'answer, not a line before one. Ask it once, in your reply.';

/**
 * Whether the round holds a call this line could be covering.
 *
 * TWO KINDS ARE NOT WORK and both are read off the tool, never named here,
 * so the next one inherits the rule instead of slipping past a list nobody
 * remembered to update: `interim` is the line itself, `changesNothing` is
 * metadata like `state_claims`, which looks nothing up and draws nothing.
 * Without the second, "say" plus a claims call would have read as a busy
 * round and let the line through, which is the usual shape of a guard with
 * one door left open.
 *
 * An unknown name counts as work, which fails toward SHOWING the line: the
 * same behaviour as before this existed.
 */
function workBesideInterim(calls = [], tools = []) {
  return calls.some((call) => {
    if (call?.type !== 'function') return false;
    const tool = tools.find((t) => t.name === call.function?.name);
    return !tool?.interim && !tool?.changesNothing;
  });
}

// `ok` false carries the summary the model is given INSTEAD of the tool's
// own, because the tool's own says the line was delivered.
function interimHolds(text, hasWork) {
  const said = String(text ?? '').trim();
  if (!hasWork) return { ok: false, summary: NO_WORK };
  if (ASKS.test(said)) return { ok: false, summary: IT_ASKS };
  return { ok: true };
}

module.exports = { interimHolds, workBesideInterim, NOT_DELIVERED };
