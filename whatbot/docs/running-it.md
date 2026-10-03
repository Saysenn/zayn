# Running it — the short version

Everything on one company machine. Three cloud APIs, nothing else leaves.

---

## What you need

1. **A machine that never sleeps** — company laptop, or better a mini PC
2. **Five phones** — ~£30 each. One per number, kept plugged in and locked away
3. **Five SIMs** — not already registered on WhatsApp
4. **The real payroll file** — from HR
5. **Wired ethernet** — the cheapest reliability upgrade there is

---

## What runs on the machine

1. **The payroll file**, or Postgres after migration
2. **Redis** — queue, sessions, rate limits, opt-outs
3. **The web process** — receives WhatsApp webhooks
4. **The worker** — answers questions, syncs the file, runs the month-end check
5. **Five WhatsApp connections** — linked devices, one per group

---

## What goes to the cloud

1. **LLM** — the caller's name, role, their groups, their question, and a summary
   like "returned 3 of 12 people". Never a figure, never another person's name
2. **WhatsApp** — each message, both ways. Meta's network carries them either way;
   what changes is that nothing about the company is registered with them
3. **Google Maps** — postcodes, once courier pay exists

---

## Setup, in order

1. Register the first SIM on WhatsApp, from its own phone
2. **Warm it up for one to two weeks** — real conversations. This has the longest lead time
3. Install Node, Docker, Redis, Postgres
4. `npm run dev:worker`, scan the QR from the phone. Each process opens with a
   banner naming itself (`worker` / `web`) and its mode — that is how you tell the
   two terminals apart. It only prints to a real terminal, never into piped logs
5. `pm2 start` both processes, `pm2 save`, `pm2 startup`
6. Disable sleep, enable auto-login, turn off automatic macOS updates
7. Heartbeat to a free uptime monitor — point it at `/ready`
8. Test with five real numbers you control before anyone else
9. Announce it through the managers, then open one group
10. A month later, repeat 1-4 for the other four numbers

---

## What will kill it

1. **Sleep** — `sudo pmset -a sleep 0 disksleep 0 standby 0 powernap 0`. `disablesleep`
   is Intel-only and ignored on Apple Silicon, where a closed lid sleeps regardless.
   If the machine is a Mac running Windows in Parallels inside a VeraCrypt volume,
   three more layers can idle independently — see
   [keeping-it-awake.md](keeping-it-awake.md)
2. **Nobody logged in** — pm2 uses a per-user LaunchAgent and will not run at the
   login screen. Enable auto-login. **The one that catches everybody out**
3. **A reboot** — `pm2 startup`, and Docker set to start at login
4. **macOS auto-updating at 3am** — turn it off, patch deliberately
5. **Power cut** — the battery covers short ones; `sudo pmset -a autorestart 1`
6. **Wi-Fi dropping** — use a cable
7. **No internet at all** — nothing works. Local data does not help; the APIs are remote
8. **Disk full from logs** — pm2 log rotation
9. **Meta token expiring** — use a permanent System User token, not a temporary one
10. **Someone borrowing the laptop** — label it, lock it away
11. **`docker compose down -v`** — deletes every payroll row and the audit log. One
    character from the safe command
12. **The machine dying** — you lose availability. You only lose *data* if there is no
    backup

---

## What makes it survivable

1. **A heartbeat.** Everything above reduces how often it breaks. This changes how long it
   stays broken — five minutes instead of "until someone complains"
2. **A local git remote** — a bare repo on an external drive. Full history, no GitHub
3. **Nightly `pg_dump`** to an external drive, 30 days kept
4. **A tested restore.** An untested backup is a guess
5. **The payroll file existing somewhere else too** — it is the one thing you cannot rebuild

---

## The honest trade

One machine means one point of failure. It will be fine most of the time, then someone will
close the lid or the building will lose power.

That is survivable for an internal tool — employees fall back to emailing HR. But it should be
a decision, not a surprise. The heartbeat and a tested restore are what turn a disaster into an
inconvenience.
