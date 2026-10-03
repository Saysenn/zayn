const test = require('node:test');
const assert = require('node:assert/strict');
const { buildImportDiff } = require('./diffImport');

/**
 * The diff decides what a human is asked to approve, so the things it must
 * never do matter more than the things it does:
 *
 *   SHOW a claimed column, marked     hiding it removed the modal's one job
 *   never call a rounding a change   "3675.00" and 3675 are one number
 *   never merge cleared with set     one wipes a value, the other replaces
 *                                    it, and Accept all treats them alike
 */

const COLUMNS = ['end_on', 'monthly_amount', 'location'];
const FIELD_FOR = { end_on: 'endOn', monthly_amount: 'monthlyAmount', location: 'location' };

function diff({ row, stored }) {
  return buildImportDiff({
    rows: [{ syncKey: 'k', personName: 'Zayn', company: 'Workforce', groupName: 'INDIGO', ...row }],
    columns: COLUMNS,
    existing: stored ? new Map([['k', { id: 1, sync_key: 'k', person_name: 'Zayn', ...stored }]]) : new Map(),
    valuesOf: (r) => ({
      end_on: r.endOn ?? null,
      monthly_amount: r.monthlyAmount ?? 0,
      location: r.location ?? '',
    }),
    fieldFor: FIELD_FOR,
  });
}

test('a row the CRM has never seen is new, not a change', () => {
  const d = diff({ row: { endOn: '2027-06-30' } });
  assert.equal(d.new.length, 1);
  assert.equal(d.changed.length, 0);
});

test('an identical row is a count, not a line to read', () => {
  const d = diff({
    row: { endOn: '2027-06-30', monthlyAmount: 3675, location: 'Abu Dhabi' },
    stored: { end_on: new Date('2027-06-30'), monthly_amount: '3675.00', location: 'Abu Dhabi' },
  });
  assert.equal(d.changed.length, 0);
  assert.equal(d.unchanged, 1);
});

/**
 * ===============================
 * * A CLAIMED COLUMN IS SHOWN, MARKED, AND DEFAULTS TO THE CRM
 * ===============================
 * It used to be dropped here, so a column anybody had ever typed into
 * vanished from the diff for good: never listed, never offered, never
 * written. The invisible guard was removing the visible modal's one job.
 */
test('a claimed column IS offered, marked, and keeps the CRM value by default', () => {
  const d = diff({
    row: { endOn: '2028-01-01', monthlyAmount: 3675, location: 'Abu Dhabi' },
    stored: {
      end_on: new Date('2027-06-30'), monthly_amount: '3675.00', location: 'Abu Dhabi',
      manually_overridden_fields: ['end_on'],
    },
  });

  assert.equal(d.changed.length, 1, 'the file disagrees, so there is something to decide');
  const [cell] = d.changed[0].cells;
  assert.equal(cell.field, 'endOn');
  assert.equal(cell.byHand, true, 'marked, so the reader knows why the CRM differs');
  assert.equal(cell.keep, true, 'and the correction wins unless somebody says otherwise');
});

test('a column nobody claimed defaults to the FILE', () => {
  const d = diff({
    row: { endOn: '2028-01-01', monthlyAmount: 3675, location: 'Abu Dhabi' },
    stored: { end_on: new Date('2027-06-30'), monthly_amount: '3675.00', location: 'Abu Dhabi' },
  });
  const [cell] = d.changed[0].cells;
  assert.equal(cell.byHand, false);
  assert.equal(cell.keep, false, 'taking the file is what an upload is for');
});

test('the mark carries WHEN it was set and WHAT it replaced', () => {
  // Without those two the note says "somebody typed this" and leaves the
  // reader with the same decision and no more information.
  const claims = new Map([['7:endOn', { changed_at: '2026-08-27T14:12:00Z', old_value: '2027-01-01' }]]);
  const d = buildImportDiff({
    rows: [{ syncKey: 'k', personName: 'Zayn', endOn: '2028-01-01' }],
    columns: ['end_on'],
    existing: new Map([['k', {
      id: 7, end_on: new Date('2027-06-30'), manually_overridden_fields: ['end_on'],
    }]]),
    valuesOf: (r) => ({ end_on: r.endOn }),
    fieldFor: FIELD_FOR,
    claims,
  });
  const [cell] = d.changed[0].cells;
  assert.equal(cell.claimedAt, '2026-08-27T14:12:00Z');
  assert.equal(cell.claimedFrom, '2027-01-01');
});

