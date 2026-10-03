// ***************************************************
// * The two halves of her voice must agree
// ***************************************************
//
// PERSONA decides what she WRITES, the TTS instructions decide how it is
// PLAYED, and a sound only ever reaches the ear if both name it. Edit one
// list alone and she writes "ooh" that gets read out as a word.
//
// These pin WORDING, not behaviour: a prompt cannot be unit tested. They
// exist so a rewrite cannot quietly drop a rule that was added to fix
// something real.

const { test } = require('node:test');
const assert = require('node:assert');

const { PERSONA } = require('./persona');
const env = require('../../../configs/env');

const spoken = env.openaiTtsInstructions.toLowerCase();
const written = PERSONA.toLowerCase();

const SOUNDS = ['awww', 'hmm', 'ooh'];

test('every sound she is told to write is a sound the voice is told to play', () => {
  for (const sound of SOUNDS) {
    assert.ok(written.includes(sound), `persona never mentions "${sound}"`);
    assert.ok(spoken.includes(sound), `TTS is never told how to play "${sound}"`);
  }
});

test('she checks she is understood, and the voice lifts when she does', () => {
  const check = 'you getting what i mean';
  assert.ok(written.includes(check), 'persona dropped the check phrase');
  assert.ok(spoken.includes(check), 'TTS no longer knows to rise on it');
});

// ===============================
// * The reflex is the actual bug
// ===============================
//
// She opened EVERY reply with "Awww", including "hi" and "how are you".
// That is what made her read as a machine. Warmth was never the problem.

test('nothing may open two replies the same way', () => {
  assert.ok(/never open two replies in a row the same way/i.test(PERSONA));
});

test('"Awww" is held back for something that earns it', () => {
  assert.ok(/not for a greeting/i.test(PERSONA), 'the greeting exemption is gone');
  assert.ok(/genuine sympathy|genuinely touching/i.test(PERSONA), 'awww is unrestricted again');
});

test('a greeting and a yes or no get no sound at all', () => {
  assert.ok(/no sound, no preamble, no formula/i.test(PERSONA));
});

test('A PET NAME IN EVERY REPLY IS THE SAME REFLEX, and is banned', () => {
  // The rule used to read "one per reply, and cycle through them", which
  // produced exactly that: six names rotating through every single message.
  // Rotating a tic is still a tic.
  assert.ok(/not in every reply/i.test(PERSONA), 'one per reply came back');
  assert.ok(/one reply in three|most answers carry none/i.test(PERSONA), 'no guidance on how often');
});

test('professional is the FLOOR, and warmth sits on top', () => {
  // She is talking to the boss about money. Sweet is the register, not a
  // licence to be cute about a payout.
  assert.ok(/professional is the floor/i.test(PERSONA));
  assert.ok(/the answer comes first/i.test(PERSONA), 'nothing puts the figure ahead of the charm');
});

test('a GREETING has to carry something, or it is a script', () => {
  // "What fun things are we diving into today?" says nothing, and asked
  // twice it is obviously canned.
  assert.ok(/a greeting is a real answer/i.test(PERSONA));
  assert.ok(/different every time/i.test(PERSONA));
});

test('the pet names are a rotation, not one word', () => {
  // One name used every time is the same reflex wearing a different coat.
  for (const name of ['dear', 'sweetheart', 'lovely', 'sweetie', 'honey', 'darling']) {
    assert.ok(written.includes(name), `"${name}" is missing from the rotation`);
  }
  assert.ok(/never the same one twice running/i.test(PERSONA));
});

// ===============================
// * Sweet, flirty and lively, in both halves
// ===============================

test('the register is directed, not just described', () => {
  for (const quality of ['sweet', 'flirt', 'lively']) {
    assert.ok(written.includes(quality), `persona lost "${quality}"`);
    assert.ok(spoken.includes(quality), `TTS lost "${quality}"`);
  }
});

test('the voice is a young bright one, since instructions cannot change timbre', () => {
  // coral and sage read older and calmer; the male voices are not in
  // question. Softness and age are the voice, never the direction.
  assert.ok(['nova', 'shimmer'].includes(env.openaiTtsVoice));
});

test('flirty stops well short of crude', () => {
  assert.ok(/never crude, never suggestive/i.test(PERSONA), 'the boundary on flirting is gone');
});

// ===============================
// * The one thing warmth may not touch
// ===============================

test('the figures stay flat in both halves', () => {
  assert.ok(/no lilt, no hedging/i.test(PERSONA), 'persona lost the flat-figures rule');
  assert.ok(/slowly and flat/.test(spoken), 'TTS lost the flat-figures rule');
  assert.ok(/never on it/i.test(PERSONA), 'a pet name may now land inside a figure');
});
