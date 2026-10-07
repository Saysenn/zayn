import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BRIEFING_GOES_TO, heardYes, YES, NO, GREETINGS, pickGreeting, ASK, sectionSegments, groupCounts,
  DETAIL_KEYS, cardEntries, heardTopic, TOPIC_WORDS, reconcile, changeCounts, closingLine, ROW_STATUS,
} from './briefingAnswer.js';
import { LINK_FILTER } from '../../configs/linkFilters.js';

/**
 * ***************************************************
 * * CONTRACT: the briefing's keys, and this half holds the routes
 * ***************************************************
 *
 * crm/api and crm/web SHARE NO FILE. The server sends a `key`, a count and
 * a finished sentence; which page shows flagged rows is the router's
 * business and the server does not own the router. The other half is
 * api/v1/shared/briefing.test.js, which pins the same eight keys.
 *
 * A key on one side and not the other is a line that says something and
 * then does nothing when you click it.
 */

test('THE EIGHT KEYS, and a new one is a deliberate change on BOTH sides', () => {
  assert.deepEqual(Object.keys(BRIEFING_GOES_TO).sort(), [
    'concerns', 'liquidating', 'needsReview', 'pastYear', 'payableOver', 'reviewMonthly', 'specialCase', 'unpaid',
  ]);
});

test('EVERY ROUTE IS A REAL PATH, never a bare query string', () => {
  for (const [key, to] of Object.entries(BRIEFING_GOES_TO)) {
    assert.match(to, /^\/[a-z-]+/, `${key} does not start at a route`);
  }
});

test('AND EVERY PARAM IT SEEDS IS A NAMED ONE', () => {
  // A typo between the writer and the reader fails silently: the page
  // opens unfiltered and looks fine. That is why LINK_FILTER exists.
  const named = new Set(Object.values(LINK_FILTER));
  for (const [key, to] of Object.entries(BRIEFING_GOES_TO)) {
    const query = to.split('?')[1];
    if (!query) continue;
    for (const param of new URLSearchParams(query).keys()) {
      assert.ok(named.has(param), `${key} seeds ${param}, which LINK_FILTER does not name`);
    }
  }
});

/**
 * THE REVIEW LINES LAND ON THE REVIEW PAGE. It was a modal over the master
 * sheet, reached by a param; his call 2026-09-29 made it a page, so the
 * link is the page and there is nothing to seed or strip.
 */
