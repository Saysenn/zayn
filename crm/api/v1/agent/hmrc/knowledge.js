const repo = require('../../repos/hmrc.repo');
const { getClient } = require('../chatClient');
const govuk = require('./govuk');
const logger = require('../../../configs/logger');

// ***************************************************
// * WHAT DIANE KNOWS ABOUT HMRC AND CIS, AND HOW SHE FINDS IT
// ***************************************************
//
// Sources: GOV.UK guidance and HMRC manuals (fetched by refresh()), and the
// admin's own notes. Each is cut into passages of ~1,800 characters with a
// small overlap, embedded, and searched by meaning. Notes always rank above
// GOV.UK at the same closeness: they are how WE do it.

const EMBED_MODEL = process.env.HMRC_EMBED_MODEL || 'text-embedding-3-small';
const CHUNK = 1800;
const OVERLAP = 200;

// ---- the reading list ----
const GUIDES = [
  '/what-is-the-construction-industry-scheme', '/what-you-must-do-as-a-cis-contractor', '/what-you-must-do-as-a-cis-subcontractor',
  '/guidance/construction-industry-scheme-a-guide-for-contractors-and-subcontractors-cis-340',
  '/employment-status', '/employment-status/selfemployed-contractor', '/employer-responsibilities', '/paye-for-employers',
  '/running-payroll', '/payroll-software', '/agency-workers-your-rights', '/national-minimum-wage', '/holiday-entitlement-rights',
  '/guidance/vat-domestic-reverse-charge-for-building-and-construction-services',
  '/guidance/understanding-off-payroll-working-ir35', '/guidance/april-2021-changes-to-off-payroll-working-for-clients',
  '/guidance/employment-intermediaries-report-requirements', '/guidance/using-an-umbrella-company-for-temporary-work',
  '/guidance/check-employment-status-for-tax', '/self-assessment-tax-returns', '/register-for-self-assessment',
  '/working-for-yourself', '/keeping-your-pay-tax-records', '/paye-for-employers/keeping-records',
  '/estimate-penalty-for-late-paye-payments', '/tax-appeals', '/guidance/compliance-checks-penalties-for-inaccuracies-in-returns-or-documents-ccfs7',
  '/national-insurance-rates-letters', '/guidance/rates-and-thresholds-for-employers-2025-to-2026', '/guidance/rates-and-thresholds-for-employers-2026-to-2027',
  '/income-tax-rates', '/vat-rates', '/vat-registration', '/making-tax-digital-for-income-tax',
];
const SEARCHES = [
  'construction industry scheme', 'CIS deductions', 'CIS gross payment status', 'CIS monthly return', 'CIS penalties',
  'CIS verify subcontractor', 'domestic reverse charge construction', 'PAYE real time information', 'employment intermediaries',
  'umbrella company', 'off-payroll working', 'employment status', 'agency workers tax', 'false self-employment',
  'national minimum wage enforcement', 'tax avoidance schemes', 'disguised remuneration', 'HMRC penalties late filing',
  'employer national insurance', 'statutory sick pay employer', 'right to work checks', 'CIS online service',
  'penalties for inaccuracies careless deliberate concealed', 'HMRC penalties for errors', 'disclose unpaid tax HMRC',
];
const MANUALS = [
  ['/hmrc-internal-manuals/construction-industry-scheme-reform', 500],
  ['/hmrc-internal-manuals/vat-reverse-charge-for-building-and-construction-services-manual', 120],
  ['/hmrc-internal-manuals/employment-status-manual', 350],
  ['/hmrc-internal-manuals/paye-manual', 250],
  ['/hmrc-internal-manuals/national-insurance-manual', 150],
  // penalties for inaccuracies and failures (careless / deliberate / concealed)
  ['/hmrc-internal-manuals/compliance-handbook/ch80000', 120],
  ['/hmrc-internal-manuals/compliance-handbook/ch60000', 60],
];

