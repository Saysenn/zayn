import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { reviewReason, countByReason, REVIEW_REASON, REVIEW_TABS } from './reviewReason.js';
import { COMPANY_STATUS } from '../configs/companyStatus.js';

/**
 * ***************************************************
 * * CONTRACT: why a deal is in the review queue
 * ***************************************************
 *
 * crm/api and crm/web SHARE NO FILE. The server's half is
 * api/v1/shared/reviewQueue.helper.js, which Diane's long answer and the
 * sign-in briefing read; this half is what the panel's tabs read. The two
 * must agree, or the tab a row sits under is not the heading she reads it
 * out under.
 *
 * THE INCIDENT, 2026-09-21. The queue swept in every live deal on a
 * liquidating company, so the status screen's checklist promised "ticked
 * deals join the Review list every month" and unticking one removed
 * nothing. His call: he marks a company and then chooses which of its
 * deals it actually touches.
 */

const deal = (over = {}) => ({ review_monthly: false, company_status: null, ...over });

test('THE TICK SAYS WHETHER, THE COMPANY SAYS WHICH', () => {
  assert.equal(
    reviewReason(deal({ review_monthly: true, company_status: COMPANY_STATUS.LIQUIDATION })),
    REVIEW_REASON.LIQUIDATION,
  );
  assert.equal(
    reviewReason(deal({ review_monthly: true, company_status: COMPANY_STATUS.REVIEW })),
    REVIEW_REASON.REVIEW,
  );
});

test('A TICK WITH NO STATUS BEHIND IT IS STILL A REVIEW', () => {
  // His sheet writes "Reviewed monthly" on 12 Workforce rows. Without this
  // they belong to no tab at all, and 12 rows vanish from a screen whose
  // whole job is to ask about them.
  assert.equal(reviewReason(deal({ review_monthly: true })), REVIEW_REASON.REVIEW);
  assert.equal(
    reviewReason(deal({ review_monthly: true, company_status: COMPANY_STATUS.ACTIVE })),
    REVIEW_REASON.REVIEW,
  );
});

test('AN UNTICKED DEAL IS HERE FOR ITS DATE, whatever its company is doing', () => {
  // Nobody ticked it, so the wind down is not what is being asked about.
  // Saying "liquidation" would name a reason that did not put it here.
  assert.equal(
    reviewReason(deal({ company_status: COMPANY_STATUS.LIQUIDATION })),
    REVIEW_REASON.PAST_END,
  );
  assert.equal(reviewReason(deal()), REVIEW_REASON.PAST_END);
});

test('AND A ROW IS NEVER IN TWO TABS', () => {
  const rows = [
    deal({ review_monthly: true, company_status: COMPANY_STATUS.LIQUIDATION }),
    deal({ review_monthly: true, company_status: COMPANY_STATUS.REVIEW }),
    deal({ review_monthly: true }),
    deal({ company_status: COMPANY_STATUS.LIQUIDATION }),
  ];
  const counts = countByReason(rows);
  assert.deepEqual(counts, { liquidation: 1, review: 2, past_end: 1 });
  // Every row lands somewhere, and only once.
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), rows.length);
});

test('THREE TABS, in the order the reasons rank', () => {
  // A company winding down is the biggest thing that can be happening; a
  // date is the ordinary case.
  assert.deepEqual(REVIEW_TABS.map((t) => t.key), ['liquidation', 'review', 'past_end']);
  for (const tab of REVIEW_TABS) assert.ok(tab.label?.length > 2, tab.key);
});

test('AND AN EMPTY QUEUE COUNTS ZERO RATHER THAN NOTHING', () => {
  // A tab that disappears when it empties moves the others under somebody's
  // hand as they answer rows.
  assert.deepEqual(countByReason([]), { liquidation: 0, review: 0, past_end: 0 });
  assert.deepEqual(countByReason(undefined), { liquidation: 0, review: 0, past_end: 0 });
});

/**
 * ===============================
 * * AND THE REVIEW PAGE READS THIS, rather than deciding again
 * ===============================
 */
const reviewPage = () => readFileSync(new URL('../pages/ReviewPage.jsx', import.meta.url), 'utf8');

test('THE PAGE FILTERS BY THE TAB, and the answers act on the tab', () => {
  const src = reviewPage();
  assert.match(src, /reviewReason\(row\) === tab/);
  // The counts are over the WHOLE queue: a tab showing its own filtered
  // count would read as the number left to do.
  assert.match(src, /countByReason\(rows\)/);
  // Switching tabs clears the selection, or "yes to all" acts on rows from
  // a tab nobody is looking at.
  assert.match(src, /setTab\(key\); sel\.clear\(\);/);
});

test('AND THE ROW NO LONGER REPEATS THE TAB AS A BADGE', () => {
  assert.doesNotMatch(reviewPage(), /badge-liquidation/, 'the tab already says it');
});

test('THE MIRROR NAMES ITS OTHER HALF', () => {
  // A mirror nobody can find is a mirror that drifts.
  const src = readFileSync(new URL('./reviewReason.js', import.meta.url), 'utf8');
  assert.match(src, /MIRRORED, NEVER IMPORTED/);
  assert.ok(src.includes('reviewQueue.helper.js'));
});
