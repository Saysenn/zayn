import { groupForNumber, toJid } from "../config/index.js";
import { logger } from "../system/logger.js";
import { socketFor } from "./connection.js";
import { splitMessage } from "./text/splitLongMessage.js";

/** the connection is down. different from "the send failed" — worth telling apart. */
export class NotConnectedError extends Error {}

/**
 * Send a message.
 *
 * @param to    who it's going to, E.164
 * @param from  which of OUR numbers to send it from. must be the number they
 *              messaged, or the reply pops up as a different chat.
 *
 * Long replies get split up. Parts go one at a time and in order — WhatsApp
 * doesn't promise ordering if you fire them off together, and half a payslip
 * turning up first is worse than the whole thing turning up slowly.
 */
export async function sendText(to, from, body) {
  const groupId = groupForNumber(from);
  if (!groupId)
    throw new Error(
      `cannot send from unmapped number ${from} — check WHATSAPP_NUMBERS`,
    );

  const socket = socketFor(groupId);
  if (!socket) {
    // nothing wrong with the message, the connection is just down.
    // throw so BullMQ retries it once we're back, instead of binning
    // somebody's answer.
    throw new NotConnectedError(
      `whatsapp not connected for group "${groupId}"`,
    );
  }

  const parts = splitMessage(body);
  const jid = toJid(to);

  try {
    for (const part of parts) {
      await socket.sendMessage(jid, { text: part });
    }
    if (parts.length > 1)
      logger.info({ to, parts: parts.length }, "sent multi-part reply");
    else logger.debug({ to, from, groupId }, "whatsapp message sent");
  } catch (err) {
    logger.error({ err, to, from, groupId }, "whatsapp send failed");
    throw err;
  }
}
