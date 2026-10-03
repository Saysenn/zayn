// ***************************************************
// * SHE PICKED THE FIELD THEY NEVER NAMED
// ***************************************************
//
// THE INCIDENT, 2026-09-24, live, and it was one yes away from writing.
//
//   admin  "can you do bulk update for these things?"
//   Diane  "Which field and what value would you like to bulk update?"   <- right
//   admin  named five deals: Reliapay FB and Sean Mannings, KP Gary,
//          Kryptonia Gary and James Heath. No field.
//   Diane  "Setting overrideShouldBePaid to false on 2 deals from
//          Reliapay in MILKMAN ... Shall I go ahead?"
//
// She asked the right question, was answered with a LIST OF DEALS, and
// filled the unanswered half in herself. `override_should_be_paid = false`
// takes a row out of every payout total, so the invented field was the one
// that moves money in the direction nobody audits.
//
// And the scope was three deals short: they named Reliapay, KP and
// Kryptonia, and the call reached Reliapay alone.
//
// ===============================
// * A MISSING ANSWER IS NOT A DEFAULT
// ===============================
// Nothing here guesses better. Both checks REFUSE and hand the question
// back, because the admin is the only one who knows, and a confirm they
// skim is not a second chance: the preview named a real field and a real
// count, so it read as a proposal they had made.

/**
 * The words that NAME a field, from the labels the CRM already uses.
 *
 * Built from the caller's own map rather than typed here: a column added
 * without a word for it would otherwise be invisible to this guard, which
 * is the same omission that made `assignedOn` unundoable.
 */
