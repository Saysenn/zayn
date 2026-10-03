import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "../config/index.js";
import { numberForGroup } from "../config/numbers.js";
import { logger } from "../system/logger.js";
import * as store from "../employee/storage.js";
import { sendText, NotConnectedError } from "../whatsapp/sendMessage.js";

/**
 * The one thing this process listens for from outside: the CRM's chatbox
 * delivering an admin's reply. Lives in worker.js, not server.js — sending
 * needs the live Baileys socket, and that only exists here (see
 * whatsapp/connection.js and .claude/CLAUDE.md, "Sockets live in worker.ts
 * only").
 *
 * No signature scheme, just a shared key in a header — same shape as the
 * CRM's own AGENT_API_KEY check, for the same reason: one admin-run service
 * on each side, not a public webhook.
 */
function isAuthed(req) {
  const key = env.ADMIN_REPLY_WEBHOOK_KEY;
  if (!key) return false; // unset means refuse everything, not accept anything
  const given = req.get("x-webhook-key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function buildAdminReplyApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: "100kb" }));

  app.post("/webhook/admin-reply", async (req, res) => {
    if (!isAuthed(req)) return res.status(401).json({ error: "unauthorized" });

    const { personId, groupName, message } = req.body ?? {};
    if (!personId || !groupName || !message) {
      return res
        .status(400)
        .json({ error: "personId, groupName and message are required" });
    }

    const from = numberForGroup(groupName);
    if (!from) return res.status(404).json({ error: "unknown group" });

    // same identity rule as everywhere else: group AND person, an active
    // row, a phone on it. No phone, no send — never guess one.
    const all = await store.findAll();
    const phone = all.find(
      (a) =>
        a.personId === personId &&
        a.group === groupName &&
        a.status === "active" &&
        a.phone,
    )?.phone;

    if (!phone) {
      return res
        .status(404)
        .json({ error: "no active phone on file for this person in this group" });
    }

    try {
      await sendText(phone, from, message);
      res.json({ ok: true });
    } catch (err) {
      const status = err instanceof NotConnectedError ? 503 : 502;
      logger.error({ err, personId, groupName }, "admin-reply send failed");
      res.status(status).json({ error: "send failed" });
    }
  });

  return app;
}
