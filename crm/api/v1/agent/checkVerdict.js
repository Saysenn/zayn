// ***************************************************
// * A YES OR NO QUESTION GOT NO YES OR NO
// ***************************************************
//
// "Is Dov on a 1% add on?" was answered with his rates and never "no".
// `check_rates` works the verdict out (rateChange.rateVerdict) and tells her
// to open with it. That is a sentence, so this checks she did.

const { asksRateCheck } = require('./askShapes');

const OPENER =/OPEN YOUR ANSWER WITH THIS SENTENCE, word for word: "([^"]+)"/g;

const fold = (s) => String(s ?? '').toLowerCase();

/** Every verdict the tools worked out this turn, one per person. */
function verdictsIn(toolResults = []) {
  const out = [];
  for (const r of toolResults) {
    for (const m of String(r?.summary ?? '').matchAll(OPENER)) {
      const line = m[1];
      const word = line.split('.')[0].trim();
      // "No. Dov Ashgrove is on ...": the first name is what she says back.
      const first = (line.slice(word.length + 1).trim().split(/\s+/)[0] ?? '').replace(/'s$/, '');
      out.push({ line, word, first });
    }
  }
  return out;
}

/**
 * @returns {{ ok: boolean, missing: string[] }} the verdict lines her reply
 *   does not carry: the word, in a sentence naming that person.
 */
function checkVerdict(reply, toolResults = [], { said = '' } = {}) {
  const verdicts = verdictsIn(toolResults);
  if (verdicts.length === 0) {
    // ASKED, AND NO TOOL RAN: "is dov's fee 2%?" answered from memory. A
    // tool that answered without one (nobody matches, which person) stands.
    return asksRateCheck(said) && toolResults.length === 0
      ? { ok: false, missing: [], noTool: true }
      : { ok: true, missing: [] };
  }
  const text = String(reply ?? '');
  const sentences = text.split(/(?<=[.!?])\s+/);
  const says = (word, s) => new RegExp(`\\b${word}\\b`, 'i').test(s);

  const whole = fold(text).replace(/\s+/g, ' ');
  const missing = verdicts.filter(({ line, word, first }) => {
    // THE LINE ITSELF, word for word: "No." is its own sentence, so the name
    // check below missed it and the backstop said it twice. 2026-09-25.
    if (whole.includes(fold(line).replace(/\s+/g, ' '))) return false;
    // One person: opening with the word is the answer, name or not.
    if (verdicts.length === 1 && says(word, sentences[0] ?? '')) return false;
    return !sentences.some((s) => says(word, s) && fold(s).includes(fold(first)));
  }).map((v) => v.line);

  return { ok: missing.length === 0, missing };
}

/**
 * THE VERDICT IS CODE'S, SO CODE SAYS IT when her retry still dropped it.
 * "Is Dov on 3%?" ended with no "No." after two retries. 2026-09-25.
 */
function withVerdict(reply, toolResults = [], opts = {}) {
  const { ok, missing } = checkVerdict(reply, toolResults, opts);
  return ok || missing.length === 0 ? reply : `${missing.join(' ')} ${reply}`;
}

module.exports = { checkVerdict, verdictsIn, withVerdict };
