import { groupForNumber, toJid } from "../config/index.js";
import { logger } from "../system/logger.js";
import { socketFor } from "./connection.js";

/**
 * "typing…" under our name while the expense bot reads a batch of files, so
 * a long read never looks like silence (his call 2026-10-07).
 *
 * WhatsApp drops the status after about 25 seconds, so it is renewed every
 * 10 until stopped. Best effort: a status that fails to show is never worth
 * failing the reply over.
 *
 * @returns {() => void} stop
 */
/** "typing…" once, left to fade on its own (about 25 seconds). */
export function typingOnce(to, from) {
  const socket = socketFor(groupForNumber(from));
  if (!socket) return;
  socket.sendPresenceUpdate("composing", toJid(to)).catch((err) => logger.debug({ err }, "typing status failed"));
}

export function keepTyping(to, from) {
  const socket = socketFor(groupForNumber(from));
  if (!socket) return () => {};
  const jid = toJid(to);
  const show = (state) => socket.sendPresenceUpdate(state, jid).catch((err) => logger.debug({ err }, "typing status failed"));
  void show("composing");
  const timer = setInterval(() => void show("composing"), 10_000);
  return () => {
    clearInterval(timer);
    void show("paused");
  };
}
