const pino = require('pino');
const env = require('./env');

// ===============================
// * REDACT BEFORE ANYTHING IS WRITTEN
// ===============================
// pino-http logs every request's headers. Without this the session cookie
// and whatbot's api key land in the log in full, so anyone who can read
// the logs can sign in as the admin.
const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  // Same secrets when a route logs a body or an error detail. Both forms:
  // a bare path matches the top level, the wildcard matches one level in.
  'password', 'secretCode', 'token', 'apiKey',
  '*.password', '*.secretCode', '*.token', '*.apiKey',
];

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: { paths: REDACT, censor: '[redacted]' },
  transport: env.nodeEnv === 'production' ? undefined : { target: 'pino-pretty' },
});

module.exports = logger;
