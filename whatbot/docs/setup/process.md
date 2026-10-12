# Keeping it running (macOS)

On Windows use [windows.md](windows.md). For the Mac + VeraCrypt + Parallels setup see
[keeping-it-awake.md](../keeping-it-awake.md).

## pm2

```bash
npm i -g pm2
pm2 start npm --name whatbot-web    -- run start
pm2 start npm --name whatbot-worker -- run start:worker
pm2 save
pm2 startup                        # prints a command — run it
pm2 install pm2-logrotate
```

Without the worker, messages queue and nobody gets a reply — with no error.

## Stop macOS interfering

- **Enable auto-login** (Users & Groups). pm2 is a per-user LaunchAgent and does nothing
  at the login screen.
- `sudo pmset -a sleep 0 disksleep 0 standby 0 powernap 0 autorestart 1`
- Software Update → automatic updates **off**.
- Docker Desktop, if used → **Start at login**.

## Heartbeat

Not built into the app. Use a free uptime monitor (Healthchecks.io, UptimeRobot) against
`/ready`, so an outage lasts minutes, not "until somebody complains".

## Check

```bash
pm2 status                         # both online
curl localhost:3000/health         # {"ok":true,...}
```

Then reboot and check again.
