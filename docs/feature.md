# Features

Intended to be built. Numbers are stable identifiers cited elsewhere
(`closure.md`, `deployment.md`, `sec-audit.md`, migration 049): never
renumber. Delete an entry when it ships. The full designs these entries
came from are in this file's git history (before 2026-10-06).

0. **Expenses: snapshot and burn.** The page shipped (see `state.md`,
   `expense.md`). Left: a period snapshot, then a burn, in its own Settings
   section, copying `masterSheet/closeMonth.js` (snapshot first, burn only if
   it succeeded, typed confirm). Undecided: period or whole table; do archived
   rows burn.
3. **Electron .exe on one always-on PC.** Load `http://localhost:3000`,
   never `file://`. A `Secure` cookie is refused over plain http to a LAN
   address: pick same-PC, a self-signed cert, or dropping `secure`. Decide
   the business timezone (`TIMEZONE`).
4. **Multi-user with roles.** One permissions file
   (`v1/shared/permissions.js`), every route checks it, the web only asks.
   Blockers: one global session id, one account row with no role, no
   `changed_by` on the change log.
7. **Debts.** Undecided which: arrears (we owe a handler), clawback (a
   handler owes us) or third party. Nothing records a debt today.
8. **Diane modes: lawyer and HMRC.** A context she switches into on her
   own when asked about HMRC, tax, employment law or company processes,
   and back out after. Its own prompt and knowledge, read-only on CRM data,
   and it says plainly it is guidance, not legal or tax advice.
9. **Diane's Expenses and Debts contexts.** Shown greyed out as "coming
   soon" in the command center selector. Expenses reading and WhatBot intake
   are planned in `whatbot-crm-expenses.md`; Debts waits on 7.
10. **Diane's wake and sleep words.** She always listens, but only answers
    once woken. A greeting ("hi", "hello", "hey Diane", "good morning")
    wakes her: she glows and works as normal. She goes back to sleep after
    5 minutes idle, or on a sleep word ("deactivate", "close", "stop", "bye",
    "that's all"). Asleep, she hears but never answers. Stops her
    answering room talk that was not meant for her.
    **Woken by mistake** (people greeting each other, "hey bro"): when what
    follows is clearly not for her, or someone says "not you", she says a
    short sorry ("Sorry, I thought you meant me") and goes back to sleep.
    **Any wording, not a fixed list:** she understands every kind of
    greeting and goodbye ("yo", "morning", "you there?", "salam", "ok we're
    done", "go to sleep", "thanks that's all"), in any accent or language
    the room uses. Read by meaning, the router way, not word matching.
    **Hands free, never forced:** no pressing space to talk. Typing a request
    and the space key / deactivate button still work as now.
