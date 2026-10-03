# Running it automatically on Windows

The Windows counterpart to [process.md](process.md). Everything needed to make the agent
start by itself, survive a reboot, and stay up without anyone watching it.

Work through it in order. Numbers 10–11 must come before 12, or the QR codes print where
nobody can see them.

---

## Before you start

**1. Put the project outside OneDrive.**

Use `C:\whatbot`, not anything under `Documents` or `Desktop`. OneDrive will sync
`auth_info\` — uploading a live WhatsApp credential to the cloud — and its file locking can
corrupt the session files while Baileys is writing to them.

**2. Install Node LTS and write down the version.**

`node -v`. When the machine is rebuilt or replaced, match it.

**3. Fill in `.env` before anything else.**

The app validates the whole environment at boot and exits immediately if anything is missing
— no retry, no partial start. `REDIS_URL` must be the Upstash **TCP** string (`rediss://…`),
not the REST URL; BullMQ cannot use REST.

---

## Stop Windows interfering

**4. Never sleep or hibernate.**

```
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0
```

These are the `-ac` (mains) settings, so the machine has to stay plugged in.

**5. Closing the lid must do nothing.**

Control Panel → Power Options → Choose what closing the lid does → **Do nothing**, on both
"On battery" and "Plugged in".

**6. Keep it on mains.**

On a laptop the battery is already a UPS — that is the one advantage it has here.

**7. Set Windows Update active hours, and expect reboots anyway.**

Updates will restart the machine eventually. That is survivable *because* of step 12; it is
not survivable if the worker has to be started by hand.

---

## First run — by hand

**8. Build.**

```
npm ci
npm run build
```

**9. Run the worker in a visible terminal.**

```
node dist\worker.js
```

**10. Scan all five QR codes.**

Each group prints its own. On that group's phone: WhatsApp → Settings → Linked devices →
Link a device.

**11. Confirm the sessions were written.**

`auth_info\<group>\` should now contain files, for every group. Do not go further until it
does — a Windows service has no visible console, so a QR printed by the service is a QR
nobody can scan.

---

## Automate it

**12. Install the worker as a service (NSSM).**

```
nssm install whatbot-worker "C:\Program Files\nodejs\node.exe" "C:\whatbot\dist\worker.js"
nssm set whatbot-worker AppDirectory C:\whatbot
nssm set whatbot-worker AppStdout C:\whatbot\logs\worker.log
nssm set whatbot-worker AppStderr C:\whatbot\logs\worker.err.log
nssm set whatbot-worker AppRotateFiles 1
nssm set whatbot-worker Start SERVICE_AUTO_START
nssm start whatbot-worker
```

`AppDirectory` is not optional — dotenv reads `.env` from the working directory.

This gives start-at-boot and restart-on-crash together. Log rotation matters more than it
sounds: a laptop disk fills faster than you expect.

**13. The web process is optional on a laptop.**

Same commands against `dist\server.js`. It only serves `/health` and `/ready`, but `/ready`
is the easiest way to see which of the five numbers are actually connected — worth having.

**14. If you cannot install NSSM, use Task Scheduler.**

Trigger **At startup**, "Run whether user is logged on or not", Settings → **"If the task is
already running: Do not start a new instance"**, and enable restart-on-failure. That
"do not start a new instance" setting is a safety control, not a preference — see 15.

**15. ⚠️ Exactly one worker. Ever.**

Never install the worker service twice, and never leave a terminal running
`node dist\worker.js` while the service is up. Each connection is a linked device on a real
WhatsApp account; two workers means two devices fighting over the same account and WhatsApp
kicks one off.

Check `nssm status whatbot-worker` before running anything by hand.

---

## Protect the things that are expensive to lose

**16. Back up `auth_info\`.**

That folder *is* the link to all five accounts. Lose it and every phone needs rescanning.
Back it up with the payroll backups — never to OneDrive, never to git. See
[backups.md](backups.md).

**17. Add a heartbeat.**

Free account at Healthchecks.io or UptimeRobot. Everything else on this page reduces how
*often* it breaks; this changes how *long* it stays broken — minutes instead of "until
somebody complains". A machine under a desk fails quietly.

**18. Keep the phones alive.**

Plugged in, switched on, on wifi, in the drawer. The app may be closed — linked devices do
not route through the phone. But a phone that is off or flat for around two weeks drops the
link, and that is five QR scans again. Tell whoever has access to the phones never to touch
Settings → Linked devices.

---

## Verify

**19. Reboot the machine.** Then check the log shows `whatsapp connected` five times and
`worker process started`.

**20. Message one of the numbers from your own phone** and confirm a reply.

**21. Test what an outage costs.** Stop the service, message the number, start it again, and
see whether that message is answered. WhatsApp holds messages for an offline linked device,
but the code deliberately ignores replayed history (`type !== 'notify'` in
`whatsapp/connection.ts`) so that a reconnect cannot message everyone at once. This test
tells you whether a missed message is answered late or lost — worth knowing before it
happens for real.

Anything that needs starting by hand will fail the same way at 3am on a Sunday.

---

## ⚠️ Do not run the payday check from a laptop

Pacing between payday sends comes entirely from the delay set on each job when it is
scheduled. There is no rate limit in the send worker itself.

If the machine sleeps for three hours mid-run, every job whose slot has passed becomes ready
at once and they fire back to back on restart — a burst of unprompted messages, which is
exactly the pattern that gets WhatsApp accounts banned.

Inbound-only on the laptop is fine: an outage means somebody waits. The first real payday run
belongs on an always-on machine.
