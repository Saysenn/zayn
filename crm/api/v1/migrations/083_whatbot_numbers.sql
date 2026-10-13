-- WHATBOT NUMBERS, per group, registered in the CRM (his call 2026-10-12).
--
-- One WhatBot number per group. WhatBot's worker reads this list every few
-- seconds and connects any new number; the QR to link it shows in Settings →
-- Whatbot, never stored (it is the key to that WhatsApp account). WhatBot
-- keeps its last list, so a CRM outage never takes a linked number down.
--
-- `link_with`: how an unlinked number is linked, a QR or an 8 character code.
-- `relink_at`: set by Relink; the worker logs that number out, sets its old
-- link aside and starts a fresh one, then clears it.
CREATE TABLE IF NOT EXISTS tb_whatbot_numbers (
  id          serial PRIMARY KEY,
  group_name  text NOT NULL CHECK (btrim(group_name) <> ''),
  phone       text NOT NULL UNIQUE CHECK (phone ~ '^\+[0-9]{7,15}$'),
  active      boolean NOT NULL DEFAULT true,
  link_with   text NOT NULL DEFAULT 'qr' CHECK (link_with IN ('qr', 'code')),
  relink_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tb_whatbot_numbers_group ON tb_whatbot_numbers (upper(group_name));

-- The numbers in WhatBot's .env are copied in once, on its first call, so
-- removing one here is never undone by a restart.
ALTER TABLE tb_settings ADD COLUMN IF NOT EXISTS whatbot_numbers_seeded boolean NOT NULL DEFAULT false;
