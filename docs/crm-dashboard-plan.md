# CRM integration — plan

> **SUPERSEDED. Kept as a record of the original plan, not as a
> description of the system.**
>
> Most of the schema below no longer exists. The `assignments`,
> `companies`, `payment_status`, `calculator_rows` and
> `calculator_overrides` tables were dropped in migration 022, and
> `master_sheet_rows` was renamed `tb_mastersheet` in 023. There is one
> table now, with People and Companies as views of it, and whatbot pulls
> from the CRM rather than syncing into it.
>
> For what actually exists, read `state.md`. For the settled decisions and
> their reasoning, `.claude/CLAUDE.md`. For the ingestion flow, `flow.md`.
>
> This file is still worth having: it shows what was asked for originally
> and why the shape changed, which is context a schema dump cannot give.

Separate codebase from `whatbot`. This doc covers both sides, kept short.

## Stack

- React (frontend)
- TanStack Query (server state)
- Zustand (UI state)
- Node + Express (backend/API)
- PostgreSQL (database)

## Hosting — its own server, on the internet

- Frontend and backend both hosted on their own server(s) — not bundled into `whatbot`'s
  infrastructure
- Database: Supabase — **database only, not Supabase Auth.** Auth is custom-built, own
  code, own Express routes.
- Auth: real login form + session cookie (`httpOnly`, `secure`, signed), HTTPS enforced,
  rate-limited/lockout on the login endpoint — not HTTP Basic Auth, not enough on its own
  once this is internet-reachable
- Needs proper HTTPS and rate limiting throughout — reachable from the internet, not
  VPN-gated, so this matters more than it would for a local deployment
- **Option: fully local instead.** VPN-only (same access as the Lithuania server), no
  domain, no public exposure, self-hosted Postgres instead of Supabase. More private, more
  ops work (patching, uptime) lands on you instead of a platform. Not the default plan — an
  alternative to come back to if the internet-hosted version turns out to be the wrong call.

## Cloud services (the exceptions to `whatbot`'s own local-first setup)

- OpenAI — GPT-5 mini, the LLM
- Google Maps API — optional, deferred until the agent is answering accurately enough
- Redis — Upstash, already in use, stays cloud
- Supabase — the CRM's database, per the hosting decision above

## CRM roles

- Owns its own pgsql pgadmin database and backend API
- Exposes tools the whatbot agent can call: read company/handler data, update payday
  status and concern descriptions — never the pay data itself
- Receives calls from `whatbot` when an escalation or payday outcome happens
- Sends admin replies to `whatbot` (webhook) for actual WhatsApp delivery

## CRM features

- One shared session login — 1–3 admins, no user management
- Company list, live, one row per **handler on a company** (not per person)
- Flagged queue — escalations + payday outcomes, joined
- Chat-box view per group, per message thread — admin types, clicks send, delivered to
  that person's WhatsApp — text + attachment
- Auto-updating data — `whatbot`'s sync job pushes cleaned xlsx data into the CRM's
  Postgres every 15 min (or on xlsx change)

## Database tables

**The real problem being solved: companies have a lifecycle** — opening, closing, changing
owners — and none of that exists anywhere in the sheet today. `assignments` mirrors what's
already in `test-master.xlsx`; `companies`, `payment_status`, and `concerns` are new.

### `companies` — the actual subject: opens, closes, changes hands

| Column     | Type      | Purpose                                                  |
|------------|-----------|----------------------------------------------------------|
| id         | serial PK | —                                                        |
| name       | text      | matches `company` in `assignments`                       |
| group_name | text      | which group it belongs to                                |
| status     | text      | `active` / `newly_opened` / `closing` / `closed`         |
| opened_on  | date      | when it started                                          |
| closing_on | date      | when closure began or completed                          |
| owner_name | text      | the actual owner — **not** the same as the Director role |
| notes      | text      | free text                                                |
| updated_at | timestamp | —                                                        |

