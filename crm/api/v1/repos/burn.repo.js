const pool = require('../../configs/db');

/**
 * The two manual "wipe it" actions from Settings — boss's own "burn the
 * month" concept (docs/boss/knowledge.md §6: "all data on the CRM
 * actually refers to future payments which haven't actually been done...
 * CRM data should only ever represent future, unconfirmed obligations").
 * Previously just a documented retention rule; these are the actual
 * manual buttons.
 *
 * Both routes (settings.js) require an exact typed confirmation phrase
 * before calling either of these — nothing here re-checks that, this
 * layer trusts its caller the same way every other repo does.
 */

/**
 * The conversation half of a month: escalations and chat threads.
 *
 * RESCOPED BY THE REFACTOR. This used to also truncate `companies`,
 * `assignments` and `payment_status`, and it was safe to do that because
 * whatbot's 15-minute sync repopulated all three within the quarter hour.
 * That sync is gone, those three tables are gone, and the deals now live
 * in tb_mastersheet — which nothing repopulates automatically. Wiping
 * them here would have destroyed the month's payroll with no way back.
 *
 * IT CLEARS THE DEALS TOO, since 2026-08-25, on the user's call. It used to
 * stop at the three tables above and leave the sheet to a second button
 * ("Reset master sheet"), which meant ending a month was two destructive
 * acts in a row and the first one only did half the job. There is one now,
 * and its description and typed phrase say what goes.
 *
 * ONE STATEMENT, not two calls. TRUNCATE across all four is atomic, so a
 * failure cannot leave the chat history gone and the sheet still there.
 *
 * tb_people and tb_companies are still deliberately untouched: a person and
 * a company outlive any one month, and re-uploading next month's sheet
 * would only recreate them anyway. They are also views of tb_mastersheet on
 * screen, so with the deals gone they show nothing regardless.
 *
 * NOTHING BRINGS THE DEALS BACK. There is no sync any more; the next
 * human-made xlsx upload is the only route in. The typed-phrase
 * confirmation is carrying real weight, not ceremony.
 */
function burnMonth() {
  return pool.query(
    `TRUNCATE TABLE tb_concerns, tb_messages, tb_thread_reads, tb_mastersheet
     RESTART IDENTITY CASCADE`,
  );
}

// tb_mastersheet only. CASCADE here reaches tb_mastersheet_changes
// (migration 015's row_id FK) — its history is meaningless once the rows
// it describes are gone, so that's the correct outcome, not a side effect
// to work around. Whatbot's own pulled-down copy (its Redis roster) isn't
// touched by this at all — it isn't reachable from this database — so a
// reset here doesn't erase whatbot's ability to keep answering, only the
// CRM's own copy.
//
// NO LONGER OFFERED IN THE UI. burnMonth above clears the deals as part of
// ending a month, which is the one act an admin actually performs. This and
// its route stay for scripts and for a restore that needs the sheet cleared
// without touching the chat history; nothing in crm/web calls it.
function resetMasterSheet() {
  return pool.query('TRUNCATE TABLE tb_mastersheet RESTART IDENTITY CASCADE');
}

module.exports = { burnMonth, resetMasterSheet };
