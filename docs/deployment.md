# Deployment

Getting the CRM onto a server, in the order the steps actually have to
happen. Anything runnable day to day is in `run-it.md`; this is the one off.

**Two things in this list the code does not use yet.** The `portal` service
has no app behind it (`feature.md` item 4), and nothing reads Redis: sessions and
login tickets live in process memory. Redis is stood up here ready for multi
user; step 10 says what wiring it involves. Both are marked.

**Self hosted Supabase and Redis**, decided 2026-08-25. Supabase is stood up
as the whole stack rather than plain Postgres, so Studio comes with it.

**No GitHub, no Docker Hub account, and neither is needed.** Our services
are **built on the server** and never pushed to a registry. Code gets there
by `rsync` (step 8).
Anonymous pulls of public base images (`node`, `nginx`, `redis`, Supabase's
own) and cloning Supabase's public repo need no login, only outbound
internet. The one thing to know: Docker Hub rate limits anonymous pulls to
100 per 6 hours per IP, which a rebuild loop can reach. If you see
`toomanyrequests`, wait it out; the built images are cached locally so
normal redeploys do not re-pull.

Target shape: two compose projects on one box, sharing a network, behind
nginx on the host.

```
browser ──▶ nginx (host, TLS) ──▶ 127.0.0.1:3000  api ──┐
                                  127.0.0.1:8080  web   │
                                  127.0.0.1:8081  portal (soon)
                                  127.0.0.1:8000  Studio (locked down)
                                                        │
                        supabase_default network ◀──────┤
                          db, kong, studio, auth…       │
                        crm network ◀───────────────────┘
                          redis
```

---

## 1. Buy the domain and point it

Any registrar. Then two A records at the DNS host, both to the server's IP:

```
@        A    203.0.113.10
portal   A    203.0.113.10      # only if you take the subdomain route
```

Wait for propagation before certbot, or it cannot validate:

```bash
dig +short crm.com
```

## 2. Get a server

**4 vCPU / 8GB, and 40GB of disk.** Not the 4GB a plain CRM would need:
Supabase's full stack is a dozen containers and is the reason for the size.
Ubuntu 24.04.

```bash
ssh root@203.0.113.10
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

Lock it down. **Do this before Docker**, see the warning in step 7:

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

## 3. Install Docker and nginx

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
apt install -y nginx
```

## 4. Point the web build at its own folder

**Do this first or the image copies nothing.** `crm/web` currently builds
into `crm/api/public` so Express can serve it; with nginx serving the static
files that is the wrong place. In `crm/web/vite.config.js`:

```js
build: { outDir: 'dist' },
```

## 5. Dockerfiles

`crm/api/Dockerfile` — **`slim`, not `alpine`**. `bcrypt` is a native
binding and alpine's musl has no prebuilt for it, so `npm ci` tries to
compile and fails.

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

`crm/web/Dockerfile` — and the same file in `crm/portal/` when it exists.

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

`crm/web/nginx.conf` — the SPA fallback, inside the container:

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    location / { try_files $uri $uri/ /index.html; }
}
```

`.dockerignore` in each, or you ship `node_modules` and `.env`:

```
node_modules
dist
.env
.env.*
```

## 6. docker-compose.yml

At `crm/`.

**Our own services use `build:`; `image:` appears only for stock upstream
images like Redis.** That is what makes this work with no registry: nothing
we wrote is ever pushed or pulled, the server compiles it from the source
rsync put there. The upstream images are anonymous public pulls.

```yaml
services:
  api:
    build: ./api
    env_file: ./api/.env
    restart: unless-stopped
    ports: ["127.0.0.1:3000:3000"]
    # BOTH networks. `crm` reaches redis, `supabase` reaches the database,
    # which lives in a different compose project (step 9).
    networks: [crm, supabase]
    depends_on: [redis]

  web:
    build: ./web
    restart: unless-stopped
    ports: ["127.0.0.1:8080:80"]
    networks: [crm]

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}",
              "--appendonly", "yes", "--save", "60", "1"]
    volumes: [redisdata:/data]
    networks: [crm]
    # No published port at all. Only the api needs it, and it reaches it
    # over the network by name.

  # portal: not built yet. See feature.md item 5.
  # portal:
  #   build: ./portal
  #   restart: unless-stopped
  #   ports: ["127.0.0.1:8081:80"]
  #   networks: [crm]

