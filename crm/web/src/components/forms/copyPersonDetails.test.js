import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * THE REAL FUNCTION, IMPORTED, NOT RESTATED.
 *
 * The first draft copied the rule into this file. Breaking the component
 * to check the test caught it left every case green, twice: it was
 * measuring its own copy. The rule moved to helpers/personFill.js, a plain
 * module a test can import, and this asserts against that.
 */
import { fillableFrom } from '../../helpers/personFill.js';

/**
 * ***************************************************
 * * FILLING A DEAL'S BLANKS FROM ONE THIS PERSON ALREADY HOLDS
 * ***************************************************
 *
 * His call 2026-09-23. Two offers, a live deal and an archived one, and
 * both fill BLANKS ONLY: nothing already typed is touched, so accepting is
 * never something to undo.
 *
 * PERSON FACTS ONLY. Not the monthly amount, not the method, not the
 * dates: 20 of the 28 multi-handler companies pay their handlers different
 * negotiated amounts, so a copied wage is silently wrong on the row nobody
 * re-reads.
 */

/**
 * ===============================
 * * THIS SIDE ONLY. crm/web and crm/api SHARE NO FILE.
 * ===============================
 * The first draft read `api/v1/repos/masterSheetRows.repo.js` from here to
 * check the column list, which is exactly the crossing the rule forbids:
 * either side must test on a machine holding only itself, and "it reads
 * it, it doesn't import it" is not an exemption.
 *
 * So the CONTRACT is written twice. This half pins what the FORM does with
 * whatever it is handed; the server's half pins which columns it hands
 * over and which donor it picks, in `api/v1/repos/personFill.test.js`.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, 'CopyPersonDetails.jsx'), 'utf8');
const PAGE = fs.readFileSync(path.join(HERE, '..', '..', 'pages', 'MasterSheetPage.jsx'), 'utf8');
// Her glow lives with every other animation in the CRM, not in a style
// prop: `prefers-reduced-motion` has to be able to reach it.
const CSS = fs.readFileSync(path.join(HERE, '..', '..', 'index.css'), 'utf8');

const donor = (fields) => ({ id: 7, company: 'Acqua', groupName: 'INDIGO', fields });

// ===============================
// * Blanks only, which is the whole promise
// ===============================

test('IT FILLS A BLANK AND LEAVES A TYPED VALUE ALONE', () => {
  const fills = fillableFrom(
    donor({ phone: '+447700900000', postcode: 'N1 7QE', location: 'Main City' }),
    { phone: '', postcode: 'L3 4EF', location: null },
  );
  assert.deepEqual(fills, { phone: '+447700900000', location: 'Main City' });
});

test('WHITESPACE IS A BLANK, so a stray space does not block a fill', () => {
  assert.deepEqual(fillableFrom(donor({ phone: '+44' }), { phone: '   ' }), { phone: '+44' });
});

test('A SENTINEL IS A VALUE, on both sides', () => {
  // "Will never be bank" and "Handled internally" are the sheet saying the
  // fact is not held, which is an answer. Copied when the form is empty,
  // and never overwritten when the form already carries one.
  assert.deepEqual(
    fillableFrom(donor({ bankDetails: 'Will never be bank' }), { bankDetails: '' }),
    { bankDetails: 'Will never be bank' },
  );
  assert.deepEqual(
    fillableFrom(donor({ bankDetails: 'Barclays' }), { bankDetails: 'Will never be bank' }),
    {},
  );
});

test('A DONOR THAT WOULD FILL NOTHING OFFERS NOTHING', () => {
  // A button that does not move the form is one somebody presses twice
  // wondering why. The component returns null on an empty set.
  assert.deepEqual(fillableFrom(donor({ phone: '+44' }), { phone: '+44' }), {});
  assert.deepEqual(fillableFrom(null, { phone: '' }), {});
  assert.match(SRC, /if \(keys\.length === 0\) return null/);
});

// ===============================
// * The shapes, so it cannot quietly widen
// ===============================

test('IT OFFERS BACK WHAT IT WAS HANDED, never its own list', () => {
  // A second list of person columns here is a second answer to "what is a
  // person fact", and the two would drift the first time one was added.
  // The server's list is the only one.
  const unseen = fillableFrom(
    donor({ somethingAddedLater: 'x', phone: '+44' }),
    { somethingAddedLater: '', phone: '' },
  );
  assert.deepEqual(unseen, { somethingAddedLater: 'x', phone: '+44' });
  assert.match(SRC, /fillableFrom\(candidate, form\)/);
  assert.doesNotMatch(SRC, /'phone'|"phone"/, 'the component hardcoded a column');
});

test('BOTH OFFERS ARE RENDERED, live first', () => {
  const live = SRC.indexOf('candidate={data.live}');
  const archive = SRC.indexOf('candidate={data.archive}');
  assert.ok(live > 0 && archive > live, 'the archive offer is missing or comes first');
});

test('THE FORM MERGES, never replaces', () => {
  // Handed the whole donor row it would blank every field the donor had
  // empty, which is the opposite of filling blanks.
  assert.match(PAGE, /onFill=\{\(fields\) => setForm\(\(f\) => \(\{ \.\.\.f, \.\.\.fields \}\)\)\}/);
});

// ===============================
// * IT IS HER OFFER, AND IT LOOKS LIKE ONE
// ===============================

test('SHE IS THE ONE SPEAKING, and the two sources say different things', () => {
  // "Copy their details from another deal" reads as a control the form
  // happens to have. His call 2026-09-23: it is a suggestion, so it is
  // written as one, and "found" is the right word for the archive.
  assert.match(SRC, /Diane suggested these infos from this person\\'s other deal/);
  assert.match(SRC, /Diane found your missing infos in the archive/);
});

test('HER ICON AND HER SKIN, on a small button', () => {
  assert.match(SRC, /<SparkleIcon/, 'the offer lost her mark');
  // Her dark ground and her green, the same ones Ask Diane wears.
  assert.match(SRC, /className="diane-skin diane-offer/);
  // `xs`, because it sits beside the Save that commits the form. An offer
  // that competes with it is one somebody presses by mistake.
  assert.match(SRC, /size="xs"/);
});

test('ONE DEFINITION OF WHAT A CONTROL OF HERS LOOKS LIKE', () => {
  /**
   * It was four `!important` utilities typed into Layout.jsx, so the
   * header was the only place that knew. A second surface wanting the
   * same look is what turns one fact into two.
   */
  const LAYOUT = fs.readFileSync(path.join(HERE, '..', 'layout', 'Layout.jsx'), 'utf8');
  assert.match(LAYOUT, /className="diane-skin /, 'Ask Diane stopped reading the shared skin');
  assert.doesNotMatch(LAYOUT, /!bg-diane-void|!text-diane-signal/, 'the typed copy came back');
  // Ask Diane wears the theme's strong step; white text on it is held by themes.test.js.
  assert.match(LAYOUT, /className="diane-skin diane-ask /);
  assert.match(CSS, /\.diane-skin\.diane-ask \{\s*--diane-ground: theme\('colors\.accent\.strong'\)/);
  // It shines and glows, and both stop for anyone who asked for calm.
  assert.match(CSS, /\.diane-skin\.diane-ask::before \{[\s\S]*?animation: diane-ask-shine/);
  assert.match(CSS, /prefers-reduced-motion: reduce\) \{\s*\.diane-skin\.diane-ask, \.diane-skin\.diane-ask::before \{ animation: none; \}/);
  // And the offer's fill reads the same four values, through the custom
  // properties: its background is a pseudo-element, so it cannot use the
  // class's own `background` without covering the glow.
  assert.match(CSS, /\.diane-offer::after[\s\S]*?background: var\(--diane-ground\)/);
});

test('THE GLOW IS DEFINED, and it stops for anyone who asked for calm', () => {
  // A rotating element, not an animated gradient angle: that needs
  // @property, which is not everywhere, and a rule that silently does not
  // run is worse here than one that does.
  assert.match(CSS, /\.diane-offer::before[\s\S]*?conic-gradient/);
  assert.match(CSS, /@keyframes diane-offer-turn[\s\S]*?rotate: 1turn/);
  assert.match(CSS, /@keyframes diane-offer-breathe/);
  assert.match(CSS, /@keyframes diane-offer-pulse/);
  // The glow is the HALO. The ring alone is clipped by overflow:hidden,
  // so nothing of it reaches past the edge and there is nothing to see.
  /**
   * SLICED, NOT MATCHED ACROSS THE FILE. `[\s\S]*?` is lazy but unbounded,
   * so `/@keyframes diane-offer-pulse[\s\S]*?box-shadow/` scanned straight
   * past the block to the next box-shadow anywhere below it. Deleting the
   * halo left this green, which is the one thing a test may not do.
   */
  /**
   * FROM THE KEYFRAME FORWARD. index.css carries more than one
   * `prefers-reduced-motion` block, and the first is far above this one,
   * so slicing to it ran backwards and handed back an empty string.
   */
  const at = CSS.indexOf('@keyframes diane-offer-pulse');
  assert.ok(at > 0, 'the pulse keyframe is gone');
  const pulse = CSS.slice(at, CSS.indexOf('@media (prefers-reduced-motion: reduce)', at));
  assert.match(pulse, /box-shadow/, 'the glow is only the clipped ring again');
  assert.match(pulse, /scale\(1\.02\)/);
  // Motion for its own sake is the first thing to go, and the border stays
  // hers, LIT, so the offer is no less findable.
  const calm = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)', at));
  assert.match(calm, /\.diane-offer \{[\s\S]*?animation: none;[\s\S]*?box-shadow:/);
  assert.match(calm, /\.diane-offer::before \{ animation: none;/);
  // Hover still answers, it just does not move. A control that reacts to
  // nothing reads as disabled.
  assert.match(calm, /\.diane-offer:hover:not\(:disabled\) \{[\s\S]*?box-shadow:/);
});

test('HOVER IS READABLE, which it was not', () => {
  /**
   * `.btn-quiet:hover` sets `text-text`, the CRM's near-black, and the two
   * rules are the same specificity. On her near-black ground the label
   * vanished the moment the pointer touched it. Reported on sight
   * 2026-09-23.
   */
  assert.match(CSS, /\.diane-skin:hover:not\(:disabled\) \{[\s\S]*?color: var\(--diane-ink-hover\)/);
  // `:not(:disabled)` matches the rule it is beating, or a disabled offer
  // lights up under the cursor.
  assert.doesNotMatch(CSS, /\.diane-skin:hover \{/, 'the hover rule stopped matching btn-quiet');
});

test('AND HOVER SAYS SO: a thicker border and more light', () => {
  // The ring IS the gap between the button edge and the fill, so a wider
  // border means insetting the fill further.
  assert.match(CSS, /\.diane-offer:hover:not\(:disabled\)::after \{ inset: 2px; \}/);
  /**
   * THE GLOW SWAPS ANIMATION rather than overriding it. A plain
   * `box-shadow` on `:hover` loses to the one the keyframes are setting,
   * because an animation beats a normal declaration whatever the
   * specificity, so the button would have hovered with no extra light at
   * all.
   */
  assert.match(CSS, /\.diane-offer:hover:not\(:disabled\) \{ animation-name: diane-offer-pulse-hot; \}/);
  const at = CSS.indexOf('@keyframes diane-offer-pulse-hot');
  assert.ok(at > 0, 'the hover keyframe is gone');
  const hot = CSS.slice(at, CSS.indexOf('@media (prefers-reduced-motion: reduce)', at));
  assert.match(hot, /box-shadow/);
  assert.match(hot, /scale\(1\.035\)/);
});

test('THE COLOURS COME FROM HER PALETTE, never a typed hex', () => {
  // 177 hardcoded literals across 19 files is what dianeTheme.js exists
  // to have ended. A new surface typing one starts it again.
  const block = CSS.slice(CSS.indexOf('.diane-offer'), CSS.indexOf('@keyframes diane-offer-turn'));
  assert.match(block, /theme\('colors\.diane\.signal'\)/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}/, 'a hex reached her palette');
});

test('IT IS OFF WHILE ADDING', () => {
  // Adding builds several handlers behind tabs and has its own "Same as"
  // copy per section. Two copy idioms on one screen is two ways to do one
  // thing, and the query would fire with no person chosen yet.
  assert.match(PAGE, /const offerFill = !isNew && /);
  assert.match(PAGE, /usePersonFill\(offerFill \? row\?\.person_id : null, row\?\.id\)/);
});

// His call 2026-09-28: her offer goes when she is switched off, not even asked for.
test('IT IS OFF WHILE DIANE IS LOCKED, and until that is known', () => {
  assert.match(PAGE, /const offerFill = !isNew && ai\.known && !ai\.locked;/);
  assert.match(PAGE, /\{offerFill && \(\s*<CopyPersonDetails/);
});

test('IT ASKS THE SERVER TO EXCLUDE THE ROW BEING EDITED', () => {
  // This side's half of that contract: it sends the id. That the server
  // honours it is pinned on the server, in personFill.test.js.
  assert.match(PAGE, /usePersonFill\([^)]*row\?\.id\)/);
});
