# How to

Where to change things. Commands are in `run-it.md`.

## Change AI provider or key

1. `crm/api/.env`: `AI_PROVIDER` (`openai`, `groq`, `cerebras`, `gemini`,
   `openrouter`) and `AI_API_KEY`.
2. `AI_MODEL` blank uses the provider default.
3. Restart the API.

Base URLs and defaults: `crm/api/configs/providers.js`. Keep
`TRANSCRIBE_PROVIDER` on a provider with transcription (Groq or OpenAI), or
the mic breaks.

## Add a group

Nothing to change. Type the new name in a Group cell on the master sheet; it
becomes a suggestion everywhere.

## Add a master sheet column

1. New numbered `.sql` in `crm/api/v1/migrations/`, then `npm run migrate`.
2. `crm/api/v1/repos/masterSheetRows.repo.js`: add to `COLUMNS` and
   `COLUMN_FOR`.
3. `crm/web/src/pages/MasterSheetPage.jsx`: add to `FIELDS`, `COLUMN_FOR`,
   `EDITABLE` (if editable), the row and the `<th>` header.

A cell is editable when its column is in `EDITABLE`; remove it to make it
read-only.

## Change the landing page or the menu

- Landing page: the `index` route in `crm/web/src/App.jsx` (now
  `<Navigate to="/dashboard" replace />`). Keep it a `Navigate` so a refresh
  lands in the same place.
- Menu: `NAV_ITEMS` in `crm/web/src/configs/navigation.js`.

## Change the loading screen

`crm/web/src/components/agentOrb/DianeBoot.jsx`: `STEPS` (checklist),
`PREFETCH` (pages warmed), `MIN_VISIBLE_MS`. The bar reaches 100% only when
every step resolves; do not swap it for a timer.

## Change Diane's personality or rules

1. `crm/api/v1/agent/prompts/persona.js`: who she is, everywhere.
2. `crm/api/v1/agent/prompts/masterSheet.js`: master sheet rules.
3. Restart the API.

Keep them short: every line is re-sent on every message.

## Add, remove or turn off one of Diane's tools

- Add: a `{ name, description, parameters, handler }` object in
  `crm/api/v1/agent/tools/masterSheet.js`, listed in `masterSheetTools` at
  the bottom. Return `{ summary }`; add `reply` when the output is the final
  answer (skips a model call).
- Turn off without removing: add its name to `DISABLED` in
  `crm/api/v1/agent/disabledTools.js`. The handler refuses.
- Read-only Diane: take `createRow`, `updateRow`, `deleteRow` (and the other
  write tools) out of `masterSheetTools`. A prompt line is a request, not a
  lock.

Restart the API after any of these.

## Change Diane's voice

`crm/api/.env`, then restart:

- `AI_PROVIDER=openai` with `AI_API_KEY` covers speech. `SPEECH_API_KEY` only
  if speech uses a different key.
- `OPENAI_TTS_VOICE` (default `nova`). Others: `shimmer`, `coral`, `sage`;
  male: `ash`, `echo`, `onyx`, `verse`.
- `OPENAI_TTS_INSTRUCTIONS`: how she reads (delivery), not how she sounds.

Without a key she uses the browser's voice.

## Change toast alerts

- `crm/web/src/components/toasts/Toaster.jsx`: `LEVELS` (colours, icons).
- `crm/web/src/hooks/useNotifications.jsx`: `AUTO_DISMISS_MS`, `MAX_VISIBLE`.

Success and info fade after 5s, warnings 8s; errors stay until dismissed.

## Change the admin password or secret code

```bash
cd crm/api && npm run seed-admin -- <username> <password> <secret-code>
```

Stored as bcrypt hashes in `tb_accounts`, never in `.env`.

## Debugging

1. Settings → dev mode on (off means nothing is logged).
2. Logs page → filter by source (`api` or `agent`; Diane's model errors log
   as `agent`).

Each failure records provider, model, status and the provider's message. One
conversation: open Diane → conversation panel → download icon (dev mode
only).