volumes:
  redisdata:

networks:
  crm:
  # Created by Supabase's own compose. `external` means "join it, do not
  # make it", so this fails loudly if step 9 has not run rather than
  # quietly starting an api that cannot see a database.
  supabase:
    external: true
    name: supabase_default
```

`REDIS_PASSWORD` is read from `api/.env` by compose. **Compose reads
`.env` from its own directory** (`crm/`), not from `env_file`, so put a
second copy of that one line in `crm/.env` or the substitution resolves to
empty and Redis starts with no password.

## 7. The `127.0.0.1:` prefix is not optional

Docker writes its own iptables rules and **bypasses UFW**. A bare
`"3000:3000"` publishes the API straight to the internet with no TLS and no
nginx in front, whatever step 2 said. Bind every port to localhost.

Check after the first `up`:

```bash
ss -tlnp | grep -E '3000|8080'    # must show 127.0.0.1, never 0.0.0.0
```

## 8. Upload the code

```bash
rsync -avz --exclude node_modules --exclude .env --exclude dist \
  ./crm/ deploy@203.0.113.10:/srv/crm/
```

rsync is the whole transfer story: there is no repo to pull from and no
registry to pull images from, so the source goes up and the server builds
it. **`.env` is excluded on purpose** and is written by hand in step 11.
`dist` and `node_modules` are excluded because the containers build their
own; sending a Windows-built `node_modules` to Linux breaks native `bcrypt`.

## 9. Self hosted Supabase

Their compose file, not ours. Public repo, no account needed:

```bash
sudo mkdir -p /srv && cd /srv
git clone --depth 1 https://github.com/supabase/supabase
# no git? curl -L https://github.com/supabase/supabase/archive/refs/heads/master.tar.gz | tar xz
cd /srv/supabase/docker
cp .env.example .env
```

### 9a. Name the project, or the network name is a surprise

The directory is `docker`, so compose would call the network `docker_default`
and step 6 could not reference it. Pin it. At the top of `/srv/supabase/docker/.env`:

```
COMPOSE_PROJECT_NAME=supabase
```

Network becomes `supabase_default`.

### 9b. Change every default secret

**The shipped `.env` values are published in a public repo.** Left alone,
anyone who knows Supabase can read your payroll. Replace all of these:

```bash
openssl rand -hex 32     # POSTGRES_PASSWORD
openssl rand -hex 32     # JWT_SECRET        (Supabase's own, not the CRM's)
openssl rand -hex 32     # SECRET_KEY_BASE
openssl rand -hex 16     # VAULT_ENC_KEY     (must be exactly 32 chars)
```

Plus `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD`, which gate Studio.

**`ANON_KEY` and `SERVICE_ROLE_KEY` are not random strings.** They are JWTs
signed with the `JWT_SECRET` above, so changing the secret without
regenerating them breaks every Supabase service. Generate them with the
`jsonwebtoken` the CRM already has:

```bash
cd /srv/crm/api && node -e "
const jwt = require('jsonwebtoken');
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 60 * 60 * 24 * 365 * 10;
for (const role of ['anon', 'service_role']) {
  console.log(role.toUpperCase() + '_KEY=' + jwt.sign({ role, iss: 'supabase', iat, exp }, process.argv[1]));
}
" '<the JWT_SECRET you just generated>'
```

### 9c. Start it

```bash
cd /srv/supabase/docker
docker compose pull
docker compose up -d
docker compose ps          # every service should be healthy
```

**If `analytics` will not start, remove it.** Logflare is the service that
most often blocks a self hosted stack from coming up, and nothing in this
CRM reads it. Delete its block from `docker-compose.yml` along with the
`depends_on: analytics` lines in the services that name it.

### 9d. Give the CRM its own database role

The api should not connect as the superuser:

```bash
docker compose exec db psql -U postgres -c \
  "CREATE ROLE crm LOGIN PASSWORD '<another random string>';"
