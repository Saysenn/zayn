import { crmConfig } from "../config/index.js";
import { env } from "../config/env.js";
import { logger } from "../system/logger.js";

/**
 * WHICH LOOK THE PICTURES TAKE: the one picked in the CRM (Settings ->
 * Whatbot -> Picture style), so WhatBot's pay pictures match the expense
 * ones. Asked every 5 minutes at most; if the CRM cannot be reached (or
 * WhatBot has been moved somewhere without it), PICTURE_STYLE in .env,
 * else the clean sheet.
 */
const STYLES = ["sheet", "notebook", "receipt", "ledger", "chalkboard"];
let cache = { at: 0, style: null };

/**
 * THE PAY BREAKDOWN'S LOOK: its own, from .env, a handwritten note by
 * default (his call 2026-10-07: "like it's been written down on paper").
 * Not the CRM's expense style: payments is WhatBot's own.
 */
export function payPictureStyle() {
  return STYLES.includes(env.PAY_PICTURE_STYLE) ? env.PAY_PICTURE_STYLE : "notebook";
}

export async function pictureStyle() {
  if (cache.style && Date.now() - cache.at < 5 * 60 * 1000) return cache.style;
  const fallback = STYLES.includes(env.PICTURE_STYLE) ? env.PICTURE_STYLE : "sheet";
  if (!crmConfig.apiUrl || !crmConfig.apiKey) return fallback;
  try {
    const res = await fetch(`${crmConfig.apiUrl}/api/v1/agent/expenses/style`, {
      headers: { "x-api-key": crmConfig.apiKey },
      signal: AbortSignal.timeout(3000),
    });
    const { style } = res.ok ? await res.json() : {};
    cache = { at: Date.now(), style: STYLES.includes(style) ? style : fallback };
  } catch (err) {
    logger.debug({ err: err.message }, "picture style: CRM not reached, using the fallback");
    cache = { at: Date.now() - 4 * 60 * 1000, style: fallback };
  }
  return cache.style;
}
