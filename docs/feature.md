# Features

Designed and INTENDED TO BE BUILT. The difference from `backlog.md` is
commitment, not readiness: a thing is here because it is going to happen,
parked there because it might not.

Move an item to `todo.md` when work starts, and delete it from here once it
ships: what the system IS lives in `state.md`.

Each entry: what it is, what blocks it, what has to be decided first.

**Numbers are stable identifiers, not an order.** These kept the numbers
they had in `backlog.md` when they moved here on 2026-09-14, because
`closure.md`, `deployment.md`, `sec-audit.md` and migration 049 all cite
them. Renumbering would silently break every one of those.

---

## 0. Expenses

**R1 SHIPPED 2026-09-14.** The page, `tb_expenses` (migration 055), CRUD,
server side filters, a search box with a field picker, and pagination.
**What it IS now lives in `state.md`** under "Expenses". **What is left is
`docs/expense.md`**: R2 bulk and export, R3 import with a diff, R4 change
log and History. All three are open in `todo.md` section 5.

The short version: a STANDALONE LEDGER of money going out. It hangs off
nothing, reports beside the money coming in, and changes no payout figure.
That one decision is what keeps it out of `owedThisMonth.helper.js` and out
of every export.

**Every row converts at its own stored rate**, through a GENERATED column
that can only see its own row. Expenses read nothing from the Settings
rates panel, and a guard refuses the import rather than a comment asking
nicely.

It carries the Master Sheet page's whole capability set, differing only in
the data: import, export, add, bulk acts, inline edit, filters, history.

### Its own Settings section: snapshot, then burn

**Asked for 2026-09-14.** Expenses get their own menu in Settings with a
burn action, so a period can be ended by hand the way the master sheet's
month already is. The snapshot is the point of it: burning without one
would destroy the only record of what was spent.

**SNAPSHOT FIRST, BURN SECOND, AND THE BURN ONLY RUNS IF THE SNAPSHOT
SUCCEEDED.** `masterSheet/closeMonth.js` is the shape to copy exactly: it
awaits `takeSnapshot(currentMonth())` and only then calls
`burnRepo.burnMonth()`. An expenses burn that fires on a failed snapshot is
unrecoverable, because nothing repopulates the table.

- **The snapshot stores FIGURES, never a recipe to recompute them.** Same
  rule as migration 049 and for the same reason: read only forever, and a
  later change to any helper must not move a saved total.
- **It is self contained already.** Every expense row carries its own
  `exchange_rate`, so reading a snapshot back needs no rate lookup and no
  `tb_fx_rates` at all. That falls out of the per row rule rather than
  needing anything extra.
- **Its own section, not the master sheet's.** Ending a month of payroll
  and clearing a ledger are two different acts and must not share one
  button.
- **A typed confirmation phrase**, like the two burns already in Settings.
  `messages.typeToConfirm` exists.
- The burn TRUNCATEs `tb_expenses`, so `sync_key` history goes with it. A
  re-import afterwards correctly reads every row as new.

The snapshot table mirrors migration 049, immutability rule included:

```sql
CREATE TABLE IF NOT EXISTS tb_expense_snapshots (
  period      text PRIMARY KEY CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  taken_at    timestamptz NOT NULL DEFAULT now(),
  rows        jsonb NOT NULL,
  totals      jsonb NOT NULL,
  row_count   integer NOT NULL CHECK (row_count >= 0)
);

CREATE OR REPLACE RULE tb_expense_snapshots_immutable AS
  ON UPDATE TO tb_expense_snapshots DO INSTEAD NOTHING;
```

INSERT and DELETE stay open: a snapshot taken by mistake has to be
removable, and a delete is loud and total where an update is quiet and
partial.

**NOT SCHEDULED. His call, 2026-09-14: "put it in feature.md for now, I
will decide later."** The expenses build is R1 to R4 without it, and
nothing in those four assumes it exists.

**Two answers needed before it starts:**

1. **Period scoped, or the whole table?** Recommended: period. It mirrors
   049, a ledger is naturally periodic, and a whole table burn would take
   this month's in progress rows with it. The whole table variant needs a
   serial primary key instead of `period`.