// ---- passages ----
function chunksOf(title, body) {
  const text = String(body ?? '').trim();
  if (!text) return [];
  const out = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + CHUNK);
    // end on a paragraph or sentence when one is near
    if (end < text.length) {
      const cut = Math.max(text.lastIndexOf('\n\n', end), text.lastIndexOf('. ', end));
      if (cut > at + CHUNK * 0.5) end = cut + 1;
    }
    out.push(`${title}\n${text.slice(at, end).trim()}`);
    if (end >= text.length) break;
    at = Math.max(end - OVERLAP, at + 1);
  }
  return out;
}

const meter = { tokens: 0 };
async function embed(texts, client = null) {
  const openai = client ?? getClient();
  if (!openai) throw Object.assign(new Error('no AI key'), { code: 'NO_AI' });
  const out = [];
  for (let i = 0; i < texts.length; i += 96) {
    // eslint-disable-next-line no-await-in-loop
    const r = await openai.embeddings.create({ model: EMBED_MODEL, input: texts.slice(i, i + 96) });
    meter.tokens += r.usage?.total_tokens ?? 0;
    out.push(...r.data.map((d) => d.embedding));
  }
  return out;
}

/** One source saved and indexed (a page fetched, or a note written). */
async function index(src) {
  const saved = await repo.upsertSource(src);
  const texts = chunksOf(saved.title, saved.body);
  const vectors = await embed(texts);
  await repo.replaceChunks(saved.id, texts.map((text, i) => ({ text, embedding: vectors[i] })));
  cache = null;
  return { id: saved.id, chunks: texts.length };
}

/** A saved source (an edited note) cut and embedded again, same id. */
async function reindex(saved) {
  const texts = chunksOf(saved.title, saved.body);
  const vectors = await embed(texts);
  await repo.replaceChunks(saved.id, texts.map((text, i) => ({ text, embedding: vectors[i] })));
  cache = null;
}

// ---- keeping current ----

const topicOf = (p) => (/construction-industry-scheme|\bcis\b/i.test(p.path + p.title) ? 'cis'
  : /vat/i.test(p.path) ? 'vat' : /employment-status|ir35|off-payroll|intermediar|umbrella|agency/i.test(p.path + p.title) ? 'status'
    : /paye|payroll|national-insurance|minimum-wage|sick-pay/i.test(p.path + p.title) ? 'payroll' : 'general');

/** What changed between two versions of a page, in a sentence or two (the small model). */
async function summarise(title, oldBody, newBody) {
  const before = new Set(String(oldBody).split('\n').map((l) => l.trim()).filter(Boolean));
  const after = new Set(String(newBody).split('\n').map((l) => l.trim()).filter(Boolean));
  const gone = [...before].filter((l) => !after.has(l)).slice(0, 40);
  const added = [...after].filter((l) => !before.has(l)).slice(0, 40);
  if (!gone.length && !added.length) return 'Wording only.';
  try {
    const r = await getClient().chat.completions.create({
      model: process.env.AI_MODEL_LIGHT && process.env.AI_MODEL_LIGHT !== 'off' ? process.env.AI_MODEL_LIGHT : 'gpt-4.1-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: 'You tell a UK staffing business (paying workers under CIS and PAYE) what changed in a GOV.UK page, in one or two plain UK English sentences: the rule, rate, deadline or process that changed. If only wording, links or layout changed, reply exactly: Wording only.' },
        { role: 'user', content: `PAGE: ${title}\n\nREMOVED LINES:\n${gone.join('\n').slice(0, 3000)}\n\nADDED LINES:\n${added.join('\n').slice(0, 3000)}` },
      ],
    });
    return String(r.choices?.[0]?.message?.content ?? '').trim() || 'Updated by GOV.UK.';
  } catch {
    return 'Updated by GOV.UK.';
  }
}

