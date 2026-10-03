const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * ***************************************************
 * * A REFUSAL MUST NOT CLAIM THE CRM CANNOT DO SOMETHING IT CAN
 * ***************************************************
 *
 * Live 2026-09-29. She sent `person` to a tool that has no such argument.
 * The unknown-argument refusal ended with a line telling her to "tell them
 * plainly that you cannot narrow by that", and she did:
 *
 *   "I can't filter by people and group together, darling. I can find Zayn
 *    Milkman or deals in MILKMAN, but not both at once."
 *
 * None of that was true. `q` searches the name and sits beside `group`, so
 * a person in a group is one call.
 *
 * A REFUSAL IS A SENTENCE SHE WILL REPEAT. It is written for her, she
 * relays it, and the admin believes it, so a false one is worse than the
 * wrong argument it was catching: he now thinks his own CRM cannot do a
 * thing he built.
 *
 * This sweeps the refusal text for the shape that caused it: a guard that
 * hands her "you cannot" without naming what she CAN do instead.
 */

const AGENT = path.join(__dirname);

function sourcesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'scenarios' ? [] : sourcesIn(full);
    return entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')
      ? [full]
      : [];
  });
}

// The comment above a guard explains the incident and often quotes the very
// sentence it exists to stop. Only what she is HANDED is checked.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * ===============================
 * * WHY THIS IS NOT A SWEEP OVER EVERY REFUSAL
 * ===============================
 * It was, twice, and both passes flagged only honest sentences:
 * `capabilities.js` listing what she genuinely cannot do, a log line
 * recording that she offered something impossible, two prompts telling her
 * NOT to say it, and four refusals whose alternative sat on the next line
 * of a concatenated string.
 *
 * Nine false positives and no real ones. A check that cries wolf is one
 * somebody widens until it catches nothing, which `checkFigures` carries
 * as a warning in its own header, so the sweep was dropped rather than
 * tuned a third time.
 *
 * WHAT IS PINNED INSTEAD is the place it actually happened and the rule it
 * broke. `knownArgs` is where a wrong argument becomes a sentence she says
 * out loud, and every branch of it has to hand her a door.
 */
test('EVERY WRONG ARGUMENT IN knownArgs NAMES THE RIGHT ONE', () => {
  // JOINED FIRST. These are written as concatenated literals, so a door
  // named across a line break ("...is ' + 'update_person") is not
  // contiguous in the source and a naive read calls an honest message
  // dishonest. The first version of this test did exactly that.
  const src = stripComments(fs.readFileSync(path.join(AGENT, 'knownArgs.js'), 'utf8'))
    .replace(/'\s*\+\s*'/g, '');

  // The per-argument answers, each a const holding what she is handed.
  for (const name of ['SEVERAL', 'ADD_DOOR', 'PEOPLE_READ', 'PERSON_READ']) {
    const found = new RegExp(`const ${name} = ([\\s\\S]*?);\\n`).exec(src);
    assert.ok(found, `${name} is the answer for one wrong argument`);
    assert.match(
      found[1],
      /`q`|\binstead\b|update_person|bulk_\w+|list_\w+|\bIt can be done\b|\bCall \w/,
      `${name} tells her it is wrong without telling her what is right`,
    );
  }
  // And the generic fallback still offers the nearest thing rather than
  // ending on a flat no.
  assert.match(src, /offer the closest thing you can/);
});

/**
 * AND THE ONE THAT ACTUALLY BIT, pinned by name so it cannot come back.
 * `person` on a read tool is `q`, and `q` works beside `group`.
 */
test('A PERSON ON A READ TOOL IS `q`, and it is said so', () => {
  const src = fs.readFileSync(path.join(AGENT, 'knownArgs.js'), 'utf8');
  const clean = stripComments(src);
  assert.match(clean, /"person" is not taken here, and that does NOT mean/);
  assert.match(clean, /`q` IS their name and it works BESIDE `group`/);
  assert.match(clean, /Do NOT tell them this cannot be done/);
});

/**
 * ===============================
 * * AND A REAL ROW IS NEVER CALLED A MISTAKE
 * ===============================
 * A payable amount CAN be set by hand, so it can exceed the monthly
 * amount, and the sign-in briefing counts those rows. Her prompt stated
 * the formula as though it were the only way a payable exists, which is
 * where "that cannot be right" comes from.
 */
test('SHE IS TOLD A PAYABLE OVER THE MONTHLY IS REAL', () => {
  const prompt = fs.readFileSync(path.join(AGENT, 'prompts', 'masterSheet.js'), 'utf8');
  assert.match(prompt, /A PAYABLE AMOUNT CAN BE SET BY HAND/);
  assert.match(prompt, /payable CAN be more than the monthly amount/);
  assert.match(prompt, /NEVER tell the admin that a row is impossible/);

  // And the CRM really does count them, so the prompt is not just a claim.
  const briefing = fs.readFileSync(
    path.join(AGENT, '..', 'shared', 'briefing.helper.js'), 'utf8',
  );
  assert.match(briefing, /Number\(row\.payable_amount\) > Number\(row\.monthly_amount\)/);
});