2. **Do archived rows burn too?** They are still expenses, so probably yes,
   with `archived_at` carried into the snapshot intact.

## 1. Ending a deal, reviewing it, and closing a company

Designed 2026-09-11 off the boss's brief, nothing built. **The plan is
`docs/closure.md`**, not here: it carries the verified reading of his sheet
and four questions only he can answer.

The short version: **nothing in the system has ever ended a deal.** His own
sheet cannot (column I returns 0 only for "not started yet"), his end date
column is read by zero formulas, and the CRM's own `ended` is unreachable
because `color_uses_end_date` defaults false. Totals only grow.

Three phases, and **the middle one is the valuable one**: a deal past its
year is reviewed monthly, yes, no, or yes but final. Phases 1 and 2 are
blocked on nothing. Phase 3 (the Close button and liquidation) waits on four
answers from him, section 8 of that document. Do not start 3 without at
least questions 1 and 3: they decide how much real people are paid.

Overlaps `backlog.md` item 17, which is the same Close button. Diane's half
is an entry in `docs/diane.md`, blocked on phase 2.

## 2. Seven person facts live on the deal row

**This REVERSES a recorded decision (migration 025). Read that first.**

Door number, postcode, phone, accepting postals, bank details, account
number and sort code are facts about a PERSON, stored once per DEAL. Drew
holds five deals, so his phone is stored five times: three rows have it, two
are blank. That is not a data entry gap, it is the same fact in five places
drifting, and it is why 25 of the 41 incomplete rows in the 2026-09-11
export are incomplete.

### What 025 said, and where it was right

> "Phone/location/bank details in particular are NOT copied up here: they
> legitimately vary per deal in the real sheet, and picking one to sit on
> the person would force a false choice."

**Right about location, wrong about phone and bank.** Checked every person
with 2+ deals in both `MASTER SHEET - 2026-09-11.xlsx` and the boss's
`Master sheet for tech-2.xlsx`:

| | CRM Sept | tech-2 July |
|---|---|---|
| people with 2+ deals | 15 | 15 |
| conflicts on the seven | **0** | **1** (TLL's phone, one side a sentinel) |

Every other disagreement was on a column that genuinely is per deal:
Drew's location (`Black country` / `Chip county`), Stuart S's
(`Abu Dhabi` / `Away`), Jay's currency (`GBP` / `AED`), Peter Gibson's
method (`Bank Transfer` / `Cash`). The rest were case drift the CRM already
canonicalises.

### The split

**Move to `tb_people`:** `phone`, `door_number`, `postcode`,
`accepting_postals`, `bank_details`, `account_number`, `sort_code`.

**Stay on `tb_mastersheet`:** `location`, `currency`, `payment_method`, and
everything already deal level. `addon_percent` and `fee_percent` stay on
BOTH and are untouched: they sit on each deliberately and they stack.

### What it costs

His sheet is per row, so the boundary translates. Export writes the person's
value into every one of their rows exactly as now; upload reads them into
the person instead of the row; a file that disagrees asks ONCE per person in
the diff rather than once per row. Migration backfills from the rows that
hold values, which is a straight copy because nothing conflicts.

The People page already renders these as "one value if consistent, a list if
not". This deletes that special case rather than adding one.

### What unblocks it

Nothing technical. It needs the decision written down as a decision, in
`state.md` with the counts above, and the comment in migration 025 corrected
so nobody re-argues it from the old reasoning. Overlaps nothing in
`closure.md`.

**The interim, if the data is wanted clean sooner:** a "copy from another
deal" action, or "apply to all their deals" on the Person page. One click,
no schema change, and it leaves the cause in place so it gets pressed again
every time a deal is added.

---

## 3. Ship it: an Electron .exe, and where the backend lives

**Decided 2026-09-01.** API and Postgres on ONE PC that is never off. The
frontend bundled as a Windows .exe. Not on the internet (his call,
2026-08-26).

**READ THIS FIRST, it will cost a day otherwise. A `Secure` cookie is
REFUSED over `http://` to a LAN address.** The session cookie sets
`secure: env.nodeEnv === 'production'`, so on `NODE_ENV=production` anybody
reaching `http://192.168.x.x:3000` has the cookie dropped by Chromium and
**login silently fails, looking exactly like a wrong password**.
`http://localhost` and `127.0.0.1` are exempt, so it passes every test on
the server itself and fails on every other machine.

Three ways out, and the choice is not obvious:

1. The .exe loads `http://localhost:3000` and the backend is on the SAME PC.
   Nothing to change. Only works if nobody uses it from another machine.
2. A self signed certificate, so it is `https://` on the LAN. An Electron
   flag, not a rewrite.
3. Drop `secure` off the internet. One line, and the session cookie then
   travels in clear over the LAN. A decision to make out loud.

**Also, in the order it bites:**

- Load from `http://localhost:3000`, never `file://`. A `file://` page sends
  `Origin: null` and neither the cookie nor CORS survives it.
- `CORS_ORIGIN` only matters for Vite today. If the .exe loads from another
  origin it becomes real and must name the Electron origin exactly.
- The SSE route has no heartbeat. Across a LAN an idle timeout cuts it and
  live updates stop with nothing on screen saying so.
- The admin reply webhook needs whatbot's live Baileys socket. Same PC, or
  `WHATBOT_WEBHOOK_URL` names a box the CRM can reach.
- Postgres is Supabase in `ap-south-1`, not on that PC. Moving it is a dump,
  a restore, `DATABASE_URL` repointed, and the pooler note in `configs/db.js`
  stops applying.

**Decide first:** where the .exe runs (option 1 needs nothing; 2 and 3 make
the heartbeat matter), and **whose month is the business month** — the
server is `Europe/Vilnius`, the admin has been Pacific, 10 hours apart, so
every month boundary has a window where the export tab names one month and
the API builds another. `TIMEZONE` in `crm/api/.env` settles it.

**Open, related:** should the frontend stop computing the month at all and
ask the API? One authority instead of a mirrored contract.

## 4. Multi user, and one file that owns every privilege

One shared credential today, no concept of a lesser account. The ask is real
users with roles and **one central file**, not checks scattered through
routes and components.

`crm/api/v1/shared/permissions.js` maps a role to permissions and nothing
else in the codebase states a rule.

- **The web must NOT hold a copy.** `/auth/session` returns the resolved
  permission list; the web only asks "do I hold this string".
- **Hiding a button is not a permission check.** Every route gets
  `requirePermission(...)`. The UI hiding it is a courtesy.
- **Scoping is part of the permission.** `deals:write:own-group` resolves in
  one place into a SQL predicate. A second "which rows" mechanism drifts.

**What blocks it, in order:**

1. **`configs/sessionStore.js` holds ONE session id for the entire server.**
   Not one per user: one, globally. A second sign in evicts the first. This
   is the structural blocker and it is a rewrite to a keyed store.
2. `tb_accounts` has one row and no role column, and there is no password
   reset flow at all, only the seed script.
3. **The change log records HOW, never WHO.** `tb_mastersheet_changes` has
   `changed_via` and no actor. Needs `changed_by`, and it touches every
   write path, so do it in the same change as roles rather than twice.
4. The secret code is per account, not per user.
5. **whatbot is not a user and must not become one.** `AGENT_API_KEY` stays
   a machine key with its own middleware.

**Decide first:** roles fixed in the file (recommend) or rows in a table;
and whether "own group" means the groups on their deals or an explicit
assignment, which may need `tb_groups` (`backlog.md` item 8) first.

## 5. An account portal, admin only

Create, edit, disable, assign a role, reset a password or secret code.
**Depends on item 4** and cannot start before it.

**`crm/web/src/portal/` behind `/portal`, and `crm/api/v1/portal/`.** One
deploy, its own folder: it needs the same session, the same
`permissions.js`, the same database. **Not in Settings** — that is where an
admin changes how the CRM behaves, this is where one person changes what
another is allowed to do.

- **One username per person, never shared.** The seed script upserts, which
  silently overwrites somebody's account. The portal must REFUSE a duplicate.
- **Disable is the default, delete is the exception.** An account with
  history keeps its row once `changed_by` exists.
- **Nobody can lock everybody out.** Checked server side.
- **Secrets are set, never read.** Reset issues a new one, shown once.
- **The seed script stays** as the break glass route.

**Decide first:** who sets a new user's secret code, and invite versus
assign (a link needs email, which the CRM does not have).

---

## 6. Deleting the last deal deletes the person or company

**His call, 2026-09-14.** Moved here from `backlog.md` the same day: it is
intended, not merely designed.

**The master sheet is the source of truth.** When a deal row is deleted,
check whether its person and its company are still on any other deal. If
not, that person or company goes from the CRM too. There is no Delete button
anywhere and none is wanted: deletion is DERIVED from the deals.

### What was built and then taken back out, 2026-09-14

Delete on the person and company detail pages is **gone**, along with its
hooks, confirms, client methods, both DELETE routes, `peopleRepo.remove`,
`companiesRepo.remove` and Diane's `delete_person` / `delete_company`.
`rowsRepo.orphanPerson` and `orphanCompany` went with them, so **nothing can
detach a deal's person or company any more.**

`clearOrphanFlags` and the `orphaned_*` columns stay for rows flagged before
that date. Nothing can create a new one.

### Where it goes when it is picked up

**One place: `deleteRows` in `repos/masterSheetRows.repo.js`.** Every delete
path funnels through it (the row route, bulk-delete, Diane's
`delete_master_sheet_row`, the import diff's delete), it is already a
transaction, and `DELETE_RETURNING` already carries `person_id` and
`company`. The check goes after the DELETE and before the COMMIT.

**Use the transaction's own client, never the repos.** `peopleRepo.remove`
took its own connection from the pool and would have committed regardless of
a rollback here. That is why deleting those two functions was not churn:
this feature must not reuse them.

**Match the company on the folded name**
(`lower(regexp_replace(btrim(...)))`), the way `companies.repo.js` keys
them, or "Relia PA" and "relia pa " are two companies again.

### Decide before building it

**It destroys data that a re-import does not bring back.** `tb_people` holds
`addon_percent`, `fee_percent`, email and notes; `tb_companies` holds
`tier`, `old_group` and notes.

The rates are the sharp edge: delete somebody's last deal, let next month's
import bring that deal back, and the person is recreated with **no rates**.
Every total carrying them is quietly lower and nothing says so.

Three shapes, undecided:

1. Cascade exactly as stated, and accept the loss.
2. Cascade, but the delete confirm names it first: "this is Gloria's last
   deal, her profile and 5% add on go with it." **Recommended.** Does what
   was asked and makes the consequence visible while it can still be
   reconsidered.
3. Cascade only when the row holds nothing worth keeping. A person with
   rates or notes survives on zero deals.

### Two smaller ones, also undecided

- **Reassignment is not deletion.** Moving a deal from Gloria to Drew leaves
  Gloria on zero deals and would NOT delete her. Confirm that is intended.
- **The import's diff-delete shares the path**, so dropping a company's last
  deal off "Potentially ended deals" would take its tier with it.

---

## 7. Debts

**A decided PLACE, an undecided THING.** He named it as one of the CRM's
kinds of money on 2026-09-17, and the sidebar carries the group already
(`configs/navigation.js`, `key: 'debts'`). It draws nothing, because an
empty group draws nothing: a heading over a page that does not exist is a
dead link with a title.

### The question that has to be answered first

It is one of three features, and they do not share a schema:

| Reading | Means | Shape |
|---|---|---|
| Arrears | money WE owe a handler and have not paid | a balance per deal, against what was owed and what went out |
| Clawback | money a handler owes US back, an advance or an overpayment | a balance per PERSON, paid down over months |
| Third party | money owed between the company and somebody outside it | its own table, unrelated to the master sheet |

**Do not guess.** The first two both look like "a number beside a person"
and behave nothing alike: one is a gap in a payment that already happened,
the other is a running balance that survives a deal ending.

### What is already true, whichever it is

- **Nothing in the CRM records a debt today.** No column, no table, no
  page: checked 2026-09-17.
- **The sidebar slot is free**, in the right order, at no cost.
- **`tb_mastersheet_changes` already holds what was owed and when it
  changed**, so an arrears reading has a history to build on rather than
  needing one invented.
