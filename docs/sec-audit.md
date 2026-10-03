# Security audit

2026-08-25. Whole CRM, both halves, plus the whatbot boundary. Nothing in
here has been fixed: findings only, each with the fix beside it.

Ranked by what an attacker actually gets. "By design" items are at the foot
so nobody re-audits them, and so nobody silently undoes the reason.

Scope: `crm/api`, `crm/web`, and the two auth boundaries (`requireSession`,
`requireApiKey`). `whatbot/` was read only where the master sheet loop
crosses into it.

---

## Critical

### 1. The session cookie is written to the log on every request

`configs/logger.js` passes no `redact` list, and `pino-http`'s default
request serializer logs the entire `headers` object. That object contains
`cookie`, so **every request logs the live session JWT**, and the login
response logs the `set-cookie` that minted it. Verified against the
installed `pino-std-serializers`:

```
{"method":"GET","url":"/x","headers":{"cookie":"crm_session=SECRET"},...}
```

The same applies to `x-api-key`, which is the only thing in front of
`/api/v1/agent/*`.

**Impact.** Anyone who can read a log file can replay a session or call the
agent API. Logs are the thing you hand to somebody debugging, paste into a
chat, or ship to a hosted log service. It defeats `httpOnly` entirely:
the point of that flag is that the token never becomes readable text, and
here it becomes readable text 96 times a page load.

**Fix.** A `redact` list in the pino config:

```js
redact: {
  paths: [
    'req.headers.cookie',
    'req.headers.authorization',
    'req.headers["x-api-key"]',
    'res.headers["set-cookie"]',
    'req.body.password', 'req.body.code', 'req.body.ticket',
  ],
  censor: '[redacted]',
}
```

Bodies are not logged today, but the login route's is the one that must
never survive it if that ever changes.

### 2. A live API key sits in plaintext in a comment

`crm/api/.env` carries a real Cerebras key on a commented line beginning
`# CEREBRAS key: csk-...`. It is not read by anything: `configs/env.js`
never looks at it. It is a working credential parked in a comment.

**Impact.** `.env` is the file people screenshot, paste when asking for
help, and copy to a new machine. A commented key reads as inert and is not.

**Fix.** Two steps, and the first is the one that counts:

1. **Rotate it at Cerebras.** Deleting the line does not un-expose it.
2. Delete the line. If the key is wanted, it belongs in `AI_API_KEY` with
   `AI_PROVIDER=cerebras`, which is what that plumbing is already for.

---

## High

### 3. No `.gitignore`, and this is not a git repo yet

There is no `.gitignore` at the root or in either half, and the tree is not
under version control. Both `crm/api/.env` and `crm/web/.env` exist.

