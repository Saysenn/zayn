// ***************************************************
// * ANY DOCUMENT, AS TEXT (his call 2026-10-13)
// ***************************************************
//
// What a liquidation document SAYS, taken out once when it is uploaded, so
// Diane (lawyer mode above all) can read it and answer from it.
//
//   PDF with text        unpdf, no model, instant
//   PDF that is a scan   the model reads it (one call, kept)
//   picture              the model reads it (one call, kept)
//   Word, PowerPoint     their XML, no model (agent/engine/intake.js)
//   old Word (.doc)      word-extractor, no model
//   Excel, CSV           their cells, as rows of text (.xls and .ods via SheetJS)
//   RTF                  its text, the markup taken out
//   text, email, JSON    as written
//   anything else        kept and listed, marked unreadable
//
// NEVER THROWS: a file that cannot be read is still a document, said so.

const { intake } = require('../agent/engine/intake');
const { getClient } = require('../agent/chatClient');

const MODEL = process.env.AI_MODEL || 'gpt-4.1';
const IMAGE = /\.(png|jpe?g|webp|gif|heic|heif)$/i;
const TEXTISH = /\.(txt|md|csv|tsv|json|eml|log|xml|html?)$/i;
// Fewer letters than this per page and the PDF is a scan.
const SCAN_CHARS_PER_PAGE = 40;
// What the model is asked, for a picture or a scan.
const READ_ASK = 'Transcribe every word in this document exactly as written, in reading order, keeping '
  + 'headings, dates, amounts, reference numbers and names. Then, under a line "NOTES:", describe anything '
  + 'that is not text (stamps, signatures, handwriting, tables). Do not summarise or add anything.';

function rowsAsText(tables) {
  return tables.map((t) => [
    t.sheet ? `Sheet: ${t.sheet}` : null,
    t.headers.join(' | '),
    ...t.rows.map((r) => r.cells.map((c) => (c == null ? '' : String(c))).join(' | ')),
  ].filter(Boolean).join('\n')).join('\n\n');
}

async function modelRead(content) {
  const client = getClient();
  if (!client) throw new Error('no AI key, so pictures and scans cannot be read');
  const r = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'text', text: READ_ASK }, content] }],
  });
  return String(r.choices?.[0]?.message?.content ?? '').trim();
}

async function readPicture(buffer, fileName, mime) {
  let data = buffer;
  let type = mime && /^image\//.test(mime) ? mime : `image/${(fileName.split('.').pop() || 'png').toLowerCase().replace('jpg', 'jpeg')}`;
  // HEIC (iPhone) is not a picture the model takes: made a JPEG first.
  if (/hei[cf]/i.test(type) || /\.hei[cf]$/i.test(fileName)) {
    // eslint-disable-next-line global-require
    data = await require('sharp')(buffer).jpeg({ quality: 85 }).toBuffer();
    type = 'image/jpeg';
  }
  return modelRead({ type: 'image_url', image_url: { url: `data:${type};base64,${data.toString('base64')}` } });
}

async function readPdf(buffer, fileName) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((t, i) => `[page ${i + 1}]\n${String(t ?? '').trim()}`);
  const letters = pages.join('').replace(/\[page \d+\]|\s/g, '').length;
  if (letters >= SCAN_CHARS_PER_PAGE * Math.max(1, totalPages)) return { text: pages.join('\n\n'), how: 'pdf text', pages: totalPages };
  // A SCAN: the model reads the PDF itself.
  const read = await modelRead({ type: 'file', file: { filename: fileName, file_data: `data:application/pdf;base64,${buffer.toString('base64')}` } });
  return { text: read, how: 'pdf read by AI (scan)', pages: totalPages };
}

/**
 * @returns {Promise<{ text: string, how: string, pages?: number, error?: string }>}
 *   `text` empty with `error` when it could not be read.
 */
async function readDocument({ buffer, fileName, mime = null }) {
  const name = String(fileName ?? '');
  try {
    if (/\.pdf$/i.test(name) || mime === 'application/pdf') return await readPdf(buffer, name);
    if (IMAGE.test(name) || /^image\//.test(mime ?? '')) return { text: await readPicture(buffer, name, mime), how: 'picture read by AI' };
    if (/\.(xlsx|docx|pptx)$/i.test(name)) {
      const got = await intake({ buffer, filename: name });
      const text = [rowsAsText(got.tables), got.text].filter((t) => t && t.trim()).join('\n\n');
      return { text, how: /\.xlsx$/i.test(name) ? 'spreadsheet' : /\.docx$/i.test(name) ? 'Word' : 'PowerPoint' };
    }
    if (/\.doc$/i.test(name)) {
      // eslint-disable-next-line global-require
      const WordExtractor = require('word-extractor');
      const doc = await new WordExtractor().extract(buffer);
      return { text: [doc.getHeaders?.(), doc.getBody(), doc.getFootnotes?.()].filter((t) => t && t.trim()).join('\n\n'), how: 'Word (old .doc)' };
    }
    if (/\.(xls|ods|xlsb|numbers)$/i.test(name)) {
      // eslint-disable-next-line global-require
      const XLSX = require('xlsx');
      const book = XLSX.read(buffer, { type: 'buffer' });
      const text = book.SheetNames.map((sheet) => `Sheet: ${sheet}\n${XLSX.utils.sheet_to_csv(book.Sheets[sheet], { FS: ' | ' }).trim()}`).join('\n\n');
      return { text, how: 'spreadsheet' };
    }
    if (/\.rtf$/i.test(name)) {
      // The words, the markup out: control words, groups and escapes.
      const text = buffer.toString('latin1')
        .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info)(?:[^{}]|\{[^{}]*\})*\}/g, '').replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^{}]*\}/g, '').replace(/\\'[0-9a-f]{2}/gi, '')
        .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').replace(/\n{3,}/g, '\n\n').trim();
      return { text, how: 'RTF' };
    }
    if (TEXTISH.test(name) || /^text\//.test(mime ?? '')) {
      const raw = buffer.toString('utf8');
      if (/\.(csv|tsv)$/i.test(name)) {
        const got = await intake({ text: raw, filename: name });
        return { text: [rowsAsText(got.tables), got.text].filter(Boolean).join('\n\n') || raw, how: 'table text' };
      }
      return { text: raw, how: 'text' };
    }
    return { text: '', how: 'none', error: `${name.split('.').pop()?.toUpperCase() || 'This'} files cannot be read as text; it is kept and can be opened.` };
  } catch (err) {
    return { text: '', how: 'none', error: String(err.message ?? err).slice(0, 300) };
  }
}

module.exports = { readDocument, rowsAsText };
