import { join } from "node:path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import {
  allGroups,
  features,
  fromJid,
  numberForGroup,
  numbersConfig,
} from "../config/index.js";
import { logger } from "../system/logger.js";
import { publishStatus } from "./status.js";
import { downloadVoiceNote, isVoiceNote, voiceSeconds } from "./voiceNote.js";
import { isExpenseAdmin, mediaOf, saveMedia } from "../expenses/expenses.js";

// Groups already sent a linking code this run: one code per start.
const pairingAsked = new Set();

/**
 * The 5 WhatsApp connections, one per group.
 *
 * Each of our numbers is a normal WhatsApp account on a SIM in a locked phone.
 * This process links to it the same way WhatsApp Web does — scan a QR once,
 * and from then on the laptop has its own connection straight to WhatsApp.
 *
 * The phones aren't in the middle. They just created the account and keep the
 * link from expiring, which is why they can sit in a drawer.
 *
 * auth_info/<group>/ IS the link. Lose it and every phone needs rescanning.
 */

const connections = new Map();

let statusHeartbeat;

/** don't retry forever at 1s intervals — back off up to a minute */
const MAX_BACKOFF_MS = 60_000;

/**
 * Should we try to reconnect?
 *
 * Yes for everything except "logged out" — that means someone unlinked the
 * device on the phone, and no amount of retrying will fix it. Somebody has to
 * scan the QR again.
 */
function shouldReconnect(err) {
  // Baileys throws Boom errors. read the status code without importing
  // @hapi/boom, which is Baileys' dependency and not ours.
  const status = err?.output?.statusCode;
  return status !== DisconnectReason.loggedOut;
}

/**
 * Is this a one-to-one chat?
 *
 * An allow-list, not a block-list. WhatsApp keeps inventing address types —
 * `@lid` is the newest — and a block-list means each new one is answered by
 * default. Getting that wrong in the other direction would post somebody's pay
 * into a group.
 *
 *   @s.whatsapp.net  a person, addressed by phone number
 *   @lid             a person, addressed by linked-identity (the new scheme)
 *   @g.us            a group          — never
 *   @broadcast       a broadcast list — never
 *   @newsletter      a channel        — never
 */
const isDirectChat = (jid) =>
  jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");

/** the text sits in a different place depending on how it was sent */
function textOf(message) {
  return (
    message?.conversation ??
    message?.extendedTextMessage?.text ??
    ""
  ).trim();
}

/**
 * Opens one group's connection and keeps it open.
 *
 * Returns as soon as the socket is set up — it doesn't wait for the QR to be
 * scanned, so one unlinked number can't stop the other four from starting.
 */
