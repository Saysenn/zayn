import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { totalsOf } from '../../helpers/formatMoney.js';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

/**
 * ***************************************************
 * * ONE CHECKLIST, THREE SCREENS
 * ***************************************************
 *
 * The status picker (which deals are reviewed monthly), the closure confirm
 * (which stop) and the liquidation panel (which are in the settlement) all
 * ask the same question. They asked it three different ways, and the select
 * all had been written out by hand on four screens before `SelectAll`.
 */

test('THE SELECT ALL IS A CHECKBOX WITH A THIRD STATE, set through a ref', () => {
  const src = read('./SelectAll.jsx');
  // `indeterminate` is a DOM PROPERTY. React will not set it from JSX, so
  // a checkbox without a ref and an effect silently has two states.
  assert.match(src, /useRef/);
  assert.match(src, /indeterminate = count > 0 && count < total/);
  assert.doesNotMatch(src, /<Button/, 'a select all is never a pair of buttons');
});

test('HALF TICKED, PRESSING IT MEANS ALL OF THEM', () => {
  // The third state is a DISPLAY state. Nobody with half a list ticked
  // presses select all meaning "none".
  const src = read('./SelectAll.jsx');
  assert.match(src, /const all = total > 0 && count === total/);
  assert.match(src, /onChange\(!all\)/);
});

test('THE CHECKLIST NEVER TICKS ITSELF', () => {
  // Defaulting is the CALLER's job: "none" is a real answer on at least one
  // of the three screens, and a component that re-ticked would fight every
  // untick on the render after it.
  const src = read('./DealChecklist.jsx');
  assert.doesNotMatch(src, /useEffect/);
  assert.match(src, /onChosen\(all \? deals\.map\(\(d\) => d\.id\) : \[\]\)/);
});

test('A DEAL IS NAMED PERSON, GROUP, ROLE, the same way on every screen', () => {
  // A deal has no name of its own, and two roles on one company look
  // identical when only the person is shown.
  const src = read('./DealChecklist.jsx');
  assert.match(src, /person_name/);
  assert.match(src, /group_name/);
  assert.match(src, /role_label/);
});

test('ALL THREE SCREENS USE THE SHARED CONTROLS, none its own copy', () => {
  const picker = read('../modals/CompanyStatusPicker.jsx');
  const panel = read('../modals/LiquidationPanel.jsx');

  assert.match(picker, /import DealChecklist/);
  // The picker's own list, before the closure confirm needed the same one.
  assert.doesNotMatch(picker, /type="checkbox"/, 'the picker kept a second copy');

  // The panel's rows carry an amount input, so it uses the table it has
  // and shares only the select all.
  assert.match(panel, /import SelectAll/);
  assert.doesNotMatch(panel, /indeterminate/, 'the panel hand rolled the third state');
});

/**
 * THE MONEY IN THE CONFIRM IS THE TICKED DEALS' MONEY, not the company's.
 * Both doors were about to sum it by hand, and one company can hold GBP and
 * EUR deals: a single number would be two currencies added together.
 */
test('totalsOf SUMS PER CURRENCY', () => {
  assert.deepEqual(
    totalsOf([
      { monthly_amount: 500, currency: 'GBP' },
      { monthly_amount: 250.5, currency: 'GBP' },
      { monthly_amount: 100, currency: 'EUR' },
    ]),
    { GBP: 750.5, EUR: 100 },
  );
});

test('totalsOf DEFAULTS A MISSING CURRENCY, and reads a missing amount as zero', () => {
  assert.deepEqual(totalsOf([{ monthly_amount: 80 }, { currency: 'GBP' }]), { GBP: 80 });
  assert.deepEqual(totalsOf([]), {});
  assert.deepEqual(totalsOf(undefined), {});
});

/**
 * AN UNTICKED DEAL IS OUTSIDE THE NEGOTIATION, so it is out of Allocated
 * too. Allocated is the figure checked against the settlement, and a deal
 * settled separately left in the sum makes every row look over.
 */
test('THE PANEL ALLOCATES ONLY WHAT IS TICKED, and says what it left out', () => {
  const src = read('../modals/LiquidationPanel.jsx');
  assert.match(src, /const included = live\.filter\(\(deal\) => chosen\.has\(deal\.id\)\)/);
  assert.match(src, /const allocated = included\.reduce/);
  assert.match(src, /const changed = included\.filter/, 'an unticked row must not be written');
  assert.match(src, /left out, unchanged/);
});

test('AND THE PANEL STARTS WITH ALL OF THEM', () => {
  const src = read('../modals/LiquidationPanel.jsx');
  assert.match(src, /useState\(\(\) => live\.map\(\(deal\) => deal\.id\)\)/);
});

/**
 * ===============================
 * * AND THE PICKER SEEDS FROM THE RIGHT PLACE
 * ===============================
 * Entering liquidation means all of it unless somebody says otherwise. A
 * company ALREADY in liquidation has been asked, and defaulting to all on
 * it re-ticked what had been deliberately unticked: Acqua stored two of
 * three, opened showing three of three, and the next save would have put
 * the third back with nobody choosing it. Found 2026-09-21.
 */
