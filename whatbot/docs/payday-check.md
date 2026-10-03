# The monthly payday check

Once a month, ask every active employee whether their pay arrived. Record the answers.
"1,043 confirmed, 12 problems, 72 no response" is what payroll wants, and it is evidence
that everyone was asked.

**Built, switched off.** Two independent guards, both off by default:

```bash
PAYDAY_SCHEDULE=off      # off = no schedule at all
PAYDAY_DRY_RUN=true      # true = nothing is queued
```

This is the only feature that can message the whole company, and a mistake is not
recallable.

---

## Why it is paced

The bot messaging people who did not message it first is the one thing here that risks a
ban. These are ordinary WhatsApp accounts ([baileys.md](baileys.md)), not an official API
with a paid allowance for unprompted messages.

So each number sends **one message every 15 minutes**, and the five numbers run in parallel:

| Employees | Per number | Finishes in |
|---|---|---|
| 500 | 100 | ~25 hours |
| 1,128 | 226 | ~56 hours |

`PAYDAY_SEND_GAP_MINUTES` controls it. Do not lower it without a reason.

Pace protects against rate detection. It does **not** protect against people blocking or
reporting a bot that messaged them out of nowhere — and blocks are the bigger cause of bans.
Two things do that work, and neither is code:

1. **Let the numbers carry real traffic first.** A month of employees asking questions
   before the first bulk send.
2. **Have managers announce it** in the group chats people already use. Nobody reports a
   message they were told to expect.

---

## How it runs

```
Last Friday of the month, 16:00 UTC
  ↓  runPaydayCheck: who is active, has a phone, and whose group has a number
  ↓  enqueue one DELAYED job per person, spaced per group
payday-send queue
  ↓  each job fires at its own time, over the next ~24h
  ↓  opt-out checked HERE, not at scheduling — people opt out mid-run
  ↓  atomic claim, then send
record: sent
```

Scheduling and sending are separate on purpose. A single job that looped and slept would
hold a BullMQ lock for a day and lose its place on any restart. Delayed jobs live in Redis,
so the run survives a reboot and each person is independently retryable.

**Surviving an outage keeps the pace, not just the queue.** If the laptop or the internet
drops mid-run, every job whose delay elapses while nobody is watching is sitting "due" the
moment the worker reconnects. `concurrency: 1` on its own would still fire that backlog back
to back — a burst with no 15-minute gap, exactly what pacing exists to prevent. The send
worker also carries `limiter: { max: 1, duration: PAYDAY_SEND_GAP_MINUTES }` (`worker.js`),
which re-enforces the gap by wall clock regardless of backlog, so a catch-up after an outage
paces out the same as an uninterrupted run.

### Why the last Friday, and why the afternoon

Payday is the last Friday of the month, so that is when the question is worth asking. Cron
cannot express "last Friday" — there is no day-of-month that means it — so the schedule fires
**every Friday at 16:00 UTC** and `payday/schedule.ts` drops the ones that are not the last of
the month. `isLastFridayOfMonth` is a pure function with tests over five-Friday months, leap
Februaries and a year roll.

16:00, not 09:00. The money lands that day: asking at nine in the morning collects "not yet"
from everybody whose bank clears in the afternoon, and every one of those is recorded as a
payroll problem and put in front of HR. The sends then spread over the following ~24 hours, so
the tail lands Saturday — which is fine. Nobody minds a weekend message about their wages.

A hand run (`npm run payday`) skips this check entirely and works any day, because the reason
for running one by hand is usually that the automatic one did not happen.

| | |
|---|---|
| `payday/runPaydayCheck.ts` | works out who, schedules the delays |
| `payday/sendPaydayMessage.ts` | sends one person's message |
| `payday/records.ts` | the claim and the record |
| `payday/paydayMessages.ts` | every word that gets sent |
| `payday/report.ts` | the summary for HR |
| `payday/schedule.ts` | the cron pattern, and the last-Friday rule |

---

## The opening message

Plain text. There is no template to submit and nothing external vets the wording, which
means this is the only thing standing between us and 1,128 confused people.

