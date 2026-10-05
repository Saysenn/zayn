import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STOPPED_REASON_LABEL, REOPEN_THE_COMPANY } from './stoppedReason.js';
import { REVIEW_ANSWER, REVIEW_ANSWER_LABEL, REVIEW_ANSWER_MEANS, monthLabel } from './monthlyReview.js';
import {
  COMPANY_STATUS, COMPANY_STATUS_OPTIONS, COMPANY_STATUS_MEANS,
  TERMINAL_STATUS, isTerminalStatus,
} from './companyStatus.js';
import { DEAL_STATUS, dealStatusOf } from './dealStatus.js';

/**
 * ***************************************************
 * * CONTRACTS: this half of three deliberate mirrors
 * ***************************************************
 *
 * crm/api and crm/web SHARE NO FILE, so each of these sets is written
 * twice and each side pins its own half. This is the web half. The server's
 * halves are:
 *
 *   stoppedReason      api/v1/repos/masterSheetRows.repo.js STOPPED_REASON
 *   monthlyReview      api/v1/repos/monthlyReview.repo.js   STOPS_AT
 *   companyStatus      api/v1/repos/companies.repo.js       COMPANY_STATUS
 *
 * and all three are also CHECK constraints, in migrations 056, 057 and 058.
 *
 * WHAT THIS CAN AND CANNOT CATCH. It cannot read the server, by design.
 * What it pins is that the WIRE VALUES here are the exact strings those
 * constraints allow, so a rename on this side has to be a deliberate edit
 * to a test that says why, rather than a label change that silently starts
 * sending a value Postgres refuses.
 */

test('THE FOUR STOP REASONS, exactly as migration 056 spells them', () => {
  assert.deepEqual(Object.keys(STOPPED_REASON_LABEL).sort(), [
    'company_closed', 'review_final', 'review_no', 'stopped_by_hand',
  ]);
});

test('EVERY REASON HAS WORDS, or the Archive prints a blank cell', () => {
  for (const [value, label] of Object.entries(STOPPED_REASON_LABEL)) {
    assert.ok(label && label !== value, `${value} needs a label`);
  }
});

test('ONE REASON CANNOT BE RESUMED, and it is the company one', () => {
  assert.equal(REOPEN_THE_COMPANY, 'company_closed');
  assert.ok(REOPEN_THE_COMPANY in STOPPED_REASON_LABEL);
});

test('THE THREE REVIEW ANSWERS, exactly as migration 057 spells them', () => {
  assert.deepEqual(Object.values(REVIEW_ANSWER).sort(), ['final', 'no', 'yes']);
  assert.deepEqual(Object.keys(REVIEW_ANSWER_LABEL).sort(), ['final', 'no', 'yes']);
  assert.deepEqual(Object.keys(REVIEW_ANSWER_MEANS).sort(), ['final', 'no', 'yes']);
});

test('FINAL AND NO ARE DESCRIBED DIFFERENTLY, because they are a month apart', () => {
  // One is a special case and one does not. Wording that blurred them would
  // be a confirm dialog that cannot be checked against what happens.
  assert.notEqual(REVIEW_ANSWER_MEANS.final, REVIEW_ANSWER_MEANS.no);
  assert.match(REVIEW_ANSWER_MEANS.final, /this month/);
  assert.match(REVIEW_ANSWER_MEANS.no, /last month/);
});

test('monthLabel names the month, and never guesses at rubbish', () => {
  assert.equal(monthLabel('2026-08'), 'August 2026');
  assert.equal(monthLabel('2026-01'), 'January 2026');
  assert.equal(monthLabel(''), 'this month');
  assert.equal(monthLabel('nonsense'), 'this month');
});

