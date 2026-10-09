#!/bin/bash
# ***************************************************
# * DIANE AND THE EXPENSE BOT, EVERY NIGHT: run, score, compare
# ***************************************************
# Run at 02:00: by Windows Task Scheduler (scripts/nightly/install-windows.ps1)
# or by launchd on the Mac (~/Library/LaunchAgents/com.sayon.diane-nightly.plist).
#
#   1. Refreshes DEV from live. Live is opened READ ONLY.
#   2. Unit tests (CRM and whatbot), Diane's capability suite in three
#      timezones, every held out wording set, the LIBRARY (every group, every
#      regression), the known bug list, the expense bot's harness, and the
#      DEV sweep (auto off and on).
#   3. Every Diane set and the expense harness save a SCORECARD, compared
#      with the night before: accuracy, invented figures, unsafe actions,
#      rounds, tokens, speed, cost, and which cases newly fail.
#   4. Writes a report: <root>/<date>/report.md, and <root>/latest.md is a
#      copy of the newest. <root> is NIGHTLY_DIR, else ~/Library/Logs/
#      diane-nightly on the Mac, else ~/diane-nightly.
#
# It FINDS. Fixing happens in a session you start in the morning, with the
# report in hand: `claude "/diane-nightly"` from the repo (see
# .claude/skills/diane-nightly). That loop is: fix the real failures, add the
# scenario behind every fix plus new wordings around it, re-run, compare.
#
# Never port 3000, never a write to live. The tests run on DEV, the Supabase
# copy of live (2026-10-08): see scripts/testDb.js.
#
# NIGHTLY SMALL, WEEKLY FULL (his call 2026-10-09: $150 of credit, and the
# full run is ~$10-20 a night). Every night: unit tests (free), the library's
# REGRESSION group, the known bug list and the expense harness, ~$2. On
# Sundays, or with NIGHTLY_FULL=1: everything above, three timezones, every
# wording set and the DEV sweep, ~$15.
set -u
FULL=0
{ [ "${NIGHTLY_FULL:-0}" = 1 ] || [ "$(date +%u)" = 7 ]; } && FULL=1
export PATH="$PATH:$HOME/.nvm/versions/node/v22.18.0/bin:/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin"
API_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BOT_DIR="$(cd "$API_DIR/../../whatbot" && pwd)"
DATE="$(date +%Y-%m-%d)"
if [ -n "${NIGHTLY_DIR:-}" ]; then ROOT="$NIGHTLY_DIR"
elif [ -d "$HOME/Library/Logs" ]; then ROOT="$HOME/Library/Logs/diane-nightly"
else ROOT="$HOME/diane-nightly"; fi
OUT="$ROOT/$DATE"
mkdir -p "$OUT"
REPORT="$OUT/report.md"
say() { echo "$*" >> "$REPORT"; }
: > "$REPORT"
say "# Diane and the expense bot, nightly · $DATE"
say ""

cd "$API_DIR" || exit 2
[ -d node_modules ] || npm ci --no-audit --no-fund > "$OUT/npm.log" 2>&1

refresh_clone() {
  node scripts/refreshDev.js > "$OUT/clone-$1.log" 2>&1 && echo ok || echo FAILED
}
# A scorecard and its comparison, as printed at the end of a suite log.
card_of() { sed -n '/^scorecard:/,/^newly passing/p' "$1" | sed 's/^/   /'; }

say "## DEV refresh from live (read only): $(refresh_clone before)"
say ""

# ---- Every capability ----
say "## Results"
npm test > "$OUT/unit.log" 2>&1
say "1. CRM unit tests: $(grep -E '^# (pass|fail)' "$OUT/unit.log" | tr '\n' ' ')"
( cd "$BOT_DIR" && npx vitest run > "$OUT/whatbot-unit.log" 2>&1 )
say "1. whatbot unit tests (payday replies included): $(grep -E 'Tests ' "$OUT/whatbot-unit.log" | tail -1 | sed 's/\x1b\[[0-9;]*m//g')"

# The suite runs below each empty DEV for their fake people; DEV is refilled
# from live once, before the sweep, rather than after every one of them.
export SUITE_NO_REFRESH=1