test('THE THREE REVIEW LINES ALL LAND ON /review, with no param', () => {
  // One list, and its tabs say which of the three a row is under.
  for (const key of ['liquidating', 'pastYear', 'reviewMonthly']) {
    assert.equal(BRIEFING_GOES_TO[key], '/review', key);
  }
  // THE PARAM IS GONE FOR GOOD. A link that opens a modal on another page
  // is what the move was for, so neither half may come back on its own.
  assert.equal(LINK_FILTER.reviewPanel, undefined, 'the param is not named any more');
  const page = readFileSync(new URL('../../pages/MasterSheetPage.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /reviewPanel/, 'and the master sheet no longer reads one');
});

/**
 * AND THE UNPAID LINE DOES NOT PRETEND THERE IS AN UNPAID FILTER. The Paid
 * checkbox narrows to PAID by explicit design, so seeding it false would
 * be a filter active with its own control reading off.
 */
test('UNPAID LANDS ON THE DEALS IN PERIOD, not on a filter that does not exist', () => {
  assert.equal(BRIEFING_GOES_TO.unpaid, `/master-sheet?${LINK_FILTER.period}=active`);
  assert.doesNotMatch(BRIEFING_GOES_TO.unpaid, /paid=false/);
});

// ===============================
// * Yes, no, and the third answer
// ===============================

test('SHE HEARS YES', () => {
  for (const said of ['yes', 'Yeah', 'yep please', 'sure', 'ok', 'Okay then']) {
    assert.equal(heardYes(said), true, said);
  }
});

test('AND NO', () => {
  for (const said of ['no', 'Nope', 'nah', 'later', 'skip it']) {
    assert.equal(heardYes(said), false, said);
  }
});

test('ANYTHING ELSE IS NOT AN ANSWER, and must not be read as one', () => {
  // "hang on" is not a no. Treating it as one would take the screen away
  // mid-thought, which is worse than waiting.
  for (const said of ['hang on', 'what', '', null, undefined, 'the review one']) {
    assert.equal(heardYes(said), null, String(said));
  }
});

test('THE FIRST ANSWER WINS, not the last', () => {
  // "Yes, no problem" is a yes. Scanning for a no anywhere in the sentence
  // would flip it.
  assert.equal(heardYes('yes, no problem'), true);
  assert.equal(heardYes('no, yes I mean leave it'), false);
});

test('PUNCTUATION AND CASE DO NOT MATTER', () => {
  assert.equal(heardYes('Yes!'), true);
  assert.equal(heardYes('  NO.  '), false);
});

test('THE WORDS ON SCREEN ARE THE WORDS SHE LISTENS FOR', () => {
  assert.equal(heardYes(YES), true);
  assert.equal(heardYes(NO), false);
});

/**
 * TYPED IN THE MIDDLE, AS SHE SAYS IT. A list sitting finished down the
 * side was already there before she had said any of it, which reads as a
 * screen you are being shown rather than somebody talking to you. His call
 * 2026-09-21, reversing the first shape.
 *
 * Still not a transcript: no input, no history, no scrollback.
 */
test('HER LINES ARE TYPED AS SHE SAYS THEM, centred', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /import Messages/, 'a transcript is the thing it is not');
  assert.doesNotMatch(src, /RichInput/, 'nothing is typed INTO this screen');
  assert.match(src, /function useTyped\(text, active, pending\)/);
  assert.match(src, /text\.slice\(0, shown\)/);
  // Built whole, THEN filtered: filtering while building hung a later topic's
  // reads on the card in front. Seen in the browser 2026-09-28.
  assert.match(src, /const cards = all\.filter\(\(card\) => card\.parts\[0\]\.index <= spoken\);/, 'cards appear as she reaches them');
  // ITS FULL HEIGHT FROM THE START: the untyped rest is laid out, invisible.
  assert.match(src, /<span aria-hidden="true" style=\{\{ opacity: 0 \}\}>\{text\.slice\(shown\)\}<\/span>/);
  assert.match(src, /justify-center/, 'centred, not down one side');
});

test('AND THE WORDS ARE WHITE, from her palette and not a hex', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /color: done \? palette\.settled : palette\.speech/);
  // The palette guard bans any hex in her components, and it exists
  // because eleven greens listed by hand missed the twelfth.
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/);

  // WHITE IN EVERY THEME: her words are fixed, only her chrome is themed.
  const theme = readFileSync(new URL('../../configs/themes.js', import.meta.url), 'utf8');
  assert.match(theme, /speech: '#ffffff'/);
});

/**
 * SHE OPENS BY SAYING WHY SHE IS THERE. Starting on "30 deals are up for
 * review" is a figure fired at somebody who has just signed in. And the
 * question closes it, so the whole thing reads as one person talking
 * rather than a list with a caption. His call 2026-09-21.
 */
test('SHE GREETS FIRST AND ASKS LAST', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /\[\{ kind: 'greet', text: greeting \}\]/, 'the greeting is the first part');
  assert.match(src, /\{ kind: 'ask', text: ASK \}/, 'the question is the last');
  assert.equal(ASK, 'Which one first?');
  // Picked once per visit, not on every render.
  assert.match(src, /const \[greeting\] = useState\(\(\) => madeAhead \?\? nextGreeting\(\)\);/);
});

