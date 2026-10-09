import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ***************************************************
 * * The review page, and the master sheet's one icon
 * ***************************************************
 *
 * Both of these were reported on sight, 2026-09-17, and both are rules the
 * CRM already had written down somewhere else.
 *
 * It was `components/modals/reviewPanelUx.test.js` while the review was a
 * modal. His call 2026-09-29 made it a page; the rules below are the same
 * ones, read off the page instead.
 */

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const page = read('./ReviewPage.jsx');
const sheet = read('./MasterSheetPage.jsx');

// The toolbar row: from the Toolbar tag to the empty state that follows it.
// Every rule about "the control row" is read off this slice.
const toolbar = page.slice(page.indexOf('<Toolbar'), page.indexOf('list.length === 0'));
// And the page header, which holds the title, the words and History.
const header = page.slice(page.indexOf('<PageHeader'), page.indexOf('<UnderlineTabs'));
// The bulk bar, which only rises once a row is ticked: the answers live here.
const bulk = page.slice(page.indexOf('<BulkBar'), page.indexOf('</BulkBar>'));

// The attributes of the bulk bar button labelled `label`, '' when there is
// none. Lazy, and never across a second <BulkAction, so it is that button's.
const barAction = (src, label) => src.match(
  new RegExp(`<BulkAction\\b((?:(?!<BulkAction\\b)[\\s\\S])*?)>\\s*${label}\\s*</BulkAction>`),
)?.[1] ?? '';

test('SELECTION IS A CHECKBOX, never the red-when-off Toggle', () => {
  // forms/Toggle is red when OFF by design: it is a yes/no FACT about a
  // deal. On a selection column that made 33 unselected rows read as 33
  // alarms, on the screen whose whole job is saying what needs attention.
  assert.doesNotMatch(page, /\bToggle\b/, 'no Toggle anywhere on the page');
  assert.match(page, /type="checkbox"/);
});

/**
 * ===============================
 * * ONE LINE ABOVE THE TABLE, and it is the one nothing else says
 * ===============================
 * It was four sentences and his call 2026-09-29 cut them: the three reasons
 * a deal is here are what the TABS say, and where an answered row goes is
 * what the CONFIRM says. Doing nothing not being neutral is carried by
 * nothing else on the screen, so that is what stays.
 */
test('IT SAYS WHAT DOING NOTHING COSTS, above the table', () => {
  const says = page.indexOf('Nothing stops on its own');
  const table = page.indexOf('<table');
  assert.ok(says > -1, 'the page must say that an unanswered deal keeps paying');
  assert.ok(says < table, 'and say it above the table, not below it');
  assert.match(page, /keeps being paid/);
});

test('AND IT DOES NOT REPEAT WHAT THE TABS AND THE CONFIRM ALREADY SAY', () => {
  const intro = page.slice(page.indexOf('<PageHeader'), page.indexOf('<UnderlineTabs'));
  assert.doesNotMatch(intro, /past their end date/, 'the tabs say why a deal is here');
  assert.doesNotMatch(intro, /liquidating company/);
  assert.doesNotMatch(intro, /History puts it back/, 'the confirm says where it goes');
  // Short enough to actually be read. Four sentences was the complaint.
  assert.ok(intro.split('.').length - 1 <= 2, 'the intro is two sentences at most');
});

test('AND THE CONFIRM IS STILL WHERE THAT IS SAID', () => {
  // Cutting it from the page must not cut it from the app: a row vanishing
  // with nothing having said it would is the moment somebody decides the
  // button did more than they asked.
  const confirms = read('../configs/confirms.config.js');
  assert.match(confirms, /and it leaves this list/);
});

