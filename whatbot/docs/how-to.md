# How to change something

## Add a tool the LLM can call

1. `src/tools/<name>.js` — export `defineTool({...})`. `myTotal.js` is the shortest example.
   `summary` goes to the LLM (no figures, no names); `display` goes to the user untouched.
2. `tools/index.js` auto-loads every file in the folder.
3. Add a line for it in `systemPrompt()` in `src/agent/prompt.js`.
4. `npm run eval` (costs money).

The LLM only calls tools or writes a short refusal. It never writes a figure.

## Add a built-in answer (no LLM)

In `src/conversation/`: `about.js` (who we are, privacy), `escalate.js` (needs a person),
`outOfScope.js` (the honest noes). Add a regex + reply, and a case in `routing.test.js`.

## Add a WhatsApp group / number

1. Add `GROUPID:+E164` to `WHATSAPP_NUMBERS` in `.env` and `.env.example`. Must match the
   sheet's `Group` exactly.
2. Restart the worker, scan the QR.

## Feature toggles

- Flip one: set it in `.env` (e.g. `FEATURE_DOCUMENTS=true`), restart the worker.
- Add one: `src/config/env.js`, `.env.example`, one line in `src/config/features.js`, then
  `requires: '<name>'` on the tool(s) it gates.

## The master sheet

The bot never writes to it. Rules: [sheet-format.md](sheet-format.md).
