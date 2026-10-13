# Features

Planned work. Numbers are stable (cited elsewhere): never renumber. Delete
an entry when it ships.

16. **TOP PRIORITY. Liquidation tracker page.** One page, one row per
    company being wound down (or watched).
    - Columns: company, director, mid, group, status, current instructions,
      deadline, next action, owner, supporting docs, blamed?, liquidator,
      last comm, note.
    - Statuses: own liq, HMRC liq, strike off, strike off rejected,
      dissolved, active.
    - Open: how these statuses map onto the company status the CRM already
      has (`active | liquidation | dissolved | closed`, which drives pay and
      the liquidation panel). They should stay one status, not become two.
    - Suggested add-ons, not agreed yet:
      - director and mid filled in from the company's deals, not typed
        again;
      - deadline turns amber when it is near and red when it has passed;
        sort by deadline;
      - filters by status, group and owner;
      - a status change history (what it was, when it changed, who changed
        it);
      - the settlement and allocated total from the liquidation panel, with
        a link to the company;
      - last comm as a dated log, not one overwritten cell;
      - export to xlsx;
      - Diane's briefing names deadlines due this week.

0. **Expenses keep 3 months.** Fixed rule, no setting: the current month and
   the 2 before, rolling. Older rows are snapshotted, then cleared only if
   the snapshot succeeded (like `masterSheet/closeMonth.js`). Receipts already
   follow it (`expenses/bot/receipts.js`). The master sheet differs: 3, 6 or
   12 months of history, chosen in Settings.
3. **Electron .exe on one always-on PC.** Load `http://localhost:3000`, never
   `file://`. A `Secure` cookie is refused over plain http on a LAN address:
   same PC, a self-signed cert, or drop `secure`. Decide `TIMEZONE`.
4. **Multi-user with roles.** One permissions file
   (`v1/shared/permissions.js`) every route checks. Blockers: one global
   session id, one account row with no role, no `changed_by` on the change
   log.
7. **Debts.** Undecided: arrears, clawback or third party. Nothing records a
   debt today.
8. **Lawyer and HMRC mode.** Built as the `hmrc` context (`agent/hmrc/`).
   Open: she switches into it on her own when asked, and back out after.
9. **Diane's Debts context.** Greyed "coming soon" in the selector; waits on 7.
10. **Wake and sleep words.** She listens always but answers only once woken
    by any greeting; sleeps after 5 minutes idle or on any goodbye. Read by
    meaning, not a word list. Woken by mistake: a short sorry, back to sleep.
    Typing and the space key / deactivate button still work.
11. **Switch context by voice or text** ("go to expenses"): the selector
    moves and she says which one. A "coming soon" context gets "not ready yet".
12. **HSBC mode.**
13. **Live exchange rates for the master sheet and exports.** Same source as
    the expense bot (`OPENEXCHANGERATES_APP_ID`,
    `crm/api/v1/expenses/bot/rates.js`). Current month uses the live rate
    with its time; a closed month keeps its snapshot rate; a rate saved in
    Settings wins; open.er-api.com is the fallback.
14. **Nightly cleanup runner inside the CRM.** One job for every clear-out:
    expenses past item 0's window, unanswered held receipts, Diane's pictures
    past 30 days. Idempotent, logs what it cleared. Absorbs
    `startReceiptsKeeper`.
15. **Voice notes on the expense bot.** On hold: speech to text is too slow
    and costly per message.