test('THE SIX COMPANY STATUSES, exactly as migrations 059 and 061 spell them', () => {
  // `going_concern` is his own word, added 2026-09-21. It is not a synonym
  // for active in what it SAYS: its deals carry no end date on purpose,
  // and the end date cell says so rather than sitting blank.
  //
  // `review` is his too, the same day: the company is asked about every
  // month without winding down. NOT liquidation, and the difference is
  // money, which is why it is its own value rather than a flag on that one.
  const SIX = ['active', 'closed', 'dissolved', 'going_concern', 'liquidation', 'review'];
  assert.deepEqual(Object.values(COMPANY_STATUS).sort(), SIX);
  assert.deepEqual(COMPANY_STATUS_OPTIONS.map((o) => o.value).sort(), SIX);
});

test('STILL ONLY TWO ARE TERMINAL, and the two new-ish ones are NOT', () => {
  // Liquidation is still paying, reduced. Going concern is paying in full.
  // Treating either as terminal would stop every deal on a company that is
  // still being paid, which is the widest write in the CRM.
  assert.deepEqual([...TERMINAL_STATUS].sort(), ['closed', 'dissolved']);
  assert.equal(isTerminalStatus('liquidation'), false);
  assert.equal(isTerminalStatus('going_concern'), false);
  assert.equal(isTerminalStatus('review'), false);
  assert.equal(isTerminalStatus('active'), false);
  assert.equal(isTerminalStatus('closed'), true);
  assert.equal(isTerminalStatus('dissolved'), true);
});

test('EVERY STATUS SAYS WHAT IT MEANS FOR THE MONEY', () => {
  for (const value of Object.values(COMPANY_STATUS)) {
    assert.ok(COMPANY_STATUS_MEANS[value]?.length > 10, `${value} needs a sentence`);
  }
  assert.match(COMPANY_STATUS_MEANS.liquidation, /[Ss]till paying/);
});

test('NO DASH IN ANY OF THE COPY, per the house rule', () => {
  const copy = [
    ...Object.values(STOPPED_REASON_LABEL),
    ...Object.values(REVIEW_ANSWER_LABEL),
    ...Object.values(REVIEW_ANSWER_MEANS),
    ...Object.values(COMPANY_STATUS_MEANS),
  ];
  for (const line of copy) assert.doesNotMatch(line, /[—–]/, line);
});

/**
 * ===============================
 * * THE OTHER SIDE OF THE MIRROR IS NOT IMPORTED. IT IS NAMED.
 * ===============================
 * Reading api/ from here would be the exact thing the boundary forbids, so
 * this only checks that each contract file SAYS where its other half lives.
 * A mirror nobody can find is a mirror that drifts.
 */
test('EACH CONTRACT POINTS AT ITS OTHER HALF', () => {
  const files = {
    './src/configs/stoppedReason.js': 'masterSheetRows.repo.js',
    './src/configs/monthlyReview.js': 'monthlyReview.repo.js',
    './src/configs/companyStatus.js': 'companies.repo.js',
  };
  for (const [file, names] of Object.entries(files)) {
    const text = readFileSync(new URL(file, import.meta.url.replace(/src\/configs\/.*$/, ''))).toString();
    assert.match(text, /MIRRORED, NEVER IMPORTED/, file);
    assert.ok(text.includes(names), `${file} must name ${names}`);
  }
});

/**
 * ===============================
 * * EVERY STATUS PICKER OFFERS ALL FOUR, AND EVERY CASCADE ASKS
 * ===============================
 * Found 2026-09-17, on sight. Three places write `tb_companies.status` and
 * only ONE had been updated in phase 3: the manage modal and the add
 * wizard still offered `active` and `closed`, so two of the four were
 * unreachable from two of the three doors.
 *
 * Worse, the manage modal SAVED a terminal status with no dialog. The
 * route cascades now, so pressing Save details on a company set to closed
 * stopped every deal on it in silence.
 */
const readSrc = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * NO PICKER HARDCODES THE STATUSES. Every door that offers them reads the
 * one contract, or a fifth status is added and two screens keep offering
 * four.
 *
 * ONE OF THEM DELEGATES NOW. ManageCompanyModal hands the whole choice to
 * `CompanyStatusPicker`, which is the file that reads the contract, so the
 * test follows it rather than being loosened: a file passes by reading the
 * contract ITSELF or by using the component that does.
 */