/**
 * A FETCHED PAGE, TAKEN IN: indexed if new or changed; a change to a page
 * we already had is recorded with its summary, to be said once. False when
 * nothing changed.
 */
async function takeUpdate(p) {
  const before = await repo.sourceByUrl(p.url);
  if (before && before.body === p.body) return false;
  const saved = await index({ kind: 'govuk', url: p.url, title: p.title, body: p.body, topic: topicOf(p), updatedOn: p.updatedOn });
  if (before) {
    await repo.recordChange({
      sourceId: saved.id, url: p.url, title: p.title,
      oldUpdatedOn: before.updated_on, newUpdatedOn: p.updatedOn,
      summary: await summarise(p.title, before.body, p.body),
    });
  }
  return true;
}

/**
 * THE LIVE CHECK, before an answer: the GOV.UK pages it is about to use are
 * fetched again and any that changed are taken in, so the answer is from
 * today's page. Bounded: what has not come back in `ms` is used as stored.
 * @returns {Promise<string[]>} urls that changed
 */
async function freshen(urls, { ms = 1500 } = {}) {
  const changed = [];
  const work = Promise.all([...new Set(urls)].filter((u) => /^https:\/\/www\.gov\.uk\//.test(u ?? '')).slice(0, 8).map(async (u) => {
    const p = await govuk.page(new URL(u).pathname).catch(() => null);
    if (p?.body?.length > 80 && await takeUpdate(p).catch(() => false)) changed.push(u);
  }));
  await Promise.race([work, new Promise((ok) => setTimeout(ok, ms))]);
  return changed;
}

/**
 * Fetch everything on the reading list from GOV.UK and index it. A page
 * that did not change since the last fetch (same updated date and body) is
 * not embedded again.
 */
async function refresh({ onProgress = null, manualsToo = true } = {}) {
  const paths = new Set(GUIDES);
  for (const q of SEARCHES) {
    // eslint-disable-next-line no-await-in-loop
    for (const p of await govuk.search(q, { count: 15 })) {
      if (!/^\/(?:government\/(?:publications|news|organisations|people|ministers)|search|hmrc-internal-manuals)/.test(p)) paths.add(p);
    }
  }
  const pages = [];
  const list = [...paths];
  for (let i = 0; i < list.length; i += 6) {
    // eslint-disable-next-line no-await-in-loop
    pages.push(...(await Promise.all(list.slice(i, i + 6).map(govuk.page))).filter((p) => p?.body?.length > 120));
    onProgress?.({ stage: 'guides', done: Math.min(i + 6, list.length), of: list.length });
  }
  if (manualsToo) {
    for (const [path, limit] of MANUALS) {
      // eslint-disable-next-line no-await-in-loop
      const got = await govuk.manual(path, { limit });
      pages.push(...got);
      onProgress?.({ stage: 'manual', manual: path, pages: got.length });
    }
  }
  let added = 0;
  let unchanged = 0;
  for (const p of pages) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await takeUpdate(p))) { unchanged += 1; continue; }
    added += 1;
    if (added % 25 === 0) onProgress?.({ stage: 'indexing', done: added, of: pages.length - unchanged });
  }
  logger.info({ pages: pages.length, added, unchanged, embedTokens: meter.tokens }, 'hmrc: knowledge refreshed');
  return { pages: pages.length, added, unchanged, embedTokens: meter.tokens };
}

// ---- search ----
let cache = null;
let loadedAt = 0;
async function loaded() {
  // reloaded every 5 minutes, so a refresh run elsewhere (the script) is picked up
  if (!cache || Date.now() - loadedAt > 5 * 60 * 1000) {
    loadedAt = Date.now();
    const rows = await repo.allChunks();
    cache = rows.map((r) => {
      const v = Float32Array.from(r.embedding);
      let n = 0;
      for (const x of v) n += x * x;
      return { ...r, v, norm: Math.sqrt(n) || 1 };
    });
  }
  return cache;
}
const forget = () => { cache = null; };

