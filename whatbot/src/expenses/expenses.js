import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { crmConfig } from "../config/index.js";
import { z } from "zod";
import { logger } from "../system/logger.js";

/**
 * EXPENSES THROUGH WHATBOT, his plan 2026-10-07 (docs/whatbot-crm-expenses.md).
 *
 * WhatBot is the messenger. The CRM is the brain: it reads the expense,
 * checks it, talks to the admin before saving, and saves. This file is the
 * part on our side:
 *
 *   THE GUARD   is this number a registered admin on THIS group's bot? Asked
 *               before anything is downloaded or read. No → we do exactly
 *               what we always did (a photo from anyone else is ignored).
 *   MEDIA       a receipt photo or a file, downloaded to a temp folder and
 *               passed on by path: base64 photos do not belong in the queue.
 *   THE TURN    one message to the CRM, one reply back.
 */

// ---- the guard ----

const CACHE_MS = 60_000;
let cache = { at: 0, keys: new Set() };

const key = (phone, group) =>
  `${String(phone).replace(/[^\d+]/g, "")}|${String(group).toLowerCase()}`;

/**
 * The registered admins, from the CRM, for a minute at a time. A CRM we
 * cannot reach keeps the last list we had: an outage must not open the
 * door, and must not shut out an admin who was let in a minute ago.
 */
async function admins() {
  if (Date.now() - cache.at < CACHE_MS) return cache.keys;
  if (!crmConfig.apiUrl || !crmConfig.apiKey) return cache.keys;
  try {
    const res = await fetch(`${crmConfig.apiUrl}/api/v1/agent/expenses/admins`, {
      headers: { "x-api-key": crmConfig.apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const { admins: list } = await res.json();
    cache = { at: Date.now(), keys: new Set(list.map((a) => key(a.phone, a.group))) };
  } catch (err) {
    logger.warn({ err: err.message }, "expense admins: could not refresh, keeping the last list");
    cache.at = Date.now() - CACHE_MS + 10_000;
  }
  return cache.keys;
}

export async function isExpenseAdmin(phone, group) {
  return (await admins()).has(key(phone, group));
}

/** for tests: forget the list */
export const resetAdminCache = () => {
  cache = { at: 0, keys: new Set() };
};

// ---- media ----

const MAX_BYTES = 15 * 1024 * 1024;
const MEDIA_DIR = join(tmpdir(), "whatbot-expense-media");

/** A photo or a file on this message, with its caption. Null for anything else. */
export function mediaOf(message) {
  const doc =
    message?.documentMessage ??
    message?.documentWithCaptionMessage?.message?.documentMessage;
  if (message?.imageMessage) {
    const img = message.imageMessage;
    return {
      kind: "image",
      mime: img.mimetype ?? "image/jpeg",
      filename: "photo.jpg",
      caption: (img.caption ?? "").trim(),
      bytes: Number(img.fileLength ?? 0),
    };
  }
  if (doc) {
    return {
      kind: "document",
      mime: doc.mimetype ?? "application/octet-stream",
      filename: doc.fileName ?? "file",
      caption: (doc.caption ?? "").trim(),
      bytes: Number(doc.fileLength ?? 0),
    };
  }
  return null;
}

/**
 * Download it now (the key that decrypts it lives on this message object)
 * and keep it on disk for the worker. Null when too big or it failed.
 */
export async function saveMedia(m, media) {
  if (media.bytes > MAX_BYTES) {
    logger.info({ bytes: media.bytes }, "expense media too big — not downloading");
    return null;
  }
  try {
    const buffer = await downloadMediaMessage(m, "buffer", {});
    if (buffer.length > MAX_BYTES) return null;
    await mkdir(MEDIA_DIR, { recursive: true });
    const path = join(MEDIA_DIR, `${Date.now()}-${Math.random().toString(36).slice(2)}-${media.filename.replace(/[^\w.-]/g, "_")}`);
    await writeFile(path, buffer);
    return { path, mime: media.mime, filename: media.filename };
  } catch (err) {
    logger.error({ err }, "could not download expense media");
    return null;
  }
}

// ---- the turn ----

/** "Sorry, nothing was saved": an admin must never be left thinking it was. */
export const CRM_DOWN =
  "Sorry, I can't reach the CRM right now, so nothing was saved. Please send it again in a few minutes.";

/**
 * One message to the CRM's expense brain.
 * @returns {Promise<{ registered: boolean, reply?: string }>}
 */
const TurnReply = z.object({
  registered: z.boolean(),
  reply: z.string().nullable().optional(),
  // not about expenses: the normal agent answers it instead
  handOff: z.boolean().optional(),
  // more than one bubble: the preview, then the rates to AED
  replies: z.array(z.string()).optional(),
  // the preview as a picture; `reply` is then its caption
  image: z.object({ base64: z.string(), mime: z.string(), filename: z.string().optional() }).optional(),
});

export async function expenseTurn({ phone, group, text, attachments = [], messageId }) {
  const files = [];
  for (const a of attachments) {
    try {
      const buffer = a.base64 ? Buffer.from(a.base64, "base64") : await readFile(a.path);
      files.push({ filename: a.filename, mime: a.mime, base64: buffer.toString("base64") });
    } catch (err) {
      logger.error({ err: err.message }, "expense media missing on disk");
    }
  }
  try {
    const res = await fetch(`${crmConfig.apiUrl}/api/v1/agent/expenses/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": crmConfig.apiKey },
      body: JSON.stringify({ phone, group, text: text ?? "", attachments: files, messageId }),
      // reading a few receipt photos can take a while; a WhatsApp reply can wait
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "expense turn failed at the CRM");
      return { registered: true, reply: CRM_DOWN };
    }
    // an edge: what the CRM says is checked before it reaches a phone
    const parsed = TurnReply.safeParse(await res.json());
    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, "expense turn: CRM reply not understood");
      return { registered: true, reply: CRM_DOWN };
    }
    return parsed.data;
  } catch (err) {
    logger.error({ err: err.message }, "expense turn: CRM unreachable");
    return { registered: true, reply: CRM_DOWN };
  } finally {
    // the temp copies have done their job
    await Promise.all(attachments.filter((a) => a.path).map((a) => rm(a.path, { force: true })));
  }
}