// Her first line opened on 3 to 9 seconds of silence. 2026-09-28.
test('HER GREETING IS MADE ON THE LOADING SCREEN, and used, not asked for again', () => {
  const boot = readFileSync(new URL('./DianeBoot.jsx', import.meta.url), 'utf8');
  assert.match(boot, /const greeting = nextGreeting\(\);/);
  assert.match(boot, /primeSpeech\(greeting, audio\);/);
  assert.match(boot, /briefingRef\.current = \{ \.\.\.res, greeting \};/);
  // Waited for, never past the cap: a slow voice must not hold the way in.
  assert.match(boot, /Promise\.race\(\[audio, new Promise\(\(resolve\) => \{ setTimeout\(resolve, GREETING_WAIT_MS\); \}\)\]\)/);
  const speech = readFileSync(new URL('./useOpenaiSpeech.js', import.meta.url), 'utf8');
  assert.match(speech, /takePrimed\(parts\[i\]\) \?\? apiService\.masterSheet\.speech\(parts\[i\]\)/);
  const layout = readFileSync(new URL('../layout/Layout.jsx', import.meta.url), 'utf8');
  assert.match(layout, /greeting=\{briefing\.greeting\}/);
});

// Never the same opening twice in a row, his call 2026-09-28.
test('SHE OPENS DIFFERENTLY EACH TIME', () => {
  assert.ok(GREETINGS.length >= 10, 'enough to feel unscripted');
  assert.equal(new Set(GREETINGS).size, GREETINGS.length, 'no duplicates');
  for (const g of GREETINGS) {
    assert.doesNotMatch(g, /\d/, `a count reads wrong before one item or ten: ${g}`);
    assert.doesNotMatch(g, /[—–-]/, `no dashes: ${g}`);
  }
  // Every draw, including the edges of random(), avoids the last one.
  for (const last of GREETINGS) {
    for (const r of [0, 0.5, 0.999999]) {
      const next = pickGreeting(last, () => r);
      assert.ok(GREETINGS.includes(next));
      assert.notEqual(next, last);
    }
  }
  // Nothing remembered yet: any of them.
  assert.ok(GREETINGS.includes(pickGreeting(null, () => 0)));
});

test('AND THE TWO WITHOUT DATA ARE NOT LINKS', () => {
  // There is nothing behind them to open, so they are not buttons.
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /if \(!to\) return <span/);
});

test('AND THEY ARE SMALL', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /text-\[13px\]/);
  assert.match(src, /text-\[10px\]/, 'the HUD labels are smaller still');
});

// "Like JARVIS", his call 2026-09-28: the welcome page wears a fixed HUD palette.
test('THE WELCOME PAGE IS THE JARVIS HUD, whatever the theme', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /<DianePaletteProvider value=\{JARVIS_HUD\}>/);
  assert.match(src, /clipPath: HUD_CHAMFER/, 'cut corner panels');
  assert.match(src, /<HudRings size=/);
  const theme = readFileSync(new URL('../../configs/dianeTheme.js', import.meta.url), 'utf8');
  assert.match(theme, /export const JARVIS_HUD = Object\.freeze\(\{/);
});

test('THE QUESTION CAN BE ANSWERED WITHOUT A MIC', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /label: 'Skip'/);
  assert.match(src, /<AskChoices keys=\{topics\} onPick=\{open\} \/>/, 'a button per topic on the ask card');
  assert.match(src, />\s*Later\s*</);
  // A denied microphone loses the question, never the way out.
  assert.match(src, /ANSWER_WINDOW_MS/, 'it must not wait forever');
  assert.match(src, /to=\{s\.kind === 'head' \? BRIEFING_GOES_TO\[s\.key\] : undefined\}/, 'every topic opens its page');
});

test('THE MIC OPENS ONLY AFTER SHE HAS FINISHED ASKING', () => {
  // An open mic during playback records her.
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /if \(!asking\) return undefined;\s*if \(voice\.supported\) voice\.start\(\);/);
  // The question is its own part, and finishing it is what opens the mic.
  assert.match(src, /if \(segment\.kind === 'ask'\) setAsking\(true\);/);
  assert.doesNotMatch(src, /tts\.speak\(ASK\)/, 'said twice');
});

/**
 * QUEUED AHEAD, NOT AWAITED IN TURN, the command center's trick. `speak`
 * starts its request the moment it is called, so the next part synthesises
 * while this one plays and there is no gap.
 */
test('EACH PART IS QUEUED AHEAD, and finishing one advances the screen', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /const LOOKAHEAD = 12;/);
  assert.match(src, /queueUpTo\.current\(index \+ 1 \+ LOOKAHEAD\)/);
  assert.match(src, /setSpoken\(index \+ 1\)/);
  assert.doesNotMatch(src, /await tts\.speak/, 'awaiting each puts a round trip in every gap');
});

