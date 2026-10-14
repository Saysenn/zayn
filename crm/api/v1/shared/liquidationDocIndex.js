const fs = require('node:fs/promises');
const repo = require('../repos/liquidations.repo');
const { readDocument } = require('./docReader.helper');
const { onDisk } = require('./liquidationDocs.helper');
const logger = require('../../configs/logger');

// ***************************************************
// * READ ONCE, SEARCH FAST (his call 2026-10-13)
// ***************************************************
//
// A document is read when it is uploaded, in the background so the upload
// returns at once: its text taken out (docReader), cut into passages and
// embedded, the HMRC knowledge's own way (agent/hmrc/knowledge.js chunksOf,
// embed), so the two searches behave the same.
//
// A QUESTION is embedded and scored against every passage in memory (the
// passages are cached until a document changes): a few milliseconds for
// thousands of passages, and only the best few go to the model.

// eslint-disable-next-line global-require
const knowledge = () => require('../agent/hmrc/knowledge');

const bare = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/[.,]/g, '')
  .replace(/\s+(?:ltd|limited|plc|llp|llc|inc|co)$/, '').trim();

let cache = null; // [{ ...chunk, norm }]
let cacheKey = null;
const forgetCache = () => { cache = null; };

const queue = [];
let running = false;

async function readOne(docId) {
  const doc = await repo.docWithText(docId);
  if (!doc) return;
  await repo.setRead(docId, { status: 'reading' });
  const full = onDisk(doc.stored_path);
  let buffer;
  try {
    buffer = await fs.readFile(full);
  } catch {
    await repo.setRead(docId, { status: 'unreadable', how: 'none', error: 'The file is missing from this computer.' });
    return;
  }
  const got = await readDocument({ buffer, fileName: doc.file_name, mime: doc.mime });
  if (!got.text?.trim()) {
    await repo.setRead(docId, { status: 'unreadable', how: got.how, error: got.error ?? 'No text in it.' });
    return;
  }
  const { chunksOf, embed } = knowledge();
  const texts = chunksOf(`${doc.file_name}`, got.text).slice(0, 600);
  let vectors = [];
  try {
    vectors = await embed(texts);
  } catch (err) {
    // Read but not searchable: the text is still kept and can be read whole.
    await repo.setRead(docId, { status: 'read', how: `${got.how}, not indexed`, error: err.message, text: got.text });
    return;
  }
  await repo.saveChunks(docId, texts.map((text, i) => ({ text, embedding: vectors[i] })));
  await repo.setRead(docId, { status: 'read', how: got.how, text: got.text });
  forgetCache();
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift();
      try {
        // eslint-disable-next-line no-await-in-loop
        await readOne(id);
      } catch (err) {
        logger.warn({ err: err.message, docId: id }, 'liquidation doc: could not be read');
        // eslint-disable-next-line no-await-in-loop
        await repo.setRead(id, { status: 'unreadable', how: 'none', error: err.message }).catch(() => null);
      }
    }
  } finally {
    running = false;
  }
}

/** Read these documents in the background. Returns at once. */
function queueRead(ids) {
  for (const id of [].concat(ids)) if (!queue.includes(id)) queue.push(id);
  void drain();
}

/** At boot: anything left waiting or half read by a restart. */
async function resumeWaiting() {
  try {
    queueRead(await repo.unread());
  } catch (err) {
    logger.warn({ err: err.message }, 'liquidation docs: could not resume reading');
  }
}

/**
 * The passages that best answer `query`, best first.
 * @param {{ companyKeys?: string[], docIds?: number[], limit?: number }} scope
 */
async function search(query, { companyKeys = null, docIds = null, limit = 8 } = {}) {
  // NEVER A STALE ANSWER: one small query says whether any document changed
  // since the passages were loaded (another process, a removal, a rename).
  const key = await repo.docsVersion();
  if (key !== cacheKey) cache = null;
  if (!cache) {
    cacheKey = key;
    cache = (await repo.allChunks()).map((c) => ({
      ...c, norm: Math.sqrt(c.embedding.reduce((s, v) => s + v * v, 0)) || 1,
    }));
  }
  // A company named without its legal ending still finds its documents.
  const wanted = companyKeys ? companyKeys.map(bare) : null;
  const pool = cache.filter((c) => (!wanted || wanted.includes(bare(c.company_key))) && (!docIds || docIds.includes(c.doc_id)));
  if (!pool.length) return [];
  const [q] = await knowledge().embed([String(query)]);
  const qn = Math.sqrt(q.reduce((s, v) => s + v * v, 0)) || 1;
  return pool.map((c) => {
    let dot = 0;
    for (let i = 0; i < q.length; i += 1) dot += q[i] * c.embedding[i];
    return { ...c, score: dot / (qn * c.norm) };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = { queueRead, resumeWaiting, search, forgetCache, readOne };
