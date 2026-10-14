// ***************************************************
// * THE DOCUMENTS SHE NAMES, as pieces of her answer (2026-10-14)
// ***************************************************
//
// The server has already matched the names to real documents (docLinks on
// her answer). This only cuts the text at them, longest name first, so
// "creditors list.csv" is never taken as "list.csv". Case is the text's own.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** [{ text } | { link, text }] in order; one plain piece when nothing matches. */
export function splitDocNames(text, links) {
  const s = String(text ?? '');
  const usable = (links ?? []).filter((l) => l?.name);
  if (!s || !usable.length) return [{ text: s }];
  const byName = new Map(usable.map((l) => [l.name.toLowerCase(), l]));
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${names.map(esc).join('|')})`, 'gi');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(re)) {
    const before = s[m.index - 1];
    const after = s[m.index + m[0].length];
    // Whole name only: not the tail of a longer word or name.
    if ((before && /[\w.]/.test(before)) || (after && /\w/.test(after))) continue;
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: m[0], link: byName.get(m[0].toLowerCase()) });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.length ? out : [{ text: s }];
}