docker compose exec db psql -U postgres -c \
  "CREATE DATABASE crm OWNER crm;"
```

Then in `/srv/crm/api/.env`:

```
DATABASE_URL=postgres://crm:<that password>@db:5432/crm
```

`db` is Supabase's service name, resolved over the shared network from
step 6. Not `localhost`, which inside the api container is the api.

### 9e. Studio stays off the internet

Kong publishes Studio on 8000. **Do not add an nginx block for it.** Reach
it over an SSH tunnel from your own machine:

```bash
ssh -L 8000:127.0.0.1:8000 deploy@203.0.113.10
# then open http://localhost:8000
```

Confirm it is not public: `ss -tlnp | grep 8000` must show `127.0.0.1`. If
Supabase's compose binds `0.0.0.0`, change its port mapping to
`127.0.0.1:8000:8000`.

### 9f. Back it up from day one

It is payroll data. Configure the CRM's verified backup scheduler before
putting the database on the server:

```bash
export BACKUP_DIR=/srv/backups/crm
export BACKUP_INTERVAL_HOURS=24
cd /srv/crm/api && npm run backup
```

The API runs the backup immediately at boot and then at the configured
interval. Verify the dump with `npm run backup:verify` and copy the backup
directory off the box. A backup on the same disk as the database is not a
backup.

## 10. Redis

The service is in step 6's compose. Two things to set and one to know.

```bash
openssl rand -hex 32     # REDIS_PASSWORD
```

Put it in **both** `crm/api/.env` (so the api can read it) and `crm/.env`
(so compose can substitute it into the `redis` command).

Check it came up with the password on:

```bash
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" ping   # PONG
docker compose exec redis redis-cli ping                        # NOAUTH
```

The second must fail. If it answers `PONG`, the substitution was empty and
Redis is open to anything on the `crm` network.

**Nothing in the CRM reads it yet, and that is a real gap, not an
oversight.** `configs/sessionStore.js` holds ONE session id for the whole
process and `configs/loginTickets.js` holds pending tickets in a `Map`. So
until they move to Redis:

- **`api` stays at one replica.** `docker compose up --scale api=3` breaks
  logins at random: the ticket is created in one container's memory and the
  verify request lands on another, which answers "that took too long".
- **A restart logs everyone out** and drops any half finished login.

Wiring it is blocker 1 of `feature.md` item 4, and it is what has to happen
before there is a second user, not before there is a second server.

## 11. Write `api/.env` on the server

Not in the repo, never committed. Generate the secrets rather than inventing
them:

```bash
openssl rand -hex 32     # once for JWT_SECRET
openssl rand -hex 32     # again for COOKIE_SECRET
openssl rand -hex 32     # again for AGENT_API_KEY
```

```bash
nano /srv/crm/api/.env
```

Required or the container exits on boot (`configs/env.js` throws):
`DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `AGENT_API_KEY`. Copy the
rest from `api/.env.example`. Set `NODE_ENV=production`, or the session
cookie is not marked `secure`.

## 12. Start it

Supabase (step 9) must already be up, or the `supabase_default` network does
not exist and this refuses to start.

```bash
cd /srv/crm
docker compose up -d --build
docker compose ps
```

Prove each service before touching nginx, so nginx is the only thing left
that can be wrong:

```bash
curl localhost:3000/health     # {"ok":true}
curl -I localhost:8080         # 200
docker compose exec api node -e "require('./configs/db').query('select 1').then(()=>console.log('db ok'))"
```

