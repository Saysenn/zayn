const { figuresFrom, round } = require('./checkFigures');
const { countsFrom } = require('./checkCounts');
const { percentsFrom } = require('./checkPercents');

const MONTH_NUMBER = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

const COUNT_UNIT = {
  deal: 'row', deals: 'row', row: 'row', rows: 'row',
  person: 'person', people: 'person', persons: 'person',
  group: 'group', groups: 'group',
  company: 'company', companies: 'company',
  change: 'change', changes: 'change',
  month: 'month', months: 'month',
  file: 'file', files: 'file',
  column: 'column', columns: 'column',
};

function monthsFromTools(results) {
  const months = new Set();
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    for (const key of ['summary', 'say', 'reply']) {
      const text = String(result[key] ?? '');
      for (const match of text.matchAll(/\b(20\d{2})-(0[1-9]|1[0-2])\b/g)) {
        months.add(`${match[1]}-${match[2]}`);
      }
      for (const match of text.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/gi)) {
        months.add(`${match[2]}-${MONTH_NUMBER[match[1].toLowerCase()]}`);
      }
    }
  }
  return months;
}

function allFigures(results) {
  const out = new Set();
  for (const result of results) for (const value of figuresFrom(result)) out.add(value);
  return out;
}

function allPercents(results) {
  const all = new Set();
  const byKind = { addon: new Set(), fee: new Set(), crypto: new Set() };
  for (const result of results) {
    const found = percentsFrom(result);
    for (const value of found.all) all.add(value);
    for (const kind of Object.keys(byKind)) {
      for (const value of found.byKind[kind]) byKind[kind].add(value);
    }
  }
  return { all, byKind };
}

function checkClaims(claims = [], toolResults = []) {
  if (!Array.isArray(claims) || claims.length === 0) {
    return { ok: true, invalid: [], had: false };
  }

  const figures = allFigures(toolResults);
  const counts = countsFrom(toolResults);
  const percents = allPercents(toolResults);
  const months = monthsFromTools(toolResults);
  const invalid = [];

  for (const claim of claims) {
    const value = Number(claim?.value);
    if (!claim || !Number.isFinite(value)) {
      invalid.push({ ...claim, reason: 'value' });
      continue;
    }

    if (claim.kind === 'total' || claim.kind === 'figure') {
      if (claim.month && !months.has(String(claim.month))) {
        invalid.push({ ...claim, reason: 'month' });
      } else if (!figures.has(round(value))) {
        invalid.push({ ...claim, reason: 'value' });
      }
      continue;
    }

    if (claim.kind === 'count') {
      const unit = COUNT_UNIT[String(claim.unit ?? '').toLowerCase()];
      const allowed = counts.get(unit);
      if (!allowed?.has(value)) invalid.push({ ...claim, reason: 'value' });
      continue;
    }

    if (claim.kind === 'percent') {
      const allowed = claim.rateKind ? percents.byKind[claim.rateKind] : percents.all;
      if (!allowed?.has(value)) invalid.push({ ...claim, reason: 'value' });
      continue;
    }

    invalid.push({ ...claim, reason: 'kind' });
  }

  return { ok: invalid.length === 0, invalid, had: true };
}

module.exports = { checkClaims, monthsFromTools };
