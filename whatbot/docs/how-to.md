# How to change something

Files to touch, per change. Details live in [features.md](features.md).

---

## Add a tool the LLM can call

1. `src/tools/<name>.js` — export `defineTool({...})`. See `myTotal.js` for the shortest example.
   - `summary` → LLM, no figures/names. `display` → user, untouched.
2. Done — `tools/index.js` auto-loads every file in the folder.
3. Add a line for it in `systemPrompt()`, `src/agent/prompt.js` (so the model picks it correctly).
4. `npm run eval` after.

## Add a built-in answer (no LLM)

For fixed policy replies. Lives in `src/conversation/`:
- `about.js` — who we are / privacy
- `escalate.js` — needs a person
- `outOfScope.js` — the honest no's

1. Add a regex + reply text to the right file.
2. Order is asserted in `src/conversation/routing.test.js` — add your case there.

## "Can the LLM just answer freely?"

No. It only calls a tool, or writes a short refusal itself. Never invents a figure.

---

## Add a WhatsApp group / number

1. `.env` → add `GROUPID:+E164` to `WHATSAPP_NUMBERS`. Must match the sheet's `Group` column exactly.
2. Restart `worker.js` → scan the QR that prints.
3. Update `.env.example`.

## Turn a feature on/off

Flip the flag in `.env` (e.g. `FEATURE_DOCUMENTS=true`), restart the worker.

## Add a new toggle

1. `src/config/env.js` — add the env var.
2. `.env.example` — add it.
3. `src/config/features.js` — one line.
4. `requires: '<name>'` on the tool(s) it gates.
5. `docs/features.md` — add to the Toggles table.

## Edit the master sheet

Read-only, bot never writes to it. Rules: [sheet-format.md](sheet-format.md). After editing,
check the sync log for `rejected` / `mismatched` counts.

---

`npm test` before done. Update `docs/features.md` if behaviour changed.
