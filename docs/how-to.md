# How to

Short answers to "where do I change X". One numbered list per thing.

For what the system currently IS, see `state.md`. For running commands,
`run-it.md`. For what is still to do, `todo.md`.

---

## Change AI provider or API key

1. Open `crm/api/.env`
2. Set `AI_PROVIDER` — one of `openai`, `groq`, `cerebras`, `gemini`, `openrouter`
3. Set `AI_API_KEY` to that provider's key
4. Leave `AI_MODEL` blank to use the provider's default, or set it
5. Restart the API

Base URLs and default models live in `crm/api/configs/providers.js`. Nothing else needs touching.

**Do not** change `TRANSCRIBE_PROVIDER` off `groq`. Only Groq and OpenAI have a transcription endpoint — the mic breaks on the others.

---

## Add a new group

Nothing to change. Groups come from whatever is in the data.

1. Master sheet page → click a Group cell → type the new name
2. It appears as a suggestion in every group cell from then on

The dropdown is suggestions, not a fixed list, precisely so a new group can be typed.

---

## Add a new column to a sheet

**Master sheet:**
1. `crm/api/v1/migrations/` — new numbered `.sql` file adding the column
2. `npm run migrate`
3. `crm/api/v1/repos/masterSheetRows.repo.js` — add to `COLUMNS` and `COLUMN_FOR`
4. `crm/web/src/pages/MasterSheetPage.jsx` — add to `FIELDS`, `COLUMN_FOR`, `EDITABLE`, and a `<Cell>` in the row
5. Add the `<th>` in the table header

**Calculator:**
1. Steps 1–2 as above, on `calculator_rows`
2. `crm/api/v1/repos/calculatorRows.repo.js` — add to `COLUMN_FOR` and `RECOMPUTED_COLUMNS`
3. `crm/web/src/pages/CalculatorPage.jsx` — add to `COLUMNS_BY_KIND` (with an `edit` type) and `FIELD_FOR`

---

## Make a cell editable / read-only

**Master sheet:** `MasterSheetPage.jsx` → the `EDITABLE` map. In the map = editable. Remove it = read-only.

**Calculator:** `CalculatorPage.jsx` → `COLUMNS_BY_KIND`. A column with `edit:` is editable; drop `edit:` to make it read-only.

Types: `text`, `number`, `date`, `select` (needs `options`), `suggest` (needs `suggestions`).

---

## Re-enable the Companies page

It's hidden, not deleted. `pages/CompaniesPage.jsx`, its hooks and its API
routes are all untouched and still work.

1. `crm/web/src/App.jsx` — add the import back:
   `import CompaniesPage from './pages/CompaniesPage';`
2. Same file — add the route:
   `<Route path="companies" element={<CompaniesPage />} />`
3. `crm/web/src/components/Layout.jsx` — add to `NAV_ITEMS`:
   `{ to: '/companies', label: 'Companies', icon: SpreadsheetIcon }`

To make it the landing page again, change the `index` route in `App.jsx`
from `<Navigate to="/master-sheet" replace />` back to `<CompaniesPage />`.

Same three steps re-enable the **Chat** page (`/chat`) — its route is
still there, so it only needs the `NAV_ITEMS` entry.

---

## Change which page opens after login

1. `crm/web/src/App.jsx` — the `index` route
2. Change `<Navigate to="/master-sheet" replace />` to whichever path you want

Currently the master sheet. Keep it as a `Navigate` rather than rendering
the page directly, so the address bar shows the real path and a refresh
lands in the same place.

---

## Change the loading screen

1. `crm/web/src/components/agentOrb/DianeBoot.jsx`
2. `STEPS` — the checklist shown, in order
3. `PREFETCH` — which pages are warmed while it runs
4. `MIN_VISIBLE_MS` — the shortest time it stays on screen

The bar only reaches 100% when every step genuinely resolves. Don't replace that with a timer.

---

## Change Diane's personality or rules

