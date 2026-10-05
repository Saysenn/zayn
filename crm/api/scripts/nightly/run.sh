#!/bin/bash
# ***************************************************
# * DIANE, EVERY NIGHT: every capability, minor to advanced
# ***************************************************
# Run by launchd at 02:00 (~/Library/LaunchAgents/com.sayon.diane-nightly.plist).
#
#   1. Refreshes the local clone from live. Live is opened READ ONLY.
#   2. Unit tests, the capability suite in three timezones, every held out
#      wording set, the known bug list, and the clone sweep (auto off and on).
#   3. Writes a report: ~/Library/Logs/diane-nightly/<date>/report.md, and
#      ~/Library/Logs/diane-nightly/latest.md points at the newest one.
#
# It FINDS. Fixing happens in a session you start in the morning, with the
# report in hand: `claude "/diane-nightly"` from the repo (see .claude/skills/diane-nightly).
#
# Never port 3000, never a write to live. Skips the night if Docker is down.
set -u
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:/usr/bin:/bin"
API_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DATE="$(date +%Y-%m-%d)"
ROOT="$HOME/Library/Logs/diane-nightly"
OUT="$ROOT/$DATE"
mkdir -p "$OUT"
REPORT="$OUT/report.md"
say() { echo "$*" >> "$REPORT"; }
: > "$REPORT"
say "# Diane nightly · $DATE"
say ""

# ---- Docker and the clone container ----
if ! docker info >/dev/null 2>&1; then
  open -a Docker 2>/dev/null
  for _ in $(seq 1 36); do docker info >/dev/null 2>&1 && break; sleep 5; done
fi
if ! docker info >/dev/null 2>&1; then
  say "SKIPPED: Docker is not running, so there is no local database to test on."
  ln -sf "$REPORT" "$ROOT/latest.md"; exit 0
fi
docker start crm-clone >/dev/null 2>&1
sleep 3

cd "$API_DIR" || exit 2
[ -d node_modules ] || npm ci --no-audit --no-fund > "$OUT/npm.log" 2>&1

refresh_clone() {
  node scripts/cloneLive.js > "$OUT/clone-$1.log" 2>&1 && echo ok || echo FAILED
}
say "## Clone refresh from live (read only): $(refresh_clone before)"
say ""

# ---- Every capability ----
say "## Results"
npm test > "$OUT/unit.log" 2>&1
say "1. Unit tests: $(grep -E '^# (pass|fail)' "$OUT/unit.log" | tr '\n' ' ')"

for tz in Asia/Dubai Europe/London America/Los_Angeles; do
  f="$OUT/suite-main-${tz//\//-}.log"
  TZ=$tz node scripts/dianeSuite/run.mjs > "$f" 2>&1
  say "1. Capability suite, $tz: $(grep -E 'passed in' "$f" | tail -1)"
done
for set in eval eval2 eval3 eval4 eval5 eval6 wander; do
  f="$OUT/suite-$set.log"
  SUITE_SET=$set node scripts/dianeSuite/run.mjs > "$f" 2>&1
  say "1. Wording set $set: $(grep -E 'passed in' "$f" | tail -1)"
done
node scripts/dianeSuite/run.mjs --pending > "$OUT/suite-pending.log" 2>&1
say "1. Known bug list: $(grep -E 'passed in' "$OUT/suite-pending.log" | tail -1)"

bash scripts/nightly/sweep.sh "$OUT/sweep" > "$OUT/sweep.log" 2>&1
say "1. Clone sweep: $(grep -c '^ok' "$OUT/sweep.log") ok, $(grep -c '^FLAGGED' "$OUT/sweep.log") flagged, $(grep -c '^NOT RESTORED' "$OUT/sweep.log") not restored"
# A sweep that left the clone changed leaves it fresh for the morning instead.
grep -q '^NOT RESTORED' "$OUT/sweep.log" && say "   Clone refreshed again after the sweep: $(refresh_clone after)"
say ""

# ---- What failed, by name ----
say "## Failures"
fails="$(grep -hE '^FAIL' "$OUT"/suite-*.log; grep -hE '^(FLAGGED|NOT RESTORED)' "$OUT/sweep.log"; grep -hE '^not ok' "$OUT/unit.log")"
if [ -z "$fails" ]; then say "None."; else echo "$fails" | sed 's/^/- /' >> "$REPORT"; fi
say ""
say "Logs: $OUT"
say "To fix: from the repo, run \`claude \"/diane-nightly\"\`."

ln -sf "$REPORT" "$ROOT/latest.md"
osascript -e "display notification \"$(echo "$fails" | grep -c . ) things to look at\" with title \"Diane nightly\"" 2>/dev/null
exit 0
