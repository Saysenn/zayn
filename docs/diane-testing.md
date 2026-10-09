# Testing Diane and the bots

Since 2026-10-08/09. Every test runs on **DEV**, the Supabase copy of LIVE. Nothing here touches LIVE.

## Where tests run

| What                 | Where                                                             |
|----------------------|-------------------------------------------------------------------|
| DEV database         | `TEST_DATABASE_URL` in `crm/api/.env`                             |
| LIVE (read only)     | `LIVE_URL` in `crm/api/.env`, used only to refresh DEV            |
| The guard            | `crm/api/scripts/testDb.js`: refuses LIVE as a test target        |
| Refresh DEV by hand  | `npm run refresh:dev` (from `crm/api`)                            |

A Diane suite run **empties DEV**, fills it with its own fake people, runs, then **puts the LIVE copy back**. Only one run
can hold DEV at a time: a second run waits for the first (an advisory lock on DEV, `holdDevLock`). Do not use the app on
DEV while a suite runs.

## The commands (from `crm/api`)

| Command                                                   | What it does                                        |
|-----------------------------------------------------------|-----------------------------------------------------|
| `npm test`                                                | Unit tests (about 2,500), on DEV                    |
| `npm run test:diane`                                      | Diane's main set (88 conversations)                 |
| `SUITE_SET=library npm run test:diane`                    | The library (about 130 cases, by group)             |
| `SUITE_SET=library SUITE_GROUP=pay npm run test:diane`    | One group of the library                            |
| `node scripts/dianeSuite/run.mjs REG-0007 PAY-011`        | Chosen cases, by id                                 |
| `SUITE_VERBOSE=1 …`                                       | Prints every tool call and result                   |
| `SUITE_DIANE=v2 …`                                        | Runs Diane v2 instead (`v1/agent/v2`)               |
| `npm run test:diane:compare`                              | This run against the last one                       |
| `node scripts/dianeSuite/compare.mjs library library-v2-gpt-5.4` | v1 against v2                                |
| `node scripts/expenseHarness/harness.js`                  | The expense bot (243 real conversations)            |
| `npx vitest run` (in `whatbot/`)                          | whatbot's tests, the payday reply table included    |

Suite runs call the real model, so they cost model credits.

## The scorecard

Every full run of a set saves `crm/api/scripts/dianeSuite/runs/<time>-<set>.json`:

- **pass rate**, overall and per group
- **failures by the step that broke**: `tool` (wrong tool), `args` (wrong person, month, filter), `records` (the tools
  never produced the figure), `calc` (the tools had it, she said another), `answer` (said wrongly), `db` (the database
  ended up wrong)
- **calculation accuracy** (exact figures), **invented rate** (money in her reply no tool returned), **unsafe rate**
  (a write before the yes, in a risky case)
- **per turn**: model rounds, tool calls, guard retries, input and output tokens, median and slowest time
- cost, when `SUITE_PRICE_IN_PER_M` / `SUITE_PRICE_OUT_PER_M` are set

## The library (`crm/api/scripts/dianeSuite/library/`)

One file per group: basic, relational, historical, ambiguous, pay, trust, workflows, actions, adversarial,
conversation, regression. `data.mjs` holds the people every expected answer is worked out from (three Johns, ABC Ltd and
ABC Limited, every pay state, last month's history). A case can expect:

- an exact `answer`: `{ amount, currency, subject, month }`
- the tool's `args`
- what is drawn on screen (`rows`), the reply, and the database afterwards

**Every bug becomes a case**: `regression.mjs`, `REG-nnnn`, never removed, with new wordings around it.

## The nightly loop

`crm/api/scripts/nightly/run.sh` runs everything above, saves every scorecard, compares each with the night before, and
writes `report.md` to `~/diane-nightly/<date>/` (Windows) or `~/Library/Logs/diane-nightly/` (Mac). In the morning,
`claude "/diane-nightly"` works through it: fix the real failures, add the scenario behind every fix plus new wordings,
re-run, compare. See `.claude/skills/diane-nightly/SKILL.md`.
