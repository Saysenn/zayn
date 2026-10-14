import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isVideoFile, overallPct, stageLine, clock, leftWords, uploadLeft, stepIndex,
} from './videoProgress.js';

// A video becoming its transcript, as its card shows it (2026-10-14).

test('A VIDEO IS KNOWN by its name or its type; a document is not', () => {
  assert.equal(isVideoFile({ name: 'call with Begbies.MOV', type: '' }), true);
  assert.equal(isVideoFile({ name: 'clip', type: 'video/mp4' }), true);
  assert.equal(isVideoFile({ name: 'petition.pdf', type: 'application/pdf' }), false);
  assert.equal(isVideoFile({ name: 'voice note.m4a', type: 'audio/mp4' }), false);
});

test('THE BAR ONLY MOVES FORWARD through the stages', () => {
  const seq = [
    overallPct({ stage: 'uploading', uploadPct: 0 }),
    overallPct({ stage: 'uploading', uploadPct: 100 }),
    overallPct({ stage: 'extracting' }),
    overallPct({ stage: 'transcribing', part: 1, parts: 4 }),
    overallPct({ stage: 'transcribing', part: 4, parts: 4 }),
    overallPct({ stage: 'summarising' }),
    overallPct({ stage: 'saved' }),
  ];
  for (let i = 1; i < seq.length; i += 1) assert.ok(seq[i] >= seq[i - 1], `step ${i}: ${seq}`);
  assert.equal(seq.at(-1), 100);
});

test('THE LINE SAYS WHICH PART, and no "part 1 of 1"', () => {
  assert.equal(stageLine({ stage: 'transcribing', part: 2, parts: 4 }), 'Transcribing part 2 of 4…');
  assert.equal(stageLine({ stage: 'transcribing', part: 1, parts: 1 }), 'Transcribing…');
  assert.equal(stageLine({ stage: 'uploading', uploadPct: 42.4 }), 'Uploading 42%');
  assert.equal(stepIndex('summarising'), 3);
});

test('THE CLOCK AND THE TIME LEFT never claim false precision', () => {
  assert.equal(clock(42), '0:42');
  assert.equal(clock(725), '12:05');
  assert.equal(clock(3723), '1:02:03');
  assert.equal(leftWords(3), 'almost done');
  assert.equal(leftWords(40), 'under a minute left');
  assert.equal(leftWords(150), 'about 3 min left');
  assert.equal(leftWords(null), null);
  assert.equal(uploadLeft(0, 5), null, 'no rate yet');
  assert.equal(Math.round(uploadLeft(25, 10)), 30);
});