**Director isn't a separate column here** — it's already the `Director` role in
`assignments`. A company's director is `SELECT ... FROM assignments WHERE role='director'
AND company='<name>'`. Owner is different: not every owner holds a paid role, so it needs
its own field.

**`assignments.end_on` is the real signal for `companies.status`/`closing_on`.** The sheet's
"End date" isn't just about one person's role ending — when a company's last active
assignment gets an end date, that's the company closing. `closing_on` should be set from
that, not tracked as an unrelated field.

### `assignments` — who currently handles which company, and for how much

Mirrors the sheet, column-for-column:

| Column           | Type      | From (xlsx column)      |
|------------------|-----------|-------------------------|
| id               | serial PK | —                       |
| employee_id      | text      | Employee ID             |
| role             | text      | Role:                   |
| group_name       | text      | Group                   |
| person_name      | text      | Name of individual:     |
| company          | text      | Company in question:    |
| phone            | text      | Phone                   |
| assigned_on      | date      | Appointment date        |
| payment_start_on | date      | Payment start date:     |
| preset_on        | date      | Preset date:            |
| end_on           | date      | End date                |
| payable_days     | integer   | Payable days this month |
| payment_method   | text      | Method of payment:      |
| monthly_amount   | numeric   | Monthly amount:         |
| payable_amount   | numeric   | Payable amount:         |
| currency         | text      | Currency:               |
| location         | text      | Location:               |
| synced_at        | timestamp | — set on every sync     |

### `payment_status` — payday check outcomes, per handler per month

| Column        | Type             | Purpose                                               |
|---------------|------------------|-------------------------------------------------------|
| id            | serial PK        | —                                                     |
| assignment_id | FK → assignments | which handler-on-company record                       |
| period        | text (YYYY-MM)   | which month                                           |
| outcome       | text             | `sent` / `confirmed` / `not_received` / `no_response` |
| note          | text             | free text from the employee's reply                   |
| replied_at    | timestamp        | —                                                     |

### `concerns` — escalations, flagged for a person to review

| Column     | Type      | Purpose                                                                                         |
|------------|-----------|-------------------------------------------------------------------------------------------------|
| id         | serial PK | —                                                                                               |
| person_id  | text      | who                                                                                             |
| group_name | text      | which group                                                                                     |
| category   | text      | `dispute` / `distress` / `legal` / `wrong-recipient` / `wants-human` / `anger` / `data-request` |
| message    | text      | the raw message                                                                                 |
| status     | text      | `open` / `in_progress` / `resolved`                                                             |
| created_at | timestamp | —                                                                                               |

## Agent roles (`whatbot`)

- Only thing that talks to WhatsApp
- Only thing that reads the xlsx
- Read-only for pay data — never writes companies, assignments, amounts
- Writes bot-side records only — escalation status, payday outcomes, opt-out
- Never adds a new company or handler from a conversation
- New tools call the CRM's API, same `defineTool()` contract as existing tools

## Next: sync automation

- Extend the existing 15-min sync job — don't build a second one
- Same validated data written to Redis and CRM Postgres — one parse, two destinations, so
  they can't drift apart from each other
- Upsert keyed on `assignment_id` (`group|company|role|seat|person|row`, same derivation
  `whatbot` already uses) — required to avoid duplicates on re-sync
- Never hard-delete on a sync — a broken/empty parse must not wipe good data
- Optional faster trigger: watch the xlsx file for changes — keep the 15-min interval as a
  fallback regardless, file-watching on a network drive isn't reliable alone

## Still open

- Webhook vs. queue for the admin-reply handoff
- Generated xlsx — content/trigger
- Every row needs an Employee ID for the sync to match reliably — some don't yet
  (`sheet-format.md` already flagged this)
- **The payment calculator.** Boss will be sending multiple sheets; need to compute monthly
  payments for people and companies from them (not just validate numbers payroll already
  computed, like `whatbot` does today), produce breakdowns for inquiries, and output a
  master xlsx. Not scoped yet — needs: what the incoming sheets actually contain, and
  whether the calculation formula is the same everywhere or varies per company.

## Flow

Two directions, two separate flows — not one pipeline.

**Starting from WhatsApp (employee-initiated):**
Employee messages WhatsApp → `whatbot` answers via its tools → payday reply / escalation
happens → `whatbot` calls the CRM's API to update payday status / concern description →
CRM Postgres updates → CRM UI shows it live to the admin.

**Starting from the CRM (admin-initiated):**
Admin opens the chat box, types a reply, clicks send → CRM calls the webhook → `whatbot`
receives it → sends via WhatsApp → employee receives it.

Sheet sync runs on its own timer, feeding both: xlsx → `whatbot` syncs → CRM Postgres.
