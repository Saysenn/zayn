import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chunkForSpeech, SPEECH_API_CHUNK_CHARS, TTS_FIRST_CHARS, TTS_CHUNK_CHARS,
} from './speechChunks.js';
import { readFileSync } from 'node:fs';

/**
 * ***************************************************
 * * A long reply is SPLIT, never trimmed
 * ***************************************************
 *
 * A cap on speech is invisible by definition: the whole reply is on screen,
 * so nothing tells you the ear got less than the eye. The server used to
 * slice at 2000 characters and say nothing.
 */

test('a short reply is one part, unchanged', () => {
  assert.deepEqual(chunkForSpeech('Gloria is owed 2,000 GBP.'), ['Gloria is owed 2,000 GBP.']);
});

test('nothing in, nothing out', () => {
  assert.deepEqual(chunkForSpeech(''), []);
  assert.deepEqual(chunkForSpeech(null), []);
});

test('NOT ONE CHARACTER IS LOST, which is the whole point', () => {
  const sentence = 'She is owed five hundred pounds for August. ';
  const long = sentence.repeat(400); // ~17,000 characters
  const parts = chunkForSpeech(long);

  assert.ok(parts.length > 1, 'it must actually split');
  // Whitespace at the seams is the only difference allowed.
  const rejoined = parts.join(' ').replace(/\s+/g, ' ').trim();
  assert.equal(rejoined, long.replace(/\s+/g, ' ').trim());
});

test('every part fits the provider limit', () => {
  const parts = chunkForSpeech('Some words here. '.repeat(500));
  for (const part of parts) assert.ok(part.length <= 3500, `${part.length} is over the limit`);
});

test('it breaks at a full stop, not mid word', () => {
  // 10 sentences of ~40 chars, a 100 char budget: seams must land on '.'
  const parts = chunkForSpeech('The quick brown fox jumped over it. '.repeat(10), 100);
  assert.ok(parts.length > 1);
  for (const part of parts) assert.match(part, /\.$/, `"${part}" was cut mid sentence`);
});

test('one sentence longer than the whole budget is still said', () => {
  // The alternative is dropping it, which is the bug this replaced.
  const runOn = `${'word '.repeat(100)}end.`;
  const parts = chunkForSpeech(runOn, 60);
  for (const part of parts) assert.ok(part.length <= 60);
  assert.match(parts.join(' '), /end\.$/);
});

/**
 * ===============================
 * * THE BROWSER VOICE NEEDS SMALLER PARTS
 * ===============================
 * SpeechSynthesis gives up part way through a long utterance and fires no
 * error, so useSpeechSynthesis chunks too. Same function, smaller budget,
 * so both voices break at the same sentence ends.
 */
test('the browser budget is well under what that engine abandons', () => {
  assert.ok(SPEECH_API_CHUNK_CHARS <= 300, 'a long utterance is dropped silently');
  assert.ok(SPEECH_API_CHUNK_CHARS >= 80, 'one word per utterance would stutter');
});