test('AND SHE SPEAKS ONCE, not twice under StrictMode', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /startedRef\.current = true/);
});

test('NOTHING TO SAY RENDERS NOTHING AT ALL', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /if \(!initialItems\?\.length\) return null;/);
  const layout = readFileSync(new URL('../layout/Layout.jsx', import.meta.url), 'utf8');
  assert.match(layout, /Boolean\(briefing\?\.items\?\.length\)/);
});

// ===============================
// * SHE READS THE CARD, entry by entry, his call 2026-09-28
// ===============================

const ROWS = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), person: `P${i + 1}`, company: `C${i + 1}` }));
const AT = (company, n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: `${company}${i}`, person: `P${i}`, company, amount: 100, currency: 'GBP', ...extra }));

test('SHE READS EVERY ENTRY ON THE CARD, in sentences, and never the totals', () => {
  const rows = [...AT('Reliapay', 3), ...AT('KP', 3), ...AT('Workforce', 6), ...AT('Gab', 1), ...AT('Acqua', 1), ...AT('Zed', 1)];
  const parts = sectionSegments({ key: 'reviewMonthly', sentence: '15 deals are marked for review this month.', rows });
  assert.deepEqual(parts.map((p) => p.kind), ['head', 'read', 'read']);
  assert.equal(parts[1].text, 'Workforce 6, KP 3, Reliapay 3, Acqua 1 and Gab 1.');
  assert.equal(parts[2].text, 'Zed 1.');
  // Every entry the card shows is read, and the card lights exactly those.
  const read = parts.filter((p) => p.kind === 'read').flatMap((p) => p.ids);
  assert.deepEqual(read, cardEntries({ key: 'reviewMonthly', rows }).map((e) => e.id));
  // "No need to mention the totals", his call 2026-09-28: shown on the card, never said.
  assert.doesNotMatch(parts.map((p) => p.text).join(' '), /other|most at|In all|£/);
});

test('THE BREAKDOWN IS EXACT: every company, counts that add up to the total', () => {
  const rows = [...AT('Reliapay', 3), ...AT('KP', 3), ...AT('Workforce', 6)];
  const groups = groupCounts(rows);
  assert.deepEqual(groups, [{ name: 'Workforce', count: 6 }, { name: 'KP', count: 3 }, { name: 'Reliapay', count: 3 }]);
  assert.equal(groups.reduce((n, g) => n + g.count, 0), rows.length);
});

test('A SORTED ROW LEAVES THE CARD AND WHAT SHE READS', () => {
  const rows = [...AT('Workforce', 2), { ...AT('KP', 1)[0], status: ROW_STATUS.SORTED }];
  assert.deepEqual(groupCounts(rows), [{ name: 'Workforce', count: 2 }]);
  assert.equal(sectionSegments({ key: 'pastYear', sentence: 'x', rows })[1].text, 'Workforce 2.');
});

