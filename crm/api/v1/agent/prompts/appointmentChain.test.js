const { test } = require('node:test');
const assert = require('node:assert');

const { MASTER_SHEET_PROMPT } = require('./masterSheet');
const { PAYMENT_START_OFFSET_DAYS } = require('../../shared/fromAppointment.helper');

/**
 * ***************************************************
 * * She has to know where the dates come from
 * ***************************************************
 *
 * These pin WORDING, not behaviour, the same arrangement voice.test.js
 * already uses: a prompt cannot be unit tested, so what these stop is a
 * rewrite quietly dropping a rule that was added to fix something real.
 *
 * PROMPTING IS NOT A GUARD. The cascade itself is enforced in
 * shared/recomputePayable.helper.js and pinned in fromAppointment.test.js.
 * What lives here is only what she SAYS about it, and the one thing no
 * guard can catch: her reporting less than she did.
 */

const prompt = MASTER_SHEET_PROMPT;

test('the chain starts at the appointment date, and she is told so', () => {
  assert.match(prompt, /appointment date \+ 90 days/i);
  assert.match(prompt, /end date = appointment date \+ one year/i);
  // Asked "why does hers start in July", the answer is a date she has.
  assert.match(prompt, /why does hers start in July/i);
});

test('the offset in the prompt is the one the code uses', () => {
  // 90 or 84 is still an open question with him: his two written documents
  // say 84 and his spreadsheet says 90. If the decision moves, this fails
  // rather than leaving her quoting the old number at an admin.
  const found = prompt.match(/appointment date \+ (\d+) days/i);
  assert.ok(found, 'the prompt must state the offset');
  assert.equal(Number(found[1]), PAYMENT_START_OFFSET_DAYS);
});

test('SHE MUST NOT UNDER REPORT AN APPOINTMENT EDIT', () => {
  // Four cells move on the admin's screen. Saying only "appointment
  // updated" is telling them nothing about their own money, which is the
  // one failure no guard downstream can catch.
  assert.match(prompt, /CHANGING AN APPOINTMENT DATE CHANGES FOUR MORE CELLS/i);
  assert.match(prompt, /Say what moved and to what/i);
});

test('a hand set payment start is reported as such, not silently skipped', () => {
  assert.match(prompt, /typed by hand is left alone, and then you say THAT/i);
});

test('THE PROSE RULE IS NOT SOFTENED BY THE CHAIN', () => {
  // The chain says prose is read as appointment + 90. That is exactly the
  // reading she must never do herself, so the two sit next to each other
  // and the prompt says which is which.
  assert.match(prompt, /never convert prose into a date yourself/i);
  assert.match(prompt, /THIS HAS NOT CHANGED and is not softened/i);
  // The evidence, so the next rewrite cannot argue it away.
  assert.match(prompt, /1,612\.90/);
});

test('a derived value is not a human claim, and she knows the difference', () => {
  assert.match(prompt, /Editing a column here claims it/i);
  assert.match(prompt, /A value the SYSTEM worked out is not a claim/i);
});
