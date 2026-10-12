# Todo

Open items only. Delete a line in the change that finishes it; git history
has the rest. Parked ideas live in `backlog.md`, planned features in
`feature.md`.

## Before the next deploy

- [ ] Set `TIMEZONE` in `crm/api/.env` on the server PC. Unset, it takes the
      machine's zone while the Electron frontend reads the admin's clock, so
      at a month boundary the two can name different months (`feature.md` 3).
- [ ] Decide whether the database moves local or only the API does
      (Supabase `ap-south-1` today; `feature.md` 3).
- [ ] Confirm the one-off runs are done (`run-it.md`): migration 060
      (`login_briefing`, safe to miss: defaults ON), migration 066 (repairs
      profile names written as slugs), and the `scripts/recoverFromSnapshot.js`
      write (dry run only was verified).

## Money at risk

- [ ] Diane's writes skip the route's value guards (parked: she has never
      written one out of range). Her tools call `repo.update` directly, so
      payable days (route allows whole 0–31 via `parseDays`) and the two
      percentages (`MAX_PERCENT`) are unchecked on `update_master_sheet_row`,
      `add_deal` and the bulk `set`. Fix: lift `parseDays` into `shared/`,
      call it and the percent check from `normalizeFields`.
- [ ] `docs/boss/knowledge.md` does not exist but is quoted in
      `calculator/buildBreakdowns.js` and `repos/burn.repo.js` (the stated
      reason for a `TRUNCATE` of four tables). Ask the boss to re-send it or
      confirm the retention rule. Do not change code on this alone.
- [ ] Parked: 25 rows with 31 typed payable days compute £0 against
      `master.xlsx`'s July preset. Revisit when he uploads a new month.
- [ ] Parked: dates may be stored a day early. Check:
      `SELECT person_name, assigned_on FROM tb_mastersheet WHERE company ILIKE 'anteep%';`
      (`master.xlsx` says `2026-03-11`; `2026-03-10` means a re-upload).
- [ ] Parked: `pg` has no `setTypeParser` for `date` (OID 1082), so dates
      come back at server-local midnight. Returning `YYYY-MM-DD` strings
      breaks every export's date cells unless all five builders change too.

## Waiting on the boss

- [ ] Drivers: no row carries a driver role, so the Driver export tab is
      disabled. Ask how a driver reaches the sheet.
- [ ] `awayGbp` (`breakdowns/withUsd.js`) counts GBP only. Pounds only, or
      all cash abroad per currency?
- [ ] Does `going_concern` count as trading everywhere `active` does (Active
      list, totals)? It does today by default; confirm.
- [ ] `POST /settings/reset-master-sheet` has no caller. Delete the route,
      `burnRepo.resetMasterSheet` and its test, or put the button back. Ask
      first: destructive.
- Group managers and money received in: see `backlog.md` 8 and 20.

## Diane

- [ ] ~30,300 tokens of prompt and tool schemas go out on every model call
      (measured 2026-09-21). Fix: prompt caching; trimming the heaviest
      schemas (`bulk_update_master_sheet`, `total_master_sheet`,
      `filter_master_sheet`) is the second lever.
- [ ] Speech is not streamed: the route buffers the whole mp3 because
      `useOpenaiSpeech` plays a blob URL. Streaming needs `MediaSource`.
- [ ] She suggests fixes for the sheet (asked for, not started; full entry
      in `diane.md` under OPEN). Every suggestion must come from the helper
      the page and export use, and apply through the export panel's route.
- [ ] A person and their company glued together ("zayn workforce") is not
      split; `splitPersonAndGroup` only knows groups. Fix when it bites.
- [ ] `wrongMonthAsked` guards the amount write only; other writes that
      print a month can land on the wrong one.
- [ ] She sometimes answers the export's groups step herself, unasked.
- [ ] No arithmetic (a difference, a percentage); she says so. A referring
      phrase with no antecedent ("the second one") still gets an answer.
- [ ] Theme setting for her colour: a `tb_settings` hue applied over
      `web/src/configs/dianeTheme.js`; `ParticleOrb` and `LoginOrb` must
      read the resolved value.

## Frontend

- [ ] Both wizards (`components/wizards/`) call `apiService` directly and
      invalidate nothing. Route them through `useAddHandlers`,
      `useUpdateCompany`, `useCreateMasterSheetRow`.
- [ ] `useImportExpenses` hand rolls the upload flow; give `useImportFlow`
      the parser and endpoints as arguments and share it.
- [ ] Forms keep a local `busy`/`saving` beside the hook's `isPending`
      (`AddDealModal`, `AddExpense`, both wizards, `MasterSheetExportModal`).
- [ ] `useOptimisticUpdate` builds its own messages instead of
      `helpers/toastMessage.js`.
- [ ] Dashboard: the two keys draw "Current month" in opposite tones
      (`MONTH_TONE` in `DashboardPage.jsx` vs `SOURCES` in
      `SourceTrendChart.jsx`). Proposed: flip `SOURCES`. Needs a call.
- [ ] Dashboard: `trimEdges` keeps a middle gap, then both callers filter
      `unavailable` points out. Drop the filters and draw a break.

## Sheet, upload and export

- [ ] Flag contradictions on upload (`parseUpload` `review_reason`): a preset
      that disagrees with the sheet, a Bank method with no account number,
      a stored date that disagrees with the appointment formula.
- [ ] The month sheet and payout files are flat values; only the master
      sheet export is live. Possible fix: `SUMIF` per currency per block.
- [ ] Nothing tells the reader the exported master sheet is live: one line
      on the export card and in Diane's summary.
- [ ] Copy a deal into another group.
- [ ] Group and role cells are single select; several groups per person are
      legitimate.
- [ ] `last_seen_upload_at` and a "not in the last upload" filter.
- [ ] Remember the header mapping between uploads.
- [ ] Expenses R4: `tb_expenses_changes`, History and undo.
- [ ] A currency spelled two ways is two currencies; add the alias to
      `CURRENCY_ALIASES` (`shared/toUsd.helper.js`) when one appears.

## whatbot (out of current scope)

- [ ] `src/tools/index.test.js` hangs intermittently.
- [ ] `parseRows`'s `lenient` mode is dead code.
- [ ] `docs/sheet-format.md` describes the retired local xlsx path.
- [ ] A reopened payday answer leaves no history.
- [ ] The `no_response` sweep only runs when the report is run.
- [ ] `employee_id` column removal, confirmed dead.