test('THE DATA CHECKS READ EVERY DEAL WITH ITS AMOUNTS', () => {
  const rows = [
    { id: '1', person: 'Drew', company: 'Monument', amount: 2000, monthly: 1250, currency: 'GBP' },
    { id: '2', person: 'Smurf', company: 'Workforce', amount: 1000, monthly: 500, currency: 'GBP' },
  ];
  const parts = sectionSegments({ key: 'payableOver', sentence: 'x', rows });
  assert.equal(parts[1].text, 'Drew at Monument, £2,000 against £1,250 a month and Smurf at Workforce, £1,000 against £500 a month.');
  assert.equal(parts.length, 2, 'no money line: each amount was already said');
  assert.deepEqual(DETAIL_KEYS, ['specialCase', 'payableOver', 'unpaid']);
  // UNPAID IS PEOPLE (his call 2026-10-07): names read, amounts on screen
  const unpaid = sectionSegments({ key: 'unpaid', sentence: 'x', rows: [
    { id: 'person:abe', person: 'Abe', company: 'KP', deals: 1, totals: [{ amount: 300, currency: 'GBP' }] },
    { id: 'person:nathan', person: 'Nathan', company: null, deals: 3, totals: [{ amount: 1200, currency: 'GBP' }, { amount: 150, currency: 'AED' }] },
  ] });
  assert.equal(unpaid[1].text, 'Abe and Nathan.');
  const flags = sectionSegments({ key: 'concerns', sentence: 'x', rows: [{ id: 'a', person: 'Abe', flags: 3 }, { id: 'b', person: 'Zo', flags: 1 }] });
  // One person in two groups is two rows: the group tells them apart.
  const twice = sectionSegments({ key: 'concerns', sentence: 'x', rows: [{ id: 'A|d', person: 'Drew', group: 'A', flags: 1 }, { id: 'B|d', person: 'Drew', group: 'B', flags: 1 }] });
  assert.equal(twice[1].text, 'With 1 flag: Drew (A) and Drew (B).');
  // By count, the word said once, never on every name. His call 2026-09-28.
  assert.equal(flags[1].text, 'With 3 flags: Abe.');
  assert.equal(flags[2].text, 'With 1 flag: Zo.');
  const many = sectionSegments({
    key: 'concerns',
    sentence: 'x',
    rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((p) => ({ id: p, person: p, flags: 1 })),
  });
  assert.deepEqual(many.slice(1).map((s) => s.text), ['With 1 flag: A, B, C, D and E.', 'F and G.']);
  assert.doesNotMatch(many.map((s) => s.text).join(' '), /flags? and|, 1 flag/);
});

test('A TOPIC IS PICKED BY VOICE, only among the ones on screen', () => {
  const keys = ['reviewMonthly', 'unpaid', 'concerns', 'specialCase'];
  assert.equal(heardTopic('the review ones please', keys), 'reviewMonthly');
  assert.equal(heardTopic('Unpaid!', keys), 'unpaid');
  assert.equal(heardTopic('whatbot', keys), 'concerns');
  assert.equal(heardTopic('special', keys), 'specialCase');
  assert.equal(heardTopic('import', keys), null, 'not on screen');
  assert.equal(heardTopic('hang on', keys), null);
  for (const key of Object.keys(TOPIC_WORDS)) assert.ok(BRIEFING_GOES_TO[key], `${key} has a page`);
});

test('THE STACK: one card per topic, the newest in front, no scroll', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /const front = focus \?\? cards\.length - 1;/);
  assert.match(src, /const depth = front - position;/);
  // BACK: the left arrow, the Back control, or a click on a card behind.
  assert.match(src, /if \(e\.key === 'ArrowLeft'\) back\.current\(\);/);
  assert.match(src, /onClick=\{\(\) => setFocus\(position\)\}/);
  // The breakdown WRAPS: every entry was no-wrap with its separator inside, one endless line.
  assert.match(src, /flex flex-wrap justify-center/);
  assert.match(src, /translate3d\(0, \$\{-depth \* STACK_STEP_Y\}px, \$\{-depth \* STACK_STEP_Z\}px\)/);
  assert.match(src, /if \(segment\.kind === 'read' && all\.length > 0\) all\.at\(-1\)\.parts\.push/, 'a topic is one card');
  // The read along: each entry lights while she says it, and nothing moves.
  assert.match(src, /const now = i === spoken \? READ_STATE\.ACTIVE : i < spoken \? READ_STATE\.DONE : READ_STATE\.WAITING;/);
  assert.doesNotMatch(src, /overflow-y-auto/, 'the height is fixed, never a scrollbar');
});

test('THE SHEET MOVED WHILE SHE TALKED: nothing removed, sorted ticked, new added', () => {
  const shown = [{ key: 'unpaid', rows: ROWS(3) }];
  const fresh = [
    { key: 'unpaid', rows: [ROWS(3)[0], ROWS(3)[2], { id: '9', person: 'New' }] },
    { key: 'concerns', rows: [{ id: 'G|z', person: 'Zayn' }] },
  ];
  const out = reconcile(shown, fresh);
  assert.deepEqual(out[0].rows.map((r) => [r.id, r.status]), [
    ['1', undefined], ['2', ROW_STATUS.SORTED], ['3', undefined], ['9', ROW_STATUS.NEW],
  ]);
  assert.equal(out[1].key, 'concerns', 'a new topic joins the end');
  assert.deepEqual(changeCounts(out), { added: 2, sorted: 1 });
  assert.equal(closingLine(changeCounts(out)), '2 new came in and 1 was sorted while I was talking.');
  assert.equal(closingLine({ added: 0, sorted: 0 }), '', 'nothing moved, nothing said');
});

