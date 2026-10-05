---
name: diane-nightly
description: Work through last night's Diane test report: fix every fault and gap found, add suite cases, re-run until green, and write the morning report. Use when the user runs /diane-nightly or asks to work on the nightly results.
---

# Diane nightly: find faults, fix them, make her sharper

You are working through last night's results for Diane (the CRM admin assistant,
`crm/api/v1/agent/`). Do not stop to ask; report at the end (the owner's standing call for Diane work). The owner's goal, in
their words: Diane must be efficient and "super intelligent". The data is
already there, so she just has to read and understand them properly. EVERY
capability, from minor to basic to advanced, is tested every night. The job
is finding faults, gaps and issues, and improving them.

Last night's results: `~/Library/Logs/diane-nightly/latest.md` is the report,
and the logs sit in the same dated folder (read every file):
- `suite-*.log`: the capability suite (`npm run test:diane:tz`) and every held
  out wording set (`SUITE_SET=eval..eval6, wander`) plus `--pending`.
- `sweep.log` + `sweep/*.log`: real conversations on the local clone of live,
  auto mode off and on. "NOT RESTORED" means a write or an undo went wrong.
- `unit.log`: `npm test`.

## What to do, in order
0. Make a branch first: `git switch -c diane/nightly-<date>` from main. Work
   in `crm/api`.
1. Read every failure, every FLAGGED transcript and every NOT RESTORED.
   Read the transcripts that passed too: a pass can still be slow (extra
   tool calls), wordy, vague, or missing before/after figures. Those count.
2. Probe beyond the cases. Write 15+ new conversations the way the owner
   types: typos, no apostrophes ("zayns deals"), "pls", "ya", short forms,
   two asks in one line, follow ups ("both", "the milkman one", "make it
   1000", "undo that"). Run them on the clone with
   `DIANE_ON_CLONE=1 DATABASE_URL=postgresql://postgres:localtest@127.0.0.1:54329/crm_clone DB_SSL=false WHATBOT_WEBHOOK_URL=http://127.0.0.1:9 node scripts/dianeChat.js <file>`
   (from `crm/api`). Every write scenario must end with "undo that" / "yes".
3. Fix the root cause in code, not by adding prompt sentences: the codebase
   rule is that prompting is not a guard, least of all about money. Match the
   surrounding style (the banner comments with a dated incident). Messy
   wording is fixed where her reading of it lives (resolveRequest,
   resolvePerson, intent checks), never by rewriting the admin's words.
4. Add a case to `scripts/dianeSuite/cases.mjs` for EVERY fix and every new
   capability gap closed (see the existing cases for shape).
5. Re-run until green: `npm test`, then `npm run test:diane:tz`, then the
   sweep (`bash scripts/nightly/sweep.sh <that folder>/after`). A fix that breaks
   an older capability is not a fix.
6. Commit on the current branch (never main, never push) with a clear
   message per fix, then write `docs/nightly/<date>.md`: what failed, what you
   fixed (file:line), what is still open and why. Short numbered lists.
   Commit that too.

## Hard rules
- NEVER touch live. The only databases are the suite's own (`crm_suite`) and
  the clone (`crm_clone`), both on 127.0.0.1:54329. Every command that talks to a
  database gets the clone or suite URL passed explicitly; never rely on
  `.env`'s DATABASE_URL, which is live. Never run `scripts/cloneLive.js`
  (the 2am job refreshes the clone).
- Never use or kill port 3000. Never push, merge, or switch to main.
- Never weaken a guard to make a test pass. If a case is wrong, say why in
  the report before changing it.
- UI changes, if any, must stay consistent: thin borders, small minimal
  cards, proper button colours and accents.
- If something cannot be fixed tonight, leave it in the report's "open"
  list with what you found. Do not leave half done code uncommitted.
