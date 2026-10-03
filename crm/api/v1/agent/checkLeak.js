// ***************************************************
// * SHE READ THE TOOL'S INSTRUCTIONS OUT TO THE ADMIN
// ***************************************************
//
// Live 2026-09-24, in one message:
//
//   "Nicola Nathan is more than one person: Nicola, Nathan. List them and
//    ask which ONE, giving their names EXACTLY as written above. Change
//    nothing yet."
//
// Every word after the first sentence is `resolvePerson` talking to HER.
// The admin was handed a stage direction.
//
// The same turn opened with "Nothing has been changed yet, and nothing
// will be until you say yes", and `check_rates` produced "None of their
// deals is paid in coin" out of an instruction that said not to mention
// the crypto charge at all.
//
// ===============================
// * THE WORDS ARE WHAT GIVE IT AWAY
// ===============================
// Every tool summary here is written as orders: "Say exactly", "ask which
// ONE", "Do not summarise". That is deliberate and it works. What was
// missing is anything checking that the orders stayed backstage.
//
// A natural answer to an admin never contains these. They are second
// person imperatives about HOW TO ANSWER, which is a thing you say to an
// assistant and never to the person waiting for the answer.
//
// ADDING ONE IS CHEAP AND EXPECTED. A phrase earns its place by having
// been said out loud in a real transcript, the same rule `askShapes.js`
// follows.

const MARKERS = [
  /\bchange nothing yet\b/i,
  /\bask which ONE\b/,
  /\bexactly as written\b/i,
  /\bsay exactly that line\b/i,
  /\bsay exactly\b/i,
  /\brelay the block\b/i,
  /\bdo not summarise it\b/i,
  /\bis more than one person:/i,
  /\bname those and ask\b/i,
  /\bso do NOT mention\b/,
  /\bsay what changed in one short sentence\b/i,
  /\bdo NOT describe it as done\b/i,
  /\bnothing has been deleted\b/i,
  /\bsay so plainly and do not offer\b/i,
  // The "which deal?" refusal, read out word for word 2026-09-25.
  /\bso ask WHICH\b/,
  /\bsend that entry again\b/i,
  // check_rates' own directions, read out 2026-09-25.
  /\bdo not work a range out of the lines\b/i,
  /\bUse those figures\b/i,
  /\bA rate on a DEAL stacks on top of it, never replacing it\b/,
];

/**
 * ===============================
 * * AND NOT OPENING WITH THE CONFIRM BOILERPLATE
 * ===============================
 * "Nothing has been changed yet, and nothing will be until you say yes."
 * is TRUE, and as the first thing an admin reads it is machine output
 * with a question buried under it. `confirmFirst` already asks her not to
 * open with it; this is what catches the ask being ignored.
 *
 * ONLY AT THE OPENING. Said at the end, in her own words, it is a
 * reassurance and perfectly fine.
 */
const OPENS_WITH_BOILERPLATE = /^\s*(?:\*+\s*)?nothing (?:has )?(?:been )?chang/i;

/**
 * @param {string} reply what she is about to say
 * @returns {{ ok: boolean, leaked: string|null }} the phrase that gave it away
 */
function checkLeak(reply) {
  const said = String(reply ?? '');
  if (!said.trim()) return { ok: true, leaked: null };

  if (OPENS_WITH_BOILERPLATE.test(said)) {
    return { ok: false, leaked: 'it opens with the confirmation boilerplate' };
  }
  for (const marker of MARKERS) {
    const hit = said.match(marker);
    if (hit) return { ok: false, leaked: `"${hit[0]}"` };
  }
  return { ok: true, leaked: null };
}

module.exports = { checkLeak, MARKERS };
