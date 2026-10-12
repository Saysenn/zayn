# Flow

How one message becomes one reply.

```
user → WhatsApp → worker socket → queue
     → OpenAI picks a tool, e.g. get_my_breakdown({})
     → backend runs it: scope check, filter, format the figures
     → OpenAI gets only a summary ("returned 1 of 12 people"), writes one sentence
     → backend appends the formatted figures under it → user
```

**The model decides what to ask; the code decides what is true.** It never sees a figure,
so it cannot misreport one. `agent/blockFakeNumbers.js` strips any figure it types anyway.

## Files, in order

| Step                                    | File                                |
| --------------------------------------- | ----------------------------------- |
| Socket receives it                      | `whatsapp/connection.js`            |
| Queued, deduped by message ID           | `whatsapp/receiveMessage.js`        |
| Job picked up                           | `worker.js`                         |
| Opt-out → rate limit → identity → scope | `conversation/handleMessage.js`     |
| Tool loop, both OpenAI calls            | `agent/askModel.js`                 |
| Arguments validated, audit written      | `agent/toolRunner.js`               |
| The tool runs                           | `tools/my*.js`                      |
| Who you may read                        | `employee/access.js`                |
| Every figure built                      | `tools/format/`                     |
| Reply out, split if long                | `whatsapp/sendMessage.js`           |

## Layout

Calls go one way, down this list. `worker.js` is the only file that wires things together.

| Folder          | Answers                                                         |
| --------------- | --------------------------------------------------------------- |
| `whatsapp/`     | Did it arrive? Sockets in, text and files out                   |
| `conversation/` | Can code answer without the model? Greetings, noes, policy      |
| `agent/`        | Which tool? Nothing else                                        |
| `tools/`        | Where do figures come from? Scoped by `employee/access.js`      |
| `tools/format/` | Who writes what the user reads? Always code                     |
| `system/`       | redis, queue, rate limit, opt-out, audit, logger                |

## Running alongside

- Every `MASTER_SHEET_PULL_MINUTES` (5): `sheet/pullMasterSheet.js` loads the CRM roster
  into Redis. The chat path only reads that copy.
- Monthly: `payday/runPaydayCheck.js` schedules one delayed job per person, paced per
  number. See [payday-check.md](payday-check.md).

## Side paths (off by default)

- **Voice note** (`FEATURE_VOICE`): `voiceNote` downloads it on the socket side →
  `fromVoice` / `transcribe` (after the dedupe, so a redelivery is not billed twice) →
  an ordinary typed question from there.
- **File** (`FEATURE_DOCUMENTS`): the model picks `get_my_breakdown_file`, the CSV is
  built in `format/csv.js`, and the worker sends the text first, then the document.

`npm run chat` and `npm run payday` use the same `handleMessage`, minus WhatsApp.