test('IT HAS A SEARCH, and the buttons follow it', () => {
  assert.match(page, /SearchInput/);
  // `list` is the filtered set, and Select all, the count and all three
  // buttons read `list`/`chosen` off it. A search that narrows the table
  // but not the button is a bulk act over rows you cannot see.
  assert.match(page, /const list = useMemo/);
  // The selection is cut back to `list`, and the answers act on `chosen`.
  assert.match(page, /const listIds = useMemo\(\(\) => list\.map\(\(row\) => row\.id\), \[list\]\)/);
  assert.match(page, /useRowSelection\(listIds\)/);
  assert.match(page, /const chosen = useMemo\(\(\) => list\.filter\(\(row\) => sel\.has\(row\.id\)\)/);
});

/**
 * ===============================
 * * A PAGE USES THE PAGE'S OWN FURNITURE
 * ===============================
 * The modal had a hand rolled sticky control row because a dialog has no
 * toolbar. On a page a second idea of where the search goes is exactly what
 * `PageHeader`/`Toolbar` exist to stop.
 */
test('IT IS A PAGE, not a dialog wearing a page shape', () => {
  assert.doesNotMatch(page, /<Modal\b/, 'the review is not in a Modal any more');
  assert.match(page, /<PageHeader\s/, 'it leads with the page header');
  assert.match(page, /<Toolbar\b/, 'and uses the shared toolbar');
  // The h1 has to say the word the sidebar says, or the page you landed on
  // is not the one you pressed.
  assert.match(page, /title="Review"/);
  // THE MONTH IS STILL ON SCREEN. An answer is stored per month, and a
  // screen that does not say which is one two people answer differently
  // across a boundary.
  assert.match(header, /Is this deal still running in \{monthLabel\(period\)\}\?/);
});

/**
 * ===============================
 * * ONE BLOCK OF WORDS, NOT THREE
 * ===============================
 * A title, a subtitle AND a paragraph, before a single row had been read.
 * His call 2026-09-29: overwhelming. The question and the consequence are
 * one subtitle now.
 */
test('THE WORDS ARE ONE BLOCK, and they are the header', () => {
  assert.match(header, /Nothing stops on its own/, 'the consequence is in the header');
  // No loose paragraph between the header and the tabs any more.
  const betweenHeaderAndTabs = page.slice(page.indexOf('/>', page.indexOf('actions=')), page.indexOf('<UnderlineTabs'));
  assert.doesNotMatch(betweenHeaderAndTabs, /<p /, 'no second block of prose');
});

test('AND THE SIDEBAR ACTUALLY GOES THERE', () => {
  const nav = read('../configs/navigation.js');
  assert.match(nav, /to: '\/review', label: 'Review'/);
  const app = read('../App.jsx');
  assert.match(app, /<Route path="review" element=\{<ReviewPage \/>\}/);
});

test('STOP AND DELETE ARE BOTH RED, and the SHAPE carries the difference', () => {
  // His call 2026-09-17: icons, both red. Both consequences are real and
  // the red says "this one counts"; what separates them is the shape, the
  // way it does on CellSuggestion's three marks. A raised palm is an ending
  // you can undo from the Archive, a bin is a row that goes.
  //
  // A UI pass in 2026-10 made Stop quiet; he reversed it, so both are red
  // again. They live in the master sheet's bulk bar now: the row's own
  // icon column went when the bar took its acts over.
  const stop = barAction(sheet, 'Stop');
  const del = barAction(sheet, 'Delete');
  assert.match(stop, /icon=\{StopHandIcon\}/);
  assert.match(stop, /variant="danger"/, 'Stop is red');
  assert.match(del, /icon=\{TrashIcon\}/);
  assert.match(del, /variant="danger"/, 'Delete is red');
  // Same colour, never the same shape.
  assert.doesNotMatch(stop, /TrashIcon/);
  assert.doesNotMatch(del, /StopHandIcon/);
});

test('AN ICON ONLY CONTROL STILL SAYS ITS NAME', () => {
  // One for the eye, one for a screen reader. The bar's Clear drops to
  // its icon on a phone, and an icon with neither is a guess.
  const bar = read('../components/layout/BulkBar.jsx');
  const clear = bar.slice(bar.indexOf('onClick={onClear}'));
  assert.match(clear.slice(0, 200), /aria-label="Clear selection"/);
  assert.match(clear.slice(0, 200), /title="Clear selection/);
});

test('THE STOP ICON IS NOT ANOTHER BIN SHAPE', () => {
  // It sits beside TrashIcon at 15px. Two lid-and-body outlines would be
  // one misclick away from a deletion.
  const icons = read('../components/icons/index.jsx');
  assert.match(icons, /export const StopHandIcon/);
  const hand = icons.slice(icons.indexOf('export const StopHandIcon'));
  assert.doesNotMatch(hand.slice(0, 400), /M4 7h16/, 'that is the bin');
});

test('THE PAYMENT START CELL HAS ONE ICON, not two', () => {
  // Extra information in a cell is AN icon, singular (CLAUDE.md). It had a
  // date suggestion and the colour explanation side by side, which is a key
  // to learn before either can be read.
  const cell = sheet.slice(sheet.indexOf("col=\"payment_start_on\""));
  const after = cell.slice(0, cell.indexOf('/>') + 2);
  assert.match(after, /after=\{dateMarkers\.payment_start_on\}/);
  assert.doesNotMatch(sheet, /<PaymentStartWhy/, 'the component is folded into the suggestion');
});

test('AND THE EXPLANATION IS STILL THERE, stacked inside it', () => {
  assert.match(sheet, /paymentStartWhyParts/);
  // Every row gets one, suggestion or not: a cell with no icon must mean
  // "nothing to say", never "the icon lost a fight".
  assert.match(sheet, /notices\.payment_start_on = startNotice/);
});

/**
 * ===============================
 * * THE ANSWERS ONLY EXIST ONCE THERE IS SOMETHING TO ANSWER
 * ===============================
 * Three saturated colours sat in the row permanently, disabled for as long
 * as nothing was ticked. His call 2026-09-29: a traffic light showing all
 * three lamps at once is not a signal, it is noise you learn to ignore, on
 * the one screen that must not be ignored.
 */
test('THE THREE ANSWERS ARE CONTEXTUAL, not three permanent colours', () => {
  // They live in the BULK BAR now (UI pass, 2026-10), not the toolbar.
  for (const label of ['REVIEW_ANSWER.YES', 'REVIEW_ANSWER.FINAL', 'REVIEW_ANSWER.NO']) {
    assert.ok(bulk.includes(label), `${label} is not in the bulk bar`);
    assert.ok(!toolbar.includes(label), `${label} is still in the toolbar`);
  }
  // Rendered behind the selection, never disabled in place. A disabled
  // button is a colour you have to look past; an absent one is not there.
  const bar = read('../components/layout/BulkBar.jsx');
  assert.match(page, /<BulkBar count=\{sel\.count\}/);
  assert.match(bar, /const open = count > 0;/);
  assert.match(bar, /if \(!open\) return null;/);
  assert.doesNotMatch(bulk, /disabled=/);
  // NO "N selected" count in the bar, his call 2026-10-08.
  assert.doesNotMatch(bar, /\} selected/);
  // No colour per answer, the shape carries it. The one exception is the
  // answer that STOPS a deal: red, like every other Stop.
  assert.equal((bulk.match(/variant=/g) ?? []).length, 1, 'only one answer is coloured');
  const no = bulk.slice(bulk.indexOf('icon={StopHandIcon}') - 40, bulk.indexOf('REVIEW_ANSWER.NO]'));
  assert.match(no, /variant="danger"/, 'and it is the one that stops');
});

test('AND HISTORY IS NOT ONE OF THEM. It rides the tab rule', () => {
  // It sat fourth in a row of three coloured answers, which put a harmless
  // reading control inside a group that stops people being paid. The end of
  // the tab rule is the most reachable empty space on the page and belongs
  // to the whole list rather than to a selection. His call 2026-09-29.
  assert.doesNotMatch(toolbar, /History of review answers/, 'not in the answer cluster');
  assert.doesNotMatch(header, /History of review answers/, 'and not in the page header');
  const tabs = page.slice(page.indexOf('<UnderlineTabs'), page.indexOf('<div className="mt-3"'));
  assert.match(tabs, /action=\{/, 'the tab row carries it');
  assert.match(tabs, /History of review answers/);
  // SOFT ACCENT. Grey read as decoration up there; a solid green would read
  // as a fourth answer beside the three.
  assert.match(tabs, /variant="accent"/);
});

test('THE TAB ROW ACTION SITS OUTSIDE THE TABLIST', () => {
  // A `role="tablist"` may only hold tabs. A button inside one is announced
  // as a tab that switches nothing.
  const src = read('../components/layout/UnderlineTabs.jsx');
  const list = src.slice(src.indexOf('role="tablist"'), src.indexOf('{action &&'));
  assert.doesNotMatch(list, /\{action\}/, 'the action is not among the tabs');
  assert.match(src, /\{action && </);
});

test('EACH ANSWER CARRIES ITS OWN SHAPE, not just its own colour', () => {
  // Amber and red on one row is a decision made by hue. The shape says it
  // first, the way the master sheet's row actions do.
  //
  // PAIRED, not merely present. Three icons in the block and three answers
  // in the block would pass a "does it have icons" check with the hourglass
  // on the one that does not end.
  for (const [icon, answer] of [
    ['CheckIcon', 'YES'],
    ['HourglassIcon', 'FINAL'],
    ['StopHandIcon', 'NO'],
  ]) {
    const at = bulk.indexOf(`icon={${icon}}`);
    assert.ok(at > -1, `${icon} is not on a button`);
    const label = bulk.indexOf(`REVIEW_ANSWER.${answer}]`, at);
    assert.ok(label > at && label - at < 120, `${icon} is not on the ${answer} button`);
  }
  // The same palm the sheet's Stop wears, because it is the same act.
  assert.match(read('./MasterSheetPage.jsx'), /[iI]con=\{StopHandIcon\}/);
});

test('THE END NOTE IS HIS WORDS, and not an eleventh amber pill', () => {
  // The master sheet badges it because it is one row among ninety six. Here
  // every row of a tab carries the same phrase, so the badge said nothing
  // eleven times. A dash would be worse: the phrase IS the reason the row
  // is here, so it has to be printed.
  assert.match(page, /\{row\.end_note \|\| formatDate\(row\.end_on\)\}/);
  assert.doesNotMatch(page, /StatusBadge/, 'no badge in the end date cell');
});

test('SELECT ALL IS IN THE TABLE HEADER, over the column it ticks', () => {
  // His call 2026-09-17, matching the master sheet. In the toolbar it sat
  // a row away from the boxes it acts on and spent width on a label that
  // its position already gives it.
  const head = page.slice(page.indexOf('<thead'), page.indexOf('</thead>'));
  assert.match(head, /<SelectAll\b/, 'the select all is in the header');
  assert.match(head, /ariaLabel="Select all deals under review"/, 'and still says so');
  assert.match(read('../components/forms/SelectAll.jsx'), /aria-label=\{label \? undefined : \(ariaLabel/);
  // THE HEADER IS STICKY, or the control scrolls out of reach on row 12.
  assert.match(head, /sticky top-0 z-20/);
  // EXACTLY ONE of it. Two select-alls is two answers to "is everything
  // ticked", and they would disagree the moment the search narrows.
  assert.equal((page.match(/<SelectAll\b/g) ?? []).length, 1);
  assert.doesNotMatch(page, />\s*Select all\s*</, 'no second one in the toolbar');
});

test('THE CONTROL ROW CARRIES NO COUNT AND NO MONEY', () => {
  // His call 2026-09-17. The waiting count is the line under the table,
  // and the money it carried is a figure nobody acts on from that row: the
  // confirm names both for the rows actually selected, which is the only
  // place either decides anything.
  assert.doesNotMatch(toolbar, /formatMoney/, 'no money in the control row');
  assert.doesNotMatch(toolbar, /count=\{/, 'and no count, even the one Toolbar offers');
  // The confirm still names both, because that is where it is acted on.
  assert.match(page, /money: formatMoney\(chosenTotal/);
  // And the waiting line is still under the table.
  assert.match(page, /of the \{list\.length\} shown still waiting/);
});
