import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * Saving a file where the admin wants it
 * ***************************************************
 *
 * "Why can Diane not let me choose the folder?" She could not, because a
 * plain `<a download>` cannot: the browser's download folder decides and
 * the page is never told where the file went. `showSaveFilePicker` opens
 * the real Save dialogue, and exists in Chromium browsers in a secure
 * context, so the anchor stays as a FALLBACK rather than being replaced.
 *
 * THREE COPIES OF THE ANCHOR EXISTED. The export modal used the shared
 * one; the orb's export and its transcript download each had their own,
 * and both of those were missing `appendChild` (which Firefox needs) and
 * revoked the object URL in the SAME FRAME as the click, which Firefox
 * treats as cancelling the download. The shared helper documented both
 * faults while the copies beside it committed them.
 *
 * Source text: there is no DOM here, and what matters is that one
 * implementation exists and that cancelling is not treated as a failure.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, p), 'utf8');

const HELPER = read('api.helper.js');
const OVERLAY = read('../components/agentOrb/AgentOverlay.jsx');
const MODAL = read('../components/export/MasterSheetExportModal.jsx');

test('THE FOLDER IS THEIRS TO PICK, where the browser allows it', () => {
  assert.match(HELPER, /showSaveFilePicker/);
  assert.match(HELPER, /suggestedName: filename/);
  // Guarded, or it throws on Firefox and Safari instead of falling back.
  assert.match(HELPER, /typeof window\.showSaveFilePicker === 'function'/);
  assert.match(HELPER, /window\.isSecureContext/);
});

test('CANCELLING IS NOT A FAILURE', () => {
  // Closing the dialogue throws AbortError. Reported as an error it tells
  // somebody their export broke when they changed their mind.
  assert.match(HELPER, /AbortError/);
  assert.match(HELPER, /return false/);
});

test('any other picker problem FALLS BACK rather than losing the file', () => {
  const picker = HELPER.slice(HELPER.indexOf('async function saveBlob'));
  assert.match(picker, /handle = null/, 'an unexpected picker error is not recovered');
  assert.match(picker, /createObjectURL/, 'there is no fallback at all');
});

test('the fallback anchor does BOTH things Firefox needs', () => {
  const fallback = HELPER.slice(HELPER.indexOf('createObjectURL'));
  assert.match(fallback, /document\.body\.appendChild\(a\)/, 'a detached anchor is ignored');
  assert.match(fallback, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 0\)/, 'revoked in the click frame');
});

test('ONE IMPLEMENTATION, not three', () => {
  // The orb had its own copy of both, each with the faults above.
  assert.doesNotMatch(OVERLAY, /createObjectURL/, 'the orb hand rolls a download again');
  assert.match(OVERLAY, /import \{ saveBlob \}/);
  assert.match(MODAL, /import \{ saveBlob \}/);
});

test('THE COUNTS COME FROM THE RESPONSE, never from the card', () => {
  // A 21 row bank run was announced as "3 rows, 3 people": the previous
  // export's figures, read from a client side preview that had not caught
  // up. A count derived on this side can go stale; one that travels with
  // the file cannot disagree with it.
  assert.match(HELPER, /X-Row-Count/);
  assert.match(HELPER, /X-People-Count/);

  const build = OVERLAY.slice(OVERLAY.indexOf('async function buildExport'));
  const body = build.slice(0, build.indexOf('\n  }'));
  assert.match(body, /rows: builtRows, people: builtPeople/);

  // NOT EVEN AS A FALLBACK, and not even as an unused argument: a fallback
  // is the same bug waiting for the header to go missing, and an unused
  // argument is an invitation to start reading it again.
  assert.doesNotMatch(body, /preview\?\./, 'it reads the client side preview again');
  assert.match(OVERLAY, /async function buildExport\(query, fileName, setProgress\)/);
});

test('SHE DOES NOT ANNOUNCE A FILE THAT WAS NOT SAVED', () => {
  // The whole point of the return value. Saying "it is yours" after they
  // closed the dialogue is claiming to have done what she did not do.
  const build = OVERLAY.slice(OVERLAY.indexOf('async function buildExport'));
  const body = build.slice(0, build.indexOf('\n  }'));
  assert.match(body, /const saved = await saveBlob\(/);
  assert.match(body, /if \(!saved\)/);
  const saidAt = body.indexOf('is yours');
  const guardAt = body.indexOf('if (!saved)');
  assert.ok(guardAt > -1 && guardAt < saidAt, 'it claims the file is theirs before checking');
});
