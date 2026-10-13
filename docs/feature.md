# Features

Planned work. Numbers are stable (cited elsewhere): never renumber. Delete
an entry when it ships.

16. **Liquidation tracker: export to xlsx.** The tracker itself shipped
    2026-10-13 (`/liquidations`, migration 084). Still to come: the rows as
    a spreadsheet, the same columns as the page.

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