/**
 * ===============================
 * * THE WELCOME PAGE SHOWS THE PARTICLES ORB
 * ===============================
 * His call 2026-09-28: the command center's orb, here too. The shader orb
 * it replaced is gone. The loading screen keeps its particle field: it was
 * swapped by mistake on 2026-09-22 and put back, and its bar waits on that
 * orb's first frame.
 */
test('THE WELCOME PAGE AND COMMAND CENTER SHOW THE PARTICLES ORB; THE LOADING SCREEN DOES NOT', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /lazy\(\(\) => import\('\.\/particlesOrb\/ParticlesOrb'\)\)/);
  assert.match(src, /<ParticlesOrb\s+state=\{orbState\}/);
  assert.doesNotMatch(src, /ShaderOrb|<ParticleOrb/);

  const boot = readFileSync(new URL('./DianeBoot.jsx', import.meta.url), 'utf8');
  assert.match(boot, /<ParticleOrb/);
  assert.doesNotMatch(boot, /ParticlesOrb/, 'the loading screen is not the welcome screen');
  const overlay = readFileSync(new URL('./AgentOverlay.jsx', import.meta.url), 'utf8');
  assert.match(overlay, /<ParticlesOrb\s+state=\{orbState\}/);
  assert.doesNotMatch(overlay, /<ParticleOrb/, 'the command center shows the particles orb only');
});

test('BOTH SIZE IT THE SAME WAY, one hook', () => {
  for (const file of ['./DianeBriefing.jsx', './AgentOverlay.jsx']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /= useOrbSlot\(ORB_FILL\);/, file);
    assert.doesNotMatch(src, /new ResizeObserver/, `${file} measures by hand again`);
  }
});

/**
 * AND IT IS HANDED A LEVEL, NEVER A MICROPHONE. The screen already holds
 * one: `tts` while she talks, `voice` while she listens. A second stream is
 * a second permission prompt and two readings of one voice that disagree.
 */
test('SHE TURNS ON THE VOICE THE SCREEN ALREADY HAS', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /orbLevelRef\.current = tts\.speaking \? tts\.level : listening \? voice\.level : -1;/);
  assert.match(src, /levelRef=\{orbLevelRef\}/);
  assert.match(src, /tts\.speaking \? ORB_STATE\.speaking : listening \? ORB_STATE\.listening : ORB_STATE\.idle/);
});

// The theme's colours, so the welcome page follows the Appearance setting.
test('ITS COLOURS ARE THE THEME\'S', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /colorFrom=\{palette\.signal\}/);
  assert.match(src, /colorTo=\{palette\.accent\}/);
});

/**
 * THE PARTICLE FIELD STILL HOLDS HER OPEN. `formIn` and `explode` both
 * decay to zero, so neither could keep her scattered; `spread` is the one
 * that stays, and the overlay is where it is used now.
 */
