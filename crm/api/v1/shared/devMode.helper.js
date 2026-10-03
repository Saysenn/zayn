// In-memory cache of tb_settings.dev_mode — read on every request (via the
// error handler) without a DB round trip. Loaded once at boot and kept in
// sync by settings.js's PATCH handler; nothing else may call setDevMode.
let devMode = false;

function setDevMode(value) {
  devMode = Boolean(value);
}

function isDevMode() {
  return devMode;
}

module.exports = { setDevMode, isDevMode };
