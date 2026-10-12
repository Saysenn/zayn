# whatbot

WhatsApp assistant for payroll questions. Express + JavaScript (ESM), two processes.

```
user → WhatsApp → linked-device socket (worker) → BullMQ (Redis) → worker → user
```

One ordinary WhatsApp account per group, linked to the machine like WhatsApp Web. No Meta
account, no webhook, no domain. See [docs/baileys.md](docs/baileys.md).

## Run locally

```bash
npm install
cp .env.example .env        # fill in
docker run -d -p 6379:6379 --name whatbot-redis redis:7-alpine

npm run dev                 # terminal 1 — web (/health, /ready)
npm run dev:worker          # terminal 2 — worker: WhatsApp, queues, schedules
```

- First worker run prints a QR per number in `WHATSAPP_NUMBERS`. Scan it: WhatsApp →
  Settings → Linked devices → Link a device. `WHATSAPP_LINK_WITH=code` prints a code instead.
- The session is saved to `auth_info/<group>/`. That folder **is** the link: back it up,
  never commit it. Delete a group's folder to force a fresh link.
- Run **one** worker only. Two would be two devices fighting over the same accounts.

| Script                                | Does                                                         |
| ------------------------------------- | ------------------------------------------------------------ |
| `npm run dev` / `dev:worker`          | watch mode                                                   |
| `npm start` / `start:worker`          | run without watch                                            |
| `npm run chat`                        | terminal chat through the real handler, no WhatsApp          |
| `npm run chat:expenses -- +44… GROUP` | expense bot as an admin; `/file <path> \| caption` sends one |
| `npm run smoke`                       | scripted questions through the real handler                  |
| `npm test`                            | vitest, no API calls                                         |
| `npm run eval`                        | tool-selection evals — **real API, costs money**             |
| `npm run payday`                      | monthly check, dry run by default                            |

## Test in the terminal

```bash
npm run chat                              # lists who is in the sheet
npm run chat -- +447100000910 MILKMAN     # as them, on that group's number
LOG_LEVEL=error npm run smoke             # every scripted case
LOG_LEVEL=error npm run smoke -- boundary # access-boundary cases only
```

- Always pass the group: someone in two groups gets a different, correct answer per number.
- Type `reset` to clear the conversation.
- `LLM_MODE=mock` routes tools by keyword instead of a model (replies start `[mock]`).
  Everything else runs for real. Never in production.

## Endpoints

| Route         | Purpose                                                        |
| ------------- | -------------------------------------------------------------- |
| `GET /health` | Liveness. Never touches Redis                                  |
| `GET /ready`  | 503 if Redis is down **or any number is disconnected**         |

Web runs on `PORT` (3000). The worker runs the CRM admin-reply webhook on `WORKER_PORT` (3002).

## The data

A row is an **assignment**: this person, this role, this company, this group, this amount.
One person can hold many, across groups.

- The worker pulls the roster from the CRM master sheet every `MASTER_SHEET_PULL_MINUTES` (5).
  `CRM_API_URL` and `CRM_AGENT_API_KEY` are required.
- Offline tools (`chat`, `smoke`, `payday`, `eval`) read `DATA_SOURCE`: `fake` (default),
  `excel` (`EXCEL_PATH`, read-only) or `sheets` (Google Sheets).
- Sheet layout rules: [docs/sheet-format.md](docs/sheet-format.md).

## Troubleshooting

| Symptom                        | Cause                                                          |
| ------------------------------ | -------------------------------------------------------------- |
| QR keeps reprinting            | Not scanned yet, or expired — scan again                       |
| "logged out" in logs           | Link removed on the phone. Delete `auth_info/<group>/`, rescan |
| `/ready` shows a group `false` | That phone is off, or the socket has not reconnected           |
| "unmapped number"              | Number missing from `WHATSAPP_NUMBERS`                         |
| Queued, no reply               | Worker not running, or on a different Redis                    |
| "I can't find your number"     | Number not in the sheet's `Phone` column                       |
| Answers, but nothing listed    | Right person, wrong number — nothing held in that group        |

## Docs

- [docs/setup/](docs/setup/) — install and keep it running
- [docs/running-it.md](docs/running-it.md) — what you need, what kills it
- [docs/keeping-it-awake.md](docs/keeping-it-awake.md) — Mac + VeraCrypt + Parallels + Windows
- [docs/flow.md](docs/flow.md) — how a message becomes a reply, where the code lives
- [docs/how-to.md](docs/how-to.md) — which files to touch for common changes
- [docs/sheet-format.md](docs/sheet-format.md) — what the sheet parser expects
- [docs/baileys.md](docs/baileys.md) — the five phones and their risks
- [docs/payday-check.md](docs/payday-check.md) — the monthly payment check
- [docs/courier-pay.md](docs/courier-pay.md) — not built: open questions
- [docs/five-numbers.md](docs/five-numbers.md) — not built: the official Meta route
- [.claude/CLAUDE.md](.claude/CLAUDE.md) — architecture rules
