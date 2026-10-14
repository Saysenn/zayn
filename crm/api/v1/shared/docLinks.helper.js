// ***************************************************
// * A DOCUMENT SHE NAMES OPENS (his call 2026-10-14)
// ***************************************************
//
// "documents: call notes.txt, creditors list.csv, HMRC petition.pdf" was
// plain text: the only way to see one was to ask again. Whoever wrote the
// sentence, a tool or the model, the names in it are matched here against
// the documents that really exist, and the browser makes those links.
//
// ONLY REAL NAMES: a name matches a live document's whole file name, never
// a word that looks like one. Two companies with a file of the same name:
// the one whose company the answer names; neither, if it names both or none.

const MAX_LINKS = 60;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = (s) => String(s ?? '').toLowerCase();

/** A document as the browser's viewer opens it (the same shape as her chips). */
const docLink = (d) => ({
  liquidationId: d.liquidation_id,
  docId: d.id,
  name: d.file_name,
  mime: d.mime,
  viewUrl: `/api/v1/liquidations/${d.liquidation_id}/docs/${d.id}?inline=1`,
  textUrl: `/api/v1/liquidations/${d.liquidation_id}/docs/${d.id}/text`,
  downloadUrl: `/api/v1/liquidations/${d.liquidation_id}/docs/${d.id}`,
  url: `/api/v1/liquidations/${d.liquidation_id}/docs/${d.id}`,
});

/** The documents `reply` names, from `docs` (rows of repo.docNames). Pure. */
function matchDocLinks(reply, docs) {
  const text = String(reply ?? '');
  if (!text || !/\.[a-z0-9]{2,5}\b/i.test(text)) return [];
  const low = fold(text);
  const byName = new Map();
  for (const d of docs) {
    const name = String(d.file_name ?? '').trim();
    // A name with no extension ("notes") is a word, not a document.
    if (!/\.[a-z0-9]{1,8}$/i.test(name) || name.length < 4) continue;
    // Whole name, not part of a longer one: "list.csv" is not "creditors list.csv".
    const re = new RegExp(`(?:^|[\\s,:;("'\\u2018\\u201c•·-])${esc(fold(name))}(?=$|[\\s,.;:)"'\\u2019\\u201d!?])`);
    if (!re.test(low)) continue;
    const key = fold(name);
    byName.set(key, [...(byName.get(key) ?? []), d]);
  }
  const out = [];
  for (const same of byName.values()) {
    const named = same.length === 1 ? same : same.filter((d) => d.company_name && low.includes(fold(d.company_name)));
    // ONE COMPANY, the same name twice (a file uploaded again): its newest.
    const companies = new Set((named.length ? named : same).map((d) => d.liquidation_id));
    const pool = named.length ? named : same;
    if (companies.size === 1) out.push(docLink(pool.reduce((a, b) => (b.id > a.id ? b : a))));
  }
  return out.slice(0, MAX_LINKS);
}

/** The links for one reply, from the database. Never throws: no links instead. */
async function docLinksFor(reply) {
  if (!/\.[a-z0-9]{2,5}\b/i.test(String(reply ?? ''))) return [];
  try {
    // eslint-disable-next-line global-require
    const docs = await require('../repos/liquidations.repo').docNames();
    return matchDocLinks(reply, docs);
  } catch {
    return [];
  }
}

module.exports = { matchDocLinks, docLinksFor, docLink };
