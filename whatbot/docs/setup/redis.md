# Redis

Queue, conversation memory, rate limits, opt-outs. Runs on the machine — none of it should
live in the cloud.

## Install

```bash
brew install redis
brew services start redis          # starts now, and on every boot
redis-cli ping                     # → PONG
```

## Turn on persistence

The default keeps periodic snapshots and can lose the last few minutes. That could mean
losing someone's **STOP** — and messaging a person who explicitly opted out.

```bash
echo "appendonly yes" >> /opt/homebrew/etc/redis.conf    # Intel Macs: /usr/local/etc/
brew services restart redis
```

## Point the app at it

```bash
# .env
REDIS_URL=redis://localhost:6379
```

No password, no TLS — it only listens on localhost, so nothing on the office network can
reach it.

## Docker instead?

Only worth it if Postgres is also in Docker and you want them managed together. On its own,
Homebrew is one less thing that has to start at login.

If you do: bind to `127.0.0.1:6379:6379`, never `6379:6379`.

## Check

```bash
redis-cli ping                     # PONG
redis-cli config get appendonly    # appendonly yes
```
