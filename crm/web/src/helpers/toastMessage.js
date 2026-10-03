/**
 * What a write says about itself, as a pure function.
 *
 * NO IMPORTS, deliberately. This is the wording half of every mutation
 * toast in the CRM, and keeping it free of React is what lets it be tested
 * with `node --test` rather than only by clicking. It was inline in
 * useMasterSheet.js, which meant the one part of the toast system that is
 * pure logic was the one part nothing could reach.
 *
 * A hook supplies two things and gets both messages:
 *
 *   describe: ({ ids }) => `${ids.length} deals`
 *   verb:     'deleted'
 *
 *   success -> "6 deals deleted"
 *   error   -> "Couldn't delete 6 deals"
 *
 * That pairing is the whole point. The failure message is DERIVED from the
 * success one, so a call site cannot describe a thing one way when it works
 * and another way when it does not — which is exactly what fourteen
 * hand-written "Couldn't remove that" toasts had drifted into.
 */

// Past tense for the confirmation ("9 deals deleted"), present for the
// failure ("Couldn't delete 9 deals"). Spelled out rather than derived:
// stripping a trailing d turns "added" into "adde".
export const PRESENT_TENSE = {
  added: 'add',
  updated: 'update',
  deleted: 'delete',
  saved: 'save',
  removed: 'remove',
  cleared: 'clear',
};

/**
 * The notify() payload for one outcome, or null for deliberate silence.
 *
 * @param describe  (variables, data) => string. Names the subject. Absent
 *                  means a SILENT success: bookkeeping writes whose result
 *                  is already on screen say nothing. Failures still speak.
 * @param verb      past tense, string or (variables, data) => string.
 * @param detail    (variables, data) => string, the second line on SUCCESS.
 *                  For a consequence only the server knows: deleting a
 *                  person reports how many deals now need a new handler,
 *                  and that count does not exist until it answers.
 * @param error     present for the failure path.
 */
export function toastFor({
  describe, verb = 'saved', icon = 'check', detail, variables, data, error,
}) {
  const word = typeof verb === 'function' ? verb(variables, data) : verb;

  if (error) {
    // `describe` is called with variables ONLY here. On failure there is no
    // server response to describe from, and a describe that reached for
    // `data.something` would throw inside the error handler.
    const subject = describe ? String(describe(variables)).toLowerCase() : 'that';
    return {
      level: 'error',
      message: `Couldn't ${PRESENT_TENSE[word] ?? word} ${subject}`,
      detail: error.message,
    };
  }

  // SILENT ON PURPOSE, and only on success. A write with nothing worth
  // announcing still has to announce a failure, or the button just does
  // nothing and nobody knows why.
  if (!describe) return null;

  return {
    level: 'success',
    icon,
    message: `${describe(variables, data)} ${word}`,
    detail: detail ? detail(variables, data) : undefined,
  };
}
