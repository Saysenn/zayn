# Postgres

Only needed when migrating off the spreadsheet. Until then Redis holds everything.

Worth doing when you want **month history** or **HR editing by chat** — neither works on a
spreadsheet the bot cannot safely write to.

## Install

```bash
brew install postgresql@16
brew services start postgresql@16
createdb whatbot
```

```bash
# .env
DATABASE_URL=postgresql://localhost:5432/whatbot
AUDIT_STORE=postgres
```

Install **pgAdmin** separately — that is how HR browses and edits rows.

## Docker instead?

Fine, with two rules:

- Bind to `127.0.0.1:5432:5432`, never `5432:5432`. The second exposes Postgres to the whole
  office network
- **Never `docker compose down -v`.** The `-v` deletes the volumes — every payroll row and the
  entire audit log. It is one character from the safe command

## Schema

In [../db-migration.md](../db-migration.md). Key is `eid + period` — one row per person per
month, which is what makes history possible.

## Check

```bash
psql whatbot -c 'select 1'
```