if [ "$FULL" = 1 ]; then
  say "_Full run (weekly)._"
  for tz in Asia/Dubai Europe/London America/Los_Angeles; do
    name="main-${tz//\//-}"
    f="$OUT/suite-$name.log"
    TZ=$tz SUITE_CARD="$name" node scripts/dianeSuite/run.mjs > "$f" 2>&1
    say "1. Capability suite, $tz: $(grep -E 'passed in|STOPPED' "$f" | tail -1)"
    card_of "$f" >> "$REPORT"
  done
  f="$OUT/suite-library.log"
  SUITE_SET=library node scripts/dianeSuite/run.mjs > "$f" 2>&1
  say "1. Library (every group and regression): $(grep -E 'passed in|STOPPED' "$f" | tail -1)"
  card_of "$f" >> "$REPORT"
  for set in eval eval2 eval3 eval4 eval5 eval6 wander; do
    f="$OUT/suite-$set.log"
    SUITE_SET=$set node scripts/dianeSuite/run.mjs > "$f" 2>&1
    say "1. Wording set $set: $(grep -E 'passed in|STOPPED' "$f" | tail -1)"
  done
else
  # THE SMALL NIGHT: every bug that was ever fixed, under its own card so
  # it compares with the night before (a group run saves only when named).
  say "_Small run (nightly). The full one runs on Sundays._"
  f="$OUT/suite-regression.log"
  SUITE_SET=library SUITE_GROUP=regression SUITE_CARD=regression node scripts/dianeSuite/run.mjs > "$f" 2>&1
  say "1. Regressions (every fixed bug): $(grep -E 'passed in|STOPPED' "$f" | tail -1)"
  card_of "$f" >> "$REPORT"
fi
node scripts/dianeSuite/run.mjs --pending > "$OUT/suite-pending.log" 2>&1
say "1. Known bug list: $(grep -E 'passed in|STOPPED' "$OUT/suite-pending.log" | tail -1)"

unset SUITE_NO_REFRESH
if [ "$FULL" = 1 ]; then
  say "1. DEV refresh before the sweep: $(refresh_clone sweep)"
  bash scripts/nightly/sweep.sh "$OUT/sweep" > "$OUT/sweep.log" 2>&1
  say "1. DEV sweep: $(grep -c '^ok' "$OUT/sweep.log") ok, $(grep -c '^FLAGGED' "$OUT/sweep.log") flagged, $(grep -c '^NOT RESTORED' "$OUT/sweep.log") not restored"
else
  : > "$OUT/sweep.log"
fi

# The expense bot: real conversations on DEV, seeded and cleaned per scenario.
node scripts/expenseHarness/harness.js > "$OUT/expenses.log" 2>&1
say "1. Expense bot harness: $(grep -E 'passed ·' "$OUT/expenses.log" | tail -1)"
node scripts/dianeSuite/compare.mjs expenses 2>/dev/null | sed 's/^/   /' >> "$REPORT"

# A sweep that left DEV changed, or the harness, leaves it fresh for the morning.
say "1. DEV refreshed for the morning: $(refresh_clone after)"
say ""

# ---- What failed, by name ----
say "## Failures"
fails="$(grep -hE '^FAIL' "$OUT"/suite-*.log "$OUT/expenses.log"; grep -hE '^(FLAGGED|NOT RESTORED)' "$OUT/sweep.log"; grep -hE '^not ok' "$OUT/unit.log"; grep -hE '×' "$OUT/whatbot-unit.log")"
if [ -z "$fails" ]; then say "None."; else echo "$fails" | sed 's/^/- /' >> "$REPORT"; fi
say ""
say "Scorecards: $API_DIR/scripts/dianeSuite/runs"
say "Logs: $OUT"
say "To fix: from the repo, run \`claude \"/diane-nightly\"\`."

# A copy, not a link: a link is not a file on Windows.
cp "$REPORT" "$ROOT/latest.md"
osascript -e "display notification \"$(echo "$fails" | grep -c . ) things to look at\" with title \"Diane nightly\"" 2>/dev/null
exit 0
