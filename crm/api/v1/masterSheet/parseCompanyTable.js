const { tidy } = require('./canonical');

/**
 * ***************************************************
 * * The "Active company list" block, off a group file.
 * ***************************************************
 *
 * His per-group sheets carry a second table beside the deals: company,
 * director, mid, and a Status column. The upload has always reported those
 * four headers as "columns not read" and thrown them away.
 *
 * HIS "STATUS" IS OUR `tier`. Its values are Top Co, T2, T3, TBC, Benched,
 * In prep, Visa co, "T2 for Reliapay". `tb_companies.status` is
 * active/closed and is the Close button, a different fact entirely. The
 * tab is called Active Companies, after his own block; the column, the API
 * and this file say tier.
 *
 * FOUND BY HEADER, NEVER BY COLUMN. readSheets splits side-by-side tables
 * only when a blank column separates them, so the block arrives merged
 * into the deal table on two of his three files (columns 0-16) and as its
 * own table on the third (columns 14-18). A fixed column would read
 * nothing on two of them.
 *
 * The rows of a merged table are UNRELATED down the page: row five's deal
 * has nothing to do with row five's company entry. They only share an
 * index, so each is read on its own.
 */

const HEADERS = {
  company: /^active company/i,
  director: /^director/i,
  mid: /^mid/i,
  tier: /^status/i,
  // HIS OWN EARLIER NAME FOR THE GROUP, never one of ours. `Milky`,
  // `Wallaby 1`, `V3`, `NA`. Only one of his three files carries it.
  oldGroup: /^old group/i,
};

function headerFor(headers, test) {
  return (headers ?? []).find((h) => h && test.test(String(h).trim()));
}

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {Array} sheets  scanBuffer output
 * @returns {{ companies: Array, found: boolean }} `found` says the block
 *   existed at all, which is what decides whether the diff shows its tab.
 *   A block that exists but is empty is not the same as no block: the
 *   first means he cleared it, the second means this file never had one.
 */
function parseCompanyTable(sheets) {
  const seen = new Map();
  let found = false;

  for (const sheet of sheets ?? []) {
    for (const table of sheet.tables ?? []) {
      const cols = {
        company: headerFor(table.headers, HEADERS.company),
        director: headerFor(table.headers, HEADERS.director),
        mid: headerFor(table.headers, HEADERS.mid),
        tier: headerFor(table.headers, HEADERS.tier),
        oldGroup: headerFor(table.headers, HEADERS.oldGroup),
      };
      if (!cols.company) continue;
      found = true;

      for (const raw of table.rows ?? []) {
        // tidy collapses whitespace only, the same fold the deal rows get.
        const company = tidy(text(raw[cols.company]));
        if (!company) continue;

        const entry = {
          company,
          director: cols.director ? text(raw[cols.director]) : '',
          mid: cols.mid ? text(raw[cols.mid]) : '',
          tier: cols.tier ? text(raw[cols.tier]) : '',
          oldGroup: cols.oldGroup ? text(raw[cols.oldGroup]) : '',
        };

        // SAME COMPANY TWICE IS A CONFLICT, NOT A LAST-ONE-WINS. INDIGO
        // lists "Social work partners PR" as both T2 and TBC. A company is
        // one row in tb_companies, so it is flagged and a human picks.
        const key = company.toLowerCase();
        const already = seen.get(key);
        if (!already) {
          seen.set(key, { ...entry, tiers: entry.tier ? [entry.tier] : [] });
          continue;
        }
        if (entry.tier && !already.tiers.includes(entry.tier)) already.tiers.push(entry.tier);
        already.director = already.director || entry.director;
        already.mid = already.mid || entry.mid;
        already.oldGroup = already.oldGroup || entry.oldGroup;
      }
    }
  }

  const companies = [...seen.values()].map((c) => ({
    company: c.company,
    director: c.director,
    mid: c.mid,
    tier: c.tiers[0] ?? '',
    oldGroup: c.oldGroup,
    // More than one tier for one name. The tab makes the admin choose.
    conflict: c.tiers.length > 1 ? c.tiers : null,
  }));

  return { companies, found };
}

module.exports = { parseCompanyTable };
