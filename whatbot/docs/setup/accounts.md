# Accounts

The things with logins. Each section ends with the `.env` values it produces.

## 1. The phones

Per group — full steps and risks in [baileys.md](../baileys.md):

1. SIM into its own phone (not already on WhatsApp), register, profile name = group name
2. **Warm it up 1–2 weeks** before any bulk use
3. Start the worker, scan the QR (or `WHATSAPP_LINK_WITH=code` for a typed code)

```
WHATSAPP_NUMBERS=MILKMAN:+440000000001,INDIGO:+440000000002
WHATSAPP_AUTH_DIR=auth_info
```

The group ID must match the roster's group, or the payday check skips everyone in it.
`auth_info/` is the link: back it up, never commit it.

## 2. OpenAI

platform.openai.com → API keys. Set a **monthly spend limit** and add credit. The key is
shown once.

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

`OPENAI_BASE_URL` points it at any OpenAI-compatible API instead.

## 3. CRM

The worker pulls its roster from the CRM. Every entry point refuses to start without the
first two (offline tools accept any value).

```
CRM_API_URL=...
CRM_AGENT_API_KEY=...
ADMIN_REPLY_WEBHOOK_KEY=...   # CRM chatbox → worker on WORKER_PORT (3002)
```

`WORKER_PORT` must match the CRM's `WHATBOT_WEBHOOK_URL`.

## 4. Google Sheets (optional, `DATA_SOURCE=sheets`)

1. console.cloud.google.com → new project → enable **Google Sheets API**
2. Credentials → **Service account** → Keys → Add key → JSON
3. Share the sheet with the service account's email as **Viewer**

Use a service account, not a personal login. The JSON is a secret.

```
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_SHEET_ID=<from the sheet URL>
```
