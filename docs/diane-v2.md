# Diane v2

Started 2026-10-09. Built **beside** v1 and scored on the same cases before anything moves.

## Why

An honest review on 2026-10-09: running cost is low (cents a question); the problem was v1's design.

1. **An old model.** v1 runs on `gpt-4.1` (April 2025). Newer models refuse tools with reasoning on the Chat
   Completions API v1 is built on, so it could not move up. v2 uses OpenAI's **Responses API** and a current model.
2. **Too many choices.** v1 shows the model 46 tools and about 28k tokens of rules on every turn.
3. **Patches instead of design.** About 5,400 lines in `runAgent.js` and 8,000 in the tools, most of it regex guards
   and forced routes added one misreading at a time. Each patch can break something else.
4. **Several model calls a turn.** A router, a read router, then the main loop.

## What v2 is

| Part        | File                         | What it does                                                        |
|-------------|------------------------------|---------------------------------------------------------------------|
| The turn    | `crm/api/v1/agent/v2/index.js`  | One model call (Responses API), five tools, box replies read in code |
| The tools   | `crm/api/v1/agent/v2/tools.js`  | `read`, `change`, `undo`, `export`, `explain`                       |
| The prompt  | `crm/api/v1/agent/v2/prompt.js` | About 600 words of rules, plus the sheet's names                    |
| The box     | `crm/api/v1/agent/v2/box.js`    | One preview, one yes, one batch, undo some, retry failed            |

- **v1's handlers are the data layer.** Each v2 tool is a typed door onto the v1 tool that already does the work, so
  every figure is still computed in code and every write still previewed by its own tool.
- **The box.** Every change is previewed in one card and applied only on "yes", in order, as one batch in History. The
  reply is read in code: yes, cancel, "skip 2", "undo 2 and 5", "retry". It lives in the conversation (session only),
  closes after 30 minutes idle, summarises over 50 rows and refuses over 500.
- **Switch:** `DIANE_V2=1` on the API. `DIANE_V2_MODEL` (default `gpt-5.4`) and `DIANE_V2_EFFORT` (default `low`).

## Folder

`crm/api/v1` is the **API's** version (`/api/v1/...` routes, repos, pages). Only the assistant changes, so v2 lives at
`crm/api/v1/agent/v2/`, beside v1's agent, not as a new API version.

## Plan

1. Score v1 (main set and library).
2. Pick the model: run library cases on two or three current models.
3. Score v2 on the same cases; compare (`compare.mjs library library-v2-<model>`).
4. If v2 wins, move one capability at a time, the library as the safety net, then retire v1's routers and guards.
5. The same treatment for the **expense brain** (`crm/api/v1/expenses/bot`) and **whatbot's payments agent**
   (`whatbot/src/agent`), each scored on its own harness.
