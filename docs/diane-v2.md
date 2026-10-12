# Diane v2

Built **beside** v1 and scored on the same cases before anything moves. Never delete v1 until the owner says so.

## Why

1. v1 runs on `gpt-4.1` on the Chat Completions API; v2 uses the **Responses API** and a current model.
2. v1 shows the model 46 tools and about 28k tokens of rules every turn.
3. v1 is patched, not designed: about 5,400 lines in `runAgent.js` and 8,000 in the tools, mostly regex guards.
4. v1 makes several model calls a turn (router, read router, main loop).

## What v2 is

| Part       | File                            | What it does                                                               |
|------------|---------------------------------|----------------------------------------------------------------------------|
| The turn   | `crm/api/v1/agent/v2/index.js`  | Responses API, up to 4 rounds, box replies read in code                    |
| The tools  | `crm/api/v1/agent/v2/tools.js`  | v1's 16 read tools as they are, plus `change`, `undo`, `export`, `explain` |
| The prompt | `crm/api/v1/agent/v2/prompt.js` | Short rules, plus the sheet's names                                        |
| The box    | `crm/api/v1/agent/v2/box.js`    | One preview, one yes, one batch, undo some, retry failed                   |

- **v1's handlers are the data layer.** Every figure is computed by the tools; every write goes through `change` into
  one preview.
- **The box.** Changes are applied only on "yes", in order, as one batch in History. Replies read in code: yes,
  cancel, "skip 2", "undo 2 and 5", "retry". Session only, closes after 30 minutes idle, summarises over 50 rows,
  refuses over 500.
- `crm/api/v1` is the API's version; v2 is only the assistant, so it lives at `crm/api/v1/agent/v2/`.

## Switches (`crm/api/.env`)

| Variable          | Default        | What                                                    |
|-------------------|----------------|---------------------------------------------------------|
| `DIANE_V2`        | off            | `1` runs v2 instead of v1                               |
| `DIANE_V2_MODEL`  | `gpt-5.4`      | `auto` starts on the light model and moves up when hard |
| `DIANE_V2_EFFORT` | `low`          | Reasoning effort                                        |
| `DIANE_V2_LIGHT`  | `gpt-5.4-mini` | Light model for `auto`                                  |
| `DIANE_V2_FULL`   | `gpt-5.4`      | Full model for `auto`                                   |

## Plan

1. Score v1 (main set and library).
2. Pick the model: library cases on two or three current models.
3. Score v2 on the same cases: `compare.mjs library library-v2-<model>`.
4. If v2 wins, move one capability at a time with the library as the safety net, then retire v1's routers and guards.
5. Same for the **expense brain** (`crm/api/v1/expenses/bot`) and **whatbot's payments agent** (`whatbot/src/agent`),
   each on its own harness.
