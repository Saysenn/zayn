import { groupForNumber, toJid } from "../config/index.js";
import { logger } from "../system/logger.js";
import { socketFor } from "./connection.js";
import { NotConnectedError } from "./sendMessage.js";

/**
 * Send a picture with a caption: the expense bot's preview note (his call
 * 2026-10-07, "always"; it opens full screen when tapped). Same guards as
 * sendText: it goes out on the number they messaged, or not at all.
 *
 * @param to    who it's going to, E.164
 * @param from  which of OUR numbers to send it from
 * @param image { content: Buffer, caption: string, mimetype?: string }
 */
export async function sendImage(to, from, image) {
  const groupId = groupForNumber(from);
  if (!groupId) throw new Error(`cannot send from unmapped number ${from} — check WHATSAPP_NUMBERS`);
  const socket = socketFor(groupId);
  if (!socket) throw new NotConnectedError(`whatsapp not connected for group "${groupId}"`);
  await socket.sendMessage(toJid(to), {
    image: image.content,
    caption: image.caption,
    mimetype: image.mimetype ?? "image/png",
  });
  logger.info({ to: `${to.slice(0, 6)}***`, groupId, bytes: image.content.length }, "image sent");
}
