import express from "express";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { corsConfig } from "../config/index.js";
import { logger } from "../system/logger.js";
import { healthRouter } from "./health.js";
import { notFound, onError } from "./errors.js";

/**
 * The web server. Health checks, and nothing else.
 *
 * WhatsApp doesn't come in here — it arrives on a socket in the worker. So
 * nothing outside ever needs to reach this machine, which is why there's no
 * tunnel and no domain in this setup.
 *
 * Kept separate from server.ts so tests can import it and hit routes without
 * actually binding a port.
 *
 * The order below matters: security headers, then parsing, then routes, then
 * the catch-alls. Anything added after the 404 handler is unreachable.
 */
export function buildApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors(corsConfig));
  app.use(pinoHttp({ logger }));

  app.use(express.json({ limit: "1mb" }));

  app.use(healthRouter);

  app.use(notFound);
  app.use(onError);

  return app;
}
