# Keeping it awake

For a Mac running the worker in Windows (Parallels) inside a VeraCrypt volume. Each layer
can go idle on its own:

```
macOS host  →  VeraCrypt volume  →  Parallels VM  →  Windows  →  worker.js  →  sockets
```

| State                                         | Survives | Why                                 |
| --------------------------------------------- | -------- | ----------------------------------- |
| Screen locked, dimmed, or asleep              | **yes**  | UI only                             |
| System sleep, or lid closed without clamshell | no       | CPU halted                          |
| Shutdown, restart, power cut                  | no       | does not come back on its own       |
| Logged out (⇧⌘Q — lock is ⌃⌘Q)                | no       | pm2 is a per-user agent             |

A closed lid only survives in clamshell: mains power **and** an external display (an HDMI
dummy plug counts). After a sleep, sockets reconnect (backoff up to 60s) and messages that
arrived meanwhile are dropped — replayed history is ignored on purpose.

## 1. macOS

```bash
sudo pmset -a sleep 0 disksleep 0 standby 0 powernap 0 autorestart 1
pmset -g custom | grep -E '^ (sleep|standby|powernap) '   # re-check after updates
```

`disablesleep` is Intel-only. Lock Screen → "Require password…" → **Immediately**.

## 2. VeraCrypt (GUI)

Preferences → Security: untick all four dismount options (logoff, screen saver, power
saving, idle minutes). A dismount under a running VM corrupts the Windows image.
Order: mount → start VM. Shut down Windows first, dismount second.

## 3. Parallels (Configure ⚙)

- Optimisation: "Pause Windows when idle" and energy saving **off**
- Startup and Shutdown → On window close: **Keep Windows running in the background**
- Travel Mode off. Networking **Bridged**

## 4. Windows

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
powercfg /hibernate off
```

Verify: `powercfg /query SCHEME_CURRENT SUB_SLEEP` → standby index `0x00000000`.

## Diagnosing

- Five `whatsapp disconnected, reconnecting` lines at one timestamp = the machine or the
  network went away, not WhatsApp.
- Every restart is manual: someone must mount VeraCrypt, start the VM and log in.
  Running whatbot natively on the Mac would make auto-start real.
