const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const pool = require('../../configs/db');
const { typeOf } = require('./liquidationDocs.helper');

// ***************************************************
// * FILES ATTACHED IN DIANE'S CHAT, KEPT BY ID (migration 088)
// ***************************************************
//
// So "save these to Quarry Lane" saves the files themselves, not the text
// she read from them. On this computer only (CHAT_FILES_DIR), never a cloud
// bucket. A day old and never saved, they are cleared: a saved one was
// copied into the company's documents, so nothing kept is ever lost.

const ROOT = process.env.CHAT_FILES_DIR || path.join(__dirname, '../../storage/chat-files');
const KEEP_MS = 24 * 60 * 60 * 1000;

async function keep(file, byUser = null) {
  const id = crypto.randomUUID();
  const ext = path.extname(file.originalname).toLowerCase().slice(0, 12);
  await fs.mkdir(ROOT, { recursive: true });
  const rel = `${id}${ext}`;
  // ON DISK ALREADY (a video, up to 500 MB, never held in memory): moved in.
  if (file.path) await fs.rename(file.path, path.join(ROOT, rel)).catch(() => fs.copyFile(file.path, path.join(ROOT, rel)));
  else await fs.writeFile(path.join(ROOT, rel), file.buffer);
  const mime = typeOf(file.originalname, file.mimetype);
  await pool.query(
    'INSERT INTO tb_chat_files (id, file_name, stored_path, mime, size_bytes, by_user) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, path.basename(file.originalname).slice(0, 200), rel, mime, file.size, byUser],
  );
  void sweep();
  return { id, name: file.originalname, mime, size: file.size };
}

/** The kept files these ids name, with their bytes. Unknown ids are left out. */
async function take(ids) {
  const list = [...new Set(ids)].filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
  if (!list.length) return [];
  const { rows } = await pool.query('SELECT * FROM tb_chat_files WHERE id = ANY($1::uuid[])', [list]);
  const out = [];
  for (const r of rows) {
    const full = path.join(ROOT, path.basename(r.stored_path));
    // A VIDEO IS NOT READ INTO MEMORY: its transcript job takes the file itself.
    // eslint-disable-next-line global-require
    if (require('./videoTranscript.helper').isVideo(r.file_name, r.mime)) {
      // eslint-disable-next-line no-await-in-loop
      if (await fs.stat(full).catch(() => null)) out.push({ id: r.id, name: r.file_name, mime: r.mime, path: full, video: true });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const buffer = await fs.readFile(full).catch(() => null);
    if (buffer) out.push({ id: r.id, name: r.file_name, mime: r.mime, buffer });
  }
  return out;
}

/** A day old: the row and its file go. Never awaited by anyone. */
async function sweep() {
  try {
    const { rows } = await pool.query("DELETE FROM tb_chat_files WHERE created_at < now() - interval '1 day' RETURNING stored_path");
    for (const r of rows) {
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(path.join(ROOT, path.basename(r.stored_path)), { force: true });
    }
  } catch { /* the next attach tries again */ }
}

module.exports = { keep, take, KEEP_MS };
