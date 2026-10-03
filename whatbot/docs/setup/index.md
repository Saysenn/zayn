# Setup

Everything needed to get the agent running on the company machine.

## Order

There is **no domain and no Meta account** in this setup — see [baileys.md](../baileys.md).
Two things have lead times and no dependencies, so start them first.

| | | Lead time |
|---|---|---|
| 1 | [The phones](accounts.md#2-the-phones) — SIMs, then **1–2 weeks warming up** | **weeks** |
| 2 | Ask payroll for the master sheet, **with a phone column** | **days** |
| 3 | [Redis](redis.md) — Upstash, TCP URL not REST | minutes |
| 4 | [LLM API key](accounts.md#4-openai) | minutes |
| 5 | The app — `npm ci`, fill in `.env`, `npm test` | minutes |
| 6 | Point `DATA_SOURCE` at the data — `excel` or `sheets` | minutes |
| 7 | Keep it running: [macOS](process.md) or [Windows](windows.md) | ~30 min |
| 8 | [Backups](backups.md) — `auth_info/` above all | ~20 min |
| 9 | [Postgres](postgres.md) | audit log, before go-live |

⚠️ Nothing can be answered until the sheet carries **phone numbers**. Identity is the verified
WhatsApp sender number, so without that column nobody can be recognised.

## Pages

- **[accounts.md](accounts.md)** — the phones, the LLM key, Google. The things with logins
- **[redis.md](redis.md)** — queue, sessions, opt-outs
- **[postgres.md](postgres.md)** — later, for history and write-back
- **[process.md](process.md)** — pm2, sleep, auto-login, heartbeat (macOS)
- **[windows.md](windows.md)** — the same, on Windows: service, power settings, QR order
- **[backups.md](backups.md)** — local git remote, nightly dumps, tested restore

## Verify at the end

```bash
pm2 status                                      # both online (or: nssm status whatbot-worker)
curl localhost:3000/health                      # {"ok":true}
curl localhost:3000/ready                       # every number connected
npm run chat                                    # lists who is in the sheet
npm run chat -- +447100000910 MILKMAN           # answers, scoped to that number
```

Then **reboot and run all five again**. Anything that needs starting by hand will fail the
same way at 3am on a Sunday.