test('IT SEEDS FROM THE TICKED DEALS, never from "all of them"', () => {
  const src = read('../modals/CompanyStatusPicker.jsx');
  /**
   * IT READ THE COMPANY'S STATUS, and that was the bug. Already Liquidation
   * or Review meant "read the deals"; anything else meant "tick
   * everything". So a company on Active with two deals ticked by the import
   * opened showing all five, and Save turned two into five with nobody
   * choosing the other three. A deal in that queue is one somebody can
   * answer "no" to, which stops paying them. Found 2026-09-22.
   */
  assert.match(src, /const already = live\.filter\(ask\.ticked\)/);
  assert.match(src, /\(already\.length > 0 \? already : live\)/);
  assert.doesNotMatch(src, /savedStatus/, 'the stored status decides nothing here now');
});

test('AND THE TICK IS READ PER QUESTION, because they are different columns', () => {
  const src = read('../modals/CompanyStatusPicker.jsx');
  // Review asks the flag. Going concern asks whether the cell holds his
  // word, because for that status the tick IS the note.
  assert.match(src, /ticked: \(d\) => Boolean\(d\.review_monthly\)/);
  assert.match(src, /ticked: \(d\) => d\.end_note === GOING_CONCERN/);
});

test('THE SEEDING STILL HAPPENS ONCE', () => {
  // Re-seeding on every render fights an untick, which is the reason the
  // `touched` guard exists at all.
  const src = read('../modals/CompanyStatusPicker.jsx');
  assert.match(src, /if \(!ask \|\| touched\) return/);
  assert.match(src, /setTouched\(true\)/);
});

/**
 * ===============================
 * * A CHECKBOX IS A WHITE BOX WITH A GREEN TICK
 * ===============================
 * `accent-color` filled the whole box with the accent when ticked, which on
 * a light page is the heaviest thing on screen. The box stays white at
 * every state and only the MARK carries the colour. His call 2026-09-21.
 */
test('THE BOX STAYS WHITE AND ONLY THE TICK IS GREEN', () => {
  const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
  const rule = /input:where\(\[type='checkbox'\]\) \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';

  assert.match(rule, /appearance-none/, 'the native box paints itself');
  // `\b` alone passes on `bg-surface-sunken`, which is the exact thing this
  // is here to refuse.
  assert.match(rule, /bg-surface(?![-\w])/, 'the box is white');
  assert.doesNotMatch(rule, /accent-accent|accent-\[/, 'accent-color fills the whole box');

  // The mark's colour comes from the palette, never a hex typed into CSS:
  // a second definition of the accent is one nobody would think to change.
  const marks = [...css.matchAll(/input\[type='checkbox'\]:(?:checked|indeterminate)::after \{([\s\S]*?)\n  \}/g)]
    .map((m) => m[1]);
  assert.equal(marks.length, 2, 'the tick and the third state both need a mark');
  for (const mark of marks) {
    assert.match(mark, /theme\('colors\.accent\.strong'\)/);
    assert.doesNotMatch(mark, /#[0-9a-fA-F]{3,8}\b/, 'a colour was typed in by hand');
  }
});

/**
 * ===============================
 * * AND IT MUST NOT OUTSCORE `sr-only`
 * ===============================
 * Two controls hide a REAL checkbox behind their own artwork, to keep the
 * keyboard behaviour and the screen reader announcement a styled <span>
 * would throw away: FilterCheckbox and the login's Remember me.
 *
 * Bare, `input[type='checkbox']` scores (0,1,1) and beats `.sr-only` at
 * (0,1,0), so both grew a 16px box in front of the thing they draw. Found
 * 2026-09-21 on the Master Sheet toolbar, where the two filter switches
 * each sprouted one.
 */
test('THE BASE CHECKBOX RULE SCORES (0,0,1), so sr-only still wins', () => {
  const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

  // The selector itself, not a comment about it: this file explains the
  // trap twice in prose, and a guard that reads prose guards nothing.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(code, /input:where\(\[type='checkbox'\]\) \{/, 'the box rule must use :where()');
  // The BOX rule is the one that must yield. Written bare it is the whole
  // bug: a sized, bordered, background-painted element beating sr-only.
  assert.doesNotMatch(code, /input\[type='checkbox'\]\s*,?\s*\{/, 'a bare box rule is back');
  assert.doesNotMatch(
    code,
    /input\[type='checkbox'\]:(?:checked|indeterminate)\s*,/,
    'the state rules set a border colour, so they must yield too',
  );
});

test('AND THE TWO HIDDEN CHECKBOXES ARE STILL REAL INPUTS', () => {
  // A styled <span> would have been simpler and would have thrown away the
  // keyboard behaviour, the focus ring and the announcement.
  const filter = read('../filters/FilterCheckbox.jsx');
  assert.match(filter, /type="checkbox"/);
  assert.match(filter, /className="peer sr-only"/);
});

test('AND THE CHECKLIST PANEL IS WHITE, not a shaded block', () => {
  const src = read('./DealChecklist.jsx');
  assert.match(src, /rounded-md border border-border bg-surface p-2\.5/);
  // White on white is no hover at all, so the row sinks rather than lifts.
  assert.match(src, /hover:bg-surface-sunken/);
});
