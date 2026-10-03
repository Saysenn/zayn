# Plan

Where this is going. Parts of this are now built — the local `.xlsx` reader and the
payday check among them. Treat it as direction, not as a to-do list.

---

## Target setup

```
Dedicated laptop
  ├── payroll.xlsx            local file, HR keeps editing it
  ├── Docker: Postgres        the data, queryable, with history
  ├── Docker: Redis           queue, sessions, rate limits
  ├── Node app (pm2)          agent + worker
  └── 5 WhatsApp sockets      linked devices, one per group
```

Data never leaves the laptop. Only a name, a role, group names and the question go to the
model — never a figure, never another person's name.

---

## What is local, what is not

**Local, on the company laptop, always:**

- The payroll file, or Postgres after migration
- Redis, the audit log, opt-outs, conversation memory
- The code, and its git history — a bare repo on an external drive, not GitHub
- Backups — `pg_dump` to an external drive or NAS

**Three cloud services, and nothing else:**

| Service | What it receives |
|---|---|
| **OpenAI / LLM** | Caller's name, code, role, the group names they manage, their question, and a summary like "returned 3 of 12 people". **Never a figure. Never another person's name.** |
| **Meta WhatsApp** | The full message, both directions — **including the payslip we send back** |
| **Google Maps** | Postcodes, when courier pay is built |

### The one worth raising with the boss

**Meta sees the payslips.** Not because of how we built it — because WhatsApp is the
transport. Anything sent to an employee passes through Meta's servers. Cloud API messages are
not end-to-end encrypted the way person-to-person WhatsApp is; Meta processes them.

That is true of every WhatsApp solution, official or not. If payroll figures must never touch
a third party, WhatsApp is the wrong channel — not the wrong implementation.

**Google Maps gets postcodes**, which are personal data. Only when courier pay is built, and
only postcodes — no names attached.

### Version control without GitHub

Git is local. A bare repo on an external drive gives full history and a real backup with
nothing leaving the building:

```
git init --bare /Volumes/backup/whatbot.git      once
git remote add origin /Volumes/backup/whatbot.git
git push                                          after each change
```

⚠️ The code is currently on `github.com/Saysenn/whatbot`. It holds no real payroll and no
credentials, but that repo should be made private or deleted before the real file is ever used.

---

## Decisions made

| | |
|---|---|
| Database | **Postgres**, local, in Docker. Not XAMPP/MySQL — `pg` code already exists |
| Redis | Stays. Queue, conversation memory, rate limits, opt-out |
| Source of truth | **The spreadsheet.** Syncs into Postgres. HR's workflow unchanged |
| WhatsApp | **Baileys** — 5 ordinary accounts, laptop linked as a device. No Meta, no Twilio, £0/mo. Ban risk is real and managed by pacing ([baileys.md](baileys.md)) |
| GUI | pgAdmin, installed natively |
| Backups | Nightly `pg_dump`, 30-day retention — `scripts/backup.sh` |

---

## Still open

- **Is the laptop acceptable as a single point of failure** for 1,128 people? If not, this
  all runs on Render with Supabase instead — same code, different env vars.
- **What does the real sheet look like?** Scattered tables across tabs may be a day's work or
  a fortnight. Nobody knows until we see one.
- **`period` column** — needed for history, and it is what makes Postgres worth doing.
- The six courier-pay questions in [courier-pay.md](courier-pay.md).

---

## Order of work

**1. Local Excel reader** — half a day
Replace the Google Sheets source with a local `.xlsx` read, watched for changes. Simpler than
what exists now: no service account, no quota, no network in the sync path.

**2. Postgres** — one day
Schema from [sheet-format.md](sheet-format.md), `eid + period` as the key. Rewrite
`employee/storage.ts`; point `syncSheet.ts` at Postgres; set `AUDIT_STORE=postgres`.
Nothing above the storage layer changes.

**3. Meta Cloud API** — half a day
Done — `whatsapp/connection.ts` holds the sockets. Different
signature check, different send payload, nothing else moves.

**4. Laptop as a server** — half a day
Docker Compose up, pm2 for both processes, disable sleep, heartbeat to an
uptime monitor.

**5. Real data**
Point it at the actual payroll file. Expect this to be where the real work appears.

---

## Also planned

- **Write-back** — employee responses, and HR editing pay by chat. See [edits.md](edits.md).
  Write-back only works properly against Postgres — a spreadsheet somebody has open
  cannot be written to safely.

## Not in scope yet

- Payday check — built, switched off, waiting on a Meta template
- Courier delivery pay — blocked on six questions
- Policy documents (RAG) — no documents to search yet
- Admin dashboard

---

## The rule that keeps this cheap

Everything above the storage layer stays untouched by all of it. The agent, tools, formatting,
scope resolution and guards do not care whether the data came from Redis, Postgres, a
spreadsheet or Google. That is why each step above is measured in days rather than weeks.