test('an edit older than the change log is still marked, just undated', () => {
  // The mark is the important half. Missing detail must not hide the cell.
  const d = diff({
    row: { endOn: '2028-01-01' },
    stored: { end_on: new Date('2027-06-30'), manually_overridden_fields: ['end_on'] },
  });
  const [cell] = d.changed[0].cells;
  assert.equal(cell.byHand, true);
  assert.equal(cell.claimedAt, null);
  assert.equal(cell.claimedFrom, null);
});

test('an empty cell over a stored value is CLEARED, not set', () => {
  const d = diff({
    row: { endOn: null, monthlyAmount: 3675, location: 'Abu Dhabi' },
    stored: { end_on: new Date('2027-06-30'), monthly_amount: '3675.00', location: 'Abu Dhabi' },
  });
  assert.equal(d.changed.length, 1);
  const [cell] = d.changed[0].cells;
  assert.equal(cell.field, 'endOn');
  assert.equal(cell.kind, 'cleared');
  assert.equal(cell.from, '2027-06-30');
  assert.equal(cell.to, '');
  assert.equal(d.changed[0].clearedCount, 1);
});

test('a different value is set, and only the columns that moved appear', () => {
  const d = diff({
    row: { endOn: '2027-06-30', monthlyAmount: 4000, location: 'Abu Dhabi' },
    stored: { end_on: new Date('2027-06-30'), monthly_amount: '3675.00', location: 'Abu Dhabi' },
  });
  assert.equal(d.changed[0].cells.length, 1);
  assert.equal(d.changed[0].cells[0].field, 'monthlyAmount');
  assert.equal(d.changed[0].cells[0].kind, 'set');
  assert.equal(d.changed[0].clearedCount, 0);
});

/**
 * ===============================
 * * `status` IS SEEDED, NOT ASKED ABOUT
 * ===============================
 * A file carrying an end date proposes a new `status` on every row, because
 * identity.js `statusFor` derives one from it. The diff then offered a two
 * way choice between `ended` and `active` that changes NOTHING on screen:
 * the badge and the status filter both go through paymentPeriod.helper.
 *
 * It was meaningful while a human could claim the column. Migration 052
 * removed that, so it has been a question with no answer worth giving since.
 * Storage is unchanged: the commit route adds it back to every mask.
 */
const WITH_STATUS = ['end_on', 'status'];

function statusDiff(storedStatus, incomingStatus) {
  return buildImportDiff({
    rows: [{ syncKey: 'k', personName: 'Euro boss', company: 'Gab', groupName: 'INDIGO', status: incomingStatus }],
    columns: WITH_STATUS,
    existing: new Map([['k', {
      id: 1, sync_key: 'k', person_name: 'Euro boss', end_on: new Date('2026-01-01'), status: storedStatus,
    }]]),
    valuesOf: (r) => ({ end_on: null, status: r.status }),
    fieldFor: { end_on: 'endOn', status: 'status' },
  });
}

test('STATUS IS NEVER A CELL IN THE DIFF, even when the file moves it', () => {
  const d = statusDiff('ended', 'active');
  const cells = (d.changed[0]?.cells ?? []).map((c) => c.column);
  assert.ok(!cells.includes('status'), `status must not be offered, got ${cells.join(', ')}`);
});

test('and the row it was the only change on is not listed at all', () => {
  // Only status moved, so there is nothing left to ask about and the row
  // must not appear as a change with an empty cell list.
  const d = buildImportDiff({
    rows: [{ syncKey: 'k', personName: 'Euro boss', company: 'Gab', groupName: 'INDIGO', status: 'active' }],
    columns: ['status'],
    existing: new Map([['k', { id: 1, sync_key: 'k', person_name: 'Euro boss', status: 'ended' }]]),
    valuesOf: (r) => ({ status: r.status }),
    fieldFor: { status: 'status' },
  });
  assert.equal(d.changed.length, 0, 'a status-only move is not a change to read');
});

test('the columns beside it still are', () => {
  const d = buildImportDiff({
    rows: [{ syncKey: 'k', personName: 'Euro boss', company: 'Gab', groupName: 'INDIGO', status: 'active' }],
    columns: WITH_STATUS,
    existing: new Map([['k', {
      id: 1, sync_key: 'k', person_name: 'Euro boss', end_on: new Date('2026-01-01'), status: 'ended',
    }]]),
    valuesOf: () => ({ end_on: null, status: 'active' }),
    fieldFor: { end_on: 'endOn', status: 'status' },
  });
  const cells = (d.changed[0]?.cells ?? []).map((c) => c.column);
  assert.deepEqual(cells, ['end_on']);
});
