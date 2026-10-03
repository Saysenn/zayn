/**
 * ===============================
 * * THEY NAMED ONE PERSON, THE CHANGE IS FOR ANOTHER
 * ===============================
 * Live 2026-09-30: "set casey test's fee to 3%". Casey's only deal was
 * stopped, the lookup offered "did you mean Drew?", and she wrote 3% onto
 * Drew's deal without asking. Nobody had said Drew.
 *
 * So a write is refused when the admin's own message names a person on the
 * sheet and the write is for somebody else. A message that names nobody
 * ("change his fee", "that one") is left alone: it points at what is on
 * screen, which is a different question.
 */
const { fold, personMentionedIn } = require('./tools/resolvePerson');

const TARGET_KEYS = ['targetPerson', 'person', 'personName'];

/** The person a write is for, when it names exactly one. */
function writeTarget(args = {}) {
  for (const key of TARGET_KEYS) {
    if (typeof args[key] === 'string' && args[key].trim()) return args[key].trim();
  }
  return null;
}

/**
 * @param {string} said      the admin's message this turn
 * @param {string} target    who the write is for
 * @param {string[]} names   every person name on the sheet, stopped deals included
 * @returns {string|null}    the person they DID name, when it is not the target
 */
function namedSomeoneElse(said, target, names = []) {
  if (!said || !target) return null;
  if (personMentionedIn(said, target)) return null;
  const wanted = fold(target);
  // Longest first, so "Casey Test" wins over a "Casey" who is also on the sheet.
  const named = [...new Set(names)]
    .filter((n) => n && fold(n) !== wanted)
    .sort((a, b) => b.length - a.length)
    .find((n) => personMentionedIn(said, n));
  return named ?? null;
}

function refusalFor(named, target) {
  return `NOTHING HAS BEEN CHANGED. They asked about ${named}, not ${target}, and a change is `
    + `never moved onto a different person. If ${named} has no live deal, say so plainly (a `
    + 'stopped deal is in the Archive and can be resumed first). Ask what they want; do not '
    + 'offer anyone else as the person to change.';
}

module.exports = { writeTarget, namedSomeoneElse, refusalFor };
