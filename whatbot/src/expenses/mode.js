import { redis, withRedisTimeout } from "../system/redis.js";
import { logger } from "../system/logger.js";

/**
 * WHICH SIDE A REGISTERED ADMIN IS TALKING TO, his call 2026-10-07.
 *
 * An admin can be on both sides: sending the group's expenses, and asking
 * about their own pay. They say which by typing one word:
 *
 *   expense   everything goes to the CRM's expense brain
 *   payments  everything goes to the normal agent, as for anyone else
 *
 * Remembered per admin per group number until they switch. EXPENSE BY
 * DEFAULT: being registered is what they are here for.
 */

export const EXPENSE = "expense";
export const PAYMENTS = "payments";

const key = (phone, group) => `expense-mode:${phone}:${String(group).toUpperCase()}`;

export const EXPENSE_WORD = /^\s*(?:expenses?|expense mode)\s*[.!]*\s*$/i;
export const PAYMENTS_WORD = /^\s*(?:payments?|payments? mode)\s*[.!]*\s*$/i;

export async function modeOf(phone, group) {
  try {
    const saved = await withRedisTimeout(redis.get(key(phone, group)));
    return saved === PAYMENTS ? PAYMENTS : EXPENSE;
  } catch (err) {
    // Redis down: the default, which is the side they are registered for.
    logger.warn({ err: err.message }, "expense mode: could not read, using expense");
    return EXPENSE;
  }
}

export async function setMode(phone, group, mode) {
  try {
    await withRedisTimeout(redis.set(key(phone, group), mode));
  } catch (err) {
    logger.warn({ err: err.message }, "expense mode: could not save");
  }
}

export const MODE_REPLIES = {
  [EXPENSE]: (group) =>
    `📒 *Expense mode.* Send *${group}* expenses: a text, a receipt photo or a file.\nType *payments* to ask about your pay instead.`,
  [PAYMENTS]: () =>
    "💷 *Payments mode.* Ask about your pay as usual.\nType *expense* to send expenses again.",
  switchedForFile: () =>
    `📒 _Switched to expense mode for this file. Type *payments* to switch back._\n\n`,
  handedOver: "\n\n_That one isn't an expense, so I answered it as a payments question. Type *payments* to stay on pay, or keep sending expenses._",
};
