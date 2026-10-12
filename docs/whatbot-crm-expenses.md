# WhatBot ↔ CRM: payday check and expenses

How WhatBot talks to the CRM, the month end payday check, and expenses sent
by WhatsApp. The Expenses page itself: `expense.md`.

## WhatBot basics

- Code in `whatbot/`. Baileys (linked WhatsApp accounts), Express,
  BullMQ/Redis, `openai` SDK. Two processes: `src/server.js` and
  `src/worker.js` (holds the WhatsApp socket).
- **Bot → CRM**: `whatbot/src/system/crmClient.js`, header `x-api-key` =
  `CRM_AGENT_API_KEY`, which must equal the CRM's `AGENT_API_KEY`. Routes in
  `crm/api/v1/agent.js` (`/api/v1/agent/...`): `GET /master-sheet`,
  `POST /concerns`, `POST /messages`, `POST /logs`, `PATCH /payment-status`,
  `GET /handlers/:personId`, `GET /companies/:name`,
  `POST /sync/master-sheet`.
- **CRM → bot**: `crm/api/v1/messages.js` posts to
  `${WHATBOT_WEBHOOK_URL}/webhook/admin-reply` (`x-webhook-key`), received
  in `whatbot/src/http/adminReplyApp.js`.
- **Who can message it**: `employee/access.js` (`identify`) needs the sender
  in the roster synced from the CRM with an active assignment; anyone else
  gets `UNKNOWN_SENDER`. `WHATSAPP_NUMBERS` maps the bot's own numbers to
  groups (`config/numbers.js`); it is not an allow-list.
- **Redis** (local): one container, data on disk:

  ```bash
  docker run -d --name whatbot-redis --restart unless-stopped -p 6390:6379 -v whatbot-redis-data:/data redis:7-alpine redis-server --appendonly yes
  ```

  Then `REDIS_URL=redis://127.0.0.1:6390` in `whatbot/.env`.
- Link another group's number: add it to `WHATSAPP_NUMBERS`;
  `WHATSAPP_LINK_WITH=code` prints a code to type on the phone.

## Payday check

- `whatbot/src/payday/*`, run with `npm run payday`, scheduled by
  `PAYDAY_SCHEDULE`. **`PAYDAY_DRY_RUN=true` by default** (logs who would be
  asked, sends nothing).
- Asks "Did you receive your <month> pay for your <group> companies?":
  1 yes, 2 no, 3 only part, 4 stop. Replies are read by `paydayAnswer` in
  `conversation/handleMessage.js`, scoped to the group's number.
- Outcomes: `confirmed`, `partial`, `not_received`, and `no_response` after
  `PAYDAY_RESPONSE_DAYS`. Sent through `crmOutbox.js` (retries).
- CRM side (`PATCH /payment-status`, `PAID_BY_OUTCOME`): writes
  `payment_outcome`, `payment_note`, `payment_replied_at`, shown as
  **Payment received**. `confirmed` sets `override_paid = true`,
  `not_received` sets it false; others leave Paid alone.
- `partial`, or an answer changed to a different one, sets `needs_review`
  ("payday…", `shared/paydayFlag.helper.js`). Only setting Payment received
  to Paid or Unpaid clears it.
- Settings flag `whatbot_writes_enabled` blocks all of these writes.

**Testing it**

- Tests: `npm test` in `whatbot/` (vitest): `src/payday/payday.test.js`,
  `schedule.test.js`, `crmOutbox.test.js`.
- Dry run needs WhatBot's Redis, `CRM_API_URL` pointing at the CRM under
  test, and a matching `CRM_AGENT_API_KEY`.
- A real send needs `PAYDAY_DRY_RUN=false`, which unlocks the whole roster.
  **Always add `--only <number>`** (a number with no match messages nobody).
  `--limit 1` alone is not safe: it picks whoever sorts first.

## Expenses through WhatBot and Diane

One brain in the CRM; WhatBot only receives, forwards and relays.

| Piece              | Where                                                                   |
| ------------------ | ----------------------------------------------------------------------- |
| Expense brain      | `crm/api/v1/expenses/bot/` (`brain.js` runs a turn)                     |
| WhatBot routes     | `crm/api/v1/expenseBot.js`, mounted at `/api/v1/agent/expenses`         |
| Diane's context    | same brain, `crm/api/v1/expenseBot.js` (`dianeTurn`)                    |
| Registered admins  | Settings → Whatbot → Expense admins                                     |
| Tables             | migration `072_expense_bot.sql` (incl. `tb_expense_actions`)            |
| WhatBot side       | `whatbot/src/expenses/` (`expenses.js`, `mode.js`, `batch.js`)          |
| Rates to AED       | `crm/api/v1/expenses/bot/rates.js`                                      |
| Preview picture    | `crm/api/v1/expenses/bot/card.js`, `whatbot/src/whatsapp/sendImage.js`  |
| Terminal tester    | `npm run chat:expenses -- +447700900001 MANBAT` (in `whatbot/`)         |

**Switches** (`crm/api/.env` unless noted)

- `EXPENSE_AGENT=on`: the gpt-4.1 tool-loop agent (`bot/agent.js`). Off uses
  the older reader, which is kept.
- `EXPENSE_PLANNER` (on unless `off`).
- `OPENEXCHANGERATES_APP_ID`: hourly rates; open.er-api.com is the free
  backup; otherwise the admin is asked.
- `FEATURE_EXPENSE_IMAGES` (WhatBot): previews as a picture card; false sends
  text.

**Rules**

1. A group's number takes expenses only from admins registered on it; the
   expense's group is the number it was sent to. Anyone else gets nothing
   from the expense side (no download, no model call).
2. Required: date, description, amount, currency, group, spent by, paid to.
   Currency defaults to AED; spent by defaults to the sender.
3. Nothing is saved before "yes". Change, remove and undo preview first.
4. Replies are built by code from templates (WhatsApp *bold*/_italic_), never
   by the model, ending **yes · modify · cancel**.
5. Their own rate wins ("1 gbp to aed is 4.85", "same as last time").
6. Files sent together are collected after 6 seconds of quiet, up to 20, and
   answered once (photos read six per model call).
7. Names match ones already used ("me" is the sender).
8. Admin modes: *expense* (default) or *payments* (WhatBot's normal agent),
   remembered per admin per number (`whatbot/src/expenses/mode.js`). A photo
   or file always goes to expenses.

**Flow**

1. Guard: registered on this number? Runs before WhatBot's opt-out words.
2. Code first: "yes", "cancel", "skip 2", "2 is 150", "undo", plain new
   expenses ("taxi 45 paid to Careem").
3. Router (gpt-4.1-mini) for the rest; reading (gpt-4.1) for text, photos,
   PDFs; spreadsheets mapped from a sample, then every row read by code.
4. Code checks every expense: missing fields (asked together), future or
   over two months old, large amount, already saved, duplicates.
5. Save is verified by reading back; every action goes to
   `tb_expense_actions` so "undo" is exact.

**Safety**: "yes" saves only if that preview was the last thing shown; a
change is refused if the expense moved since; unsaved previews expire after
6 hours; a redelivered WhatsApp message never saves twice; an unreachable
CRM always says nothing was saved.

**Known**: the CRM's `TIMEZONE` is `America/Los_Angeles`, so "today" is the
US date (Dubai is up to 12 hours ahead).
