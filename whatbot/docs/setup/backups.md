# Backups

One machine is fine. One copy of anything is not.

| What                 | How                                                     |
| -------------------- | ------------------------------------------------------- |
| `auth_info/`         | copy with the other backups; never git or OneDrive      |
| Code                 | a bare git repo on an external drive (below)            |
| Postgres, if used    | nightly `pg_dump`, 30 days kept                         |
| Payroll data         | a second copy off this disk — it cannot be rebuilt      |
| Conversation memory  | not needed — it expires after 30 minutes                |

```bash
git init --bare /Volumes/backup/whatbot.git
git remote add origin /Volumes/backup/whatbot.git && git push

# crontab -e
0 2 * * * pg_dump whatbot | gzip > ~/backups/whatbot-$(date +\%F).sql.gz
0 3 * * * find ~/backups -name 'whatbot-*.sql.gz' -mtime +30 -delete
```

**Test the restore once, now**, on a scratch database:

```bash
gunzip -c ~/backups/whatbot-<date>.sql.gz | psql whatbot_test
```
