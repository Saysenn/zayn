const fs = require('node:fs/promises');
const path = require('node:path');

// ***************************************************
// * WHERE A LIQUIDATION'S DOCUMENTS LIVE ON DISK (migration 084)
// ***************************************************
//
// Shared by the page's routes and Diane, so a document is found and moved
// aside the same way whoever asks. A removed one is moved, never deleted.

const DOCS_ROOT = process.env.LIQUIDATION_DOCS_DIR || path.join(__dirname, '../../storage/liquidations');
const REMOVED = '_removed';

/** Inside the docs folder, or null: a stored path is ours, but checked anyway. */
function onDisk(rel) {
  const full = path.resolve(DOCS_ROOT, rel);
  return full.startsWith(path.resolve(DOCS_ROOT) + path.sep) ? full : null;
}

/** Moves a document's file into _removed and returns its new relative path. */
async function moveAside(storedPath) {
  const full = onDisk(storedPath);
  const rel = path.join(REMOVED, storedPath);
  if (full) {
    await fs.mkdir(path.dirname(path.join(DOCS_ROOT, rel)), { recursive: true });
    await fs.rename(full, path.join(DOCS_ROOT, rel)).catch(() => null);
  }
  return rel;
}

// ANY FILE BUT A PROGRAM: a letter, a scan, a spreadsheet, an email, a zip of
// statements. What cannot be read as text is still kept and opened.
const NEVER = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|mjs|cjs|jar|app|dll|sh|apk|dmg|pkg)$/i;
const MAX_DOC_BYTES = 25 * 1024 * 1024;

// WHAT IT IS, from its name, when the browser sent nothing useful: a PDF
// served as octet-stream downloads instead of opening in the viewer.
const TYPES = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', txt: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  eml: 'message/rfc822', html: 'text/html', md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', zip: 'application/zip',
};
const typeOf = (name, given) => (given && given !== 'application/octet-stream'
  ? given
  : TYPES[String(path.extname(name)).slice(1).toLowerCase()] ?? 'application/octet-stream');

/**
 * Saves one file onto a company's Liquidations row and queues it to be read.
 * The page's upload and Diane's "save these to Quarry Lane" both come here.
 */
async function storeDoc(liquidationId, { buffer, originalName, mime = null }, byUser = null) {
  // eslint-disable-next-line global-require
  const repo = require('../repos/liquidations.repo');
  // eslint-disable-next-line global-require
  const crypto = require('node:crypto');
  const ext = path.extname(originalName).toLowerCase().slice(0, 12);
  // Our own name on disk, never the uploaded one: it is shown, not trusted.
  const rel = path.join(String(liquidationId), `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  await fs.mkdir(path.join(DOCS_ROOT, String(liquidationId)), { recursive: true });
  await fs.writeFile(path.join(DOCS_ROOT, rel), buffer);
  const doc = await repo.addDoc(liquidationId, {
    fileName: path.basename(originalName).slice(0, 200),
    storedPath: rel,
    mime: typeOf(originalName, mime),
    size: buffer.length,
  }, byUser);
  // eslint-disable-next-line global-require
  require('./liquidationDocIndex').queueRead(doc.id);
  return doc;
}

/** Puts a removed document's file back where it was (Diane's undo). */
async function moveBack(removedPath) {
  const back = removedPath.startsWith(`${REMOVED}${path.sep}`) ? removedPath.slice(REMOVED.length + 1) : removedPath;
  const from = onDisk(removedPath);
  if (from) {
    await fs.mkdir(path.dirname(path.join(DOCS_ROOT, back)), { recursive: true });
    await fs.rename(from, path.join(DOCS_ROOT, back)).catch(() => null);
  }
  return back;
}

module.exports = {
  DOCS_ROOT, REMOVED, NEVER, MAX_DOC_BYTES, onDisk, moveAside, moveBack, storeDoc, typeOf,
};
