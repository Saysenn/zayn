# whatbot

WhatsApp AI assistant for HR/payroll queries. Express + JavaScript (ESM), two processes.

```
user → WhatsApp → linked-device socket (worker) → BullMQ (Redis) → worker → user
```

Five ordinary WhatsApp accounts, one per group. The laptop links to each by QR code, the
same way WhatsApp Web does — no Meta account, no Twilio, no webhook, no domain.
See [docs/baileys.md](docs/baileys.md).

## Run locally

```bash
npm install
cp .env.example .env        # fill in, see below
docker run -d -p 6379:6379 --name whatbot-redis redis:7-alpine

npm run dev                 # terminal 1 — web (health checks only)
npm run dev:worker          # terminal 2 — worker: WhatsApp, queues, schedules
```

On the worker's first run a **QR code prints for each number in `WHATSAPP_NUMBERS`**.
Scan it from that group's phone: WhatsApp → Settings → Linked devices → Link a device.
The session is saved to `auth_info/<group>/` and later runs are silent.

`auth_info/` **is** the link — back it up, never commit it. Delete a group's folder to
force a fresh scan for that number.

| Script | Does |
|---|---|
| `npm run dev` / `dev:worker` | watch mode |
| `npm run chat` | terminal chat — no WhatsApp needed |
| `npm run chat:expenses -- +44… GROUP` | talk to the expense bot as a registered admin; `/file <path> \| caption` sends a receipt or file |
| `npm run smoke` | a scripted set of questions through the real handler |
| `npm test` | vitest (428 tests, no API calls) |
| `npm run eval` | tool-selection evals — **calls the real API, costs money** |
| `npm run build` / `start` | compile to `dist/`, run |
| `npm run payday` | the monthly check. Dry run by default — see [docs/payday-check.md](docs/payday-check.md) |

## Test in the terminal

Chats as anyone in the sheet through the real handler — same identity resolution,
same group scoping, same tools, same state machine. Only the transport differs.
No WhatsApp needed.

```bash
npm run chat                              # lists who is in the sheet
npm run chat -- +447100000910             # as them, on their first group
npm run chat -- +447100000910 MILKMAN     # as them, on a specific number
```

**Pass the group.** Somebody who works across two groups gives two different,
equally correct answers depending on which number they messaged. Testing on one
number only hides the whole boundary.

### If the model is rate-limited

Free tiers run out. Set `LLM_MODE=mock` in `.env` to route tools by keyword
instead of calling a model — identity, scope, tools, formatting, splitting and
the confirmation flow all still run for real. Replies are prefixed `[mock]`.
Only model tool-selection is skipped. Never use it in production.

Try:

| As | Ask | Expect |
|---|---|---|
| anyone | "what am I owed?" | their companies on that number, and the total |
| a mid in two groups | the same question on the other number | a different, equally correct answer |
| anyone | "which company pays me most?" | one company, ranked |
| anyone | "what does <a company in their other group> pay me?" | refusal, pointing at the other number |
| anyone | "what does <someone else> earn?" | refusal |
| anyone | "what did I earn in June?" | refusal — there is no history |

Type `reset` to clear the conversation.

### The scripted version

```bash
LOG_LEVEL=error npm run smoke              # every case
LOG_LEVEL=error npm run smoke -- boundary  # only the access-boundary cases
```

Twelve questions through the real handler, each printed next to what it should
do. Nothing is asserted — a reply from a model is not a value you can compare,
so a person reads it. What *can* be asserted lives in `npm test`.

`LOG_LEVEL=error` matters: debug logging buries the answers.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | Liveness. Never touches Redis |
| `GET /ready` | Readiness. 503 if Redis is down **or any WhatsApp number is disconnected** |

## The data

A row of the master sheet is an **assignment**: this person holds this role on this
company, in this group, for this much. One person holds many, often across two groups —
and then they get two separate conversations, one per number.

```
DATA_SOURCE=excel     # a local .xlsx, read-only
DATA_SOURCE=sheets    # Google Sheets
DATA_SOURCE=fake      # built-in samples, the default
```

See [docs/sheet-format.md](docs/sheet-format.md) for the columns, the layout rules, and
what payroll still needs to add.

## Setup

Installing and running it: **[docs/setup/](docs/setup/)**

## Test with real WhatsApp

1. Redis up, both processes running
2. Scan the QR from the group phone (first run only)
3. `curl localhost:3000/ready` → expect every group `true`
4. Message that number from your own phone
5. Expect a real answer back

Not working? Check in this order:

| Symptom | Cause |
|---|---|
| QR keeps reprinting | Not scanned yet, or the link expired — scan again |
| "logged out" in logs | Link removed on the phone. Delete `auth_info/<group>/`, rescan |
| `/ready` shows a group `false` | That phone is off, or the socket has not reconnected |
| "unmapped number" | Number missing from `WHATSAPP_NUMBERS` |
| Queued, no reply | Worker not running, or pointing at a different Redis |
| "I can't find your number" | That number is not in the sheet's `Phone` column |
| Answers, but nothing listed | Right person, wrong number — they hold nothing in that group |
| Nothing at all | Worker not running — it owns the sockets, not the web process |

## Deploy

One machine, both processes under pm2. There is no inbound port, so no tunnel and no
domain — see [docs/setup/](docs/setup/).

Only ever run **one** worker. It holds the five WhatsApp sessions, and a second instance
would give WhatsApp two devices fighting over the same account.

## Docs

- [docs/plan.md](docs/plan.md) — where this is going, and what is still open
- [docs/running-it.md](docs/running-it.md) — the short version: what you need, what kills it
- [docs/keeping-it-awake.md](docs/keeping-it-awake.md) — sleep, lids and dismounts: the four layers that stop replies
- [docs/flow.md](docs/flow.md) — how one message becomes one reply
- [docs/features.md](docs/features.md) — what it does, the rules, the limits
- [test.md](test.md) — the manual test run-through
- [docs/setup/](docs/setup/) — installing and running it: redis, pm2, backups, phones
- [docs/sheet-format.md](docs/sheet-format.md) — **what to ask payroll to change**, and the format the parser expects
- [docs/how-to-columns.md](docs/how-to-columns.md) — when payroll renames or adds a column: which files, which lines
- [docs/baileys.md](docs/baileys.md) — WhatsApp without Meta or Twilio: 5 phones, 5 accounts, £0/mo
- [docs/five-numbers.md](docs/five-numbers.md) — the official Meta route we did **not** take, and what it would cost
- [docs/edits.md](docs/edits.md) — planned write-back: responses and HR payroll edits
- [docs/payday-check.md](docs/payday-check.md) — the monthly payment check
- [docs/courier-pay.md](docs/courier-pay.md) — planned cash-delivery pay, and the open questions
- [.claude/CLAUDE.md](.claude/CLAUDE.md) — architecture rules
