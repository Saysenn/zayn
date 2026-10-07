const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');

/**
 * HOW WIDE A TEXT REALLY IS, read off the bundled font itself, so a column
 * is never narrower than what is written in it (his call 2026-10-07: cut
 * "Handl…" cells and a total written over its own label). Per character
 * advance widths added up, no kerning: never short, at most a little wide.
 */
const DIR = path.join(__dirname, '../../assets/fonts');
const FACES = {
  sans: 'Inter.ttf', hand: 'Caveat.ttf', serif: 'LibreBaskerville.ttf', chalk: 'PatrickHand-Regular.ttf', mono: 'IBMPlexMono-Regular.ttf',
};
const fonts = new Map();
const widths = new Map();

function fontOf(face) {
  if (!fonts.has(face)) {
    const b = fs.readFileSync(path.join(DIR, FACES[face]));
    fonts.set(face, opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  return fonts.get(face);
}

/** Width in px of `text` in `face` at `size`; bold is drawn about 6% wider. */
function measure(text, face, size, bold = false) {
  const font = fontOf(face);
  let units = 0;
  for (const ch of String(text ?? '')) {
    const key = `${face}:${ch}`;
    if (!widths.has(key)) {
      const g = font.charToGlyph(ch);
      // a character the face lacks is drawn by another font: count it wide
      widths.set(key, g && g.index !== 0 ? g.advanceWidth : font.unitsPerEm * 0.7);
    }
    units += widths.get(key);
  }
  return (units / font.unitsPerEm) * size * (bold ? 1.06 : 1);
}

/** Words into lines no wider than `max`; a word longer than a line is split. */
function wrapTo(text, max, face, size, bold = false) {
  const out = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    let w = word;
    while (measure(w, face, size, bold) > max && w.length > 1) {
      let k = w.length - 1;
      while (k > 1 && measure(w.slice(0, k), face, size, bold) > max) k -= 1;
      if (line) { out.push(line); line = ''; }
      out.push(w.slice(0, k));
      w = w.slice(k);
    }
    const next = line ? `${line} ${w}` : w;
    if (!line || measure(next, face, size, bold) <= max) line = next;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

/**
 * COLUMN WIDTHS FROM WHAT IS IN THEM. Each column is at least as wide as
 * its longest word (cell or heading), so nothing is ever cut; room left
 * over goes to the columns with the most to say; and when even the
 * narrowest fit does not, the picture itself grows wider.
 * @returns {{ widths: number[], total: number }}
 */
function fitColumns(columns, rows, { face, size, headSize, pad = 22, avail, headFace = face }) {
  const longestWord = (v, f, s, b) => Math.max(0, ...String(v ?? '').split(/\s+/).map((w) => measure(w, f, s, b)));
  const min = columns.map((c, i) => pad + Math.max(
    longestWord(c.label, headFace, headSize, true),
    // a short value (a date, "Abu Dhabi") stays on one line; a long one wraps by words
    ...rows.map((r) => (c.align === 'right' || String(r.cells[i] ?? '').length <= 14 ? measure(r.cells[i], face, size, true) : longestWord(r.cells[i], face, size, i === 0))),
  ));
  // what it would like: its longest cell on one line, but never more than
  // a third of the page for one column
  const want = columns.map((c, i) => Math.max(min[i], Math.min(avail / 3, pad + Math.max(
    measure(c.label, headFace, headSize, true),
    ...rows.map((r) => measure(r.cells[i], face, size, c.align === 'right' || i === 0)),
  ))));
  const sumMin = min.reduce((a, b) => a + b, 0);
  const sumWant = want.reduce((a, b) => a + b, 0);
  let widths;
  if (sumWant <= avail) widths = want.map((w) => w + ((avail - sumWant) * w) / sumWant);
  else if (sumMin <= avail) widths = min.map((m, i) => m + ((want[i] - m) * (avail - sumMin)) / (sumWant - sumMin));
  else widths = min;
  return { widths, total: Math.max(avail, sumMin) };
}

module.exports = { measure, wrapTo, fitColumns, FACES };
