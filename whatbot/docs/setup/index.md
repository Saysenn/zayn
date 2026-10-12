# Setup

No domain and no Meta account — see [baileys.md](../baileys.md). Start the slow items first.

| #   | Step                                                                   | Lead time    |
| --- | ---------------------------------------------------------------------- | ------------ |
| 1   | [Phones](accounts.md#1-the-phones) — SIMs, then 1–2 weeks warming up   | weeks        |
| 2   | [Redis](redis.md)                                                      | minutes      |
| 3   | [OpenAI key](accounts.md#2-openai), [CRM access](accounts.md#3-crm)    | minutes      |
| 4   | `npm ci`, fill in `.env`, `npm test`                                   | minutes      |
| 5   | Keep it running: [macOS](process.md) or [Windows](windows.md)          | ~30 min      |
| 6   | [Backups](backups.md) — `auth_info/` above all                         | ~20 min      |
| 7   | [Postgres](postgres.md) — optional, for the audit log                  | later        |

Nobody can be recognised until the roster carries **phone numbers** — identity is the
WhatsApp sender number.

## Verify

```bash
pm2 status                                # both online (Windows: nssm status whatbot-worker)
curl localhost:3000/health                # {"ok":true,...}
curl localhost:3000/ready                 # every number connected
npm run chat -- +447100000910 MILKMAN     # answers, scoped to that number
```

Then **reboot and check again**. Anything that needs starting by hand will fail at 3am.
