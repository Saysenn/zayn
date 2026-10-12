# Keeping it running (Windows)

The Windows counterpart to [process.md](process.md). Do it in order: link the phones by
hand **before** installing the service, or the QR codes print where nobody can see them.

## Before you start

1. Put the project at `C:\whatbot`, **not** under OneDrive (`Documents`, `Desktop`). OneDrive
   would upload `auth_info\` and can corrupt it with file locks.
2. Install Node LTS; note the version for rebuilds.
3. Fill in `.env` first — the app exits at boot if anything is missing.

## Stop Windows interfering

```
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0
```

- Power Options → closing the lid → **Do nothing** (battery and plugged in). Keep it on mains.
- Set Windows Update active hours; reboots will still happen, so the service must auto-start.

## First run, by hand

```
npm ci
node src\worker.js
```

Scan every group's QR (Linked devices → Link a device). Check `auth_info\<group>\` has files
for **every** group before going on.

## Install the service (NSSM)

```
nssm install whatbot-worker "C:\Program Files\nodejs\node.exe" "C:\whatbot\src\worker.js"
nssm set whatbot-worker AppDirectory C:\whatbot
nssm set whatbot-worker AppStdout C:\whatbot\logs\worker.log
nssm set whatbot-worker AppStderr C:\whatbot\logs\worker.err.log
nssm set whatbot-worker AppRotateFiles 1
nssm set whatbot-worker Start SERVICE_AUTO_START
nssm start whatbot-worker
```

- `AppDirectory` is required — dotenv reads `.env` from the working directory.
- The web process is optional: same commands with `src\server.js`. Its `/ready` shows which
  numbers are connected.
- No NSSM? Task Scheduler: **At startup**, "Run whether user is logged on or not",
  restart on failure, and **"If the task is already running: Do not start a new instance"**.
- **Exactly one worker.** Check `nssm status whatbot-worker` before running it by hand.

## Verify

1. Reboot. The log should show `whatsapp connected` per group and `worker process started`.
2. Message a number from your own phone and get a reply.
3. Stop the service, message it, start it again. Messages that arrive while it is down are
   ignored (`type !== "notify"` in `whatsapp/connection.js`), not answered late.

Back up `auth_info\` ([backups.md](backups.md)) and add a heartbeat ([process.md](process.md#heartbeat)).
