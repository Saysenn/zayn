const { fold, within } = require('../tools/resolvePerson');

/**
 * ***************************************************
 * * PEOPLE AND COMPANIES FROM THEIR FILE, AGAINST THE CRM
 * ***************************************************
 *
 * The same check as for deals (sheetCheck.compare), for the two other
 * things she can change: a person (their own email and rates, and the
 * phone and bank details carried on every deal of theirs) and a company
 * (tier, status, old group). The admin's call 2026-10-06: read everything,
 * change only what she already can. Code only; nothing is guessed: a name
 * that is two people, or nobody, is listed, not matched.
 */

const PROFILE = { email: 'email', addonPercent: 'addon_percent', feePercent: 'fee_percent' };
const ON_DEALS = {
  phone: 'phone', bankDetails: 'bank_details', accountNumber: 'account_number', sortCode: 'sort_code', postcode: 'postcode', location: 'location',
};
const COMPANY = { tier: 'tier', status: 'status', oldGroup: 'old_group' };
const NUMBER = new Set(['addonPercent', 'feePercent']);

const same = (field, theirs, ours) => (NUMBER.has(field)
  ? Math.abs(Number(theirs) - Number(ours ?? 0)) < 0.005
  : fold(theirs) === fold(ours ?? ''));

/** One name to one record, one slip allowed; two or none is not a match. */
function one(list, name, nameOf) {
  const want = fold(name);
  let hits = list.filter((x) => fold(nameOf(x)) === want);
  if (hits.length === 0 && want.length >= 4) hits = list.filter((x) => within(fold(nameOf(x)), want, 1));
  return hits;
}

/**
 * @param {object[]} rows people rows read from their file
 * @param {object[]} deals live deals (snake case)
 * @param {object[]} people tb_people rows
 */
function comparePeople(rows, deals, people) {
  const live = deals.filter((d) => !d.stopped_on);
  const changed = [];
  const unmatched = [];
  for (const r of rows) {
    const theirDeals = one(live, r.person, (d) => d.person_name);
    const names = [...new Set(theirDeals.map((d) => d.person_name))];
    if (names.length !== 1) {
      unmatched.push({ ...r, why: names.length ? `could be ${names.join(' or ')}` : 'no one by that name on the sheet' });
      continue;
    }
    const name = names[0];
    const profile = people.find((p) => fold(p.display_name) === fold(name) || fold(p.person_id) === fold(name)) ?? null;
    const profileDiffs = Object.keys(PROFILE).filter((f) => r[f] !== undefined && profile && !same(f, r[f], profile[PROFILE[f]]))
      .map((f) => ({ field: f, theirs: r[f], ours: profile[PROFILE[f]] }));
    // ON EVERY DEAL OF THEIRS: a phone differs if any one deal holds another.
    const dealDiffs = Object.keys(ON_DEALS).filter((f) => r[f] !== undefined && theirDeals.some((d) => !same(f, r[f], d[ON_DEALS[f]])))
      .map((f) => ({ field: f, theirs: r[f], ours: theirDeals.find((d) => !same(f, r[f], d[ON_DEALS[f]]))?.[ON_DEALS[f]] }));
    if (profileDiffs.length || dealDiffs.length) changed.push({ row: r, name, deals: theirDeals, profileDiffs, dealDiffs });
  }
  return { changed, unmatched };
}

/** @param {object[]} companies tb_companies rows */
function compareCompanies(rows, companies) {
  const changed = [];
  const unmatched = [];
  for (const r of rows) {
    const hits = one(companies, r.company, (c) => c.name);
    if (hits.length !== 1) {
      unmatched.push({ ...r, person: r.company, why: hits.length ? `could be ${hits.map((c) => c.name).join(' or ')}` : 'not a company in the CRM' });
      continue;
    }
    const c = hits[0];
    const diffs = Object.keys(COMPANY).filter((f) => r[f] !== undefined && !same(f, r[f], c[COMPANY[f]]))
      .map((f) => ({ field: f, theirs: r[f], ours: c[COMPANY[f]] }));
    if (diffs.length) changed.push({ row: r, company: c, diffs });
  }
  return { changed, unmatched };
}

const LABEL = {
  email: 'email', addonPercent: 'add on %', feePercent: 'fee %', phone: 'phone', bankDetails: 'bank', accountNumber: 'account number',
  sortCode: 'sort code', postcode: 'postcode', location: 'location', tier: 'tier', status: 'status', oldGroup: 'old group',
};
const line = (d) => `${LABEL[d.field] ?? d.field} ${d.ours ?? 'none'} → ${d.theirs}`;

/** Their differences as engine steps, numbered after `from`. */
function entitySteps(people, companies, from = 0) {
  const steps = [];
  const n = () => from + steps.length + 1;
  for (const p of people.changed) {
    if (p.profileDiffs.length) {
      steps.push({
        n: n(), action: 'person', person: p.name,
        changes: p.profileDiffs.map((d) => ({ field: d.field, mode: 'set', value: String(d.theirs) })),
        lines: [{ name: p.name, where: 'their profile', detail: p.profileDiffs.map(line).join(' · ') }],
      });
    }
    if (p.dealDiffs.length) {
      steps.push({
        n: n(), action: 'update', person: p.name,
        changes: p.dealDiffs.map((d) => ({ field: d.field, mode: 'set', value: String(d.theirs) })),
        ids: p.deals.map((d) => d.id),
        lines: [{ name: p.name, where: `on all ${p.deals.length} of their deals`, detail: p.dealDiffs.map(line).join(' · ') }],
      });
    }
  }
  for (const c of companies.changed) {
    const closing = c.diffs.some((d) => d.field === 'status' && /clos|liquid/i.test(String(d.theirs)));
    steps.push({
      n: n(), action: 'company', company: c.company.name,
      changes: c.diffs.map((d) => ({ field: d.field, mode: 'set', value: String(d.theirs) })),
      lines: [{ name: c.company.name, where: 'company', detail: `${c.diffs.map(line).join(' · ')}${closing ? ' · ⛔ closing it ends its live deals' : ''}` }],
    });
  }
  return steps;
}

module.exports = { comparePeople, compareCompanies, entitySteps };
