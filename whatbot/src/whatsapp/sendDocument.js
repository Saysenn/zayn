import { groupForNumber, toJid } from "../config/index.js";
import { logger } from "../system/logger.js";
import { socketFor } from "./connection.js";
import { NotConnectedError } from "./sendMessage.js";

/**
 * Send a file.
 *
 * The same shape as `sendText` and the same guards, deliberately — a document
 * goes out on exactly one socket, the one for the number they messaged, or it
 * arrives from a sender they have never heard of.
 *
 * @param to    who it's going to, E.164
 * @param from  which of OUR numbers to send it from
 *
 * A document is not a message that can be scrolled past. It lands in WhatsApp's
 * media folder, gets picked up by whatever backs the phone up, and stays there.
 * So this is only ever called with something built for the verified sender —
 * see `tools/format/csv.ts`. Never send a file nobody asked for.
 *
 * `Attachment` is defined with the tool contract, not here. A tool has to be
 * able to describe a file without knowing WhatsApp exists — imports only ever
 * go channels -> tools, never back.
 */
export async function sendDocument(to, from, file) {
  const groupId = groupForNumber(from);
  if (!groupId)
    throw new Error(
      `cannot send from unmapped number ${from} — check WHATSAPP_NUMBERS`,
    );

  const socket = socketFor(groupId);
  if (!socket) {
    // same reasoning as sendText: nothing is wrong with the file, the
    // connection is down. throw so BullMQ retries rather than binning it.
    throw new NotConnectedError(
      `whatsapp not connected for group "${groupId}"`,
    );
  }

  try {
    await socket.sendMessage(toJid(to), {
      document: file.content,
      fileName: file.fileName,
      mimetype: file.mimetype,
      caption: file.caption,
    });
    logger.info(
      {
        to,
        from,
        groupId,
        fileName: file.fileName,
        bytes: file.content.length,
      },
      "whatsapp document sent",
    );
  } catch (err) {
    logger.error(
      { err, to, from, groupId, fileName: file.fileName },
      "whatsapp document send failed",
    );
    throw err;
  }
}
