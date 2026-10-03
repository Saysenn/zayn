/**
 * ***************************************************
 * * She must not draw the same list twice
 * ***************************************************
 *
 * Real transcript. She listed the thirty INDIGO cash deals, was asked "are
 * you sure that's 30?", and printed all thirty again before saying yes.
 *
 * RE-RUNNING THE TOOL WAS RIGHT. "Are you sure" asks whether she CHECKED,
 * so checking is the correct response and the count is the correct answer.
 * Redrawing thirty rows to deliver one word is not.
 *
 * `notTwice.js` guards her REPLY TEXT and could never catch this: the two
 * replies genuinely differed, and the thirty repeated lines were an event
 * beside them rather than words inside them.
 *
 * The client commits every list to history as `[listed N deals: #id name,
 * …]`, which is what makes this possible without any server-side session.
 */

// The client's own format, in AgentOverlay.jsx's list handler. A CONTRACT:
// change it there and this stops matching, so both carry the note.
const LISTED = /^\[listed \d+ deals?: (.+)]$/;
const ID = /#(\d+)/g;

/** The ids in a list, in order, as one comparable string. */
function signature(rows = []) {
  return rows.map((r) => r?.id).filter((id) => id != null).join(',');
}

/** The ids in the most recent list she drew, or null if she drew none. */
function lastListed(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn?.role !== 'assistant') continue;
    const match = LISTED.exec(String(turn.content ?? '').trim());
    // Only the MOST RECENT list counts. Coming back to the same set later
    // in a conversation is an ordinary thing to do; twice in a row is not.
    if (match) return [...match[1].matchAll(ID)].map((m) => m[1]).join(',');
  }
  return null;
}

/**
 * Is this the same list she just drew?
 *
 * @param {{rows: Array<{id: number|string}>}} list
 * @param {Array<{role: string, content: string}>} history
 */
function drawnAlready(list, history = []) {
  const now = signature(list?.rows);
  if (!now) return false;
  return now === lastListed(history);
}

// What the model is told instead of the rows. It still gets the tool's own
// summary, so the figure it needs to confirm is in front of it.
const SAY_IT_INSTEAD = 'This is the SAME list you drew a moment ago and it is still on their '
  + 'screen, so it has NOT been drawn again. Do not repeat the rows. Answer in one sentence: '
  + 'say you checked again and give the count.';

module.exports = {
  drawnAlready, signature, lastListed, SAY_IT_INSTEAD, LISTED,
};