/**
 * The passages closest to the question: notes first when close, then GOV.UK,
 * one or two per source so a long manual page does not crowd out the rest.
 */
async function find(question, { k = 8 } = {}) {
  const all = await loaded();
  if (!all.length) return [];
  const [q] = await embed([question]);
  let qn = 0;
  for (const x of q) qn += x * x;
  qn = Math.sqrt(qn) || 1;
  const scored = all.map((c) => {
    let dot = 0;
    for (let i = 0; i < q.length; i += 1) dot += q[i] * c.v[i];
    const score = dot / (qn * c.norm) + (c.kind === 'note' ? 0.05 : 0);
    return { ...c, score };
  }).sort((a, b) => b.score - a.score);
  /**
   * A MIX, NOT ONE MANUAL (2026-10-10: "what rate if HMRC can't find him"
   * got eight manual sections and no GOV.UK guide, so no "30%"): notes as
   * they come, at most 4 manual passages, and up to 3 from the plain-English
   * guides when any are reasonably close. At most 2 passages a source.
   */
  const isManual = (c) => /hmrc-internal-manuals/.test(c.url ?? '');
  const perSource = new Map();
  const out = [];
  const take = (c) => {
    const n = perSource.get(c.source_id) ?? 0;
    if (n >= 2 || out.includes(c)) return false;
    perSource.set(c.source_id, n + 1);
    out.push(c);
    return true;
  };
  const best = scored[0]?.score ?? 0;
  for (const c of scored.filter((x) => x.kind === 'govuk' && !isManual(x) && x.score >= best - 0.12).slice(0, 12)) {
    if (out.filter((x) => !isManual(x) && x.kind === 'govuk').length >= 3) break;
    take(c);
  }
  for (const c of scored) {
    if (out.length >= k) break;
    if (isManual(c) && out.filter(isManual).length >= 4) continue;
    take(c);
  }
  out.sort((a, b) => b.score - a.score);
  return out.map(({ v, norm, embedding, ...rest }) => rest);
}

// ---- the daily refresh ----
const refreshState = { running: false, startedAt: null, last: null, progress: null, error: null };
function runRefresh() {
  if (refreshState.running) return refreshState;
  Object.assign(refreshState, { running: true, startedAt: new Date().toISOString(), progress: null, error: null });
  refresh({ onProgress: (p) => { refreshState.progress = p; } })
    .then((out) => Object.assign(refreshState, { running: false, last: { ...out, at: new Date().toISOString() } }))
    .catch((err) => Object.assign(refreshState, { running: false, error: err.message }));
  return refreshState;
}

/**
 * ONCE A DAY, in the API (his call 2026-10-10). Checked hourly: a refresh
 * runs when the GOV.UK knowledge is more than a day old. Only where there
 * is knowledge already (never on a test database), and HMRC_AUTO_REFRESH=off
 * stops it.
 */
function startAutoRefresh() {
  if (String(process.env.HMRC_AUTO_REFRESH ?? 'on').toLowerCase() === 'off' || process.env.DIANE_TRACE_EVENTS === '1') return null;
  const tick = async () => {
    try {
      const govuk = (await repo.status()).find((r) => r.kind === 'govuk');
      if (govuk?.sources > 0 && Date.now() - new Date(govuk.last).getTime() > 24 * 60 * 60 * 1000) {
        logger.info('hmrc: daily refresh from GOV.UK');
        runRefresh();
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'hmrc: daily refresh check failed');
    }
  };
  const t = setInterval(tick, 60 * 60 * 1000);
  t.unref?.();
  setTimeout(tick, 60 * 1000).unref?.();
  return t;
}

module.exports = { refresh, runRefresh, refreshState, startAutoRefresh, freshen, takeUpdate, summarise, index, reindex, find, forget, chunksOf, embed, GUIDES, MANUALS };