test('NO PICKER HARDCODES THE STATUSES', () => {
  for (const file of [
    '../pages/CompanyDetailPage.jsx',
    '../components/modals/ManageCompanyModal.jsx',
    '../components/wizards/AddCompanyWizard.jsx',
    '../components/modals/CompanyStatusPicker.jsx',
  ]) {
    const src = readSrc(file);
    assert.doesNotMatch(src, /\{ value: 'closed', label: 'Closed' \}/, file);
    assert.match(
      src,
      /COMPANY_STATUS_OPTIONS|CompanyStatusPicker/,
      `${file} must read the contract, or use the picker that does`,
    );
  }
});

/**
 * AND THE PICKER IS WHERE THE CONTRACT ACTUALLY LANDS, so it is pinned
 * directly: it must render every status the contract holds, not a subset.
 */
test('the picker offers EVERY status, never a subset', () => {
  const src = readSrc('../components/modals/CompanyStatusPicker.jsx');
  assert.match(src, /COMPANY_STATUS_OPTIONS\.map/);
  // A hand written list of radios would pass the test above and still
  // offer four. Mapping the contract is the thing that cannot drift.
  assert.doesNotMatch(src, /value="active"/, 'a hardcoded radio');
});

/**
 * ===============================
 * * ONE CONTROL, A ROW, ON BOTH DOORS
 * ===============================
 * The Manage modal had five stacked cards with a meaning each, and the
 * detail page still had the dropdown: two doors onto one decision, looking
 * nothing alike, and neither minimal. Found 2026-09-21.
 */