If the api restarts in a loop, it is almost always `.env`: `configs/env.js`
throws on a missing `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET` or
`AGENT_API_KEY`. `docker compose logs api` says which.

## 13. Migrations and the admin account

**Neither runs by itself.** Nothing works until both do.

```bash
docker compose exec api npm run migrate
docker compose exec api npm run seed-admin -- admin 'Password' 'SecretCode'
```

The third argument is the login secret code (migration 039). Without one the
account is **locked, not exempt**: `/auth/login/verify` answers 403.

## 14. nginx, on HTTP first

**Certbot writes the TLS config for you.** A config naming
`/etc/letsencrypt/...` before those files exist stops nginx from starting at
all, which is the usual chicken and egg here. So put up port 80 only:

```bash
sudo nano /etc/nginx/sites-available/crm
```

```nginx
server {
    listen 80;
    server_name crm.com www.crm.com;
    location /api/       { proxy_pass http://127.0.0.1:3000; }
    location /socket.io/ { proxy_pass http://127.0.0.1:3000; }
    location /           { proxy_pass http://127.0.0.1:8080; }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/crm
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 15. Certificates

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d crm.com -d www.crm.com
sudo systemctl status certbot.timer     # renewal is automatic
```

Certbot rewrites the file: adds the 443 block, the cert paths and the 80 to
443 redirect.

## 16. Finish the nginx config

Go back into the file certbot rewrote and add these to the **443** server
block. Every one of them matters:

```nginx
    client_max_body_size 25m;      # multer caps the xlsx at 20m

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # generating a month sheet beats the 60s default
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_read_timeout 3600s;
    }

    location / { proxy_pass http://127.0.0.1:8080; }
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**The `X-Forwarded-*` headers are not decoration.** `app.js` sets
`trust proxy 1`, and both the login rate limiter and the `secure` cookie
flag read them. Drop them and every request looks like it comes from nginx,
so ten failed logins from anyone locks out everyone.

**Without the `/socket.io/` block** those requests fall through to `/` and
get `index.html` instead of a websocket, and live updates silently stop.

## 17. The portal, when it exists

Decided: **`crm.com/portal`**, same origin, separate app. Same origin means
the session cookie just works, with no `domain: '.crm.com'` widening it
across every future subdomain and no second login. See `feature.md` item 5.

Uncomment the `portal` service, then in the 443 block:

```nginx
    location /portal/ { proxy_pass http://127.0.0.1:8081/; }
```

For `portal.crm.com` instead: a second `server` block, the DNS record from
step 1, `-d portal.crm.com` on certbot, and `domain: '.crm.com'` added to
`cookieOptions` in `api/configs/session.js`.

## 18. Deploying an update

From your machine, then on the server. No registry, so the build happens
there:

```bash
# local
rsync -avz --exclude node_modules --exclude .env --exclude dist \
  ./crm/ deploy@203.0.113.10:/srv/crm/

# server
cd /srv/crm
docker compose up -d --build
docker compose exec api npm run migrate     # only if migrations are new
docker compose logs -f api
```

`--build` is not optional here: without a registry there is no new image to
pull, so leaving it off restarts the old code and looks like the deploy
silently did nothing.

---

## Before you call it live

- [ ] `ss -tlnp` shows `127.0.0.1` on 3000, 8080 and 8000, never `0.0.0.0`.
      Port 8000 is Supabase Studio and must be tunnel only.
- [ ] Supabase's `.env` has no value still matching `.env.example`.
- [ ] `redis-cli ping` without the password is refused.
- [ ] `https://crm.com` loads and `http://` redirects to it.
- [ ] You can sign in, including the secret code step.
- [ ] An upload of `docs/master.xlsx` previews and commits.
- [ ] An export downloads, with the progress bar moving.
- [ ] `pg_dump` runs and the file is not empty.
- [ ] **Read `sec-audit.md` first.** Two findings there should be fixed
      before this is public: the session cookie is written to the logs on
      every request, and a live API key sits in a comment in `api/.env`.