1. `crm/api/v1/agent/prompts/persona.js` — who she is, how she writes. Applies everywhere.
2. `crm/api/v1/agent/prompts/masterSheet.js` — master sheet rules only
3. `crm/api/v1/agent/prompts/calculator.js` — cash/bank/expensing rules
4. Restart the API

Keep these SHORT. Every line is re-sent on every message and counts against the daily token limit.

---

## Add or remove one of Diane's tools

1. `crm/api/v1/agent/tools/masterSheet.js` (or `calculator.js`) — add the tool object
2. Add it to the exported array at the bottom of that file
3. Restart the API

A tool needs `{ name, description, parameters, handler }`. Return `{ summary }` for the model, and add `reply` if the tool's output IS the final answer (that skips a model call and is much faster).

---

## Change Diane's voice

1. `crm/api/.env` → `AI_PROVIDER=openai` with `AI_API_KEY` covers it. `SPEECH_API_KEY` only if speech is on a different provider from chat.
2. `OPENAI_TTS_VOICE`, default `nova`. The youngest and brightest of the set; `shimmer` is breathier and sultrier but flatter, `coral` the most expressive but clearly older, `sage` calm. `ash`, `echo`, `onyx`, `verse` are male.
3. `OPENAI_TTS_INSTRUCTIONS` for HOW she reads, never how she sounds. Delivery only: pitch and softness are the voice, not this.
4. Restart the API

Without a key she uses the browser's own voice, which differs on every machine.

---

## Change the toast alerts

1. `crm/web/src/components/Toaster.jsx` → `LEVELS` for colours and icons
2. `crm/web/src/hooks/useNotifications.jsx` → `AUTO_DISMISS_MS` for timing, `MAX_VISIBLE` for the cap

Success fades after 5s. Errors and warnings stay until dismissed — deliberate, so a failed save is never missed.

---

## Change the admin password

1. `cd crm/api`
2. `npm run seed-admin -- <username> <password>`

It lives in the `admins` table as a bcrypt hash, never in `.env`.

---

## Add security: OTP or a secret PIN

Nothing like this exists yet. To add one:

1. Migration adding `otp_secret` (or `pin_hash`) to the `admins` table
2. `crm/api/v1/repos/admins.repo.js` — read/write that column
3. `crm/api/v1/auth.js` — after the password check passes, issue a short-lived "half-authenticated" token instead of the full session cookie
4. New route `POST /api/v1/auth/verify-otp` — checks the code, then issues the real session cookie
5. `crm/web/src/components/LoginForm.jsx` — a second step after the password
6. Rate-limit the verify route (`crm/api/configs/rateLimit.js`) or it can be brute-forced

**Decide first:** TOTP (an authenticator app, needs `otplib`) or a fixed PIN (simpler, much weaker). A fixed PIN is a second password, not a second factor.

---

## Add security: require a PIN before destructive actions

For bulk delete, burn month, reset master sheet.

1. `crm/api/v1/shared/` — new `confirmPin.helper.js` that checks a PIN against the `admins` row
2. Call it at the top of the destructive route, before anything is touched
3. Return 403 with a clear message if wrong
4. Frontend: ask for the PIN in the existing confirm modal and send it with the request

Do not put the PIN in a query string — it lands in server logs.

---

## Add security: lock Diane out of writes

If you want her read-only for a while:

1. `crm/api/v1/agent/tools/masterSheet.js` — remove `createRow`, `updateRow`, `deleteRow` from the exported array
2. Same for `calculator.js`
3. Restart the API

She then physically cannot write, regardless of what she's asked. Removing the tool is the real lock; telling her not to in the prompt is only a request.

---

## See what went wrong (debugging)

1. Settings page → turn dev mode ON
2. Logs page → filter by source `agent` (Diane) or `api` (everything else)

Every model failure, tool error, rate limit and rejected request is recorded with the provider, model, status code and the provider's own message. Dev mode off means nothing is written at all.

For a single conversation: open Diane → expand the conversation panel → download icon (dev mode only).
