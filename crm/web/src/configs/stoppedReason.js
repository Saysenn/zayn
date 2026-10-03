/**
 * ***************************************************
 * * CONTRACT: the four ways a deal ends
 * ***************************************************
 *
 * MIRRORED, NEVER IMPORTED. The server's half is
 * api/v1/repos/masterSheetRows.repo.js `STOPPED_REASON`, and migration 056
 * has the same four in a CHECK constraint. The two codebases share no file,
 * so each states the set and each pins its own half with its own test
 * (web/src/configs/stoppedReason.test.js).
 *
 * The KEYS are the wire values and must match the server exactly. The
 * LABELS are ours alone: the Archive prints them and the server never sees
 * them.
 */

export const STOPPED_REASON_LABEL = Object.freeze({
  stopped_by_hand: 'Stopped by hand',
  review_no: 'Answered no at review',
  review_final: 'Final month at review',
  company_closed: 'Company closed',
});

// The one that cannot be resumed on its own: the company went, and putting
// the deal back alone would put it on a company that is gone.
export const REOPEN_THE_COMPANY = 'company_closed';