test('a long reply keeps every word across the browser parts', () => {
  const answer = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i + 1}.`).join(' ');
  const parts = chunkForSpeech(answer, SPEECH_API_CHUNK_CHARS);

  assert.ok(parts.length > 1, 'it has to split, or there is nothing being tested');
  for (const part of parts) assert.ok(part.length <= SPEECH_API_CHUNK_CHARS);
  // NOTHING LOST. A cut here is invisible: the whole reply is on screen.
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), answer.replace(/\s+/g, ' '));
  assert.match(parts.at(-1), /sentence number 40\.$/);
});

/**
 * ***************************************************
 * * TIME TO FIRST WORD, which is a different question
 * ***************************************************
 *
 * Fitting under the provider's limit is not the same as starting quickly.
 * The review queue is 1,696 characters: ONE request under `CHUNK_CHARS`,
 * so not a word was heard until all of it had been synthesised, with the
 * text on screen the whole time. Reported 2026-09-21.
 */

// Her real answer, as it went out. Kept as a fixture rather than as a made
// up paragraph: the shape of it, short lines and no full stops, is what
// decides where a sentence splitter can break.
const REVIEW_BLOCK = [
  '30 of 30 unanswered for September 2026, 39,619.04 a month.',
  'Final stops on 30 September 2026. No stops on 31 August 2026.',
  '',
  ...Array.from({ length: 15 }, (_, i) => [
    `Company ${i + 1}, GROUP, ended 1 January 2026`,
    '   Somebody, Director, GBP 500.00',
    '   Another one, Mid 1, GBP 1,000.00',
    '',
  ]).flat(),
].join('\n');

test('THE FIRST PART IS SHORT, so she starts talking quickly', () => {
  const parts = chunkForSpeech(REVIEW_BLOCK, TTS_CHUNK_CHARS, TTS_FIRST_CHARS);
  assert.ok(parts.length > 1, 'the block used to be one request');
  assert.ok(
    parts[0].length <= TTS_FIRST_CHARS,
    `the opener is ${parts[0].length}, over the ${TTS_FIRST_CHARS} budget`,
  );
  // It is the HEADLINE, which is the part somebody is waiting to hear.
  assert.match(parts[0], /30 of 30 unanswered/);
});

test('AND THE REST ARE NOT, because they are fetched behind playback', () => {
  const parts = chunkForSpeech(REVIEW_BLOCK, TTS_CHUNK_CHARS, TTS_FIRST_CHARS);
  for (const part of parts.slice(1)) assert.ok(part.length <= TTS_CHUNK_CHARS);
  // Making every part small would multiply the requests for no gain: only
  // the first one is a wait anybody sits through.
  assert.ok(parts.length <= 6, `${parts.length} requests for one answer`);
});

test('NOT ONE CHARACTER IS LOST TO THE SMALLER FIRST PART EITHER', () => {
  const parts = chunkForSpeech(REVIEW_BLOCK, TTS_CHUNK_CHARS, TTS_FIRST_CHARS);
  const flat = (s) => s.replace(/\s+/g, ' ').trim();
  assert.equal(flat(parts.join(' ')), flat(REVIEW_BLOCK));
});

test('A SHORT REPLY IS STILL ONE PART', () => {
  // The opener budget must not split a two line answer into two requests.
  const short = 'Gloria is owed 2,000 GBP this month.';
  assert.deepEqual(chunkForSpeech(short, TTS_CHUNK_CHARS, TTS_FIRST_CHARS), [short]);
});

test('AN OPENER LONGER THAN ITS OWN BUDGET DOES NOT KEEP IT', () => {
  // A single sentence over the small budget is cut, and the NEXT slice
  // takes the ordinary budget: keeping 180 for the whole answer would be
  // twenty requests for one paragraph.
  const oneSentence = `${'word '.repeat(600).trim()}.`;
  const parts = chunkForSpeech(oneSentence, TTS_CHUNK_CHARS, TTS_FIRST_CHARS);
  assert.ok(parts[0].length <= TTS_FIRST_CHARS);
  assert.ok(parts[1].length > TTS_FIRST_CHARS, 'the small budget stuck');
  assert.ok(parts.every((p) => p.length <= TTS_CHUNK_CHARS));
});

test('THE TWO BUDGETS ARE THE ONE DEFINITION, and the hook reads them', () => {
  assert.ok(TTS_FIRST_CHARS < TTS_CHUNK_CHARS, 'the opener is the small one');
  const hook = readFileSync(new URL('./useOpenaiSpeech.js', import.meta.url), 'utf8');
  assert.match(hook, /chunkForSpeech\(text, TTS_CHUNK_CHARS, TTS_FIRST_CHARS\)/);
});

/**
 * ===============================
 * * AND THE NEXT PART IS FETCHED WHILE THIS ONE PLAYS
 * ===============================
 * Both halves are needed. A small first part with no fetch ahead just
 * moves the wait to the first seam; fetching ahead with one 3,500
 * character part has nothing to fetch.
 */
test('THE HOOK ASKS FOR THE NEXT PART BEFORE IT PLAYS THIS ONE', () => {
  // Comments stripped, because this file explains the rule in prose twice
  // and a guard that reads prose guards nothing.
  const hook = readFileSync(new URL('./useOpenaiSpeech.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Asked for before the chain even starts, so it warms up behind whatever
  // is already playing.
  assert.match(hook, /fetchPart\(0\);/);
  // And the one after this, BEFORE the await that plays.
  assert.match(hook, /fetchPart\(i \+ 1\);\s*\n\s*await playOne\(blob\)/);
  // Never all of them at once: a thirty part answer would open thirty
  // connections for audio minutes away from being wanted.
  assert.doesNotMatch(hook, /parts\.map\([^)]*speech\(/, 'every part fetched at once');
});

test('MUTING STOPS A PART THAT IS STILL IN FLIGHT', () => {
  const hook = readFileSync(new URL('./useOpenaiSpeech.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Pausing the element stops what is AUDIBLE. A request that lands after
  // a cancel would start playing into a muted session, and resetting the
  // queue never covered it because the chain was already built.
  assert.match(hook, /genRef\.current \+= 1;/);
  assert.match(hook, /if \(gen !== genRef\.current\) return;/);
});

test('A FAILED FETCH IS NOT THE SAME AS NO FETCH', () => {
  // Swallowing it as null would make a dead request look like the end of
  // the answer, and `available` would never flip.
  const hook = readFileSync(new URL('./useOpenaiSpeech.js', import.meta.url), 'utf8');
  assert.match(hook, /const FAILED = Symbol\(/);
  assert.match(hook, /blob === FAILED/);
});
