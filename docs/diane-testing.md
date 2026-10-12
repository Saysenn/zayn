# Testing Diane and the bots

Every test runs on **DEV**, the Supabase copy of LIVE. Nothing here touches LIVE.

## Where tests run

| What                | Where                                                      |
|---------------------|------------------------------------------------------------|
| DEV database        | `TEST_DATABASE_URL` in `crm/api/.env`                      |
| LIVE (read only)    | `LIVE_URL` in `crm/api/.env`, used only to refresh DEV     |
| The guard           | `crm/api/scripts/testDb.js`: refuses LIVE as a test target |
| Refresh DEV by hand | `npm run refresh:dev` (from `crm/api`)                     |

A suite run **empties DEV**, seeds its own fake people, runs, then **puts the LIVE copy back**. One run at a time (an
advisory lock, `holdDevLock`). Do not use the app on DEV while a suite runs.

## Commands (from `crm/api`)

| Command                                                          | What it does                             |
|------------------------------------------------------------------|------------------------------------------|
| `npm test`                                                       | Unit tests (about 2,500), on DEV         |
| `npm run test:diane`                                             | Main set (88 conversations)              |
| `SUITE_SET=library npm run test:diane`                           | The library (about 130 cases)            |
| `SUITE_SET=library SUITE_GROUP=pay npm run test:diane`           | One library group                        |
| `node scripts/dianeSuite/run.mjs REG-0007 PAY-011`               | Chosen cases, by id                      |
| `SUITE_VERBOSE=1 …`                                              | Prints every tool call and result        |
| `SUITE_DIANE=v2 …`                                               | Runs Diane v2 (`v1/agent/v2`)            |
| `npm run test:diane:compare`                                     | This run against the last one            |
| `node scripts/dianeSuite/compare.mjs library library-v2-gpt-5.4` | v1 against v2                            |
| `node scripts/expenseHarness/harness.js`                         | The expense bot (243 real conversations) |
| `npx vitest run` (in `whatbot/`)                                 | whatbot's tests                          |

Other sets: `SUITE_SET=eval|eval2|…|eval6|wander|bulk|messy` (`wander` takes `SUITE_SEED=n`).
`node scripts/dianeSuite/metrics.mjs <log>` gives rounds, tokens and time per turn. Suite runs call the real model and
cost credits.

## Scorecard

Each full run saves `crm/api/scripts/dianeSuite/runs/<time>-<set>.json`:

- pass rate, overall and per group
- failures by step: `tool`, `args`, `records`, `calc`, `answer`, `db`
- calculation accuracy, invented rate (money no tool returned), unsafe rate (a write before the yes)
- per turn: model rounds, tool calls, guard retries, tokens, median and slowest time
- cost, when `SUITE_PRICE_IN_PER_M` / `SUITE_PRICE_OUT_PER_M` are set

## The library (`crm/api/scripts/dianeSuite/library/`)

- One file per group: basic, relational, historical, ambiguous, pay, trust, workflows, actions, adversarial,
  conversation, regression. `data.mjs` holds the people every expected answer comes from.
- A case can expect an `answer` (`{ amount, currency, subject, month }`), tool `args`, `rows` on screen, the reply,
  and the database afterwards.
- **Every bug becomes a case** in `regression.mjs` (`REG-nnnn`), never removed.
- A new set written before any fix is the only honest score; a set already fixed against only shows nothing went
  backwards.

## Nightly loop

`crm/api/scripts/nightly/run.sh` runs everything, compares with the night before and writes `report.md` to
`~/diane-nightly/<date>/` (Windows) or `~/Library/Logs/diane-nightly/` (Mac). In the morning, `claude "/diane-nightly"`
fixes the failures, adds cases and re-runs. See `.claude/skills/diane-nightly/SKILL.md`.
