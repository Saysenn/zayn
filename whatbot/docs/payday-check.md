# The monthly payday check

Once a month, ask every active employee whether their pay arrived, record the answers, and
forward them to the CRM. The only feature that messages people first — a mistake cannot be
recalled. Two guards, both off by default:

```bash
PAYDAY_SCHEDULE=off      # last-friday = schedule it
PAYDAY_DRY_RUN=true      # false = allow real sends
```

## Pacing

Each number sends **one message per `PAYDAY_SEND_GAP_MINUTES` (15)**; numbers run in
parallel. 500 people over 5 numbers ≈ 25 hours. Do not lower it without a reason.
Pacing stops rate detection only — warm-up traffic and managers announcing the check are
what stop people blocking it ([baileys.md](baileys.md)).

## How it runs

```
Every Friday 16:00 UTC — schedule.js skips all but the last Friday of the month
  → runPaydayCheck: active, has a phone, group has a number
  → one DELAYED job per person, spaced per group
  → at send time: opt-out checked, atomic claim, send, record `sent`
```

- Delayed jobs live in Redis, so a run survives a reboot.
- The send worker has `concurrency: 1` and `limiter: { max: 1, duration: gap }` (`worker.js`),
  so a backlog after an outage is still paced.
- A hand run (`npm run payday`) skips the last-Friday rule.
- Do not run a real check from a laptop that may sleep.

| File                          | Does                              |
| ----------------------------- | --------------------------------- |
| `payday/runPaydayCheck.js`    | who, and the delays               |
| `payday/sendPaydayMessage.js` | sends one person's message        |
| `payday/records.js`           | the claim and the record          |
| `payday/paydayMessages.js`    | every word that gets sent         |
| `payday/report.js`            | the HR summary                    |
| `payday/schedule.js`          | the cron and the last-Friday rule |

## The message and answers

The opener names payroll and the group, asks about this month's pay, and offers
`1. Yes` · `2. No` · `3. Only part of it` · `4. STOP`. It carries no figures (tested).

- Only a **bare digit** or bare yes/no is an answer (`paydayAnswer` in
  `conversation/handleMessage.js`). "1 payment is missing" goes to the model. Change the
  options and you must change that parser and its tests.
- **No** → says what method we hold, asks "nothing at all, or wrong amount?". The next
  message is read via `payday:clarify:<group>:<phone>` (3 days): `NOTHING_ARRIVED` is tested
  before `AMOUNT_WRONG` on purpose, so "received nothing" never becomes a partial.
- **Only part of it** → recorded `partial`; whatever they say next becomes the note.
- **No reply in `PAYDAY_RESPONSE_DAYS` (3)** → `no_response`. No chase message.
- **Changing an answer** — with no check open, phrases like "I didn't receive my payment"
  (`REOPEN_INTENT`) bring back a 3-option menu for the month in `payday:last:<group>:<phone>`
  (90 days). The new answer overwrites the record. No STOP option there.

## What the CRM is told

`PATCH /api/v1/agent/payment-status`, one call per assignment in that group. Best-effort;
Redis is the source of truth.

| Outcome        | When                     | Paid toggle | Payment received (deal / person) | Review flag |
| -------------- | ------------------------ | ----------- | -------------------------------- | ----------- |
| `sent`         | message goes out         | untouched   | Awaiting / Awaiting              | no          |
| `confirmed`    | yes                      | ON          | Paid / Paid                      | no          |
| `partial`      | amount was short         | untouched   | Unpaid / Portion                 | yes         |
| `not_received` | no                       | OFF         | Unpaid / Unpaid                  | no          |
| `no_response`  | the 3-day sweep gives up | untouched   | Awaiting / Awaiting              | no          |

- A `partial` waits for an admin to set each deal Paid or Unpaid; that clears the flag.
- A changed answer (e.g. Paid → Unpaid) is flagged for admin review.

## Not sending twice

| Guard                                              | How                                                    |
| -------------------------------------------------- | ------------------------------------------------------ |
| `jobId` = `payday-<period>-<group>-<personId>`     | BullMQ drops duplicates. Built by `system/jobId.js`    |
| `claimSend` — atomic `HSETNX`                      | Redis picks a winner if two race                       |
| `concurrency: 1` on the send worker                | spacing cannot collapse                                |

A failed send hands its claim back so a retry is not skipped.

## Running it by hand

```bash
npm run payday                        # dry run over everyone
npm run payday -- --limit 5           # dry run over five people
npm run payday -- --only +4477...     # just that number
npm run payday -- --period 2026-10    # a specific month
npm run payday -- --send              # real run (needs PAYDAY_DRY_RUN=false)
npm run payday -- --report            # summary; also runs the no_response sweep
```

A real run only **queues**; the worker must stay up until the sends finish.

**Testing a real send** — only to a number you control:

1. `npm run payday -- --only +44…` → want `eligible: 1+`. If no active row has the number,
   it stops and queues nothing.
2. Set `PAYDAY_DRY_RUN=false`, run `npm run dev:worker`, then
   `npm run payday -- --send --only +44…`. The first person per group has no delay.
3. Put `PAYDAY_DRY_RUN=true` back — while `false`, a bare `--send` reaches everybody.

The same person cannot be sent twice in one period (the CLI still prints `scheduled: 1`).
Use another `--period` to resend; only the newest check is answerable.

**Nothing arrived?** Check `payday check sent` in the worker log, the opt-out set in Redis,
the record in `payday:<period>`, and the sending phone's chat list (one tick = WhatsApp-side).
An unknown number messaging a fresh account is the likeliest drop — get them to message first.

## Known gaps

1. The whole roster has never been messaged; only `--only` has run for real.
2. `outcome: sent` means Baileys accepted it, not that the number is on WhatsApp
   (`sock.onWhatsApp(jid)` is not wired in).
3. A roster group missing from `WHATSAPP_NUMBERS` is skipped (logged).
4. The `no_response` sweep only runs with `--report`; nothing schedules it.
5. HR is not paged on a "no".
6. The Redis record keeps only the latest answer; the CRM change log keeps the history.