> Hi {name}, quick check from payroll.
>
> Did you receive your {month} pay for your {Group} companies?
>
> 1. Yes
> 2. No
> 3. Only part of it
> 4. STOP
>
> Choose 4 to stop receiving these updates.
> You can ask about your breakdown anytime.

**"Only part of it" is its own option.** A short payment is the commonest real problem and
it used to have nowhere to go: people picked No, which reads as "nothing arrived" and files
a payment that actually worked in the same bucket as one that failed. Payroll chases those
two completely differently.

**STOP moved from 3 to 4** when that option was added. The *word* STOP is unaffected and
always has been — `optOut` runs before any of this — so the only person the renumber can
catch is somebody typing the bare digit from memory instead of reading the message in front
of them, and 3 now means "I was paid short", which they can correct by reopening. A stray
3 silently opting somebody out would not have been correctable.

Four things it must keep:

- **Says who it is.** An unexplained message about pay from an unknown number is what gets
  reported.
- **Offers a way out, as an option and not a footnote.** `4` does exactly what typing STOP
  does. Offering an opt-out that only half works is worse than not offering one.
- **Numbers, not a paragraph.** A linked device has no buttons, so the numbers are the
  interface. `paydayAnswer` in `conversation/handleMessage.ts` accepts 1 to 4 — change
  the copy and you must change that, and there are tests on both.
- **Carries no figures.** It goes to a phone the person may not control, unprompted. There
  is a test asserting this.

The group is written as "Milkman", not "MILKMAN". A shouted system code mid-sentence reads
like a mail merge went wrong, on the one message that most needs to read as if a person
sent it.

A bare digit only. "1" is an answer; "1 payment is missing" is a question and goes to the
model — logging that as a confirmation would delete a missing-wages report. Tested.

---

## The replies

**YES →**
> Thanks for confirming. If anything looks wrong later, just message me.

**NO →**
> Sorry to hear that. Our records show your {month} pay was sent by {method}.
>
> Has nothing arrived at all, or has the amount come through wrong?

That question is now actually **listened to**. It was always asked, but the check was
closed by the time the answer arrived, so it reached the model like any other sentence and
nothing recorded it. A `payday:clarify:<group>:<phone>` key (3 days) makes their next
message mean something:

> **"nothing at all"** → stays `not_received`, already recorded when they said no
>
> **"only got half" / "the amount is wrong"** → upgrades the record to `partial`, with
> their words kept as the note

`NOTHING_ARRIVED` is tested **before** `AMOUNT_WRONG`, and that ordering is load-bearing:
"I received nothing, the amount never came" matches both, and reading it as a short payment
would mark somebody who got zero as part paid, which switches their Paid toggle **on** in
the CRM. The expensive mistake only runs one way, so the cautious branch goes first.

Anything that matches neither is a real question: it is answered normally and the follow-up
stays outstanding, because they may still come back to it.

Then, either way:
> I've flagged this with payroll and someone will be in touch. Would you like to see your
> pay breakdown in the meantime?

**ONLY PART OF IT →**
> Understood, so some of it came through but not all. I've flagged the shortfall with
> payroll and someone will be in touch.
>
> If you know how much did arrive, tell me and I'll pass it on.

Whatever they say next becomes the note, through the same clarify key. Payroll's first
question is "how much came through", and it costs the person nothing to answer it now
rather than being asked again by a human tomorrow.

**No reply after 3 days →** no chase message. Record `no_response` and put it on the HR
report. Chasing people about their wages by bot reads badly.

---

## Changing an answer

Somebody confirms on payday, then finds the money never cleared, or was short. Their record
said `confirmed` and the CRM had their Paid toggle switched **on**, and there was no way
back: the check was closed, so anything they said reached the model, which cannot record an
outcome.

Now, with no check open, a message like any of these brings the options back:

> "I didn't receive my payment" · "my payment is incomplete" · "I was underpaid" ·
> "only got half in the end" · "the amount is wrong" · "still waiting for my pay" ·
> "can I change my answer"

