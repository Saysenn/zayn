# Keeping it awake

The bot replies only while the machine holding the five WhatsApp sockets is running.
Four layers can each go idle on their own:

```
macOS host  →  VeraCrypt volume  →  Parallels VM  →  Windows  →  worker.ts  →  5 sockets
```

Three of them can stop replies with the Mac wide awake.

## What survives what

| State                                         | Survives | Why                                  |
| --------------------------------------------- | -------- | ------------------------------------ |
| Screen locked, dimmed, or asleep              | **yes**  | UI only — the session never stops    |
| System sleep, or lid closed without clamshell | no       | CPU halted, every process suspended  |
| Shutdown, restart, power cut                  | no       | it does not come back on its own     |
| Logged out                                    | no       | pm2 is a per-user agent              |

⌃⌘Q locks. **⇧⌘Q logs out** and kills the session pm2 lives in. One key apart.

Sleep cannot be worked around — a sleeping CPU runs nothing, and `pmset` only governs
the *idle* path, not a sleep you asked for. **Clamshell** is the exception for a closed
lid: it needs mains power *and* an external display (an HDMI dummy plug counts).

After a sleep the sockets reconnect with backoff up to 60s, and messages that arrived
meanwhile are dropped — `messages.upsert` ignores replayed history, or a reconnect
would answer the whole backlog at once.

## 1. macOS host

```bash
sudo pmset -a sleep 0 disksleep 0 standby 0 powernap 0 autorestart 1
pmset -g custom | grep -E '^ (sleep|standby|powernap) '   # verify; re-check after updates
```

`displaysleep` is cosmetic, set it to anything. Set System Settings → Lock Screen →
"Require password…" to **Immediately**, or a locked screen is only a dark one.

## 2. VeraCrypt — GUI only

**Preferences → Security**, uncheck all four: dismount on logoff / on screen saver /
on power saving, and auto-dismount after *N* idle minutes.

This one does lasting damage. The `.pvm` sits inside the volume with Parallels writing
to it, so a dismount under a running VM corrupts the Windows image, not just the
session. Closing the lid fires the power-saving trigger too.

**Order, always:** mount → start VM → work. Shutting down: Windows first, dismount
second. Confirm with `mount | grep -i veracrypt` after a long lock.

## 3. Parallels — GUI only, under Configure (⚙)

- **Optimization** — off: "Pause Windows when idle", energy saving. These pause the
  guest while the Mac is awake.
- **Startup and Shutdown** → On window close: **Keep Windows running in the background**.
- **Travel Mode**: off. Networking: **Bridged**, not Shared.

## 4. Windows guest

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
powercfg /hibernate off
```

Verify: `powercfg /query SCHEME_CURRENT SUB_SLEEP` → standby index `0x00000000`.
Ignore the adapter's Power Management tab; the virtual NIC has none.

## Diagnosing

Five `whatsapp disconnected, reconnecting` lines on one timestamp = the machine or the
network went away, not WhatsApp.

Two setups that mimic a bug: `displaysleep 0` with a non-zero `sleep` (screen lit while
the Mac suspends), and a forgotten `caffeinate -d` (display refuses to sleep).

## What this does not fix

Restart. Nothing returns until a person types the VeraCrypt password, mounts, starts
the VM and logs into Windows — so `pm2 startup` in the guest buys nothing. Every
restart is manual and in-person. Put a heartbeat on `/ready`.

Running whatbot natively on the Mac (it is Node) with FileVault, and VeraCrypt holding
only the payroll `.xlsx`, collapses four layers to one and makes auto-start real.
