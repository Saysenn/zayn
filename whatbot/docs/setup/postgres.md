# Postgres

Optional. Only used to keep the audit log in Postgres instead of Redis.

```bash
brew install postgresql@16
brew services start postgresql@16
createdb whatbot
psql whatbot -c 'select 1'
```

```
DATABASE_URL=postgresql://localhost:5432/whatbot
AUDIT_STORE=postgres       # DATABASE_URL is required when set
```

With Docker: bind `127.0.0.1:5432:5432`, never `5432:5432`, and **never
`docker compose down -v`** — it deletes the volumes and the whole audit log.
