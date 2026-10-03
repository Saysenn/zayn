import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * Starting the conversation again, on purpose
 * ***************************************************
 *
 * The transcript survives closing the orb AND a page reload, both
 * deliberately, so until this button the only way out of a conversation
 * that had gone somewhere unhelpful was to wait thirty minutes for the idle
 * timer or close the tab.
 *
 * THE RESET IS NOT A DELETE. What is on screen goes; what happened is
 * saved first, because the log is what the search and the summaries read
 * and nobody asked to unsay it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, p), 'utf8');

const OVERLAY = read('AgentOverlay.jsx');
const LOG = read('useConversationLog.js');
const RESET = OVERLAY.slice(OVERLAY.indexOf('function resetConversation'));
const BODY = RESET.slice(0, RESET.indexOf('\n  }'));

test('IT SAVES BEFORE IT CLEARS', () => {
  // Clearing first and saving after would file an empty transcript over
  // the real one.
  const savedAt = BODY.indexOf('endConversation()');
  const clearedAt = BODY.indexOf('setHistory(');
  assert.ok(savedAt > -1, 'the conversation is not saved at all');
  assert.ok(savedAt < clearedAt, 'it clears the transcript before saving it');
});

test('a manual end starts a FRESH id, not a second write to the same row', () => {
  assert.match(LOG, /const endConversation = useCallback\(/);
  assert.match(LOG, /save\(\)\.finally\(\(\) => \{ convo\.current = newConversation\(\); \}\)/);
  assert.match(LOG, /return \{ save, noteTouched, endConversation \};/);
});

test('THE HALF BUILT EXPORT GOES WITH IT', () => {
  // It lives in sessionStorage and would otherwise come back on reload,
  // as a card whose questions and answers are no longer on screen.
  assert.match(BODY, /forgetExport\(\)/);
});

test('nothing is left mid flight', () => {
  // A streaming reply, a progress bar or her voice carrying on would all
  // be about a conversation that is no longer there.
  assert.match(BODY, /setStreamingReply\(''\)/);
  assert.match(BODY, /setProgress\(null\)/);
  assert.match(BODY, /tts\.cancel\?\.\(\)/);
  // The editor keeps its text in the DOM, so React state alone is not
  // enough to empty it.
  assert.match(BODY, /inputRef\.current\?\.clear\(\)/);
});

test('IT ASKS FIRST, and names what survives', () => {
  assert.match(OVERLAY, /confirmingReset && \(/);
  const dialog = OVERLAY.slice(OVERLAY.indexOf('<ConfirmDialog'));
  assert.match(dialog, /SAVED first/, 'it does not say the record is kept');
  assert.match(dialog, /openCard/, 'it does not warn that a live export goes too');
});

test('the button is disabled mid answer and on an empty transcript', () => {
  // Clearing while she is writing would leave a request landing into a
  // conversation that no longer exists.
  assert.match(OVERLAY, /disabled=\{isSending \|\| history\.length <= 1\}/);
});

test('ESCAPE ANSWERS THE CONFIRM, not the overlay behind it', () => {
  // There were two Escape handlers, one closing the conversation drawer in
  // the capture phase and one closing Diane, and the dialog could end up
  // answered by the wrong one. The drawer is gone; the one that is left
  // still has to stand down while a confirm is open, or Escape throws you
  // back to the CRM with the question still on screen.
  // And while a deal is open on top: Escape closes that, not Diane. 2026-09-30.
  assert.match(OVERLAY, /if \(!open \|\| confirmingReset \|\| openDeal\) return;/);
  assert.equal((OVERLAY.match(/e\.key === 'Escape'|e\.key !== 'Escape'/g) ?? []).length, 1,
    'there is more than one Escape handler again');
});
