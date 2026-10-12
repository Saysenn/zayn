# Redis

Queue, conversation memory, rate limits, opt-outs, payday records.

## Local (Homebrew)

```bash
brew install redis
brew services start redis
echo "appendonly yes" >> /opt/homebrew/etc/redis.conf    # Intel: /usr/local/etc/
brew services restart redis
```

```
REDIS_URL=redis://localhost:6379
```

Turn on `appendonly`: without it a crash can lose the last few minutes — including
someone's **STOP**.

With Docker, bind `127.0.0.1:6379:6379`, never `6379:6379` (exposes it to the network).

## Upstash

Use the **TCP** string (`rediss://…`), not the REST URL — BullMQ cannot use REST.

## Check

```bash
redis-cli ping                     # PONG
redis-cli config get appendonly    # appendonly yes
```