**Impact.** The first `git init && git add .` commits the Supabase
`DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `AGENT_API_KEY`,
`WHATBOT_WEBHOOK_KEY` and the AI keys. Once pushed, rewriting history does
not un-leak them; every one has to be rotated. This is the cheapest finding
here to fix and the most expensive to fix late.

**Fix.** Add a root `.gitignore` now, before `git init`:

```
node_modules/
.env
.env.*
!.env.example
crm/api/public/
docs/boss/downloads/
*.log
```

Confirmed clean: neither `.env.example` contains a real key.

### 4. whatbot receives bank details it never uses

`GET /api/v1/agent/master-sheet` returns every row, and `toAgentRow.js`
includes `bankDetails`, `postcode` and `phone`. whatbot pulls this every 5
minutes into its own roster.

Checked what whatbot does with them: `bankDetails` and `postcode` appear
only in `employee/types.js` (a zod field with `.default("")`) and in
`sheet/parseSheet.js`, which is the **retired** local xlsx path already
logged for deletion in `todo.md`. **No whatbot behaviour reads either
field.**

**Impact.** One leaked `AGENT_API_KEY` hands over the whole payroll,
including bank details, for 96 people. The key is a single shared static
string in an env file on a second deployment. The structured
`account_number` and `sort_code` columns are correctly excluded already,
which shows the intent; `bank_details` is the older free text column that
holds the same information and was missed.

**Fix.** Drop `bankDetails` and `postcode` from `toAgentRow`. Both are
`.default("")` in whatbot's schema, so an absent field is valid and nothing
throws.

**Not done, and this is a genuine decision, not laziness:** it changes a
cross service wire contract, and the safety of it depends on the *deployed*
whatbot matching this source. Confirm that, then it is a two line change.

### 5. Rate limiting covers the login route and nothing else

`configs/rateLimit.js` is applied to `/auth/login` only. Every other route
is unlimited: the export builder, the upload parser, Diane's chat endpoint
(which spends money per call), and the transcription endpoint (which
accepts 25MB per request).

**Impact.** An authenticated session, or a stolen one, can drive unbounded
cost and CPU. The xlsx export builds the whole workbook in memory per call.

**Fix.** A general limiter on `/api/v1` after `requireSession`, generous
(say 300 per 15 minutes) so normal use never sees it, plus a tighter one on
the two AI routes and the upload.

This was already listed in `todo.md` under Gaps. It is recorded here at its
real severity.

---

## Medium

### 6. `trust proxy: 1` makes the rate limiter spoofable if ever run unproxied

`app.set('trust proxy', 1)` tells Express to believe the last hop of
`X-Forwarded-For`. Correct behind nginx, which is the documented setup. If
the process is ever exposed directly, or put behind a proxy that does not
overwrite the header, a client sets its own `X-Forwarded-For` and rotates
it per request, which defeats the per IP login limiter completely.

**Fix.** Nothing to change while nginx is in front. Worth a startup
assertion: refuse to boot in production if `trust proxy` is on and no
proxy header arrives on the first request. At minimum keep it in mind at
deploy time, because the login limiter is the only brute force defence.

### 7. Dead `USERNAME` and `PASSWORD` in `crm/api/.env`

Neither is read anywhere. Verified: no `process.env.USERNAME` or
`process.env.PASSWORD` in either half.

**Impact.** Plaintext credentials with no purpose, which is pure downside.
Separately, `USERNAME` is a Windows built in environment variable, and
`dotenv` setting it can confuse anything that reads it.

**Fix.** Delete both lines. The real credential lives in `tb_accounts` and
is set with the seed script, which is the design.

### 8. `exceljs` pulls a vulnerable `uuid`

`npm audit --omit=dev` in `crm/api`: 2 moderate,
[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq),
a missing buffer bounds check in `uuid` v3/v5/v6 when `buf` is supplied.

**Impact.** Low in practice: exceljs does not pass a `buf`, and the input
is our own workbook building. Recorded because `npm audit fix --force`
proposes `exceljs@3.4.0`, a major downgrade that would break every export.

**Fix.** Do not run `--force`. Wait for exceljs to bump its `uuid`, or pin
a resolution/override to `uuid@^11.1.1` and run the export test suite.

`crm/web`: 0 vulnerabilities.

### 9. The Logs page returns stack traces to any session

`errorHandler` correctly keeps a 500's message out of the browser, then
`captureLog` writes `{ ref, stack, method, path }` to `tb_logs`, and
`GET /api/v1/logs` returns `detail` to the client.

**Impact.** None today: one admin, and it is the whole point of the
reference number workflow. It becomes a real finding the day a `viewer` or
`manager` role exists, because a stack trace names internal paths, table
names and driver internals.

**Fix.** Gate `detail` behind a permission when RBAC lands. Listed as a
dependency in `feature.md` item 4.

### 10. No length or quality rule on the password or the secret code

`seedAdmin.js` accepts anything, including one character. Nothing anywhere
enforces a minimum.

**Impact.** The rate limiter makes online guessing slow, but bcrypt is at
cost 8 (deliberately, and documented in `bcrypt.helper.js`), so a leaked
hash plus a four digit code is an afternoon.

**Fix.** A minimum length check in `seedAdmin.js`, at the one place a
credential is ever set. 12 for the password, 6 for the code, and refuse a
code that is all the same digit or a run.

---

## Low

### 11. `exportFileName` does not strip CR or LF

`v1/shared/exportFileName.helper.js` replaces `\ / : * ? " < > |` before the
value goes into a `Content-Disposition` header. Carriage return and line
feed are not in that set, and the value derives from a group or company
name, which comes from an uploaded spreadsheet.

**Impact.** Response header injection in principle. In practice Node's
`res.setHeader` throws `ERR_INVALID_CHAR` on those characters, so the real
outcome is a 500. The defence is Node's, not ours, which is the finding.

**Fix.** Add `\r\n` to the existing character class. One character change.

### 12. No indicator that dev mode is on

Dev mode makes 500 messages reach the browser verbatim
(`middlewares/errors.js`). It is a deliberate switch in Settings and a good
one, but nothing on screen says it is currently on, and it is read once at
boot into memory.

**Fix.** A small persistent marker in the layout while dev mode is on.

### 13. No CSRF tokens, and the mitigation is load bearing

There is no CSRF token anywhere. What prevents cross site requests is
`sameSite: 'strict'` on the session cookie (`configs/session.js`). That is
sufficient, and it is the correct choice at this size.