> No problem {name}, let's put that right.
>
> For your {month} {Group} pay, which is it now?
>
> 1. Yes, received in full
> 2. No, nothing arrived
> 3. Only part of it
>
> Whichever you pick replaces your earlier answer.

The new answer overwrites the record and is sent to the CRM, which upserts per assignment
per period — so reverting a `confirmed` to `not_received` also switches the Paid toggle back
**off** on both CRM pages.

Notes on the design:

- **No STOP option here.** They came back to fix somebody else's mistake; offering an
  opt-out in that moment is an invitation to leave over it.
- **Which month.** `payday:last:<group>:<phone>` (90 days) remembers what they were last
  asked about, because the current month is the wrong guess for the case that matters
  most — realising on the 2nd that *last* month's money never landed.
- **Only when no check is open**, so it can never cut across an answer they are in the
  middle of giving.
- **Still their message first.** We reply to them; we never reopen a check on our own
  initiative, so the never-message-first rule is intact.
- **`REOPEN_INTENT` is deliberately generous.** A false positive shows a menu nobody
  wanted. A miss is somebody's missing wages going unrecorded.

**Anything else →** answer it normally and leave the check open. Someone asking "how much
was it?" has not confirmed anything.

Bare `yes` / `no` is what most people send and is handled directly. "Yes, received" is
handled too — otherwise the trailing word looks like a separate request.

### The "no" path

Not receiving your pay is urgent, so it must not dead-end in a chatbot:

1. Confirm what we hold — payment method, date processed
2. Offer the breakdown; often the confusion is a deduction, not a missing payment
3. Ask one qualifying question: *"Has nothing arrived, or is the amount wrong?"*
4. **Escalate either way.** The bot is never the last stop on a missing-wages report

---

## What the CRM is told

Every outcome is forwarded to the CRM (`PATCH /api/v1/agent/payment-status`, one call per
assignment the person holds in that group). Redis is still the source of truth: these calls
are best-effort and never awaited into a reply.

| Outcome        | When                          | Paid toggle in the CRM | Indicator |
|----------------|-------------------------------|------------------------|-----------|
| `sent`         | the message goes out          | untouched              | none      |
| `confirmed`    | they answer yes               | ON                     | check     |
| `partial`      | they say the amount was short | ON, it did arrive      | warning   |
| `not_received` | they answer no                | OFF                    | warning   |
| `no_response`  | the 3-day sweep gives up      | untouched              | none      |

`sent` is what makes the CRM's Confirmed column start at "awaiting reply" instead of blank,
so an admin can tell *we asked and they have not answered* from *nobody has asked them*.

The Paid rule is **"did any money arrive"**, not "was it right" — which is why `partial`
counts as paid. `sent` and `no_response` touch nothing: nobody has told us anything, and
defaulting a silent person to unpaid would erase an admin's own record on no evidence.

---

## Not sending twice

Messaging someone about their pay twice cannot be undone, so there are three layers:

| | |
|---|---|
| `jobId` = `payday-<period>-<group>-<personId>` | BullMQ refuses a duplicate outright. Dashes, not colons — BullMQ rejects a colon in a custom ID, which is why the first real send ever attempted threw. Built by `system/jobId.ts` |
| `claimSend` — atomic `HSETNX` | Redis picks a winner if two ever race |
| `concurrency: 1` on the send worker | The spacing cannot collapse |

A failed send hands its claim back, so a retry finds the slot free rather than skipping the
person it was retrying for.

---

## Running it by hand

```bash
npm run payday                        # dry run over everyone
npm run payday -- --limit 5            # dry run over five people
npm run payday -- --only +4477...      # just that one number
npm run payday -- --period 2026-10     # a specific month
npm run payday -- --send               # real run (needs PAYDAY_DRY_RUN=false)
npm run payday -- --report             # this period's summary
```

A real run only **queues**. The worker must stay running for the following day or the
remaining sends never fire.

