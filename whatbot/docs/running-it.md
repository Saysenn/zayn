# Running it

Everything on one machine. Setup steps: [setup/](setup/index.md).

## What you need

1. A machine that never sleeps, on wired ethernet
2. One phone + SIM per group (SIM not already on WhatsApp), plugged in and locked away
3. The payroll data (the CRM master sheet)

## What leaves the machine

1. **LLM** — the caller's name, role, groups, question, and a summary like "returned 3 of
   12 people". Never a figure, never another person's name
2. **WhatsApp** — each message, both ways

## What will kill it

| Cause                       | Fix                                                                     |
| --------------------------- | ----------------------------------------------------------------------- |
| Sleep                       | `pmset` / `powercfg` — see [keeping-it-awake.md](keeping-it-awake.md)   |
| Nobody logged in            | pm2 is per-user on macOS — enable auto-login                            |
| Reboot                      | `pm2 startup`, Docker set to start at login                             |
| OS auto-update at night     | turn automatic updates off, patch deliberately                          |
| Power cut                   | `sudo pmset -a autorestart 1`                                           |
| Wi-Fi drop / no internet    | use a cable; nothing works offline, the APIs are remote                 |
| Disk full from logs         | `pm2 install pm2-logrotate`                                             |
| `docker compose down -v`    | deletes the volumes — every row and the audit log. Never use `-v`       |
| Machine dies                | lose availability only, if [backups](setup/backups.md) exist            |

A heartbeat changes how long an outage lasts: point an uptime monitor at `/ready`.