**Recorded so it is not undone by accident.** `GET /api/v1/export/xlsx`
returns the entire payroll and is authorised by cookie alone. The day
anybody relaxes `sameSite` to `'lax'` or `'none'` (for an embed, an OAuth
return, a subdomain split) CSRF tokens must land in the same change.

---

## By design, verified, leave alone

Each of these looks like a finding and is not. Recorded so the next audit
does not spend time on them.

- **In memory session store, one slot for the whole server.** A second
  login evicts the first and a restart logs everyone out. Deliberate at 1
  to 3 admins. It is the structural blocker for multi user, and is item 4
  in `backlog.md`.
- **No account lockout.** With one shared credential a lockout lets anyone
  lock the boss out of his own payroll on purpose. Ticket burn plus the
  rate limit gives the protection without the self inflicted denial.
- **bcrypt cost 8**, below the usual 10, reasoned in `bcrypt.helper.js`:
  one shared rate limited credential, not a public signup form.
- **No password reset flow**, and no "forgot password" link pretending
  otherwise. The seed script is the reset.

## Verified clean

Checked and found correct. Not a list of things not looked at.

- **No SQL injection anywhere.** Every dynamic fragment is either a `$N`
  placeholder or an allow listed identifier: `AMOUNT_COLUMNS` for the range
  filter column, a fixed `{current,future,old}` map for the preset
  operator, `COLUMN_FOR` for writes. `update()` iterates `EDITABLE` (the
  allow list) rather than the caller's keys, so an attacker supplied field
  name cannot reach the SET clause at all. That is the right shape.
- **Protected by default.** `app.use('/api/v1', requireSession)` is mounted
  before every data router, so a newly added router is protected without
  anybody remembering to protect it.
- **Timing safe comparisons.** `apiKey.helper.js` uses
  `crypto.timingSafeEqual` with a length check; `auth.helper.js` compares a
  dummy bcrypt hash for an unknown username so the response time does not
  reveal which usernames exist.
- **Cookie hardening.** `httpOnly`, `sameSite: 'strict'`, `secure` in
  production, signed at the cookie-parser layer with `COOKIE_SECRET`, and
  carrying a JWT signed independently with `JWT_SECRET`. Two separate
  secrets, correctly.
- **Sockets run the same session check.** `sockets/index.js` reuses
  `isSessionValid` rather than reimplementing it, and rejects at the
  handshake. Every failure path is wrapped, so an anonymous connection
  cannot crash the process.
- **helmet defaults are on and real**: `default-src 'self'`,
  `object-src 'none'`, `script-src 'self'`, `frame-ancestors 'self'`,
  HSTS, `nosniff`, `Referrer-Policy: no-referrer`.
- **Upload is safe.** Memory only, never written to disk, 20MB cap, one
  file, extension and mimetype both checked, and the filter calls back with
  both arguments (a bug this codebase already hit once).
- **No XSS sinks.** No `dangerouslySetInnerHTML` anywhere in `crm/web`.
- **Nothing secret reaches the browser bundle.** One `VITE_` variable
  exists and it is an API origin.
- **500 messages do not reach the browser** outside dev mode; they carry a
  six hex reference that leads the log entry.
- **whatbot never gets Postgres credentials.** It goes through
  `/api/v1/agent/*` over HTTP with its own key, and that layer never
  touches the admin session.
- **`crm/web`: 0 dependency vulnerabilities.**

---

## What changes when multi user lands

Not findings today. They become findings the day there is a second account,
and they are cheaper to build in than to retrofit. Full design in
`feature.md` item 4.

1. **The session store must become keyed and persistent.** One global slot
   cannot represent two people.
2. **The change log records HOW, never WHO.** `tb_mastersheet_changes` has
   `changed_via` ('admin' / 'diane' / 'sync' / 'upload') and no actor
   column. With one user those are the same question. With five it stops
   being an audit trail. Needs `changed_by`, and it touches every write
   path, so do it in the same change as roles rather than twice.
3. **The secret code is per account.** Shared between real users it is a
   secret everybody knows, which is no gate. Each user needs their own.
4. **Log detail, exports and the destructive Settings actions**
   (`burn-month`, `reset-master-sheet`) need permissions. Right now any
   session can wipe the month.
5. **whatbot must stay outside the role system.** It is a machine key with
   its own middleware, not a user with a role.

## Note on the login flow

This audit was written while the secret code step was being added. The
finished shape is: `/auth/login` verifies the password and returns a short
lived pending ticket that grants nothing, and `/auth/login/verify` is the
only route that issues a session. Findings 1, 5 and 10 all touch it, and
none of them are caused by it.

Not yet run: migration `039_secret_code.sql`. Until the seed script sets a
code, `/auth/login/verify` answers 403 and nobody can sign in.
