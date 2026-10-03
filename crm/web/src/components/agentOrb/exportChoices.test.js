import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * "no buttons, no previews, no interactivity"
 * ***************************************************
 *
 * The chips existed the whole time, on the card. The card is a transcript
 * entry, so two questions into an export it had scrolled away and the
 * session was prose with nothing to click. The progress tracker went with
 * it, so nothing on screen said an export was half built either.
 *
 * Three things this pins, each of which was a complaint:
 *   1. The CURRENT step's choices are pinned beside the input.
 *   2. The tracker is in the drawer header, which cannot scroll.
 *   3. A colour is a preview, not a dot, and a sheet shape carries its
 *      description on screen rather than in a `title` nobody hovers.
 *
 * Source text, not a render: there is no DOM here, and the thing worth
 * catching is somebody quietly putting them back on the card only.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, p), 'utf8');

const OVERLAY = read('AgentOverlay.jsx');
const SESSION = read('forms/ExportSession.jsx');
const MESSAGES = read('Messages.jsx');
const TRACKER = read('SessionTracker.jsx');

test('THE LIVE EXPORT FLOATS OVER THE ORB', () => {
  assert.match(OVERLAY, /import ExportSession from '\.\/forms\/ExportSession'/);
  const stage = OVERLAY.slice(OVERLAY.indexOf('<section'), OVERLAY.indexOf('</section>'));
  assert.match(stage, /<ExportSession/);
  assert.match(stage, /overlay/);
  assert.match(stage, /onSay=\{sendMessage\}/);
  assert.match(stage, /openCard && !openCard\.paused/);
});

