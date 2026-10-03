# Five WhatsApp numbers, one per group — the official Meta route

> **Not what was built.** Kept for comparison and in case the Baileys route has to be
> abandoned. What ships is [baileys.md](baileys.md): five ordinary accounts, no
> registration, £0/month.


Each group gets its own official WhatsApp number. Everyone behind them shares one machine, one
agent, one data source, and later one dashboard.

```
Milk Man  +4471…  ┐
Indigo 1  +4472…  │
Sprite    +4473…  ├──→  one webhook  →  one agent  →  one data source
Nexus     +4474…  │
Avagan    +4475…  ┘
```

---

## How it works

Meta sends `phone_number_id` on every inbound message. The agent maps it to a group, tags the
job with it, and replies from the same number.

```bash
# .env
WHATSAPP_NUMBERS=milkman:+4471…,indigo:+4472…,sprite:+4473…,nexus:+4474…,avagan:+4475…
```

One webhook URL serves all five. No extra processes, no extra tunnels, no extra machine.

**The number decides branding and reply routing.** Data access still comes from `reports_to`,
so nobody sees another group's pay by messaging a different number.

---

## Per number

| | Effort | One-off |
|---|---|---|
| Phone number / SIM — must not already be on WhatsApp | — | yes |
| Register in WhatsApp Manager | ~10 min | yes |
| Display name + profile photo — what employees see | ~5 min | yes |

## Shared across all five

| | |
|---|---|
| Meta business verification | once, covers the whole business account |
| Message template for the payday check | approved once, usable from any number |
| Webhook URL | one |
| Domain + tunnel | one |
| Machine, agent, data source | one |

---

## Build order

1. Meta business verification — **start first**, days to weeks
2. Buy 5 numbers
3. Register number 1, get the agent working end to end on it
4. Register the other 4 — each is a config line plus a profile
5. Submit the payday template
6. Switch the check on for one group, then all five

Do step 3 completely before step 4. Five numbers with a broken webhook is five times the
debugging.

---