# Backups — no cloud

One machine to run on is fine. One copy of anything is not.

## Code and docs

Git is a local tool. GitHub is not required.

```bash
git init --bare /Volumes/backup/whatbot.git      # once, on an external drive or NAS
git remote add origin /Volumes/backup/whatbot.git
git push
```

Full history, real backup, nothing leaves the building.

## Database

```bash
# crontab -e
0 2 * * * pg_dump whatbot | gzip > ~/backups/whatbot-$(date +\%F).sql.gz
0 3 * * * find ~/backups -name 'whatbot-*.sql.gz' -mtime +30 -delete
```

Thirty days is enough. Older dumps of payroll data are a liability, not an asset.

## The payroll file

Needs a second copy on something that is not this disk. **It is the one thing you cannot
rebuild** — everything else can be reinstalled from scratch.

## Test the restore

```bash
gunzip -c ~/backups/whatbot-2026-07-29.sql.gz | psql whatbot_test
```

**An untested backup is a guess.** Do it once, now, on a scratch database — not on the day you
need it.

## What losing the machine actually costs

| | Lost? |
|---|---|
| Availability | yes — employees email HR instead |
| Code, docs | no, if pushed to the bare repo |
| Payroll data | no, if the file has a second copy |
| Audit log, opt-outs | no, if the dump ran |
| Conversation memory | yes, and it does not matter — 30 minute expiry |

Downtime is survivable. Data loss is a choice.