async function connect(groupId, onMessage, attempt = 0) {
  const ourNumber = numberForGroup(groupId);
  if (!ourNumber)
    throw new Error(`no number configured for group "${groupId}"`);

  const { state, saveCreds } = await useMultiFileAuthState(
    join(numbersConfig.authDir, groupId),
  );

  const socket = makeWASocket({
    auth: state,
    // this is the name shown on the phone under Linked devices.
    // naming it makes it obvious which entry is the bot.
    // LINKING BY CODE needs a real system name: WhatsApp answered "couldn't
    // link device" to the custom one (2026-10-07). A QR takes either.
    browser: numbersConfig.linkWith === "code" ? Browsers.macOS("Chrome") : ["whatbot", "Chrome", "1.0.0"],
    // don't show as online. we answer every message anyway, and a number that's
    // online 24/7 doesn't look like a person.
    markOnlineOnConnect: false,
  });

  connections.set(groupId, { socket, ready: false });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { qr, connection, lastDisconnect } = update;

    // ---- first run, or the link expired ----
    if (qr && numbersConfig.linkWith === "code") {
      /**
       * A CODE INSTEAD OF A QR, asked for once per start. A QR drawn in a
       * terminal often will not scan (a dark theme inverts it, a small
       * window squashes it). On the group phone: WhatsApp → Linked devices
       * → Link a device → Link with phone number instead → type this.
       */
      if (!pairingAsked.has(groupId)) {
        pairingAsked.add(groupId);
        socket
          .requestPairingCode(ourNumber.replace(/^\+/, ""))
          .then((code) => {
            const shown = String(code).replace(/^(.{4})(.{4})$/, "$1-$2");
            logger.warn({ groupId, number: ourNumber, code: shown }, "type this code on the group phone");
            process.stdout.write(`\n  ${groupId} (${ourNumber}): on that phone open WhatsApp → Linked devices → Link a device →\n  Link with phone number instead, and type:  ${shown}\n\n`);
          })
          .catch((err) => logger.error({ err: err.message, groupId }, "could not get a linking code"));
      }
    } else if (qr) {
      // printed rather than logged, because you have to actually scan it
      logger.warn(
        { groupId, number: ourNumber },
        "scan this QR with the group phone",
      );
      qrcode.generate(qr, { small: true });
    }

    // ---- we're live ----
    if (connection === "open") {
      connections.set(groupId, { socket, ready: true });
      void publishStatus(groupId, true);
      logger.info({ groupId, number: ourNumber }, "whatsapp connected");
    }

    // ---- dropped ----
    if (connection === "close") {
      connections.set(groupId, { socket, ready: false });
      void publishStatus(groupId, false);
      const err = lastDisconnect?.error;

      if (!shouldReconnect(err)) {
        logger.error(
          { groupId, number: ourNumber },
          "logged out — delete this group's auth folder and scan the QR again",
        );
        return;
      }

      // disconnects are normal, not an emergency: WhatsApp drops idle sockets,
      // and the laptop sleeping or changing wifi drops all five at once
      const wait = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
      logger.warn(
        { groupId, err, retryInMs: wait },
        "whatsapp disconnected, reconnecting",
      );
      setTimeout(() => {
        void connect(groupId, onMessage, attempt + 1).catch((e) =>
          logger.error({ groupId, err: e }, "reconnect failed"),
        );
      }, wait).unref();
    }
  });

  // ---- a message arrived ----
  socket.ev.on("messages.upsert", ({ messages, type }) => {
    // 'notify' = a live message. 'append' = WhatsApp replaying old history on
    // connect — running THAT through the agent would message everyone at once.
    if (type !== "notify") return;

    for (const m of messages) {
      // fromMe = something typed on the phone itself. not a question for us.
      if (m.key.fromMe || !m.key.remoteJid) continue;

      // Never answer anywhere but a one-to-one chat. A reply in a group would
      // show one person's pay to everybody in it.
      if (!isDirectChat(m.key.remoteJid)) continue;

      /**
       * Who sent it, as a phone number.
       *
       * WhatsApp is migrating to "LID" addressing, where a one-to-one chat
       * arrives as `1234567@lid` instead of `447700900123@s.whatsapp.net`. The
       * real number then comes on `remoteJidAlt`.
       *
       * This is not cosmetic: identity IS the phone number here, so a LID we
       * cannot resolve is somebody we cannot recognise. We skip and say so,
       * rather than guessing — but we must not silently drop it as if it were
       * a group message, which is what used to happen and meant real messages
       * vanished with no log at all.
       */
      const senderJid = m.key.remoteJid.endsWith("@lid")
        ? m.key.remoteJidAlt
        : m.key.remoteJid;

      if (!senderJid) {
        logger.warn(
          { groupId, lid: m.key.remoteJid },
          "message from a LID with no phone number attached — cannot identify sender",
        );
        continue;
      }

      const text = textOf(m.message);
      const voice = isVoiceNote(m.message);
      const media = mediaOf(m.message);

      /**
       * A RECEIPT PHOTO OR FILE, from a registered expense admin on this
       * group's number only. The guard runs BEFORE downloading: from anyone
       * else a photo is ignored, as it always was. Fetched here because the
       * key that decrypts it lives on this message object.
       */
      if (media) {
        const from = fromJid(senderJid);
        void isExpenseAdmin(from, groupId)
          .then(async (ok) => {
            if (!ok) return;
            const file = await saveMedia(m, media);
            await onMessage({
              messageId: m.key.id ?? `${m.key.remoteJid}:${m.messageTimestamp}`,
              from,
              to: ourNumber,
              groupId,
              text: media.caption,
              attachments: file ? [file] : [],
            });
          })
          .catch((err) => logger.error({ err, groupId }, "failed to handle expense media"));
        continue;
      }

      // nothing we can read and nothing we can listen to — a sticker, a
      // location. Not a question, so there is nothing to answer.
      if (!text && !voice) continue;

      const deliver = (extra = {}) =>
        onMessage({
          messageId: m.key.id ?? `${m.key.remoteJid}:${m.messageTimestamp}`,
          from: fromJid(senderJid),
          to: ourNumber,
          groupId,
          text,
          ...extra,
        }).catch((err) =>
          logger.error({ err, groupId }, "failed to handle incoming message"),
        );

      if (!voice) {
        void deliver();
        continue;
      }

      /**
       * A voice note. Fetch the audio here, because the key that decrypts it
       * lives on this message object and does not survive the queue.
       *
       * With the feature off we do not download at all — but we still enqueue,
       * so the worker can say we cannot listen. Silence reads as "it got it".
       */
      if (!features.voice) {
        void deliver({ voice: { seconds: voiceSeconds(m.message) } });
        continue;
      }

      void downloadVoiceNote(m)
        .then((note) =>
          deliver({ voice: note ?? { seconds: voiceSeconds(m.message) } }),
        )
        .catch((err) =>
          logger.error({ err, groupId }, "failed to handle voice note"),
        );
    }
  });
}

/**
 * Opens every group. Called once, from worker.ts.
 *
 * A failure here is logged, not thrown — four working numbers beats none
 * because the fifth phone was flat.
 */
export async function startConnections(onMessage) {
  await Promise.all(
    allGroups().map((groupId) =>
      connect(groupId, onMessage).catch((err) =>
        logger.error({ groupId, err }, "failed to open whatsapp connection"),
      ),
    ),
  );

  // keep re-publishing the status even when nothing changes.
  // the status key expires, so if this worker dies it stops refreshing and
  // /ready correctly says everything is down instead of showing stale "up".
  statusHeartbeat = setInterval(() => {
    for (const [groupId, { ready }] of connections)
      void publishStatus(groupId, ready);
  }, 60_000);
  statusHeartbeat.unref();
}

/** the socket to send from. undefined until that group has finished connecting. */
export function socketFor(groupId) {
  const conn = connections.get(groupId);
  return conn?.ready ? conn.socket : undefined;
}

/** which groups are up right now */
export function connectionStatus() {
  return Object.fromEntries(
    allGroups().map((g) => [g, connections.get(g)?.ready ?? false]),
  );
}

export async function closeConnections() {
  if (statusHeartbeat) clearInterval(statusHeartbeat);
  for (const [groupId, { socket }] of connections) {
    await publishStatus(groupId, false);
    try {
      // end the socket, do NOT log out. logging out unlinks the device and
      // you'd be scanning 5 QR codes again on the next start.
      socket.end(undefined);
    } catch (err) {
      logger.warn({ groupId, err }, "error closing whatsapp connection");
    }
  }
  connections.clear();
}
