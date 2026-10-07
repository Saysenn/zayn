const { randomUUID } = require('crypto');

// ***************************************************
// * A FILE ATTACHED IN DIANE'S EXPENSES CONTEXT, HELD BRIEFLY
// ***************************************************
//
// Her conversation is posted whole on every turn, so a receipt photo kept
// in it would be sent again with every message after it (and past the
// 2mb body limit). The file waits here instead, by id, for the message
// that uses it. In memory: one admin, one PC, an hour at most.

const HOLD_MS = 60 * 60 * 1000;
const MAX_TOTAL = 150 * 1024 * 1024;
const held = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, f] of held) if (now - f.at > HOLD_MS) held.delete(id);
  let total = [...held.values()].reduce((n, f) => n + f.buffer.length, 0);
  for (const [id, f] of held) {
    if (total <= MAX_TOTAL) break;
    total -= f.buffer.length;
    held.delete(id);
  }
}

function hold({ buffer, filename, mime }) {
  sweep();
  const id = randomUUID();
  held.set(id, { buffer, filename, mime, at: Date.now() });
  return id;
}

/** The file as the brain reads attachments, or null when gone. */
function get(id) {
  sweep();
  const f = held.get(String(id ?? ''));
  return f ? { filename: f.filename, mime: f.mime, base64: f.buffer.toString('base64') } : null;
}

module.exports = { hold, get };