test('SPREAD IS STILL THE ONE THAT STAYS', () => {
  const orb = readFileSync(new URL('./ParticleOrb.jsx', import.meta.url), 'utf8');
  assert.match(orb, /uniforms\.uSpread\.value = spreadNow/);
  // Eased toward, so opening the field is a drift rather than a teleport.
  assert.match(orb, /spreadNow \+= \(stateRef\.current\.spread/);
  // Rotation follows her voice, and only while she is speaking.
  assert.match(orb, /m === 'speaking' && !reducedMotion \? smoothedLevel \* 0\.012 : 0/);

  const shader = readFileSync(new URL('./orbShaders.js', import.meta.url), 'utf8');
  assert.match(shader, /aDrift \* \(uExplode \+ uFormIn \+ uSpread\)/);
});

/**
 * ===============================
 * * THE LOADING SCREEN WAITS FOR BOTH OF THEM
 * ===============================
 * The dashboard is the slowest page there is, and the briefing decides
 * whether she opens her mouth at all. Landing on either cold is the wait
 * the boot screen exists to spend.
 */
test('THE BOOT SCREEN WARMS THE DASHBOARD AND WAITS FOR THE BRIEFING', () => {
  const boot = readFileSync(new URL('./DianeBoot.jsx', import.meta.url), 'utf8');

  // Its own step, not hidden inside "Loading your pages": it is the
  // slowest one and its duration would be unexplainable in there.
  assert.match(boot, /\{ key: 'dashboard', label:/);
  assert.match(boot, /\{ key: 'briefing', label:/);
  assert.match(boot, /complete\('dashboard'\)/);
  assert.match(boot, /complete\('briefing'\)/);

  // The KEY comes from the helper. A prefetch whose key differs by one
  // field warms an entry the page never reads: slower, and silent.
  assert.match(boot, /queryKey: dashboardCacheKey\(\)/);
  assert.doesNotMatch(boot, /\['dashboard', \{/, 'a hand written key drifts');
});

test('AND IT HANDS THE BRIEFING ON, so nothing fetches it twice', () => {
  const boot = readFileSync(new URL('./DianeBoot.jsx', import.meta.url), 'utf8');
  assert.match(boot, /onDone\?\.\(\{ briefing: briefingRef\.current[,\s}]/);

  const layout = readFileSync(new URL('../layout/Layout.jsx', import.meta.url), 'utf8');
  assert.match(layout, /ready\?\.briefing \?\? \{ items: \[\] \}/);
  // The second fetch is the bug this replaced.
  assert.doesNotMatch(layout, /apiService\.briefing/, 'the boot screen already has it');
});

test('THE DASHBOARD DEFAULTS HAVE ONE HOME', () => {
  // Two definitions of a default is how a prefetch and its page drift.
  const helper = readFileSync(new URL('../../helpers/dashboard.js', import.meta.url), 'utf8');
  assert.match(helper, /export function defaultDashboardFilters/);
  assert.match(helper, /export function dashboardCacheKey/);

  const page = readFileSync(new URL('../../pages/DashboardPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /const initialFilters = defaultDashboardFilters/);
});

/**
 * THE PARTICLE FIELD NAMES ITS BACKING STORE CAP. It was inline in the render
 * setup, so there was no way to lighten the scene without hunting for it.
 */
test('THE PARTICLE FIELD NAMES ITS PIXEL RATIO CAP, and never types it twice', () => {
  const field = readFileSync(new URL('./ParticleOrb.jsx', import.meta.url), 'utf8');
  assert.match(field, /const MAX_PIXEL_RATIO = 1\.5;/, 'one definition, at the head of the file');
  assert.match(field, /maxPixelRatio = MAX_PIXEL_RATIO,/);
  assert.match(field, /Math\.min\(window\.devicePixelRatio, staticRef\.current\.maxPixelRatio\)/);
  assert.doesNotMatch(field, /devicePixelRatio, 1\.5\)/, 'the cap was written twice');
});

// "its very lag", 2026-09-28: a backdrop blur over the live orb re-blurred every
// frame. The stack moves transform and opacity only, which the GPU composites.
test('THE STACK NEVER BLURS, so it never lags', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /backdropFilter|filter: .*blur|boxShadow/);
  const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
  const card = css.slice(css.indexOf('.briefing-card {'), css.indexOf('@media (prefers-reduced-motion', css.indexOf('.briefing-card {')));
  assert.doesNotMatch(card, /blur|box-shadow/);
});

test('AND THE STACK SITS OUT HER VOICE LEVEL: memoised on what it shows', () => {
  // The level re-renders the page ~60 times a second; the cards must not follow.
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.match(src, /const stack = useMemo\(\(\) => \{/);
  assert.match(src, /\}, \[segments, spoken, items, focus, palette\]\);/);
});

// "No need to display the totals also on the cards", his call 2026-09-28.
test('THE WELCOME CARDS CARRY NO TOTALS', () => {
  const src = readFileSync(new URL('./DianeBriefing.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /formatTotals|topicTotals/);
});
