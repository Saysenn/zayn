const cors = require('cors');
const env = require('./env');

// Only matters in dev — the Vite dev server (5173) calling the API (3000).
// In production React is built to static files served by this same Express
// process, so the request is same-origin and this middleware is a no-op.
const corsMiddleware = cors({
  origin: env.corsOrigin,
  credentials: true,
});

module.exports = corsMiddleware;
 