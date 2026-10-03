# Flow

How one message becomes one reply.

```
user
 > whatbot (WhatsApp)
 > backend receives it on an open socket (linked device), queues it
 > backend sends question + tools to OpenAI
 > OpenAI replies "call get_my_breakdown({})"
 > backend runs the tool — scope check, filter, format the figures
 > backend sends only a summary back to OpenAI ("returned 1 of 12 people")
 > OpenAI replies with one sentence, no numbers
 > backend appends the formatted figures under that sentence
 > whatbot
 > user
```

**Two calls to OpenAI.** It never sees the figures — only the summary — which is why it
cannot misreport them.

**No webhook.** The laptop is a linked device on five ordinary WhatsApp accounts, exactly
like WhatsApp Web, so messages arrive over a socket it opened. Nothing has to reach the
laptop from outside — no tunnel, no domain, no signature to verify, and no forged-webhook
problem to guard against.

---

## The same flow, with files

| Step | File |
|---|---|
| Socket receives it | `whatsapp/connection.ts` |
| Queued, deduped by message ID | `whatsapp/receiveMessage.ts` |
| Job picked up | `worker.ts` |
| Opt-out → rate limit → identity → scope | `conversation/handleMessage.ts` |
| Tool loop, both OpenAI calls | `agent/askModel.ts` |
| Arguments validated, audit written | `agent/toolRunner.ts` |
| The tool runs | `tools/myBreakdown.ts` and the six beside it |
| Who you may read | `employee/access.ts` |
| Every figure built | `tools/format/` |
| Reply out, split if long | `whatsapp/sendMessage.ts` |

---

## Who calls whom

Every arrow points one way. Nothing ever calls back up the list, which is the
rule that makes any single file safe to read on its own.

```
worker.ts                    the only file that wires things together
  │
  ├─ whatsapp/       sockets in, text and files out
  │     connection ─ receiveMessage ─ sendMessage ─ sendDocument ─ voiceNote
  │
  ├─ conversation/   can we answer this in code, without the model?
  │     handleMessage ─ greeting ─ banter ─ about ─ outOfScope ─ escalate
  │                  ─ blockBypass ─ memory ─ fromVoice
  │
  ├─ agent/          only if code could not answer it
  │     askModel ─ prompt ─ toolRunner ─ blockFakeNumbers ─ noDashes ─ transcribe
  │
  ├─ tools/          one file per shape of answer
  │     myBreakdown ─ myCompany ─ myTotal ─ myCount ─ myRanking ─ myDates
  │     format/      every figure and every file is written here
  │
  ├─ employee/       access ─ storage ─ types
  │
  └─ system/         redis ─ queue ─ rateLimit ─ optOut ─ audit ─ logger
```

Read it as five questions in order, and most of the codebase falls into place:

1. **Did it arrive?** `whatsapp/`
2. **Can we answer without the model?** `conversation/` — greetings, noes, policy
3. **What is the model for?** `agent/` — picking a tool, and nothing else
4. **Where do figures come from?** `tools/`, scoped by `employee/access.ts`
5. **Who wrote the sentence the user reads?** `tools/format/`, always. Never the model

The one thing worth memorising: **the model decides what to ask, the code decides
what is true.** Every file above is on one side of that line or the other.

---

## What each side decides

**OpenAI decides:** which tool, and what to put in the query — filters, aggregate, sort,
limit, how much detail.

**The backend decides:** whether the query is legal, whose records are in range, what the
figures are, and how they are written.

One line: **the model decides what to ask; the code decides what is true.**

---

## Why the model never sees the figures

After the tool runs, only `summary` goes back:

```
"Returned 1 of 12 people (paid by crypto), view=takehome."
```

Not the names, not the amounts. The formatted block is held in the backend and appended
after the model has finished writing.

It was not always this way. Early on the model received the data, and it wrote out a full
list of salaries above the real one — every figure wrong, every figure plausible. Withholding
them makes that impossible rather than discouraged.

Two guards sit on top:

- `agent/blockFakeNumbers.ts` strips any figure the model types anyway
- Displays are keyed by tool, so calling one twice produces one block, not two

---

## Running alongside

```
every 15 min   sheet > validate > Redis               sheet/syncSheet.ts
monthly        payday check > schedules one delayed   payday/runPaydayCheck.ts
               job per employee, paced per number     payday/sendPaydayMessage.ts
```

The chat path never waits on the sheet. It only ever reads the synced copy.

The payday check schedules; it does not send. Each employee gets a delayed job spaced 15
minutes apart *within their group*, so the five numbers work in parallel and none of them
looks like it is broadcasting.

---

## The two side paths

Both are off by default, and both join the main flow rather than running beside it.

**A voice note** becomes text, then takes the ordinary path from step one:

```
connection ─ voiceNote      spot it, download the audio  (socket side: the
                            decrypt key does not survive the queue)
receiveMessage              audio as base64 onto the job
worker                      BullMQ drops it if this message ID was seen before
fromVoice ─ transcribe      the charge sits BEHIND the dedupe, on purpose
handleMessage               from here it is an ordinary typed question
```

**A file** is the ordinary flow plus one attachment, sent second:

```
askModel                    picks get_my_breakdown_file
access.readable             the caller's rows, this group only
format/csv                  built in code, the model never sees it
worker                      sendText first, then sendDocument
```

Text goes first every time. A document arriving before the sentence explaining it
is a file from a number you were not expecting one from.

---

## The other front doors

Same `conversation/handleMessage.ts`, different transport:

```
npm run chat      terminal, no WhatsApp
npm run payday    the monthly check, dry run by default
```

That is why the CLI proves something — it is the production path, minus WhatsApp.
