# Accounts

The things with logins — Meta, the LLM provider, Google. Installing on the machine itself is
covered by the other pages in this folder; start at [index.md](index.md).

Everything that must be done outside the codebase. Each section ends with the `.env` values it produces.

---

## 1. Upstash (Redis) — blocks any local test

1. upstash.com → create a Redis database
2. Region: closest to your Render region
3. Copy the **TCP** connection string (`rediss://…`)

⚠️ Not the REST URL — BullMQ needs the Redis protocol.

```
REDIS_URL=rediss://...
```

---

## 2. The phones — blocks any WhatsApp test

There is **no account to register anywhere**. No Twilio, no Meta, no API key. Five ordinary
WhatsApp accounts and a QR scan. See [baileys.md](../baileys.md).

Per number:

1. SIM into its own phone. Must not already be on WhatsApp
2. Install WhatsApp, register, verify by SMS
3. Profile name = the group name, add a photo — this is what employees see
4. **Warm it up for one to two weeks.** Real conversations with real colleagues. A fresh
   account that immediately messages a hundred people is the fastest ban there is
5. Run the worker, scan the QR: WhatsApp → Settings → Linked devices → Link a device

```
WHATSAPP_NUMBERS=milkman:+447700900001,sprite:+447700900002
WHATSAPP_AUTH_DIR=auth_info
```

The groupId must match the group name in the roster, or the payday check skips everyone
in it.

⚠️ `auth_info/` **is** the link. Back it up with the payroll backups, never commit it.
Lose it and every phone needs rescanning.

⚠️ Phones stay **plugged in and switched on**, in a locked drawer. Off for ~2 weeks and
WhatsApp drops the link. Each one also holds that group's entire conversation history —
treat them as five copies of the payroll data.

---

## 4. OpenAI — blocks the agent

1. platform.openai.com → API keys → create a key
2. Set a **monthly spend limit** before going live
3. Billing → add credit

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

⚠️ The key is only shown once. Store it now.

---

## 5. Google service account — blocks the real data source

1. console.cloud.google.com → new project
2. APIs & Services → Library → enable **Google Sheets API**
3. Credentials → Create credentials → **Service account**
4. Keys → Add key → JSON → download
5. Open the sheet → Share → paste the service account's email → **Viewer**

⚠️ Use a service account, not your personal login. A personal login breaks when you
change your password or leave the company.

The JSON is a secret — never commit it. On Render, paste the whole JSON as one env var.

```
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_SHEET_ID=<from the sheet URL>
```

---

## 6. The sheet — blocks real answers

Add these columns (see [db-migration.md](../db-migration.md)):

```
employee_code | full_name | phone | role | reports_to | group | status | payment_method
basic | overtime | bonus | deductions | net | currency
employer_ni | pension | hours | charge_rate
```

1. Number every row `EMP001`…
2. Phones in E.164 (`+447XXXXXXXXX`), from HR's SIM list
3. `role`: `courier` / `employee` / `mid` / `director` / `manager` / `hr` — manager is highest
4. `reports_to`: their boss's **code**, blank only for managers
5. `status`: `active` / `inactive` — never delete leaver rows
6. Upload to Drive → convert to Google Sheets → share with the service account

⚠️ Needs HR sign-off on the phone↔employee mapping and the reporting tree before go-live.
A wrong `reports_to` exposes the wrong team's salaries.

---

## 7. The machine — blocks production

Both processes under pm2 on the one laptop. No hosting account, no domain, no tunnel —
nothing needs to reach the machine from outside.

Only ever run **one** worker. It holds the five WhatsApp sessions, and a second instance
would give WhatsApp two devices fighting over the same account.

---

## Order

| Do now | Blocks |
|---|---|
| 2 First SIM + warm-up (slowest) | any real WhatsApp test |
| 1 Redis | any local test |
| 4 OpenAI | agent |
| 6 The payroll file (HR, slow) | real answers |
| 7 The machine | go-live |

Start 6 today — it depends on other people and takes the longest.