test('a PAUSED session offers no choices, only the way back', () => {
  // Answering a question on a paused export would silently resume it.
  assert.match(OVERLAY, /openCard && !openCard\.paused && \(/);
  assert.match(OVERLAY, /Export paused/);
});

test('BUILDING SHOWS ITSELF, wherever the card has got to', () => {
  // The only sign used to be a percentage inside the card's own button,
  // and the card is a transcript entry: press Build, ask something else,
  // and nothing on screen said a file was on its way.
  assert.match(OVERLAY, /\{buildProgress && \(/);
  assert.match(OVERLAY, /Building/);
  assert.match(OVERLAY, /width: buildProgress\.saving \? '100%' : `\$\{buildProgress\.pct\}%`/);
  // The download helper sends { phase, percent }; the card needs the
  // numeric percent, never the whole object rendered as "[object Object]".
  assert.match(OVERLAY, /const pct = typeof update === 'number' \? update : update\?\.percent/);
  assert.match(OVERLAY, /setProgress\(pct\)/);
  // And cleared however the build ends, or a bar outlives its work.
  assert.match(OVERLAY, /finally \{\s*setProgress\(null\);\s*setBuildProgress\(null\);/);
});

test('SAVING is its own wait, not a finished bar', () => {
  // With a Save dialogue the write happens after the download, so a bar
  // that vanished at 100% would say done while nothing was on disk yet.
  assert.match(OVERLAY, /setBuildProgress\(\{ pct: 100, fileName, saving: true \}\)/);
});

test('A SUCCESSFUL SAVE REMOVES THE FINISHED EXPORT CARD', () => {
  assert.match(OVERLAY, /forgetExport\(\);\s*setHistory\(\(h\) => \[/);
  assert.match(OVERLAY, /h\.filter\(\(message\) => !message\.exportSession\)/);
});

test('THE TRACKER IS IN THE HEADER, which cannot scroll', () => {
  // From the drawer's own title down to the scrolling area under it. The
  // point of the test is that the tracker is ABOVE that boundary.
  const title = OVERLAY.indexOf('<PanelLabel>Conversation</PanelLabel>');
  const scroller = OVERLAY.indexOf('ref={drawerScrollRef}', title);
  assert.ok(title > 0 && scroller > title, 'the drawer header could not be found');
  const header = OVERLAY.slice(title, scroller);
  assert.match(header, /<SessionTracker/, 'the tracker is not in the drawer header');
  assert.match(header, /stages=\{cardStages\}/);
  assert.match(header, /paused=\{Boolean\(openCard\.paused\)\}/);
});

test('the tracker says how far in AND what it is waiting on', () => {
  assert.match(TRACKER, /\{done\} of \{stages\.total\}/);
  assert.match(TRACKER, /nextLabel/, 'it shows a count with no idea what is outstanding');
});

test('NO PULSING DOT, and the progress itself carries the life', () => {
  // A green circle that breathes beside a count is the shape every
  // generated dashboard has, and it said nothing the number did not.
  assert.doesNotMatch(TRACKER, /animate-ping/, 'the dot is back');
  assert.doesNotMatch(TRACKER, /rounded-full bg-diane-signal" \/>/, 'the dot is back');
  // The light runs through the filled part instead, and only while
  // something is outstanding.
  assert.match(TRACKER, /tracker-live/);
  assert.match(TRACKER, /const settled = !paused && !waiting/);
  assert.match(TRACKER, /settled \|\| paused \? '' : 'tracker-live'/);
});

test('it is ONE track being filled, not a row of loose dashes', () => {
  // Five separate bars with gaps read as five unrelated marks once they
  // are all filled, which is what the screenshot showed.
  assert.match(TRACKER, /width: `\$\{Math\.round\(\(done \/ Math\.max\(stages\.total, 1\)\) \* 100\)\}%`/);
  assert.match(TRACKER, /rounded-full bg-white\/10/, 'there is no track behind the fill');
});

test('A COLOUR IS A PREVIEW, not a dot', () => {
  const colour = SESSION.slice(SESSION.indexOf("step === 'colour'"), SESSION.indexOf("step === 'delivery'"));
  // Both weights the file actually writes, so the swatch resembles the
  // sheet rather than naming a paint.
  assert.match(colour, /c\.strong/);
  assert.match(colour, /c\.soft/, 'only the strong colour is shown, which is the dot again');
  assert.match(colour, /\{c\.label\}/, 'the name is not on screen');
});

test('A SHEET SHAPE CARRIES ITS DESCRIPTION ON SCREEN', () => {
  const sheet = SESSION.slice(SESSION.indexOf("step === 'sheet'"));
  assert.match(sheet, /t\.description/);
  assert.doesNotMatch(
    sheet.slice(0, sheet.indexOf('</button>')),
    /title=\{t\.description\}/,
    'the description is back in a tooltip nobody hovers',
  );
});

test('A COMING SOON SHEET IS VISIBLE BUT CANNOT ANSWER DIANE', () => {
  const sheet = SESSION.slice(SESSION.indexOf("step === 'sheet'"));
  assert.match(sheet, /disabled=\{busy \|\| t\.disabled\}/);
  assert.match(sheet, /onClick=\{t\.disabled \? undefined/);
  assert.match(sheet, /\{t\.availability\}/);
});

test('CHOICES HAVE ONE RENDERER INSIDE THE LIVE CARD', () => {
  assert.match(SESSION, /export function Choices/);
  assert.match(SESSION, /<Choices step=\{stages\?\.next\}/);
  assert.doesNotMatch(OVERLAY, /<Choices/);
});

test('THE QUESTION CARD COMES FIRST, THE COMPLETE PREVIEW COMES LAST', () => {
  assert.match(SESSION, /if \(stages\?\.next\) \{/);
  const decision = SESSION.slice(
    SESSION.indexOf('if (stages?.next) {'),
    SESSION.indexOf('const scope ='),
  );
  assert.match(decision, /<Choices/);
  assert.doesNotMatch(decision, /<table/);
  assert.doesNotMatch(decision, /Build it/);

  const complete = SESSION.slice(SESSION.indexOf('const scope ='));
  assert.doesNotMatch(complete, /<table/);
  assert.match(complete, /Build it/);
});

test('A LIVE COUNT REFRESH CANNOT ERASE THE WORKFLOW OPTIONS', () => {
  assert.match(SESSION, /const card = live \? \{ \.\.\.session, \.\.\.live \} : session/);
});

test('ONE definition of the sample colours, not two', () => {
  // The modal and the card both draw these previews. Two copies of the
  // palette mapping drift the first time either is touched.
  const previews = read('../export/breakdownPreviews.jsx');
  const picker = read('../export/BreakdownPicker.jsx');

  assert.match(previews, /export function fillsFrom/);
  assert.match(picker, /fillsFrom\(colors, primary, secondary\)/);
  assert.doesNotMatch(picker, /head: chosen\.strong/, 'the picker still has its own copy');
});


/* ===============================
 * * The redesign: text, not a gallery
 * =============================== */

test('THE BREAKDOWN STEP IS TEXT, not a gallery of samples', () => {
  // It drew a scaled sample of each of the four designs, growing on hover.
  // In the middle of a conversation that reads as a picture gallery, and
  // the choice is nearly always the default anyway: DEFAULT_ID on the
  // server is the USD + add ons table, so the card arrives set to it.
  const step = SESSION.slice(SESSION.indexOf("step === 'breakdown'"), SESSION.indexOf("step === 'colour'"));

  assert.doesNotMatch(SESSION, /BREAKDOWN_PREVIEWS/, 'the previews are back on the card');
  assert.doesNotMatch(step, /<Preview/);
  assert.doesNotMatch(step, /scale-\[/, 'something is still being scaled down');
});

test('and it still NAMES what each one is', () => {
  // Eight bare labels told nobody the difference. The description is on
  // the chip, not in a `title`: that is a tooltip nobody hovers and no
  // touch screen has.
  const step = SESSION.slice(SESSION.indexOf("step === 'breakdown'"), SESSION.indexOf("step === 'colour'"));

  assert.match(step, /\{d\.label\}/);
  assert.match(step, /d\.description &&/);
  assert.match(step, /onSay\(`use the \$\{d\.label\} breakdown`\)/);
});

test('A PLAIN CHIP MAY BE A BUTTON AGAIN', () => {
  // The <div role="button"> only existed because a <table> inside a
  // <button> is invalid markup. With no table there is no reason to hand
  // roll the keyboard handling.
  const step = SESSION.slice(SESSION.indexOf("step === 'breakdown'"), SESSION.indexOf("step === 'colour'"));

  assert.match(step, /<button/);
  assert.doesNotMatch(step, /role="button"/);
  assert.doesNotMatch(step, /onKeyDown/);
});

/* ===============================
 * * The command centre: orb left, conversation right
 * =============================== */

test('THE CONVERSATION IS ALWAYS ON SCREEN and cannot be shut', () => {
  // It was a drawer you had to open, then a panel with a collapse control.
  // Both meant the product of this page had a button that hid it, and the
  // transcript was rendered TWICE so a closed drawer still had a strip
  // under the orb: two scrollers and two copies of every message.
  assert.doesNotMatch(OVERLAY, /convoExpanded|agent\.convo/, 'the toggle is back');
  assert.doesNotMatch(OVERLAY, /CollapseIcon|ExpandConvoIcon/, 'a control still hides it');

  // One scroller, one <Messages>. Two of either is the strip coming back.
  assert.equal((OVERLAY.match(/<Messages\b/g) ?? []).length, 1, 'the transcript is rendered twice');
  assert.doesNotMatch(OVERLAY, /const scrollRef = useRef/, 'the second scroller is back');
  assert.equal((OVERLAY.match(/ref=\{drawerScrollRef\}/g) ?? []).length, 1, 'two scrollers again');
});

test('THE PANELS EITHER SIDE OF THE ORB ARE GONE', () => {
  // One was navigation for a single workspace; the other was a menu of
  // sentences you could already type. Between them the orb had a strip
  // down the middle.
  assert.doesNotMatch(OVERLAY, /WorkspacePanel/);
  assert.doesNotMatch(OVERLAY, /CommandStrip/);

  // Actually deleted, not just unmounted: a file nothing imports is a file
  // somebody re-imports.
  for (const gone of ['WorkspacePanel.jsx', 'CommandStrip.jsx', 'commands.js']) {
    assert.equal(fs.existsSync(path.join(here, gone)), false, `${gone} is still there`);
  }
});

test('NO PAIR OF NUMBERS: the panel is a grid column, not a fixed drawer', () => {
  // It WAS `position: fixed` with a matching `--convo-clearance` padding on
  // the column beside it. Two literals that have to agree drift, and the
  // input ends up either under the panel or floating short of it.
  //
  // The grid replaced it because the panel and the command bar have to
  // reach DIFFERENT depths: the panel to the bottom of the screen, the bar
  // only as far as she does. A flex row with a footer under it cannot do
  // that without padding the bar to the panel's width by hand, which is the
  // same pair of numbers again.
  const css = read('../../index.css');

  assert.doesNotMatch(css, /--convo-width|--convo-clearance/, 'the clearance pair is back');
  assert.doesNotMatch(OVERLAY, /convo-clearance/, 'the column is padding itself again');
  assert.match(OVERLAY, /lg:grid-rows-\[minmax\(0,1fr\)_auto\]/, 'the body is not the two row grid at lg');
  assert.match(OVERLAY, /lg:grid-cols-\[minmax\(0,1fr\)_25rem\]/, 'the panel has no column at lg');
  assert.match(OVERLAY, /lg:col-start-2 lg:row-span-2/, 'the panel does not reach the bottom');
  assert.match(OVERLAY, /row-start-3 col-start-1 lg:row-start-2/, 'the command bar is not under her alone');

  // Below lg it stacks into three rows instead, so the panel is on screen
  // at every width rather than the orb being hidden to make room for it.
  assert.match(OVERLAY, /grid-rows-\[auto_minmax\(0,1fr\)_auto\]/, 'the narrow layout does not stack');
});

test('THE OPTIONS AND PREVIEW ARE NOT DUPLICATED IN THE CONVERSATION', () => {
  const aside = OVERLAY.slice(OVERLAY.indexOf('<aside'), OVERLAY.indexOf('</aside>'));
  assert.doesNotMatch(aside, /<Choices/, 'the choices are still duplicated in the conversation');
  assert.doesNotMatch(MESSAGES, /<ExportSession/, 'the full preview is still duplicated in the transcript');
  assert.match(MESSAGES, /data-export-summary/, 'the transcript has no compact reference to the live preview');
});

test('THE ORB OVERLAY IS A COMPACT GLASS CARD', () => {
  assert.match(SESSION, /overlay = false/);
  assert.match(SESSION, /backdrop-blur-xl/);
  assert.match(SESSION, /rounded-2xl/);
  assert.match(SESSION, /shadow-2xl/);
  assert.match(SESSION, /max-h-full/);
});

test('and the ORB keeps a FIXED slot, not one sized by what is left', () => {
  // `flex-1` tied her size to how much room the transcript was not using:
  // one message in and she was enormous, and she shrank as it grew.
  //
  // UNCHANGED BY THE 2026-09-17 SMALL SCREEN FIX. Shrinking her was the
  // first attempt and the wrong one: it made her small on every phone to
  // buy the transcript a few lines. The transcript covers her instead.
  // BIGGER 2026-09-27, his call: the plinth under her went and she took its space.
  assert.match(OVERLAY, /clamp\(240px, 62vh, 700px\)/);
  assert.match(OVERLAY, /maxWidth: 'min\(100%, 720px\)'/);
  assert.doesNotMatch(OVERLAY, /OrbPlinth/, 'the rings and the beam are gone');
});

test('BELOW lg THE TRANSCRIPT COVERS HER, and she shows through it', () => {
  // It was the middle ROW, so the stage above took 38vh of orb and 26vh of
  // plate and the transcript got whatever was left. On a short window that
  // was one clipped line. Reported 2026-09-17.
  assert.match(OVERLAY, /row-start-1 row-span-2 col-start-1 z-10/, 'it spans the stage row');
  assert.match(OVERLAY, /lg:row-start-1 lg:col-start-2 lg:row-span-2/, 'a column from lg');

  // TRANSLUCENT so she is visible behind it, and BLURRED so the text stays
  // readable: the particle field moves while she is thinking.
  assert.match(OVERLAY, /bg-diane-panel\/55 backdrop-blur-sm/);
  assert.match(OVERLAY, /lg:bg-diane-panel\/70 lg:backdrop-blur-none/, 'opaque from lg');
});

test('SHE DOES NOT DRAW WHEN SHE IS NOT ON SCREEN', () => {
  // The overlay hides itself with CSS so the WebGL context survives a close
  // and reopen. That also meant the whole particle field kept rendering
  // sixty times a second behind a `display: none`.
  // The particles orb halts itself when its element is off screen (display: none included).
  assert.match(OVERLAY, /<ParticlesOrb\s/, 'the command center orb');
  const orb = read('particlesOrb/ParticlesOrb.jsx');
  assert.match(orb, /observeActivity\(host, \(active\) => \{/, 'nothing stops the draw');
  assert.match(orb, /if \(active\) wake\(\); else halt\(\);/);
});

test('ONE PALETTE: NO HEX AT ALL in her components', () => {
  /**
   * She was green in 177 literals across 19 files. Every colour she uses
   * now comes from configs/dianeTheme.js, through Tailwind's `diane-*`
   * classes or an import.
   *
   * THIS USED TO LIST ELEVEN GREENS BY HAND, which is a guard that only
   * catches the colours somebody remembered. `text-[#04170e]` sat in
   * DealForm and ExportSession through two whole palette changes because
   * it was not on the list, so those controls stayed green while the rest
   * of the screen went gold and back.
   *
   * Any hex, in any form, including Tailwind's `[#…]` arbitrary value.
   * Nothing in here has a reason to carry one.
   */
  const HEX = /#[0-9a-fA-F]{3,8}\b/;

  const dirs = [here, path.join(here, 'forms')];
  const offenders = [];
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.jsx')) continue;
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      const hit = source.match(HEX);
      if (hit) offenders.push(`${file}: ${hit[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `these hold a colour of their own:\n${offenders.join('\n')}`);

  // The login is not in that folder and reads the same module.
  assert.doesNotMatch(read('../auth/LoginForm.jsx'), HEX, 'the login holds a hex of its own');
});

test('THE VITALS PANEL IS MEASURED, never seeded', () => {
  // A figure on a screen about money is real or it is a lie. Nothing on
  // that panel opens on a flattering number before the first turn.
  const vitals = read('useDianeVitals.js');
  assert.match(vitals, /useState\(0\)/, 'the counters do not start empty');
  assert.match(vitals, /turns \? \(\(turns - failed\) \/ turns\) \* 100 : null/);

  // The round trip is timed at the two ends of the actual await.
  assert.match(OVERLAY, /const startedAt = performance\.now\(\)/);
  assert.match(OVERLAY, /vitals\.record\(answered, performance\.now\(\) - startedAt\)/);

  // "not yet" before the first turn, never a zero dressed as a reading.
  const panel = read('OrbVitals.jsx');
  assert.match(panel, /const NO_READING = 'not yet'/);
  assert.match(panel, /=== null \? NO_READING/);
});

test('A REPLY IS SHOWN WHOLE. Nothing is hidden behind a click', () => {
  /**
   * ===============================
   * * TWO TRUNCATIONS ON ONE ANSWER
   * ===============================
   * The bubble capped a reply at twelve lines behind "Show all 14 lines",
   * and the tools already capped what they read aloud. The queue arrived
   * here and was cut a second time, one of them a click.
   *
   * Removed 2026-09-17, his call. The collapse existed to stop a wall of
   * text, and the wall was a FORMATTING problem: the review queue printed
   * thirty six run on sentences. It is grouped by company now.
   *
   * A REPLY THAT NEEDS HIDING IS A REPLY THAT NEEDS REWRITING, and hiding
   * it is what stops anybody noticing.
   */
  const messages = read('Messages.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.doesNotMatch(messages, /LONG_REPLY_LINES/, 'the cap is gone, not just unused');
  assert.doesNotMatch(messages, /Show all/, 'and so is the control');
  assert.doesNotMatch(messages, /Show less/);
  assert.doesNotMatch(messages, /useState/, 'the bubble holds no open state');
  // It still links `#47` to the row, which is the only thing it ever did
  // besides hiding text.
  assert.match(messages, /function Bubble[\s\S]{0,120}return linkify\(text, onOpenDeal\);/);
});