`--only` takes one phone number and matches it against the sheet. It is how you test a
real send without picking a stranger: `PAYDAY_DRY_RUN=false` unlocks the whole roster,
and `--limit 1` would message whoever happens to sort first. If no active row carries
that number the run stops and queues nothing, rather than reporting a quiet zero.

---

## Testing a real send, end to end

Send to a number you control. Nothing here is recallable.

**1. Check the sheet has that number.** No `--send`, so nothing can go out:

```bash
npm run payday -- --only +351967818386
```

Want `eligible: 1` or more. `eligible: 3` with `no number for group: 2` is normal for
somebody in three groups — only the groups in `WHATSAPP_NUMBERS` can be messaged. If you get
*"No active row on the sheet has the phone…"*, the number is missing or not E.164 in the sheet.

**2. Turn off the dry run.** `PAYDAY_DRY_RUN` defaults to `true` and may not be in `.env`
at all, in which case add it:

```bash
PAYDAY_DRY_RUN=false
```

**3. Worker running, then send:**

```bash
npm run dev:worker                                  # terminal 1 — holds the sockets
npm run payday -- --send --only +351967818386        # terminal 2
```

Expect `SCHEDULED`, `scheduled: 1`, and the message within seconds — the first person in each
group has zero delay.

**4. Put `PAYDAY_DRY_RUN=true` back.** While it is `false`, a bare `--send` reaches everybody.

### Sending to the same person twice

You cannot, within one period. `jobId` is `payday-<period>-<group>-<personId>` and BullMQ
silently discards a repeat — the CLI still prints `scheduled: 1`, because scheduling is what
succeeded. To send again, use a month you have not used:

```bash
npm run payday -- --send --only +351967818386 --period 2026-10
```

The period changes the dedupe key and the month named in the message ("your October pay"), and
nothing else. Only the newest check is answerable: `payday:open:<group>:<phone>` is overwritten
each time, so earlier periods stay open in the records and show as `no_response` in the report.
Fine on a test number, but do not read the report as truth afterwards.

### When nothing arrives

The job completing is not proof of delivery. Work down this list:

| Check | Meaning |
|---|---|
| `payday check sent` in the worker log | it got as far as Baileys |
| `redis-cli smembers optout` (or the equivalent) | they replied STOP, and sends are skipped silently |
| the record in `payday:<period>` | `outcome: sent` means `sendText` did not throw |
| the sending number's own chat list | the message sitting there with one tick is a WhatsApp-side delivery problem |

A freshly linked account messaging a never-contacted number is the likeliest cause of a silent
drop — see [baileys.md](baileys.md). Getting them to message the number first turns it into an
existing conversation, which is the single biggest factor in whether an unprompted message
lands. Note also that `outcome: sent` is recorded on the strength of Baileys not throwing: we
do not yet check the number is on WhatsApp at all.

---

## What is not done

1. **Only ever sent to one test number.** A real send works — several went to a controlled
   number in August 2026 — but the whole roster has never been messaged, and `--only` is the
   only path that has been exercised for real.
2. **A phantom "sent" is possible.** `outcome: sent` means Baileys accepted the message, not
   that the number exists on WhatsApp. A sheet with mistyped numbers would report everybody as
   asked. `sock.onWhatsApp(jid)` would settle it and is not wired in.
3. **The group in the roster must match a group in `WHATSAPP_NUMBERS`**, or everyone in it
   is skipped. Logged loudly, but it is a config gap waiting to happen.
4. **The `no_response` sweep only runs when the report does.** `closeStale` is called by
   `paydaySummary`, which nothing schedules — it runs on `npm run payday -- --report`.
   Until somebody runs that, people who never replied stay `sent`, and the CRM keeps
   showing them as awaiting a reply.
5. **HR is not notified on a "no".** It is recorded, appears in the report and reaches the
   CRM; nobody is paged.
6. **A reopened check is not distinguishable in the record.** The new answer overwrites the
   old one and nothing keeps "they said yes on the 3rd, then no on the 9th". The CRM's
   `master_sheet_field_changes` log catches the outcome changing, but the Redis record does
   not.
