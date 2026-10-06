# WhatBot ↔ CRM: payday check and expenses

Written 2026-10-06. Nothing here is built yet except where it says so. The
expenses page itself is in `expense.md` and `state.md`; this file is about
WhatBot feeding it, and the month end payday check.

---

## What exists today

### WhatBot

- Code lives in `whatbot/` in this repo. There is an older standalone copy at
  `../whatbot`; the in-repo one is newer (it has `sync:crm`).
- Stack: Baileys (linked WhatsApp accounts, not the Cloud API), Express,
  BullMQ/Redis, and the `openai` SDK pointed at Groq or Gemini. Two processes:
  `server.js`, and `worker.js` which holds the WhatsApp socket.
- **Bot → CRM**: `whatbot/src/system/crmClient.js`, header `x-api-key` =
  `CRM_AGENT_API_KEY`, which must equal the CRM's `AGENT_API_KEY`
  (`crm/api/configs/env.js:80`). Routes, all in `crm/api/v1/agent.js`:
  `GET /api/v1/agent/master-sheet`, `POST /agent/concerns`,
  `POST /agent/messages`, `POST /agent/logs`, `PATCH /agent/payment-status`.
  The CRM also exposes `/handlers/:personId`, `/companies/:name` and
  `/sync/master-sheet`.
- **CRM → bot**: `crm/api/v1/messages.js:80-105` posts to
  `${WHATBOT_WEBHOOK_URL}/webhook/admin-reply` with `x-webhook-key`, received
  at `whatbot/src/http/adminReplyApp.js:38` and sent through Baileys.
- AI: `agent/askModel.js:79` (tool calling, read-only payroll questions),
  `LLM_MODE=mock` for keyword routing, Whisper voice notes behind
  `FEATURE_VOICE`, regex parsing in `conversation/*`, evals in `agent/evals`.

### Payday check: built, end to end

- `whatbot/src/payday/*`, run with `npm run payday` on `PAYDAY_SCHEDULE`.
  **`PAYDAY_DRY_RUN=true` by default.**
- Asks each person "Did you receive your <month> pay for your <group>
  companies?" with 1 yes, 2 no, 3 only part, 4 stop
  (`paydayMessages.js:35`).
- Replies are parsed in `conversation/handleMessage.js:55` (`paydayAnswer`):
  digits, yes/no and partial amounts, scoped to the group the reply came in.
- Outcomes are `confirmed`, `partial`, `not_received`, and `no_response`
  after `PAYDAY_RESPONSE_DAYS`. They go through `crmOutbox.js`, which retries.
- CRM side, `agent.js:79-120`: writes `payment_outcome`, `payment_note` and
  `payment_replied_at` (migration 016). **`confirmed` and `partial` set
  `override_paid = true`, which is the paid tick on the master sheet;
  `not_received` sets it false** (`agent.js:35`,
  `masterSheetRows.repo.js:1015-1037`). `sent` and `no_response` leave paid
  alone.
- The CRM can block every one of these writes with the Settings flag
  `whatbot_writes_enabled` (migration 028).

**So the payday check needs testing, not building.**

#### Testing the payday check (status 2026-10-06: not run yet)

- **Its tests cannot run yet**: WhatBot's packages are not installed
  (`whatbot/node_modules` is missing), so `npm test` (vitest) fails with
  "Cannot find package 'vitest'". The tests are `src/payday/payday.test.js`,
  `schedule.test.js` and `crmOutbox.test.js`. First step: `npm install` in
  `whatbot/`.
- **Dry run** (`PAYDAY_DRY_RUN=true`, the default): works out who would be
  asked and logs it; **no messages are sent**. It still needs WhatBot's Redis
  and its link to the CRM: `CRM_API_URL` pointing at the CRM under test (the
  local clone runs on `http://localhost:3010`) and `CRM_AGENT_API_KEY` equal
  to that CRM's `AGENT_API_KEY`.
- **Real send** needs `PAYDAY_DRY_RUN=false`, which unlocks the **whole
  roster**. Always pair it with `--only <number>` (`runPaydayCheck.js:66`):
  only that number is messaged, and a number with no match messages nobody.
  `--limit 1` alone is NOT safe; it picks whoever sorts first.
- **Never run a real send without `--only`.**

The order to prove it:

| Option | What | Messages sent |
|---|---|---|
| A | `npm install` in `whatbot/`, run the payday tests, then a dry run against the clone | none |
| B | A, then one real send with `--only <the admin's own number>`; reply 1, 2 or 3 on the phone and check the paid tick (`override_paid`) and `payment_outcome` on that deal in the clone | one, to the admin |
| C | Leave it for later | none |

Not yet chosen. B needs the admin's own number.

### Expenses

