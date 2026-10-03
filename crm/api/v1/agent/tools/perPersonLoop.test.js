const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../repos/masterSheetRows.repo');
const { masterSheetTools } = require('./masterSheet');

/**
 * ***************************************************
 * * A GUARD ONE DOOR ALONG IS NOT A GUARD
 * ***************************************************
 *
 * `bulk_update_master_sheet` refuses a phone, an address or a bank account,
 * because a filter cannot target one person's fact. Live, that bought
 * nothing: told to "put the phone number 07700900000 on all three" she
 * called `update_master_sheet_row` THREE TIMES and the same number landed
 * on three different people. A bank account reached that way is three
 * people paid into one account.
 *
 * The check is NOT "is this a per person field". On one row these are
 * perfectly legitimate and refusing them would break the ordinary case. It
 * is "is this the SAME VALUE going to a SECOND PERSON in the same turn",
 * which is the thing that cannot be right.
 *
 * `turn` is injected by runAgent and lives exactly as long as the turn.
 */

const update = masterSheetTools.find((t) => t.name === 'update_master_sheet_row');

const ROWS = [
  { id: 1, person_id: 'testy', person_name: 'Testy McTest', group_name: 'ZZTEST', monthly_amount: 1000, payable_days: 30 },
  { id: 2, person_id: 'fakeo', person_name: 'Fakeo Fakerson', group_name: 'ZZTEST', monthly_amount: 1000, payable_days: 30 },
  { id: 3, person_id: 'testy', person_name: 'Testy McTest', group_name: 'ZZTEST', monthly_amount: 500, payable_days: 30 },
];

const withRepo = (run) => {
  const saved = { findById: repo.findById, update: repo.update };
  const written = [];
  repo.findById = async (id) => ROWS.find((r) => r.id === Number(id)) ?? null;
  repo.update = async (id, patch) => { written.push({ id, patch }); return { id, person_name: 'X' }; };
  return run(written).finally(() => Object.assign(repo, saved));
};

// One per turn, exactly as runAgent creates it.
const turn = () => ({ wrote: new Map() });

test('THE ACTUAL INCIDENT: the same phone cannot reach a second person', async () => {
  await withRepo(async (written) => {
    const t = turn();
    const first = await update.handler({ id: 1, phone: '07700900000', turn: t });
    const second = await update.handler({ id: 2, phone: '07700900000', turn: t });

    assert.match(first.summary, /Updated/, 'the first row is the ordinary case and must work');
    assert.deepEqual(written.map((w) => w.id), [1], 'it wrote the second person anyway');
    assert.match(second.summary, /NOTHING HAS BEEN CHANGED/);
    assert.match(second.summary, /Testy McTest/, 'it does not say who already has it');
  });
});

test('A BANK ACCOUNT IS THE ONE THAT COSTS MONEY', async () => {
  await withRepo(async (written) => {
    const t = turn();
    await update.handler({ id: 1, accountNumber: '12345678', turn: t });
    const out = await update.handler({ id: 2, accountNumber: '12345678', turn: t });

    assert.deepEqual(written.map((w) => w.id), [1]);
    assert.match(out.summary, /wrong person/);
  });
});

test('ONE PERSON, TWO OF THEIR OWN ROWS, is still fine', async () => {
  // Somebody with four deals has one phone number. Refusing that would be
  // the guard breaking the thing it is meant to protect.
  await withRepo(async (written) => {
    const t = turn();
    await update.handler({ id: 1, phone: '07700900000', turn: t });
    await update.handler({ id: 3, phone: '07700900000', turn: t });

    assert.deepEqual(written.map((w) => w.id), [1, 3]);
  });
});

test('DIFFERENT values to different people are untouched', async () => {
  await withRepo(async (written) => {
    const t = turn();
    await update.handler({ id: 1, phone: '07700900001', turn: t });
    await update.handler({ id: 2, phone: '07700900002', turn: t });

    assert.deepEqual(written.map((w) => w.id), [1, 2]);
  });
});

test('a field that is NOT one person\'s fact is not restricted', async () => {
  // Payable days on three rows in one turn is an ordinary mass edit.
  await withRepo(async (written) => {
    const t = turn();
    await update.handler({ id: 1, payableDays: 25, confirmed: true, turn: t });
    await update.handler({ id: 2, payableDays: 25, confirmed: true, turn: t });

    assert.deepEqual(written.map((w) => w.id), [1, 2]);
  });
});

test('THE NEXT TURN STARTS CLEAN, or a correction becomes impossible', async () => {
  // They said the wrong name, fixed it, and now genuinely want that number
  // on the other person. A guard that outlived its turn would block it.
  await withRepo(async (written) => {
    await update.handler({ id: 1, phone: '07700900000', turn: turn() });
    await update.handler({ id: 2, phone: '07700900000', turn: turn() });

    assert.deepEqual(written.map((w) => w.id), [1, 2]);
  });
});

test('clearing a value is not a shared value', async () => {
  await withRepo(async (written) => {
    const t = turn();
    await update.handler({ id: 1, phone: '', turn: t });
    await update.handler({ id: 2, phone: '', turn: t });

    assert.deepEqual(written.map((w) => w.id), [1, 2], 'blanking two rows was refused');
  });
});

/* ===============================
 * * The amount follows its inputs, whichever door
 * =============================== */

test('EDITING PAYABLE DAYS RECOMPUTES THE AMOUNT', async () => {
  // The page's PATCH recomputed and so did the bulk edit; this did not, so
  // a row edited through Diane stopped following from its own inputs. Live:
  // 20 payable days on 1,000 a month, payable 0.
  await withRepo(async (written) => {
    // It moves the money, so it previews first (2026-09-29), then writes.
    const first = await update.handler({ id: 1, payableDays: 15, turn: turn() });
    assert.equal(first.pending, true, 'a day count that moves the payable is previewed');
    assert.equal(written.length, 0);
    await update.handler({ id: 1, payableDays: 15, confirmed: true, turn: turn() });

    const { patch } = written[0];
    assert.equal(patch.payableDays, 15);
    assert.ok(patch.payableAmount !== undefined, 'the amount was left stale');
    assert.ok(Number(patch.payableAmount) > 0, `payable came out ${patch.payableAmount}`);
  });
});

test('an explicit amount still wins over the formula', async () => {
  await withRepo(async (written) => {
    // It asks first now: a payable set by hand moves the month (2026-09-25).
    const first = await update.handler({ id: 1, payableDays: 15, payableAmount: 777, turn: turn() });
    assert.equal(first.pending, true);
    assert.equal(written.length, 0);
    await update.handler({ id: 1, payableDays: 15, payableAmount: 777, confirmed: true, turn: turn() });
    assert.equal(written[0].patch.payableAmount, 777);
  });
});
