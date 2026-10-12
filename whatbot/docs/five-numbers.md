# The official Meta route — not built

Kept for comparison in case [baileys.md](baileys.md) has to be abandoned.

- One official number per group, all on one webhook. Meta sends `phone_number_id`; the
  agent maps it to a group and replies from the same number.
- Needs: Meta business verification (days to weeks), a number per group registered in
  WhatsApp Manager, an approved message template for the payday check, a domain and tunnel.
- Order: verification first → get one number working end to end → add the rest → template.
