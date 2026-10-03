# Findings

2026-08-25. An audit pass over security, speed, UI and UX, the endpoints,
and the documents. **No code was changed.** Every fix below is described,
none is applied.

## How this was checked, and what that does not cover

| done | how |
|---|---|
| 59 API tests | `npm test` in `crm/api`, all pass, no database |
| production web build | `vite build`, clean |
| every route enumerated | 65 across `v1/`, read and traced to their repo calls |
| async handler safety | scanned, **every one has try/catch**, no unhandled rejections |

**Endpoints were NOT called live.** Starting the API would point it at the
live Supabase and write to real payroll data, so this is static tracing plus
the test suite. Endpoint behaviour under real data is unverified and step 12
of `deployment.md` is where that gets proven.

---

# A. Security

### A1. `POST /master-sheet/upload` still writes a whole sheet with no diff

**The one to fix first.** [masterSheet.js:606](../crm/api/v1/masterSheet.js#L606)
is a live, session-authenticated route that parses an xlsx and calls
`repo.syncUpsert(rows, 'upload', { columns })` directly. No preview, no
accept list, no override guard decision, no confirmation.

It is the one-shot upload the two-step flow replaced, and `CLAUDE.md` states
the rule it breaks: *"AN UPLOAD IS TWO REQUESTS, AND THE FIRST WRITES
NOTHING."* Every bug that rule exists to stop is reachable through it: a
renamed column wiping every end date, a partial sheet, a file whose group
recovery failed.

Nothing calls it. `apiService.masterSheet.upload` still exists in
[api.config.js:216](../crm/web/src/configs/api.config.js#L216) but no
component uses it, and whatbot does not touch it.

**Fix:** delete the route and the client function. Both are dead; the route
is dead *and* dangerous. If a scripted import is ever wanted it should go
through `preview` and `commit` like everything else.

### A2. The session cookie and whatbot's API key are written to the log on every request

Still open from `sec-audit.md`. [configs/logger.js](../crm/api/configs/logger.js)
has no `redact` list, and `pino-http` serialises request headers by default.
That puts `cookie: crm_session=…` and `x-api-key: …` into the log store on
every single request, where the Logs page can read them back.

**Fix:** a `redact` list on the logger:

```js
redact: {
  paths: ['req.headers.cookie', 'req.headers["x-api-key"]',
          'req.headers.authorization', 'res.headers["set-cookie"]'],
  remove: true,
}
```

### A3. A live API key sits in a comment in `api/.env`

Still open from `sec-audit.md`. Lines 39-40 carry a real `csk-…` Cerebras
key in an explanatory comment. **Deleting it is not enough** — it has been
on disk, so it needs rotating at the provider.

### A4. The database connection never verifies a certificate, and cannot reach a local one

[configs/db.js:9](../crm/api/configs/db.js#L9):

```js
ssl: { rejectUnauthorized: false },
```

Unconditional, comment reads *"Supabase is always the cloud"*. Two problems:

1. **`rejectUnauthorized: false` disables certificate verification**, so the
   connection is encrypted but unauthenticated. Anything that can intercept
   the route to Supabase can present its own certificate and read every
   query, payroll included.
2. **It blocks self hosting.** A local Postgres container does not speak SSL
   and `pg` refuses rather than falling back, so `npm run migrate` fails on
   its first statement and the api never boots.

**Fix, one line, backwards compatible:**

```js
ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
```

Then `DATABASE_SSL=false` for the self hosted box. Verifying the certificate
properly against hosted Supabase is a separate, larger change (it needs
their CA bundle) and is worth doing only while the connection is still
crossing the internet.

### A5. Rate limiting covers only the two login routes

`loginLimiter` and `verifyLimiter` are the only ones, and they are on
`/login` and `/login/verify`. Four routes behind the session cost real money
or real CPU per call, with no limit at all:

| route | what an unbounded loop costs |
|---|---|
| `/master-sheet/agent` | an LLM call per request. Directly billable |
| `/master-sheet/speech` | a TTS call per request. Directly billable |
| `/master-sheet/upload/preview` | parses a 20MB xlsx in memory |
| `/export/xlsx` | builds N workbooks and zips them |

It needs a session, so this is not anonymous abuse. It is a stuck retry
loop, a held-down button, or one compromised session emptying the AI
account.

**Fix:** a shared `expensiveLimiter` (say 30 per 5 minutes) on those four.

### A6. `CORS_ORIGIN` defaults to `http://localhost:5173`

Harmless today because production is same origin and `sameSite: 'strict'`
blocks the cookie anyway. It stops being harmless the moment the portal
goes on a subdomain. **Fix:** set it explicitly in the server's `.env`, and
add it to the deployment checklist.

### A7. `.env.example` is missing most of what the app reads

It has the four required vars and three optional ones. It does **not**
mention `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `TRANSCRIBE_*`,
`OPENAI_TTS_*`, or the new `DATABASE_SSL`. Someone deploying from it gets a
CRM where Diane silently does not work and nothing says why.

**Fix:** bring it back in line with `configs/env.js`, with every key present
and commented, secrets left blank.

### Verified good

- **Auth layering is sound.** `app.use('/api/v1', requireSession)` sits
  above every dashboard router; `/api/v1/auth` is mounted before it and
  `/api/v1/agent` behind `requireApiKey`. No route slips past.
- **The API key comparison is timing safe** (`crypto.timingSafeEqual`), and
  so is the username lookup (`DUMMY_HASH`).
- **500s never leak.** The error handler returns a 6-hex reference and logs
  the stack separately.
- **The upload's multer config is right**: 20MB, one file, extension and
  mimetype both checked, `cb(null, true)` correct.
- **Helmet is on** with its default CSP (`default-src 'self'`).
- **`/companies/names` is declared before `/companies/:key`**, so it is not
  shadowed.

---

# B. Speed

### B1. `findAllRows()` is the only uncached read, and it is the hottest one

[masterSheetRows.repo.js:645](../crm/api/v1/repos/masterSheetRows.repo.js#L645)
does a full table SELECT with no `cache.wrap`, while `findById` right beneath
it is cached. It backs `/export/count`, `/export/xlsx` and `/export/rows`.

The export modal's count query is keyed on `selection`, so it refires on
**every** tab, group, person and widen change. Each one is a full scan
shipped to Node and filtered in JS.

At 96 rows this is milliseconds and nobody notices. It is listed because the
cache is already built, the call is one line, and the export modal is the
screen where a wait is most visible.

**Fix:** `return cache.wrap('allRows', () => …)`. The cache already
invalidates on every write, so there is no staleness to reason about.

### B2. The whole app is one 548KB JavaScript chunk

```
548KB  index-*.js        every page, every modal
496KB  three.module-*.js lazy, login orb only
```

No route level splitting. First load pulls the master sheet, the upload diff
modal, the export modal, Settings, Logs, and the **hidden Chat page** before
anything renders.

**Fix:** `React.lazy` per route in the router, which is a contained change
and would likely halve the initial chunk. The Chat page in particular is
shipped to every user and cannot be opened.

### B3. `sync_key` has no index

`findBySyncKeys` and `findNotInKeys` both filter on it, on every upload
preview. Irrelevant at 96 rows, cheap insurance later.

**Fix:** `CREATE INDEX ... ON tb_mastersheet (sync_key);` in the next
migration.

### Verified good

- **Connection pooling is already tuned**, with measurements in the comment
  (`min: 2`, `idleTimeoutMillis: 0`, `keepAlive`) and a `warmUp()` at boot.
- **The read cache is well designed**: caches the promise not the value, so
  concurrent identical reads share one query; never caches a rejection.
- **Indexes exist** on `group_name`, `source`, `person_id`, `needs_review`
  (partial), and trigram indexes on the two searched name columns.

---

# C. UI and UX

### C1. The export modal can be closed mid download, and the request keeps running

**A bug in work from earlier today, and the most concrete one here.** I
disabled the `Cancel` button while a download is in flight and stopped
there. [Modal.jsx](../crm/web/src/components/Modal.jsx) closes on **three
other paths** that are not gated:

- `Escape`
- clicking the backdrop
- the `×` in the header

Take any of them mid download and the XHR is never aborted, so when it
finishes it calls `saveBlob` and `onClose` on an unmounted component, plus
`setProgress` on unmounted. A file appears with no modal in sight, and React
logs a state-update-on-unmounted warning. On failure it calls `notify` from
a component that no longer exists.

**Fix, two parts:**

1. Hold the XHR on a ref and `abort()` it in a cleanup effect, so closing
   the modal actually cancels the download.
2. Pass the busy state into `Modal` so Escape, the backdrop and the `×` all
   respect it, rather than guarding one button and leaving three doors open.

The second half is the real lesson: guarding the button was guarding the
politest way out.

### C2. Two `todo.md` entries are already done

Verified gone, not just moved:

- *"`PeoplePage.jsx` still holds `uploadState` and a `handleUpload`"* — no
  such symbols in that file.
- *"`RowModal` accepts a `startInDelete` prop nothing passes"* — `RowModal`
  does not exist anywhere in `web/src`.

**Fix:** delete both lines. A todo list with finished items in it stops
being read.

### C3. The diff modal can open on an empty tab

`useState(changed.length > 0 ? 'changed' : 'new')` falls through to `new`
even when there are no new rows. A file that only adds deletions to consider
opens on a blank tab, and the tab that has something in it is the third one.

**Fix:** pick the first tab with a non-zero count, in tab order.

### C4. After an optimistic delete the group filter can point at nothing

Deleting every row of the selected group inside "Different deals" leaves the
dropdown holding a group with zero rows, so the list is blank with no
explanation while other groups still have entries.

**Fix:** when the selected group empties, fall back to all groups.

### C5. Confirm is disabled on a deletions-only upload

`disabled={… || accept.length === 0}` is correct now that deleting is its
own act, but it means a sheet whose only purpose was to identify finished
deals ends with a greyed out primary button and `Cancel` as the way out.
That reads as failure at the end of a successful job.

**Fix:** when there is nothing to write but a deletion has happened this
session, the primary button should say `Done` and close.

---

# D. Documents

2815 lines across ten files, plus 515 in `CLAUDE.md`. Three are not in
`CLAUDE.md`'s "keep these current" list and have drifted.

| file | lines | verdict |
|---|---|---|
| `deployment.md` | 565 | new today, correct, but the longest thing here |
| `totaling-audit.md` | 421 | reference. Fine as is |
| `backlog.md` | 399 | fine, it is a list of designs |
| `sec-audit.md` | 344 | **overlaps this file** |
| `state.md` | 342 | fine |
| `how-to.md` | 199 | useful, keep |
| `crm-dashboard-plan.md` | 193 | **delete** |
| `todo.md` | 169 | two stale entries (C2) |
| `run-it.md` | 68 | fine |
| `flow.md` | 78 | **merge into `CLAUDE.md`** |

**`crm-dashboard-plan.md` declares itself superseded in its own header** and
describes five tables that migration 022 dropped. 193 lines whose only
function is to be wrong to anyone who opens it before `state.md`. Git history
is the record of an old plan; a file in `docs/` is a claim about the system.

**`flow.md`** opens with the governing principle ("a CRM edit always wins"),
which `CLAUDE.md` already states as the override guard. One rule in two
places is the drift this codebase keeps paying for.

**`sec-audit.md` and this file now overlap.** A2, A3 and A5 appear in both.
Two security documents is one too many; findings should be one list with
dates and statuses.

**Recommended, all deletions of duplicate or false text, no new writing:**

1. Delete `crm-dashboard-plan.md`.
2. Fold `flow.md`'s principle into `CLAUDE.md`, delete the file.
3. Merge `sec-audit.md` into this file as one dated findings list.
4. Remove the two done entries from `todo.md`.

That is roughly 450 lines gone with nothing true lost.

**Not recommended:** compressing `state.md`, `backlog.md` or
`totaling-audit.md`. Their length is reasoning and consequence, which is the
thing `CLAUDE.md` says to keep, and shortening them would mean deleting the
"why" that stops a decision being relitigated.

---

# Priority

| # | finding | why first |
|---|---|---|
| 1 | **A1** one-shot upload route | live, authenticated, bypasses every guard |
| 2 | **A2** cookie and API key in logs | every request, already recorded |
| 3 | **A3** rotate the leaked key | it has been on disk |
| 4 | **A4** database SSL | blocks self hosting entirely, and disables cert checks |
| 5 | **C1** modal closes mid download | reachable by pressing Escape |
| 6 | **A5** rate limit the billable routes | before it is public |
| 7 | **A7 / D** `.env.example`, doc deletions | cheap, and both mislead |
| 8 | **B1 / B2 / B3** speed | nothing is slow at 96 rows |

Nothing here blocks the deployment in `deployment.md` except **A4**, which
stops the first step working, and **A1**, which should not reach a public
server at all.