- `tb_expenses` (migration 055): `id`, `spent_on`, `description`, `payee`,
  `currency` (uppercase, 2-8 chars), `raw_amount`, `exchange_rate` (AED per
  unit, nullable), `aed_amount` (generated), `group_name`, `spent_by` (free
  text), `sync_key` (not unique), `archived_at`, `created_at`, `updated_at`.
- `tb_group_receipts` (migration 012, renamed in 023): `group_name`,
  `period`, `currency`, `amount`, `received_at`, `note`, unique on
  (group, period, currency). Read and written by `repos/groupReceipts.repo.js`.
- Routes, `crm/api/v1/expenses.js`: `GET /expenses`, `/options`,
  `/export/options`, `/download`, `POST /import/preview` and
  `/import/commit`, `POST /expenses` (:231, requires `spentOn`,
  `description`, `currency`, `rawAmount`, :50), `PATCH /:id`, `DELETE /:id`,
  `POST /bulk-update`, `POST /bulk-delete`.
- Writable fields (`repos/expenses.repo.js:29`): `spentOn`, `description`,
  `payee`, `currency`, `rawAmount`, `exchangeRate`, `groupName`, `spentBy`.
- Page: `crm/web/src/pages/ExpensesPage.jsx`, nav `/expenses`.
- **WhatBot has no connection to expenses at all.**

### Who may message the bot

- There is no admin allow-list. `employee/access.js:27` (`identify`) looks
  the sender up in the roster synced from the CRM and needs an active
  assignment; anyone else gets `UNKNOWN_SENDER`.
- `WHATSAPP_NUMBERS` maps the bot's OWN numbers to groups
  (`config/numbers.js`); it is not a list of allowed senders.
- Gates in order: opt-out, rate limit, identity (`handleMessage.js:89-120`).
  There is no admin number concept.

---

## What we want

1. **Payday check**: at month end, WhatBot asks and the paid tick on each
   deal follows the answer. (Exists; needs proving.)
2. **Expenses through WhatBot**: a registered admin sends plain text, a photo
   of a receipt, an Excel or any document. It is read accurately, cleaned,
   and sent back as a numbered list for confirmation, with extra bubbles for
   what is missing or doubtful ("3 expenses have no group: which group?").
   They fix it by replying; on "yes" it is saved to the expenses page.
   **Only registered numbers can save expenses, or message the bot for it at
   all; everyone else is refused.**

---

## Recommendation: the brain in the CRM, WhatBot as the messenger

Build the expense reading and checking **in the CRM**, then connect WhatBot
to it.

- One brain serves WhatBot now and Diane's Expenses context later, the same
  way the master sheet engine serves both her and the file checks.
- It reuses what Diane already has: `agent/engine/intake.js` (any file into
  tables), `layout.js` (the AI says what each column means), code reading
  every row, the plan card, one confirm and one undo.
- WhatBot stays thin: receive, forward to the CRM, relay the replies as
  bubbles, send the "yes" back.

### The pattern

The same family as Diane's engine:

- **Structured extraction**: a photo is read by a model that sees images; a
  file is mapped by the AI from a few rows and then read row by row by code.
- **Validation and flagging**: code checks every expense, every column:
  missing group, person, date, amount or currency, a doubtful read, or a
  likely duplicate of an expense already saved.
- **Slot filling**: only the missing pieces are asked for, all at once, and a
  reply like "1 and 3 are MANBAT, spent by Gloria" fills them.
- **Human in the loop**: nothing is saved until they confirm.

---

## Plan (to be checked before building)

1. **Expense brain (CRM)**
   - Read text, receipt photos, Excel, CSV, Word and PDF into expense rows.
   - Flag every column: missing group, person, date, amount, currency; a
     duplicate of an existing expense; a doubtful read.
   - A clean numbered summary, plus extra notes ("3 are missing a group").
   - Fixes by reply ("2 and 4 are INDIGO, spent by Gloria"), saved on "yes",
     one undo.
2. **Security**: a list of registered admin numbers. Only those can send
   expenses; everyone else is refused and the attempt is logged.
3. **WhatBot connection**: expense messages from registered numbers go to the
   CRM brain; the summary, flags and questions come back as WhatsApp bubbles;
   saved on "yes".
4. **Payday check**: install WhatBot's packages, run its tests, dry run it
   against the clone, then one real send with `--only` the admin's own number,
   and confirm the paid tick lands on the master sheet. See "Testing the
   payday check" above for the options and the one rule (never a real send
   without `--only`).
5. **Later**: Diane's Expenses context uses the same brain.

## Open questions

1. Registered numbers: managed on the CRM Settings page, or a fixed list in
   WhatBot's config for now?
2. Default currency when a receipt does not say: AED?
3. Required to save an expense: date, description, amount, currency, group,
   spent by? Payee optional?
4. Payday testing: option A, B or C (see "Testing the payday check"). For B,
   which number is the admin's own?
