const { randomUUID } = require('crypto');
const pool = require('../../configs/db');

/**
 * A PICTURE DIANE SENT, kept so the conversation's Attachments can open it
 * again (the chat itself lives in the browser and keeps only the id). Kept
 * 30 days (his call 2026-10-07), cleared here rather than on a timer.
 */
async function keepImage(png, caption) {
  const id = randomUUID();
  await pool.query('INSERT INTO tb_agent_images (id, png, caption) VALUES ($1, $2, $3)', [id, png, caption ?? '']);
  await pool.query("DELETE FROM tb_agent_images WHERE created_at < now() - interval '30 days'");
  return id;
}

module.exports = { keepImage };
