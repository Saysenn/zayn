# WhatsApp without Meta or Twilio

Five ordinary WhatsApp accounts, linked to the laptop like WhatsApp Web.
No registration anywhere. £0/month.

```
Phone 1  →  SIM 1  →  WhatsApp account  →  Milk Man
Phone 2  →  SIM 2  →  WhatsApp account  →  Indigo 1
Phone 3  →  SIM 3  →  WhatsApp account  →  Sprite
Phone 4  →  SIM 4  →  WhatsApp account  →  Nexus
Phone 5  →  SIM 5  →  WhatsApp account  →  Avagan

Phone 1..5  ──  scan QR once  ──→  laptop (Baileys)  ──→  agent
```

The laptop talks to WhatsApp directly. The phones are not in the path — they exist to
create the account and keep the link alive.

**Twilio account?** No. **Meta account?** No.

---

## The two speeds

| | Speed | Why |
|---|---|---|
| Employee asks → bot replies | instant, all day | normal conversation, no risk |
| Payday check → bot initiates | 1 per 15 min per number | unprompted messaging is the ban pattern |

500 employees ÷ 5 numbers = 100 each ≈ **25 hours**. Once a month, over a weekend.

No 24-hour window, no templates, no per-message cost.

---

## The phones

Plugged in, switched on, wifi on, in a **locked** drawer next to the laptop. Never carried.

Always-on beats a weekly power-on reminder — a recurring human chore is the part that fails.

**Each phone holds that group's entire conversation history** — every question, every reply,
every figure. Treat them as five copies of the payroll data. HR custody, screen lock, app lock.

Let one drain and the link drops after ~2 weeks. Bot goes silent.

---

## Steps

**1. Register.** SIM into phone, install WhatsApp, verify by SMS. Profile name = group name,
add a photo.

**2. Warm up — 1 to 2 weeks.** Real conversations with real colleagues. A fresh account that
immediately messages 100 people is the fastest ban there is. **Do not skip.**

**3. Build** — ✅ **done**

```bash
WHATSAPP_NUMBERS=milkman:+447700900001,sprite:+447700900002
WHATSAPP_AUTH_DIR=auth_info
```

| File | |
|---|---|
| `whatsapp/connection.ts` | one socket per group, auth in `auth_info/<group>/`, QR on first run, backoff reconnect |
| `whatsapp/sendMessage.ts` | Baileys socket, same `sendText(to, from, body)` signature |
| `whatsapp/receiveMessage.ts` | socket event → queue, deduped by WhatsApp message ID |
| `whatsapp/status.ts` | publishes per-number connection state so `/ready` can see it |
| `config/numbers.ts` | number ↔ group, E.164 ↔ JID |
| `whatsapp/sendTemplate.ts` | deleted — no templates outside the official API |

Agent, tools, scope rules, formatting, Redis, queue — unchanged.

**4. Link.** `npm run dev:worker`. A QR prints per number. Phone → Settings → Linked devices
→ Link a device → scan. Back up `auth_info/`.

**5. Check.** `curl localhost:3000/ready` → every group `true`. A disconnected number fails
this on purpose; it is the failure that otherwise hides.

**6. Test** with 5 people you know.

**7. Announce, then open group 1.** Managers post in the existing group chats: *"you'll get
messages from this number, it's ours."* People don't report what they expect. Leave it a month.

**8. Roll out the other 4.** A config line and a QR scan each.

**9. The monthly push, last.** ✅ built, switched off. One delayed BullMQ job per person,
spaced 15 minutes per number. `PAYDAY_SCHEDULE=last-friday` and `PAYDAY_DRY_RUN=false` both have to be
set deliberately. See [payday-check.md](payday-check.md).

---

## Cost

| | |
|---|---|
| 5 Android phones | ~£150 one-off |
| SIMs | already have |
| Monthly | **£0** |

Deleted: Meta registration · Twilio · Cloudflare Tunnel · domain · `PUBLIC_URL` · templates ·
**$64/month**

Buy **one** phone first. Prove it on one group before spending £150.

---

## The trade

1. **Breaks ToS.** Not supported, no one to appeal to.
2. **A ban loses the number.** Warm-up and announcing are the protection.
3. **Library breaks** when WhatsApp changes their protocol — a few times a year. Expect downtime.
4. **Blocks matter more than rate.** Spacing stops rate detection, not someone blocking an
   unprompted bot. Steps 2 and 7 do the real work.
5. **Five phones to physically control.** The official API has no phones. This is the part
   that isn't technical.

---

## Order

```
buy 1 phone → register → warm up 2 weeks ──┐
                                            ├→ link → test → announce → group 1 live
build connection.ts + swap transport ──────┘
                                                     ↓
                                   1 month later → other 4 groups
                                                     ↓
                                         then → monthly push
```

Warm-up and build run in parallel. Nothing else overlaps.
