# WhatsApp without Meta or Twilio

One ordinary WhatsApp account per group, each on its own phone + SIM, linked to the machine
as a device (Baileys). No registration anywhere, no monthly cost. The phones are not in the
message path — they create the account and keep the link alive.

```
WHATSAPP_NUMBERS=MILKMAN:+440000000001,INDIGO:+440000000002
WHATSAPP_AUTH_DIR=auth_info
```

## The two speeds

| Direction                    | Speed                   | Why                                     |
| ---------------------------- | ----------------------- | --------------------------------------- |
| Employee asks → bot replies  | instant                 | normal conversation                     |
| Payday check → bot initiates | 1 per 15 min per number | unprompted messaging is the ban pattern |

## Bringing a number live

1. SIM into its own phone, install WhatsApp, verify by SMS. Profile name = group name, add a photo.
2. **Warm it up 1–2 weeks** with real conversations. A fresh account messaging 100 people
   is the fastest ban there is.
3. Start the worker, scan the QR. Back up `auth_info/`.
4. `curl localhost:3000/ready` → every group `true`.
5. Test with people you know, then have managers announce the number before opening the group.

## The phones

- Plugged in, switched on, on wifi, in a **locked** drawer. Off or flat for ~2 weeks and the
  link drops.
- Each holds that group's whole conversation history — treat it as a copy of the payroll data.
- Nobody touches Settings → Linked devices.

## The trade

1. Breaks WhatsApp ToS. No support, no appeal; a ban loses the number.
2. The library breaks when WhatsApp changes protocol, a few times a year.
3. Pacing stops rate detection, not people blocking an unexpected bot. Warm-up and
   announcing do that work.
4. The phones need physical custody.
