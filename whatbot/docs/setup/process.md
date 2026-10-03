# Keeping it running

The agent is a server. It only works if the machine stays on and the processes stay up.

> **On Windows?** Use [windows.md](windows.md) instead — service instead of pm2, and the
> power settings are different.

## pm2

```bash
npm i -g pm2
pm2 start npm --name whatbot-web    -- run start
pm2 start npm --name whatbot-worker -- run start:worker
pm2 save
pm2 startup                        # prints a command — run it
pm2 install pm2-logrotate          # a laptop disk fills faster than you expect
```

Both processes must run. Without the worker, messages queue up and nobody gets a reply —
and nothing errors.

## ⚠️ The one that catches everybody out

**pm2 on macOS uses a per-user LaunchAgent. It does not run at the login screen.**

You will test it sitting at the machine and it will work perfectly. Then it reboots overnight,
sits at the login screen, and does nothing until someone walks over.

**System Settings → Users & Groups → enable auto-login.**

## Stop macOS interfering

```bash
sudo pmset -a sleep 0 disablesleep 1     # never sleep, even lid closed
sudo pmset -a autorestart 1              # power back on after a cut
```

- System Settings → General → Software Update → **turn off automatic updates**. Patch
  deliberately, not at 3am
- Docker Desktop, if used → **Start at login**

A laptop has one advantage over a desktop here: the battery is already a UPS.

## Heartbeat

Free account at Healthchecks.io or UptimeRobot. The worker pings it every five minutes; if the
pings stop, you get an email.

Everything else on this page reduces how *often* it breaks. This changes how *long* it stays
broken — five minutes instead of "until somebody complains".

**Do not skip it.** A machine under a desk fails quietly.

## Check

```bash
pm2 status                         # both online
curl localhost:3000/health         # {"ok":true}
```

Then **reboot the machine and run both again**. If anything needs starting by hand, it will
fail the same way at 3am on a Sunday.