test('THE PICKER IS A ROW, NOT A COLUMN OF CARDS', () => {
  const src = readSrc('../components/modals/CompanyStatusPicker.jsx');
  assert.match(src, /role="radiogroup"[^>]*className="flex flex-wrap/);
  // A meaning per option is what made it a column. One sentence, and it is
  // the CHOSEN status's, so reading five to pick one is not the job.
  assert.doesNotMatch(src, /\{o\.means\}/, 'a meaning per option is the column again');
  assert.match(src, /COMPANY_STATUS_MEANS\[value\]/);
});

test('BOTH DOORS USE THAT ONE CONTROL, neither its own', () => {
  for (const file of [
    '../pages/CompanyDetailPage.jsx',
    '../components/modals/ManageCompanyModal.jsx',
  ]) {
    const src = readSrc(file);
    assert.match(src, /<CompanyStatusPicker/, `${file} must use the picker`);
    // A Select labelled Status beside the picker is the old door left open.
    assert.doesNotMatch(src, /<Select[\s\S]{0,120}label="Status"/, `${file} has a second picker`);
  }
});

/**
 * THE PER DEAL QUESTION GOES WHERE THE ANSWER CAN BE SAVED. The modal
 * sends it with the status in one press; the detail page writes the status
 * on click and has no press to attach it to, so it does not ask and its
 * liquidation amounts stay with LiquidationPanel.
 */
test('THE SECOND QUESTION IS ASKED ONLY WHERE IT CAN BE SAVED', () => {
  const picker = readSrc('../components/modals/CompanyStatusPicker.jsx');
  // The picker holds a handler per question now, so the rule is that it
  // only asks one it was GIVEN a way to save. See CompanyStatusPicker ASKS.
  assert.match(picker, /typeof handlers\[a\.key\] === 'function'/);

  const modal = readSrc('../components/modals/ManageCompanyModal.jsx');
  assert.match(modal, /onReviewIds=\{setReviewIds\}/);
  assert.match(modal, /reviewMonthlyDealIds: reviewIds/);

  // AND THE THIRD LIST, which asks a different question about the same
  // deals: not which are reviewed, but which have no end date.
  assert.match(modal, /onGoingConcernIds=\{setGoingConcernIds\}/);
  assert.match(modal, /goingConcernDealIds: goingConcernIds/);

  /**
   * ===============================
   * * AND THE DETAIL PAGE ASKS IT IN A CONFIRM, not in place
   * ===============================
   * It writes the moment you click a status, so it has no press to hang
   * the answer on: the picker there still gets no handler. It asked
   * NOTHING at all until 2026-09-22, so the checklist the feature is for
   * never appeared on that page.
   *
   * ONE PRESS, BOTH DECISIONS either way. The status and the ids are
   * written together or not at all.
   */
  const page = readSrc('../pages/CompanyDetailPage.jsx');
  assert.doesNotMatch(page, /onReviewIds=/, 'the picker there has no press to save on');
  assert.match(page, /if \(asksDeals\(next\)\)/, 'the three asking statuses must route to a confirm');
  assert.match(page, /confirm\.companyDeals\(\{/);
  assert.match(page, /goingConcernDealIds: askIds/);
  assert.match(page, /reviewMonthlyDealIds: askIds/);
});

/**
 * AND IT SEEDS FROM THE TICKED DEALS, the same rule as the picker. A
 * company with two deals ticked by the import must not open showing five
 * and save five: a deal in that queue is one somebody can answer "no" to.
 */
test('THE DETAIL PAGE SEEDS ITS CHECKLIST FROM WHAT IS STORED', () => {
  const page = readSrc('../pages/CompanyDetailPage.jsx');
  assert.match(page, /\(already\.length > 0 \? already : liveDeals\)/);
  assert.match(page, /d.end_note === GOING_CONCERN/, 'going concern reads the note');
  assert.match(page, /d.review_monthly/, 'the other two read the flag');
});

test('EVERY DOOR THAT EDITS AN EXISTING COMPANY CONFIRMS THE CASCADE', () => {
  // The wizard is exempt and says so: it creates a company, so there are
  // no deals on it yet to stop.
  for (const file of [
    '../pages/CompanyDetailPage.jsx',
    '../components/modals/ManageCompanyModal.jsx',
  ]) {
    const src = readSrc(file);
    assert.match(src, /isTerminalStatus\(/, `${file} must check`);
    assert.match(src, /confirm\.closeCompany/, `${file} must ask`);
  }
  const wizard = readSrc('../components/wizards/AddCompanyWizard.jsx');
  assert.doesNotMatch(wizard, /confirm\.closeCompany/, 'a new company has no deals to stop');
});

/**
 * ===============================
 * * A CLOSURE STOPS WHAT IS TICKED, AND EVERYTHING IS TICKED
 * ===============================
 * The confirm used to say "every deal stops" and had no way to say
 * otherwise. Both doors now carry the same checklist, seeded with all of
 * them AT THE MOMENT THE DIALOG OPENS: an effect would re-tick everything
 * on the render after somebody unticked a row.
 */
test('BOTH CLOSURE DIALOGS CARRY THE CHECKLIST, and seed it with all of them', () => {
  for (const file of [
    '../pages/CompanyDetailPage.jsx',
    '../components/modals/ManageCompanyModal.jsx',
  ]) {
    const src = readSrc(file);
    assert.match(src, /<DealChecklist[\s\S]{0,200}label="Deals to stop"/, `${file} must ask`);
    assert.match(src, /setStopIds\(liveDeals\.map\(/, `${file} must default to all`);
    assert.match(src, /stopDealIds/, `${file} must send them`);
    // An effect would fight every untick. The seed happens once, on open.
    assert.doesNotMatch(src, /useEffect\([^)]*setStopIds/, `${file} re-ticks on render`);
  }
});

test('THE COPY FOLLOWS THE TICKS, and says when some are left running', () => {
  const src = readSrc('./confirms.config.js');
  assert.match(src, /closeCompany: \(\{ status, companyName, count, total, money \}\)/);
  // "Every deal stops today" is a lie the moment one is unticked.
  assert.match(src, /count === total/);
  assert.match(src, /count === 0/, 'unticking the lot has to say so');
});

test('THE MODAL ASKS ONLY ON THE WAY IN', () => {
  // Reopening brings the deals back, so it needs no dialog, and a company
  // already closed being saved for a notes edit must not ask again about a
  // cascade that already happened.
  const src = readSrc('../components/modals/ManageCompanyModal.jsx');
  assert.match(src, /isTerminalStatus\(form\.status\)\s*&&\s*!isTerminalStatus\(company\?\.status\)/);
});

/**
 * ***************************************************
 * * CONTRACT: deal status, the web half
 * ***************************************************
 *
 * The server's half is api/v1/shared/dealStatus.helper.js. Same three
 * words, same reading priority, same rule that a write sets BOTH columns.
 *
 * His call 2026-09-22, and his own answer is what fixes the shape: setting
 * a deal to Active must take it out of the review AND show it unticked in
 * the company's checklist next visit. One fact, so one place to store it.
 */
test('THE THREE DEAL STATUSES, and they are company words', () => {
  assert.deepEqual(Object.values(DEAL_STATUS).sort(), ['active', 'going_concern', 'review']);
  // Each is also a company status: one vocabulary, two levels.
  for (const value of Object.values(DEAL_STATUS)) {
    assert.ok(Object.values(COMPANY_STATUS).includes(value), `${value} is not a company word`);
  }
});

test('READING PRIORITISES HIS WORD, the same as the end date tag', () => {
  assert.equal(dealStatusOf({}), DEAL_STATUS.ACTIVE);
  assert.equal(dealStatusOf({ review_monthly: true }), DEAL_STATUS.REVIEW);
  assert.equal(dealStatusOf({ end_note: 'Going concern' }), DEAL_STATUS.GOING_CONCERN);
  // A row can hold both: the checklist can tick a deal that carried his
  // word. His word wins, so the column and the exported cell agree.
  assert.equal(
    dealStatusOf({ end_note: 'Going concern', review_monthly: true }),
    DEAL_STATUS.GOING_CONCERN,
  );
  // A phrase nobody has taught it is not a status.
  assert.equal(dealStatusOf({ end_note: 'AUGUST TBC' }), DEAL_STATUS.ACTIVE);
});

test('IT IS NOT A STORED COLUMN ON THIS SIDE EITHER', () => {
  // RAW for the banner, STRIPPED for the code. `readSrc` removes comments,
  // so asking it for a sentence that lives in one is asking it for
  // something it has just deleted.
  const raw = readFileSync(new URL('./dealStatus.js', import.meta.url), 'utf8');
  assert.match(raw, /MIRRORED, NEVER IMPORTED/);
  assert.match(raw, /dealStatus\.helper\.js/, 'it must name its other half');

  // Derived from the two columns, never read off a row field.
  const code = readSrc('./dealStatus.js');
  assert.match(code, /row\?\.review_monthly/);
  assert.match(code, /row\?\.end_note/);
  assert.doesNotMatch(code, /row\?\.deal_status/, 'a third source of truth');
});

/**
 * THE TAG HAS ONE HOME ON SCREEN. It lived in the end date cell only
 * because there was no status column to put it in; two columns drawing one
 * fact is what makes a table ask which is true. The EXPORT still writes
 * the words into that cell, because his own sheet has no status column.
 */
test('THE END DATE CELL SHOWS A DATE, and Deal Status shows the word', () => {
  const page = readSrc('../pages/MasterSheetPage.jsx');
  assert.match(page, /<DealStatusCell row=\{row\} onPick=\{onDealStatus\} \/>/);
  assert.doesNotMatch(page, /display=\{endTag/, 'the tag is drawn twice');
  assert.doesNotMatch(page, /const endTag = endCellTag\(row\)/, 'the row still computes it');
});

test('AND THE COMPANIES PAGE SAYS COMPANY STATUS', () => {
  const page = readSrc('../pages/CompaniesPage.jsx');
  // Sentence case like every other header; it still names WHICH status.
  assert.match(page, /<th className="th">Company status<\/th>/);
});
