import { setNumbers } from "../config/index.js";
import { redis, withRedisTimeout } from "../system/redis.js";
import { logger } from "../system/logger.js";

/**
 * THE LAST NUMBER LIST THE CRM GAVE, kept in Redis.
 *
 * So a worker restarted while the CRM is down still connects the numbers
 * registered in Settings → Whatbot, and the web process (/ready) knows them
 * without asking the CRM itself. No expiry: an old list beats none.
 */
const KEY = "whatsapp:numbers";

export async function saveNumbers(entries) {
  try {
    await withRedisTimeout(redis.set(KEY, JSON.stringify(entries)));
  } catch (err) {
    logger.debug({ err }, "could not save the number list");
  }
}

/** The saved list, or null when there is none (or Redis did not answer). */
export async function readNumbers() {
  try {
    const raw = await withRedisTimeout(redis.get(KEY));
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

/** The web process: take the saved list, if there is one. */
export async function refreshFromCache() {
  const list = await readNumbers();
  if (list) setNumbers(list);
}
