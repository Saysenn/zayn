import { env, isProd } from "./env.js";

export const loggerConfig = {
  level: env.LOG_LEVEL ?? (isProd ? "info" : "debug"),

  // pino logs request headers by default. without this list, auth tokens and
  // cookies end up sitting in the log files in plain text.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-hub-signature-256"]',
      'res.headers["set-cookie"]',
    ],
    censor: "[redacted]",
  },

  // readable colours while developing.
  // production gets raw JSON, which is what log tools actually want.
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss" },
      },

  base: { env: env.NODE_ENV },
};
