# whatbot

WhatsApp AI assistant. Express + JavaScript (ESM), modular monolith, two processes (`server.js`, `worker.js`).

Act as a senior engineer. **Ask if unsure, or if you have a better suggestion — before writing code.**

Answer questions short, direct, and easy to understand. Answer exactly what was asked — skip
the surrounding explanation unless it's asked for.

## Structure

```
src/
  server.ts worker.ts chat.ts payday.ts   the things you run

  http/           app · health · errors — what the web process serves
  whatsapp/       connection (the 5 linked-device sockets) · receiveMessage
                  sendMessage · sendDocument · voiceNote (spot it, fetch it)
                  status · text/ message-body helpers
  conversation/   handleMessage (the orchestrator) · memory
                  answered in code, before the model: greeting · banter
                  blockBypass · about (who we are, what we hold) · escalate
                  (needs a person) · outOfScope (the honest noes) · scripted
                  fromVoice (a voice note becomes a question, or an honest no)
  agent/          askModel · toolRunner · prompt · transcribe · blockFakeNumbers
                  offlineMode
  tools/          one file per tool at the root, auto-registered by index.ts —
                  export a defineTool() and it is live, no list to join
                  shared/ the contract + common arguments · format/ builds every figure
                  and every file
  expenses/       expenses — the guard (registered admins, from the CRM), receipt
                  media, and one message to the CRM's expense brain. The brain is the CRM's
                  mode — an admin's "expense" / "payments" switch
  employee/       access · storage · types — assignments, and who may read them
  sheet/          syncSheet · parseSheet · fakes/ (sample data only)
                  source is excel (local .xlsx), sheets, or fake — all read-only
  system/         redis · queue · jobId · audit · rateLimit · optOut · logger · banner · sheets
  config/         one file per concern. Only place reading process.env
```

One file, one job. If a file needs "and" to describe it, split it.
Feature folders own their own scheduled work; worker.ts just wires it up.
Entrypoints live at the root — if a person or a schedule runs it, it goes there.

Dependencies flow one way: `channels → agent → tools → modules → infra`. Never backwards.

Only repos touch the database.

## Rules

- Plain JavaScript, ESM. No TypeScript, no build step — `src/` is what runs
- Validate at edges only (env, sheet rows, LLM output) with Zod. This is the
  only checking there is now, so an edge without a schema is an edge with nothing
- The unit is an ASSIGNMENT: person × role × company × group. Not a person, not an employee.
  One person holds many, across several companies and often several groups
- **The roster comes from the CRM and nowhere else.** `worker.js` pulls
  `/api/v1/agent/master-sheet` every `MASTER_SHEET_PULL_MINUTES` and never pushes.
  The CRM owns the deals: a human uploads the messy sheet there and cleans it up there.
  `CRM_API_URL` and `CRM_AGENT_API_KEY` are required, because answering a real person
  from a stale Redis roster is worse than refusing to start.
  `syncSheet()` still loads a local xlsx, but only for the offline entry points
  (`chat.js`, `payday.js`, `smoke.js`, evals). It is not scheduled. Never add a second
  writer to the roster keys: two sources meant whichever ran last silently won
- Tools never take an identity param, and never take a group — both come from verified context
- Identity = verified WhatsApp sender number → `personId`. Never a typed name, never a shared PIN
- `personId` comes from the sheet's `Employee ID` when present, else from the name.
  The name fallback merges two humans who share one — parseSheet flags that when their
  phones differ. Drop the fallback once every row carries an ID
- Group = which of our numbers received it, mapped in `config/numbers.ts`. Scope every read by it.
  Someone in two groups holds two separate threads and neither may show the other's companies
- WhatsApp is Baileys — 5 ordinary accounts, laptop linked as a device. No Meta, no Twilio.
  Sockets live in `worker.ts` only; two processes holding them would fight over the account
- `auth_info/` is a live credential. Never commit it, never log it
- Name files for what they do, in plain words. `access.ts`, not `employee.service.ts`
- Lookup must return exactly one person, or refuse. Never guess
- People see their own assignments and nobody else's. The reporting tree is gone —
  the sheet has no `reports_to`
- Never dedupe assignments by person+company+role. The same person legitimately holds
  the same role on the same company twice with different payable days — both are real pay
- Payable = monthly × payable_days ÷ 31. 0 days means nothing owed this month, NOT inactive
- A group with no number in `WHATSAPP_NUMBERS` is never messaged. That is how Takeoff
  stays out, with no special case
- Figures are formatted in code and appended below the model's prose. The model
  writes the sentence, never a number
- Attachments follow the same rule as figures: built in code, never seen by the model,
  and only ever on an explicit request. ONE EXCEPTION, his call 2026-10-07: the expense
  bot's previews and "saved" notes go as a picture (FEATURE_EXPENSE_IMAGES) with the
  reply line in the caption; a receipt an admin asks for ("show me the receipt for 4")
  goes back as the picture or file it was sent as. A file persists on the device and in its
  backups long after a message would have been scrolled past — never attach one to
  anything unprompted. Text goes first, the file second, so a document never arrives
  ahead of the sentence explaining it
- We listen but never speak. Voice notes in are transcribed and answered in text;
  a reply is never audio, because a spoken figure cannot be re-read or checked
- A feature that can be switched off gets a flag in `config/features.ts` and
  `requires: '<name>'` on its tools. Off must mean the model never learns it exists —
  a tool it knows about gets offered in prose, and then we have promised what we do
  not do. Never gate only at the send site. `FEATURE_DOCUMENTS` is the worked example
- Dates are formatted in code too, same reason. Report what the sheet holds, say
  "no end date recorded" when it holds nothing, and never call an end date settled
- Policy answers — what we hold, who can see it, what we cannot do — are written
  in `conversation/`, not left to the model. Same question, same answer, every time
- Never hand out a phone number or an email for a human. We do not have one to give.
  An escalation records the message and says so, and promises nothing else
- Inbound: enqueue, return. Slow work goes to the worker — never block the socket
- Every Redis call on a request path wrapped in `withRedisTimeout` — ioredis hangs
  instead of failing when Redis is down
- Idempotency: `jobId` = WhatsApp message ID. Baileys redelivers on reconnect — a redelivery
  must never double-reply or double-charge OpenAI. Any new side effect (send, write, charge)
  needs a dedupe key before it ships
- Build every `jobId` with `system/jobId.ts`. BullMQ rejects a custom ID containing `:`,
  and a dry run never reaches the enqueue that would tell you
- Never message someone who did not message us first, except the paced payday check.
  Unprompted bulk sending is what gets these accounts banned
- No `console.log`, no `any`, no `utils/` junk drawer — name a folder for what it holds
- No secrets in logs — add sensitive fields to `redact` in `config/logger.ts`
- New env var → add to `config/env.ts` *and* `.env.example`
- `npm test` passes before done

## Document

- Architecture or folder change → update this file in the same change
- New or changed behaviour → update `docs/features.md` in the same change
- Setup step or script change → update `README.md`
- Any table in a doc → pad cells so the `|` columns line up in raw text, not just valid markdown
- End each task with: what changed, what was verified, what wasn't

