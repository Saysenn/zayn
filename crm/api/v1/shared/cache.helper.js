/**
 * A tiny in-process read cache with a version stamp for invalidation.
 *
 * ---- why not Redis ----
 * Redis exists to share cache BETWEEN processes. The CRM runs one API
 * process and serves 1-3 admins, so a Map in that process is identical in
 * effect with no service to run, no connection to drop and no second
 * source of truth. whatbot has Redis because it genuinely needs a roster
 * shared across its server and worker; this doesn't. Revisit only if the
 * API is ever run as more than one instance.
 *
 * ---- why a version counter and not per-key deletes ----
 * Diane's reads are things like "search for Zane", "find rows needing
 * review", "audit the sheet". A single row edit can change the answer to
 * any of them, and working out which cached queries a given write affects
 * is exactly the kind of bookkeeping that goes subtly wrong and serves
 * stale pay data. So writes bump one counter, and every key minted before
 * that bump is dead. Cheap, and impossible to get half-right.
 *
 * The cost is that any write throws away every cached read. At this scale
 * that's the correct trade: a wrong number on screen is far more expensive
 * than a repeated query.
 */

const DEFAULT_TTL_MS = 30_000;

function createCache({ ttlMs = DEFAULT_TTL_MS, max = 500 } = {}) {
  const entries = new Map();
  let version = 0;
  let hits = 0;
  let misses = 0;

  function evictIfFull() {
    if (entries.size < max) return;
    // Oldest insertion first — Map preserves insertion order, so this is
    // FIFO rather than true LRU. With a 30s TTL the difference doesn't
    // matter, and tracking access order would cost more than it saves.
    const oldest = entries.keys().next().value;
    entries.delete(oldest);
  }

  /**
   * Read through the cache. `fn` is only called on a miss.
   *
   * Note it caches the PROMISE, not the resolved value: two requests
   * arriving together for the same key share one query instead of both
   * missing and both hitting the database.
   */
  function wrap(key, fn) {
    const hit = entries.get(key);
    if (hit && hit.version === version && Date.now() - hit.at < ttlMs) {
      hits += 1;
      return hit.value;
    }

    misses += 1;
    const value = Promise.resolve()
      .then(fn)
      .catch((err) => {
        // A failed query must never be cached — otherwise one transient
        // network blip serves an error for the next 30 seconds.
        entries.delete(key);
        throw err;
      });

    evictIfFull();
    entries.set(key, { value, at: Date.now(), version });
    return value;
  }

  // Called by every write. Everything cached before this moment is stale
  // by definition, so nothing has to be enumerated.
  function invalidate() {
    version += 1;
  }

  function stats() {
    return { size: entries.size, version, hits, misses };
  }

  return { wrap, invalidate, stats };
}

module.exports = { createCache };