function fieldWords(labels) {
  const out = new Set();
  for (const [key, label] of Object.entries(labels ?? {})) {
    // "payableDays" -> "payable days", so her camelCase and his prose meet.
    out.add(key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
    // "should be paid (admin override)" -> "should be paid"
    out.add(String(label).replace(/\s*\(.*\)\s*/g, '').trim().toLowerCase());
  }
  out.delete('');
  return out;
}

/**
 * ===============================
 * * ONLY THE FIELDS THAT DECIDE WHETHER SOMEBODY IS PAID
 * ===============================
 * The first version of this refused ANY unnamed field and went red on
 * every ordinary instruction: "set them all to September 2026" names a
 * VALUE and no field, "roll them forward" names neither, and both are
 * unambiguous because a preset is the only thing you roll.
 *
 * These three are different. Nothing implies them, there is no sentence
 * that means one without saying so, and each moves money in the direction
 * nobody audits: `override_should_be_paid = false` takes a row out of
 * every payout total. Guessing one is never a near miss.
 */
const MUST_BE_NAMED = Object.freeze([
  'overrideShouldBePaid',
  'overridePaid',
  'specialCaseDeal',
  'shouldBePaid',
  'paid',
]);

const SPOKEN = Object.freeze({
  specialCaseDeal: /\bspecial\b/,
  overridePaid: /\b(?:un)?paid\b/,
  paid: /\b(?:un)?paid\b/,
  overrideShouldBePaid: /\bshould(?:n'?t|\s+not)?\s+be\s+paid\b/,
  shouldBePaid: /\bshould(?:n'?t|\s+not)?\s+be\s+paid\b/,
});

// Words that END a deal. A payment switch is never what they meant.
const ENDS_A_DEAL = /\b(stop|stopped|end|ended|finish|finished|terminate|cancel)\b[^.?!]*\bdeals?\b|\bdeals?\b[^.?!]*\b(is|are) (over|done|finished|ended)\b/;

/**
 * "Stop her deal" became Should be paid = No, then was reported as moved to
 * the Archive. Live 2026-09-28. Ending a deal is stop_deal, never a switch.
 * @returns {string|null} the refusal, or null
 */
function endingNotSwitch(said, keys) {
  const text = String(said ?? '').toLowerCase();
  const key = keys.find((k) => MUST_BE_NAMED.includes(k));
  if (!key || !ENDS_A_DEAL.test(text)) return null;
  const mine = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return `NOTHING HAS BEEN CHANGED. They asked to END a deal, which is stop_deal, not ${mine}. `
    + 'Call stop_deal with the person (and company or group if they hold more than one). '
    + 'Do not say anything was stopped until stop_deal has returned.';
}

/**
 * Did the admin name the field this call is about to write?
 *
 * MATCHED ON THEIR WORDS, not on hers. The summary she produces afterwards
 * always names it, which is why nothing downstream could catch this.
 *
 * @param {string} said    their sentence, and the one before it
 * @param {string[]} keys  the fields this call would write
 * @param {object} labels  FIELD_LABELS
 * @returns {string|null}  the refusal, or null
 */
function fieldNotNamed(said, keys, labels) {
  const text = String(said ?? '').toLowerCase();
  if (!text.trim()) return null;
  const words = fieldWords(labels);

  for (const key of keys.filter((k) => MUST_BE_NAMED.includes(k))) {
    const mine = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const label = String(labels?.[key] ?? '').replace(/\s*\(.*\)\s*/g, '').trim().toLowerCase();
    if (text.includes(mine) || (label && text.includes(label))) continue;
    // How it is actually said. "make zayn milkman special" names the
    // switch as surely as its label does, and was refused. 2026-09-29.
    if (SPOKEN[key]?.test(text)) continue;

    /**
     * THEY NAMED A DIFFERENT ONE, so this is a mix up rather than an
     * invention, and saying which they named is what makes the second
     * attempt land.
     */
    const theirs = [...words].filter((w) => w.length > 3 && text.includes(w));
    const instead = theirs.length > 0
      ? ` They said ${theirs.slice(0, 3).map((w) => `"${w}"`).join(' and ')}, not that.`
      : '';

    const ending = endingNotSwitch(text, [key]);
    if (ending) return ending;

    return `NOTHING HAS BEEN CHANGED. They never said to change ${mine}.${instead}\n\n`
      + 'A write needs the FIELD and the VALUE from them, and a list of deals is neither: '
      + 'it answers WHICH ROWS. Ask what to set and wait. Do not choose a likely '
      + 'field, do not offer one as a suggestion inside a confirmation, and never pick one that '
      + 'decides whether somebody is paid.';
  }
  return null;
}

/**
 * ===============================
 * * A SCOPE NARROWER THAN WHAT THEY NAMED
 * ===============================
 * They named Reliapay, KP and Kryptonia; the call was scoped to Reliapay,
 * so the preview said "2 deals" and read as the whole of it. A count is
 * only checkable against something, and the admin has nothing to check it
 * against but their own memory of the sentence they just said.
 *
 * @param {string} said       their sentence
 * @param {object[]} rows     what the call actually reaches
 * @param {string[]} known    every company name on the sheet
 * @returns {string|null}
 */
function scopeMissesNamed(said, rows, known) {
  const text = String(said ?? '').toLowerCase();
  if (!text.trim() || !Array.isArray(known)) return null;

  // THE SHEET'S OWN SPELLING in the message, folded only for comparison.
  // "reaches only reliapay" reads as a different company from the one on
  // their screen.
  const reachedAs = [...new Set((rows ?? []).map((r) => String(r.company ?? '').trim()).filter(Boolean))];
  const reached = new Set(reachedAs.map((c) => c.toLowerCase()));
  // A COMPANY THEY NAMED, spelled as the sheet spells it. Short names are
  // skipped: "KP" is two letters and lives inside ordinary words.
  const named = known
    .map((c) => String(c ?? '').trim())
    .filter((c) => c.length >= 3 && new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));

  const missed = named.filter((c) => !reached.has(c.toLowerCase()));
  if (missed.length === 0) return null;

  return `NOTHING HAS BEEN CHANGED. They named ${named.join(', ')} and this reaches only `
    + `${reachedAs.length > 0 ? reachedAs.join(', ') : 'nothing'}. `
    + `${missed.join(' and ')} ${missed.length === 1 ? 'is' : 'are'} not in it.\n\n`
    + 'A count they cannot check against their own sentence is a count they agree to. Either '
    + 'widen it to everything they named, or tell them plainly which ones this covers and which '
    + 'it does not, BEFORE asking them to confirm anything.';
}

/**
 * ===============================
 * * "WHAT SHOULD CHANGE?" WHEN THEY HAD ALREADY SAID
 * ===============================
 * Live 2026-09-24. "Add 3% on Zayn's deal on Milkman, on the add-on. Only
 * on Milkman deal, please." got "Zayn at Workforce: what should change?"
 * Reworded twice more, it got the SAME question, word for word, three
 * times in a row.
 *
 * The deal was resolved and the sentence carried the field AND the value;
 * the call simply arrived with none of it. Asking again cannot fix that,
 * because the answer is already on screen.
 *
 * So the question hands the fields back instead. It NAMES them rather
 * than guessing a value: which number goes with which field is exactly
 * the reading that took 3% off a 5% add on, and this is a read tool's
 * sentence, not a write.
 *
 * @returns {string[]} the field words their sentence used
 */
/**
 * The words an admin actually uses for a field.
 *
 * THE LABEL, NOT THE KEY. "addonPercent" splits to "addon percent" and
 * nobody says either half; the label is "add on %" and "add on" is
 * exactly what they say. The "%" and anything in brackets are stripped,
 * which is what stopped the first version matching anything.
 */
function fieldPhrases(key, label) {
  const fromLabel = String(label ?? '')
    .replace(/\s*\(.*\)\s*/g, ' ')
    .replace(/%/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const fromKey = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return [fromLabel, fromKey].filter((p) => p.length >= 3);
}

function namedFieldsIn(said, labels) {
  // A HYPHEN IS A SPACE. They write "add-on" as often as "add on", and
  // the first version matched only the spaced one.
  const text = String(said ?? '').toLowerCase().replace(/[-_]+/g, ' ');
  if (!text.trim()) return [];
  const out = new Set();
  for (const [key, label] of Object.entries(labels ?? {})) {
    for (const phrase of fieldPhrases(key, label)) {
      // WHOLE WORDS. "fee" is three letters and lives inside other ones.
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) { out.add(key); break; }
    }
  }
  return [...out];
}

/** Every number in their sentence, percentages included. */
function valuesIn(said) {
  return [...String(said ?? '').matchAll(/\b\d+(?:\.\d+)?\s*%?/g)]
    .map((m) => m[0].trim())
    .filter(Boolean);
}

/**
 * The line to add to "what should change?", or '' when they really did
 * not say.
 */
function alreadySaid(said, labels) {
  const fields = namedFieldsIn(said, labels);
  if (fields.length === 0) return '';
  const values = valuesIn(said);
  return `\n\nTHEY ALREADY SAID WHICH: ${fields.join(', ')}`
    + `${values.length > 0 ? `, and the sentence carries ${values.join(', ')}` : ''}. `
    + 'Do NOT ask what to change. Call this again with that field set, and if you cannot tell '
    + 'which number goes with which field, ask about THAT one thing and nothing else.';
}

module.exports = {
  fieldWords, fieldNotNamed, endingNotSwitch, scopeMissesNamed, MUST_BE_NAMED, namedFieldsIn, valuesIn, alreadySaid,
};
