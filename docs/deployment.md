# Deployment

Zayn is local-only and has never been deployed. There is no Dockerfile or
compose file in the repo. This is the short list of what the code itself
demands if it ever goes on a server. Day to day commands: `run-it.md`.

## What the code needs

- **Env** (`crm/api/configs/env.js` throws without these): `DATABASE_URL`,
  `JWT_SECRET`, `COOKIE_SECRET`, `AGENT_API_KEY`. Copy the rest from
  `crm/api/.env.example`. Generate secrets with `openssl rand -hex 32`.
- **`NODE_ENV=production`**, or the session cookie is not `secure`
  (`configs/session.js`).
- **Web build**: `crm/web/vite.config.js` builds into `../api/public` so
  Express serves it. If nginx serves the static files instead, set
  `outDir: 'dist'`.
- **Node image**: use `node:22-slim`, not alpine. `bcrypt` is native and has
  no musl prebuilt.
- **Never ship** `node_modules`, `dist` or `.env`. A `node_modules` built on
  another OS breaks `bcrypt`.
- **One API process only.** Sessions (`configs/sessionStore.js`) and login
  tickets (`configs/loginTickets.js`) live in memory. A second replica breaks
  logins at random, and a restart logs everyone out.

## First run on a new database

```bash
cd crm/api
npm run migrate
npm run seed-admin -- <username> <password> <secret-code>
```

Without a secret code the account is locked: `/auth/login/verify` answers
403.

## Ports and proxy

- Bind every Docker port to `127.0.0.1:` (e.g. `127.0.0.1:3000:3000`).
  Docker bypasses UFW, so a bare `3000:3000` is public. Check with
  `ss -tlnp`.
- `crm/api/v1/app.js` sets `trust proxy 1`. nginx must send
  `X-Forwarded-For` and `X-Forwarded-Proto`, or the login rate limiter sees
  every request as nginx and one bad actor locks out everyone.
- Proxy `/socket.io/` with the websocket upgrade headers, or live updates
  silently stop.
- `client_max_body_size 25m` (the master sheet upload caps at 20MB) and
  `proxy_read_timeout 120s` on `/api/` (month sheets are slow).

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
}
location /socket.io/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host       $host;
    proxy_read_timeout 3600s;
}
```

## Check it

```bash
curl localhost:3000/health     # {"ok":true}
```

Then sign in (including the secret code), upload a master sheet, export a
month, and run a backup (`run-it.md` → Backups) with the copy kept off the
box.
