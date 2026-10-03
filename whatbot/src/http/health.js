import { Router } from "express";
import { pingRedis } from "../system/redis.js";
import { allGroups } from "../config/index.js";
import { readStatus } from "../whatsapp/status.js";

export const healthRouter = Router();

/**
 * Is the process alive? Always 200 if it can answer at all.
 *
 * Deliberately does NOT check Redis. Whatever restarts the process watches this
 * endpoint, and a brief Redis hiccup shouldn't cause a restart loop.
 */
healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/**
 * Can we actually do our job? Point your uptime monitor at THIS one.
 *
 * 503 if Redis is down, or if any WhatsApp number is disconnected.
 *
 * A dead number failing this is on purpose. It's the failure that hides: the
 * process is running, four groups work fine, and the fifth quietly answers
 * nobody for a week until someone happens to mention it.
 *
 * The connection status comes through Redis because the sockets live in the
 * worker process, not this one — see whatsapp/status.ts.
 */
healthRouter.get("/ready", async (_req, res) => {
  const redisUp = await pingRedis();
  if (!redisUp) {
    res.status(503).json({ ok: false, redis: "down", whatsapp: {} });
    return;
  }

  const reported = await readStatus();
  // missing = the worker hasn't checked in lately = down, not "unknown"
  const whatsapp = Object.fromEntries(
    allGroups().map((g) => [g, reported[g] === true]),
  );
  const allUp = Object.values(whatsapp).every(Boolean);

  res.status(allUp ? 200 : 503).json({ ok: allUp, redis: "up", whatsapp });
});
