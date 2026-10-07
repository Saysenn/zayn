import { logger } from "../system/logger.js";
import { inboundQueue } from "../system/queue.js";
import { jobIdOf } from "../system/jobId.js";
import { withRedisTimeout } from "../system/redis.js";
import { sendText } from "./sendMessage.js";

/**
 * Every message someone sends us comes through here.
 *
 * No webhook, no signature check — the message arrived on our own authenticated
 * socket, so it definitely came from WhatsApp. Nobody can fake one.
 *
 * All this does is put it on the queue. Actually answering takes 3-8 seconds
 * (it calls the LLM), and doing that here would block every other message on
 * that number.
 */
export async function receiveMessage(msg) {
  const { messageId, from, to, groupId, text, voice, attachments } = msg;

  // Buffers do not survive JSON. See the note on InboundMessageJob.
  const queuedVoice = voice && {
    seconds: voice.seconds,
    ...(voice.audio ? { audioBase64: voice.audio.toString("base64") } : {}),
  };

  // jobId = WhatsApp's own message ID.
  // Baileys sometimes redelivers a message when it reconnects. BullMQ throws
  // away a job ID it's already seen, so nobody gets answered twice and we
  // don't pay OpenAI twice for the same question.
  try {
    await withRedisTimeout(
      inboundQueue.add(
        "inbound",
        {
          messageId,
          from,
          to,
          groupId,
          text,
          ...(queuedVoice ? { voice: queuedVoice } : {}),
          // paths to receipts on disk, never the bytes: see expenses.js
          ...(attachments?.length ? { attachments } : {}),
          receivedAt: new Date().toISOString(),
        },
        // through jobIdOf because BullMQ rejects a colon and the ID is Baileys'
        { jobId: jobIdOf(messageId) },
      ),
    );
  } catch (err) {
    // Redis is down. There's no webhook to return an error to, so nothing will
    // ever retry this — the message is just gone. Tell them, otherwise they sit
    // there waiting for a reply that's never coming.
    logger.error(
      { err, messageId, groupId },
      "failed to queue message — redis down",
    );
    await sendText(
      from,
      to,
      "Sorry, something's playing up on my end. Give me a few minutes and try again?",
    ).catch((sendErr) =>
      logger.error({ err: sendErr, messageId }, "could not warn sender either"),
    );
    return;
  }

  logger.info({ messageId, groupId }, "message queued");
}
