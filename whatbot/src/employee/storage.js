import { redis } from "../system/redis.js";
import { logger } from "../system/logger.js";
import { AssignmentSchema } from "./types.js";

const KEY = "assignments:all";
const PHONE_INDEX = "assignments:byPhone";
const VERSION_KEY = "assignments:version";

/**
 * The only file that touches the data store.
 * Moving from Redis to Postgres later means rewriting this file and nothing else.
 */

/**
 * Cache the whole sheet in memory.
 *
 * Answering one message needs the full list several times over — who is this,
 * what do they hold, which of it is in this group, then totalling. Without this
 * each of those is a Redis round trip plus parsing the whole sheet.
 *
 * The version key means a sync in the worker also invalidates the web process's
 * copy, instead of it serving stale figures until the TTL runs out.
 */
const CACHE_TTL_MS = 60_000;
let cache = null;

export async function replaceAll(assignments) {
  // one phone can only belong to one person, and a person holds many
  // assignments — so the index maps phone -> personId, not phone -> row.
  const byPhone = {};
  for (const a of assignments) {
    if (a.phone && a.status === "active") byPhone[a.phone] = a.personId;
  }

  const version = `${Date.now()}-${assignments.length}`;

  const tx = redis.multi();
  tx.set(KEY, JSON.stringify(assignments));
  tx.del(PHONE_INDEX);
  if (Object.keys(byPhone).length > 0) tx.hset(PHONE_INDEX, byPhone);
  tx.set(VERSION_KEY, version);
  await tx.exec();

  cache = { at: Date.now(), version, rows: assignments };
}

export async function findAll() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

  // one cheap read to find out whether we need the expensive one
  const version = (await redis.get(VERSION_KEY)) ?? "";
  if (cache && cache.version === version) {
    cache.at = Date.now();
    return cache.rows;
  }

  const raw = await redis.get(KEY);
  if (!raw) return [];

  const parsed = AssignmentSchema.array().safeParse(JSON.parse(raw));
  if (!parsed.success) {
    logger.error(
      { issues: parsed.error.issues.slice(0, 5) },
      "stored assignments failed validation",
    );
    return [];
  }

  cache = { at: Date.now(), version, rows: parsed.data };
  return parsed.data;
}

/**
 * Everything one person holds, across every group.
 *
 * Callers narrow it to a group themselves — see `access.readable`. Building it
 * whole here is what lets the payday check ask "which groups is this person in"
 * without reading the sheet five times.
 */
export function personFrom(rows, personId) {
  const assignments = rows.filter((a) => a.personId === personId);
  if (assignments.length === 0) return null;

  const first = assignments[0];
  return {
    personId,
    personName: first.personName,
    phone: assignments.find((a) => a.phone)?.phone ?? "",
    assignments,
  };
}

export async function findByPhone(phone) {
  const rows = await findAll();

  // usually answered from the cached sheet. the phone index is the cold path.
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    const hit = rows.find((a) => a.phone === phone && a.status === "active");
    return hit ? personFrom(rows, hit.personId) : null;
  }

  const personId = await redis.hget(PHONE_INDEX, phone);
  return personId ? personFrom(rows, personId) : null;
}

/** test helper — force the next read to go to Redis */
export function clearCache() {
  cache = null;
}
