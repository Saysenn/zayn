import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = readFileSync(new URL('./forms/DealCard.jsx', import.meta.url), 'utf8');
const messages = readFileSync(new URL('./Messages.jsx', import.meta.url), 'utf8');
const overlay = readFileSync(new URL('./AgentOverlay.jsx', import.meta.url), 'utf8');

test('deal payment pills separate current eligibility from receipt state', () => {
  assert.match(card, /Payable this month/);
  assert.match(card, /Not payable this month/);
  assert.doesNotMatch(card, /Payment expected/);
});

/**
 * BOTH SWITCHES, 2026-09-09. The row filtered to `overridePaid` alone and
 * `Pill` hardcoded one pair of words, so a card said a deal was unpaid
 * without ever saying whether it was meant to be paid at all.
 *
 * Asserted on PILL_WORDS rather than on the file's text: the old labels
 * still appear in the comment above the map, so a plain /Payment received/
 * would pass on prose while the pill drew something else.
 */
test('each switch says WHICH switch it is, in its own words', () => {
  const words = /const PILL_WORDS = \{([\s\S]*?)\n\};/.exec(card);
  assert.ok(words, 'PILL_WORDS is where the labels live');
  assert.match(words[1], /overrideShouldBePaid: \{ yes: 'Should be paid', no: 'Not to be paid'/);
  assert.match(words[1], /overridePaid: \{ yes: 'Paid', no: 'Not paid'/);
});

test('SHOULD BE PAID IS RED WHEN NO, paid is only amber', () => {
  // His call. The decision gets both answers stated plainly; an unpaid row
  // is amber because most rows are unpaid for most of the month, and forty
  // red pills would leave the one that matters the same colour as the rest.
  const words = /const PILL_WORDS = \{([\s\S]*?)\n\};/.exec(card)[1];
  assert.match(words, /overrideShouldBePaid: \{[^}]*noTone: 'alert'/);
  assert.match(words, /overridePaid: \{[^}]*noTone: 'warn'/);
  // Yes is green for both, so the tone map has to carry all three.
  assert.match(card, /signal: 'border-diane-signal/);
  assert.match(card, /alert: 'border-diane-alert/);
});

test('the row renders every switch, not one of them', () => {
  assert.doesNotMatch(card, /\.filter\(\(item\) => item\.editField === 'overridePaid'\)/);
  assert.match(card, /\(card\.switches \?\? \[\]\)\s*\n?\s*\.map\(\(item\) => <Pill/);
});

test('conversation-facing separators are plain text without mojibake', () => {
  assert.doesNotMatch(card, /Â·|â–¸|â–¾/);
  assert.doesNotMatch(messages, /Â·|â–¸|â–¾/);
});

test('downloaded conversations carry a UTF-8 marker for Windows readers', () => {
  assert.match(overlay, /new Blob\(\['\\uFEFF', lines\.join\('\\n'\)\]/);
});
