// ***************************************************
// * GOV.UK, READ AS TEXT: guidance pages and HMRC manuals
// ***************************************************
//
// GOV.UK's own public APIs (Open Government Licence): the search API finds
// pages, the content API returns each as JSON with its body as HTML and its
// "last updated" date. Nothing is scraped from rendered pages.

const BASE = 'https://www.gov.uk';
const UA = 'zayn-crm-diane/1.0 (HMRC & CIS knowledge, local)';

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) return null;
      if (r.ok) return r.json();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((ok) => setTimeout(ok, 800 * (i + 1)));
    } catch {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((ok) => setTimeout(ok, 800 * (i + 1)));
    }
  }
  return null;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&pound;': '£', '&ndash;': '–', '&mdash;': '—', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”' };

/** HTML to plain text that keeps the shape: headings, lists, tables as rows. */
function textOf(html) {
  return String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<abbr[^>]*title="([^"]+)"[^>]*>([^<]*)<\/abbr>/gi, '$2')
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n\n## $1\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(?:p|div|ul|ol|table|blockquote)>/gi, '\n')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? (/^&#(\d+);$/.test(e) ? String.fromCharCode(Number(e.slice(2, -1))) : ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One GOV.UK page (guide, answer, detailed guide, manual section) as text. */
async function page(path) {
  const j = await getJson(`${BASE}/api/content${path}`);
  if (!j) return null;
  const d = j.details ?? {};
  const parts = (d.parts ?? []).map((p) => `## ${p.title}\n${textOf(p.body)}`);
  const body = [textOf(d.body), ...parts, textOf(d.introductory_paragraph), textOf(d.more_information)]
    .filter(Boolean).join('\n\n').trim();
  return {
    url: `${BASE}${path}`,
    path,
    title: j.title,
    type: j.document_type,
    updatedOn: String(j.public_updated_at ?? '').slice(0, 10) || null,
    body,
    children: [
      ...(d.child_section_groups ?? []).flatMap((g) => (g.child_sections ?? []).map((c) => c.base_path)),
      ...(d.child_sections ?? []).map((c) => c.base_path),
    ].filter(Boolean),
  };
}

/** Search GOV.UK; links of the results. */
async function search(q, { count = 20, format = null } = {}) {
  const u = new URL(`${BASE}/api/search.json`);
  u.searchParams.set('q', q);
  u.searchParams.set('count', String(count));
  u.searchParams.set('fields', 'title,link,format');
  if (format) u.searchParams.set('filter_format', format);
  const j = await getJson(u.toString());
  return (j?.results ?? []).map((r) => r.link).filter((l) => typeof l === 'string' && l.startsWith('/'));
}

/** A whole HMRC manual, section by section, up to `limit` pages. */
async function manual(path, { limit = 400, onPage = null } = {}) {
  const out = [];
  const seen = new Set();
  const queue = [path];
  while (queue.length && out.length < limit) {
    const batch = queue.splice(0, 6).filter((p) => !seen.has(p));
    batch.forEach((p) => seen.add(p));
    // eslint-disable-next-line no-await-in-loop
    const pages = (await Promise.all(batch.map(page))).filter(Boolean);
    for (const p of pages) {
      if (p.body && p.body.length > 80) out.push(p);
      queue.push(...p.children.filter((c) => !seen.has(c)));
      onPage?.(p);
    }
  }
  return out.slice(0, limit);
}

module.exports = { page, search, manual, textOf };
