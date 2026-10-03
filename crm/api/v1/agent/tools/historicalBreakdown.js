const rowsRepo = require('../../repos/masterSheetRows.repo');
const settingsRepo = require('../../repos/settings.repo');
const peopleRepo = require('../../repos/people.repo');
const snapshotsRepo = require('../../repos/monthSnapshots.repo');
const fxRates = require('../../shared/fxRates.helper');
const { currentMonth } = require('../../shared/presetMonth.helper');
const { monthsInQuestion, monthForRead } = require('../../shared/guessedYear.helper');
const { countsTowardTotal } = require('../../shared/owedThisMonth.helper');
const { DEFAULT_LOCAL_LOCATIONS } = require('../../shared/awayLocations.helper');
const { paymentBreakdown } = require('../../masterSheet/groupTables');
// THE ONE THAT APPLIES THE RATES. paymentBreakdown only reads them back
// off the row, the same order buildWorkbook uses.
const { withRates } = require('../../shared/rates.helper');
const { METHOD_LABELS } = require('../../masterSheet/buildWorkbook');
const { projectMonth } = require('../../masterSheet/projectMonth');
const withUsd = require('../../masterSheet/breakdowns/withUsd');
const { codeFor, AED_PER_USD } = require('../../shared/toUsd.helper');

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const fold = (value) => String(value ?? '').trim().toLocaleLowerCase('en');
const round = (value) => Math.round(Number(value) * 100) / 100;
const FOLLOW_UP = /\b(?:what about|and|also|same for|how about|those|them|only)\b/i;

// What this report is actually called. A sentence with none of these did
// not ask for a breakdown, whatever the model decided.
const BREAKDOWN_WORDS = /\b(?:breakdowns?|break (?:it|that|this|them) down|banks?|cash|crypto|uk|local|away|methods?|splits?|send|payouts?)\b/i;

function monthLabel(month) {
  const [year, part] = month.split('-').map(Number);
  return new Date(Date.UTC(year, part - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function money(amount) {
  return Number(amount).toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

function rate(amount) {
  return Number(amount).toLocaleString('en-GB', { maximumFractionDigits: 6 });
}

function moneyList(lines) {
  if (!lines?.length) return 'nothing';
  return lines.map(({ currency, total }) => `${currency} ${money(total)}`).join(' and ');
}

function requestedMonths(args, now = currentMonth()) {
  // The admin's words outrank a model-supplied year. In September 2026,
  // "last August" is August 2026, never an older year the model guessed.
  const currentWords = monthsInQuestion(args.said, now);
  if (currentWords.length > 0) return currentWords;

  // A short continuation keeps the immediately preceding period before a
  // model argument is trusted.
  if (FOLLOW_UP.test(String(args.said ?? ''))) {
    for (const line of priorLines(args)) {
      const recent = monthsInQuestion(line, now);
      if (recent.length > 0) return recent;
    }
  }

  /**
   * ===============================
   * * A YEAR SHE GUESSED IS NOT A FILTER THEY CHOSE
   * ===============================
   * A model month was trusted verbatim, so "break that down by group",
   * which names no month at all, came back "August 2024 is unavailable
   * because no month snapshot was saved". Nobody said 2024.
   *
   * `monthForRead` is the same repair `total_master_sheet` already applies:
   * theirs when they chose it, repaired to the nearest when she guessed a
   * year over a month they named, dropped when there is nothing to repair
   * to. Dropping every supplied month falls back to the current one, which
   * is the month this panel is about.
   */
  const explicit = [args.month, ...(Array.isArray(args.months) ? args.months : [])]
    .map((value) => String(value ?? '').trim())
    .filter((value) => MONTH.test(value))
    .map((value) => monthForRead(value, args.said, now))
    .filter(Boolean);
  if (explicit.length > 0) return [...new Set(explicit)].sort();
  return [now];
}

/** The immediately preceding admin line from runAgent's newest-first context. */
function priorSaid(args) {
  const current = String(args.said ?? '').trim();
  const lines = String(args.saidRecent ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const at = lines.findIndex((line) => line === current);
  return at >= 0 ? (lines[at + 1] ?? '') : (lines[0] ?? '');
}

function priorLines(args) {
  const current = String(args.said ?? '').trim();
  const lines = String(args.saidRecent ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const at = lines.findIndex((line) => line === current);
  return at >= 0 ? lines.slice(at + 1) : lines;
}

function ratesFromRows(rows) {
  const rates = new Map();
  for (const row of rows) {
    if (!row.person_id) continue;
    rates.set(row.person_id, {
      addon: Number(row.person_addon_percent) || 0,
      fee: Number(row.person_fee_percent) || 0,
    });
  }
  return rates;
}

function dealSignature(value, row = false) {
  const get = (snake, camel) => value[row ? snake : camel];
  return [
    get('person_name', 'personName'), get('company', 'company'),
    get('group_name', 'group'), get('role_label', 'role'),
    get('currency', 'currency'), Number(get('payable_amount', 'amount')) || 0,
  ].map(fold).join('|');
}

/** Select exactly the deals whose stored figures counted in that month. */
function countedSnapshotRows(snapshot) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const deals = Array.isArray(snapshot?.totals?.deals) ? snapshot.totals.deals : [];
  if (deals.length === 0) return [];

  const ids = new Set(deals.filter((deal) => deal.id != null).map((deal) => String(deal.id)));
  if (ids.size === deals.length) return rows.filter((row) => ids.has(String(row.id)));

  // Early snapshots may not carry ids. Match as a multiset so two
  // identical deals remain two deals instead of collapsing into one.
  const left = new Map();
  for (const deal of deals) {
    const key = dealSignature(deal);
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  return rows.filter((row) => {
    const key = dealSignature(row, true);
    const count = left.get(key) ?? 0;
    if (count === 0) return false;
    left.set(key, count - 1);
    return true;
  });
}

function exactGroupsIn(text, available) {
  const source = ` ${fold(text).replace(/[^a-z0-9]+/g, ' ')} `;
  return available.filter((group) => {
    const wanted = fold(group).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!wanted) return false;
    if (wanted === 'all groups') return /\ball group\b|\ball groups group\b/.test(source);
    return source.includes(` ${wanted} `);
  });
}

function requestedGroups(args, available) {
  const sent = exactGroupsIn(args.said, available);
  const carried = [];
  if (sent.length === 0 && FOLLOW_UP.test(String(args.said ?? ''))) {
    for (const line of priorLines(args)) {
      carried.push(...exactGroupsIn(line, available));
      if (carried.length > 0) break;
    }
  }
  const supplied = [args.group, ...(Array.isArray(args.groups) ? args.groups : [])]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  // Current exact words win, then the immediately preceding scope on a
  // follow-up, then model arguments. This prevents a model omission from
  // widening a cash/group report to the whole sheet.
  const wanted = sent.length > 0 ? sent : (carried.length > 0 ? carried : supplied);
  if (args.allGroups || wanted.length === 0) return { groups: [...available], missing: [] };

  const groups = [];
  const missing = [];
  for (const value of wanted) {
    const exact = available.find((group) => fold(group) === fold(value));
    if (exact && !groups.includes(exact)) groups.push(exact);
    else if (!exact) missing.push(value);
  }
  return { groups, missing };
}

function methodsIn(text) {
  const source = String(text ?? '');
  return [
    ...( /\bbank(?:\s+transfer)?\b/i.test(source) ? ['bank'] : []),
    ...( /\bcash\b/i.test(source) ? ['cash'] : []),
    ...( /\b(?:crypto|cryptocurrency)\b/i.test(source) ? ['crypto'] : []),
  ];
}

function requestedMethods(args) {
  const sent = methodsIn(args.said);
  const carried = [];
  if (sent.length === 0 && FOLLOW_UP.test(String(args.said ?? ''))) {
    for (const line of priorLines(args)) {
      carried.push(...methodsIn(line));
      if (carried.length > 0) break;
    }
  }
  const supplied = [args.paymentMethod, ...(Array.isArray(args.paymentMethods) ? args.paymentMethods : [])]
    .map(fold)
    .filter(Boolean);
  return [...new Set(sent.length > 0 ? sent : (carried.length > 0 ? carried : supplied))];
}

/**
 * A PLACE'S FIGURE IS `line.total`, rates already inside it. This re-added
 * the add on, crypto and fee, so live 2026-09-30 Abu Dhabi read AED 4,400
 * under a total of AED 4,200: Zayn's 5% charged twice. groupTables says the
 * same about its method totals; this line was the one still summing.
 */
function netOf(line) {
  return round(Number(line.total));
}

function breakdownFor(rows, {
  group, rates, cryptoPercent = 0, fx = null, localLocations = DEFAULT_LOCAL_LOCATIONS,
}) {
  const groupRows = rows.filter((row) => fold(row.group_name) === fold(group));

  /**
   * ===============================
   * * RATE THE ROWS, THEN BREAK THEM DOWN. NEVER BOTH AT ONCE.
   * ===============================
   * `paymentBreakdown` reads the rates OFF THE ROW: `withRates` is the one
   * that applies them, and the workbook runs it at the top of its build.
   * This passed `rates` and `cryptoPercent` INTO the breakdown instead,
   * where they were accepted and silently ignored, so her figure came back
   * short by every add on and every crypto charge: 1,000 where the sheet
   * beside her said 1,050. Both are gone from that signature now, so the
   * mistake cannot be made again.
   */
  const rated = groupRows.map((row) => withRates(row, rates, { cryptoPercent }));
  const breakdown = paymentBreakdown(rated, {
    methodLabels: METHOD_LABELS,
    counts: () => true,
  });
  const converted = Number(fx?.usdPerGbp) > 0
    ? withUsd.totals(breakdown, Number(fx.usdPerGbp), localLocations, fx.perUsd ?? {})
    : null;
  return { breakdown, converted, rows: groupRows, rated };
}

/**
 * ONE RECORD AS PARTS, so the text she reads and the card she draws are
 * built from the same figures and cannot disagree. See recordText, recordCard.
 */
function recordParts(record) {
  const { month, group, source, breakdown, converted, fx } = record;
  const head = `${monthLabel(month)}, ${group}, ${source}`;
  const totals = [['Total', moneyList(breakdown.grand)]];
  for (const method of breakdown.methods) {
    totals.push([/bank/i.test(method.method) ? 'Bank' : method.method, moneyList(method.totals)]);
  }
  const usd = [];
  const notes = [];
  if (converted) {
    const methodValue = (pattern) => [...converted.methodUsd.entries()]
      .filter(([method]) => pattern.test(method))
      .reduce((sum, [, value]) => sum + value, 0);
    const missing = new Set(converted.noRate.map(codeFor));
    const addMethodTotal = (label, pattern) => {
      const methods = breakdown.methods.filter((item) => pattern.test(item.method));
      if (methods.length === 0) return;
      const currencies = new Set(methods.flatMap((item) => item.locations)
        .flatMap((location) => location.lines).map((item) => codeFor(item.currency)));
      const rated = [...currencies].filter((currency) => !missing.has(currency));
      const unrated = [...currencies].filter((currency) => missing.has(currency));
      if (rated.length === 0 && unrated.length > 0) {
        usd.push([label, `not converted, no USD rate for ${unrated.join(', ')}`]);
        return;
      }
      usd.push([label, `USD ${money(round(methodValue(pattern)))}`]);
    };
    addMethodTotal('Total bank', /bank/i);
    addMethodTotal('Total Cash', /cash/i);
    addMethodTotal('Total Crypto', /crypto/i);
    usd.push(['Of which UK', `USD ${money(round(converted.awayUsd))}`]);
    usd.push(['Of which other', `USD ${money(round(converted.localUsd))}`]);
    usd.push(['UK send in GBP', `GBP ${money(round(converted.awayGbp))}`]);
    if (converted.noRate.length > 0) {
      notes.push(`No USD rate for ${converted.noRate.join(', ')}. Those amounts are excluded from USD totals.`);
    }
  }
  const detail = [];
  for (const method of breakdown.methods) {
    for (const location of method.locations) {
      for (const line of location.lines) {
        detail.push({ method: method.method, location: location.location, value: `${line.currency} ${money(netOf(line))}` });
      }
    }
  }
  if (fx) {
    const rateSource = fx.source ? `, ${fx.source}` : '';
    const currencies = new Set(breakdown.grand.map((item) => codeFor(item.currency)));
    const used = [`1 GBP = ${rate(fx.usdPerGbp)} USD`];
    if (currencies.has('AED')) used.push(`1 USD = ${rate(AED_PER_USD)} AED, fixed peg`);
    for (const currency of [...currencies].filter((item) => !['GBP', 'USD', 'AED'].includes(item)).sort()) {
      const perUsd = Number(fx.perUsd?.[currency]);
      if (perUsd > 0) used.push(`1 USD = ${rate(perUsd)} ${currency}`);
    }
    notes.push(`FX: ${used.join('; ')}${rateSource}${fx.asOf ? `, ${fx.asOf}` : ''}.`);
  }
  return { head, totals, usd, detail, notes };
}

/** The card: totals, the USD view, then each method's places. */
function recordCard(record, many) {
  const { head, totals, usd, detail } = recordParts(record);
  const prefix = many ? `${record.group} · ` : '';
  const pairRows = (pairs) => pairs.map(([name, detailText]) => ({ name, detail: detailText }));
  const sections = [{ label: `${prefix}Totals`, rows: pairRows(totals) }];
  if (usd.length) sections.push({ label: `${prefix}In USD`, rows: pairRows(usd) });
  const byMethod = new Map();
  for (const d of detail) {
    if (!byMethod.has(d.method)) byMethod.set(d.method, []);
    byMethod.get(d.method).push({ name: d.location, detail: d.value });
  }
  for (const [method, rows] of byMethod) sections.push({ label: `${prefix}${method}`, count: rows.length, rows });
  return { head, sections };
}

function recordText(record) {
  const { head, totals, usd, detail, notes } = recordParts(record);
  const lines = [`${head}.`, ...totals.map(([k, v]) => `${k}: ${v}.`), ...usd.map(([k, v]) => `${k}: ${v}.`)];
  if (detail.length > 0) lines.push(`Payment detail: ${detail.map((d) => `${d.method}, ${d.location}: ${d.value}`).join('; ')}.`);
  lines.push(...notes);
  return lines.join('\n');
}

async function handler(args) {
  /**
   * ===============================
   * * A BARE FOLLOW-UP IS NOT A REQUEST FOR A BREAKDOWN
   * ===============================
   * Live 2026-09-07: "whats the rate", then "and last august?". This ran
   * and returned the five group payment workbook, every figure correct and
   * none of it the answer. A short follow-up carries the PREVIOUS question
   * to a new month; it does not choose a new kind of report.
   *
   * This is a REPORT and it is asked for BY NAME. Checked against the
   * previous line too, so "what about milkman" after "the bank breakdown"
   * still reaches it.
   */
  const asked = String(args.said ?? '');
  if (FOLLOW_UP.test(asked) && !BREAKDOWN_WORDS.test(asked)
    && !BREAKDOWN_WORDS.test(priorSaid(args))) {
    return {
      summary: 'They did not ask for a breakdown. This is a REPORT tool, asked for by name. A '
        + 'short follow-up carries the PREVIOUS question to a new month, so answer that one: '
        + 'exchange_rate for a rate, total_master_sheet for a total, compare_months for a '
        + 'month against another. Do NOT hand them a payment breakdown they did not ask for.',
    };
  }

  const now = currentMonth();
  const months = requestedMonths(args, now);
  const past = months.filter((month) => month < now);
  const saved = new Map((await snapshotsRepo.findMany(past)).map((item) => [item.month, item]));
  const needsLive = months.some((month) => month >= now);
  let live = null;

  if (needsLive) {
    const [rows, settings, rates, fx] = await Promise.all([
      rowsRepo.findAllRows(), settingsRepo.get(), peopleRepo.rateMap(), fxRates.usdPerGbp(),
    ]);
    live = { rows, settings, rates, fx };
  }

  const records = [];
  const unavailable = [];
  for (const month of months) {
    let rows;
    let available;
    let rates;
    let cryptoPercent;
    let localLocations;
    let fx;
    let source;

    if (month < now) {
      const snapshot = saved.get(month);
      if (!snapshot) {
        unavailable.push(`${monthLabel(month)} is unavailable because no month snapshot was saved.`);
        continue;
      }
      available = [...new Set((snapshot.rows ?? []).map((row) => row.group_name).filter(Boolean))].sort();
      rows = countedSnapshotRows(snapshot);
      rates = ratesFromRows(snapshot.rows ?? []);
      cryptoPercent = Number(snapshot.totals?.settings?.cryptoPercent ?? 0);
      localLocations = snapshot.totals?.settings?.localLocations ?? DEFAULT_LOCAL_LOCATIONS;
      fx = snapshot.totals?.fx ?? null;
      source = 'saved actual';
    } else {
      const projected = month === now ? live.rows : projectMonth(live.rows, month);
      const useEndDate = Boolean(live.settings?.color_uses_end_date);
      available = [...new Set(projected.map((row) => row.group_name).filter(Boolean))].sort();
      rows = projected.filter((row) => countsTowardTotal(row, { useEndDate, month }));
      rates = live.rates;
      cryptoPercent = Number(live.settings?.crypto_percent ?? 0);
      localLocations = live.settings?.local_locations ?? DEFAULT_LOCAL_LOCATIONS;
      fx = live.fx;
      source = month === now ? 'live current estimate' : 'projected from current deals';
    }

    const scope = requestedGroups(args, available);
    if (scope.missing.length > 0) {
      /**
       * ===============================
       * * A NAME THEY NEVER SAID IS ONE SHE INVENTED
       * ===============================
       * Live 2026-09-07. "break that down by group" came back as
       * "September 2026 has no group named "ALPHA", "BETA", "GAMMA"".
       * `requestedGroups` falls back to the MODEL's argument when the
       * sentence names none, so three invented names were queried and the
       * refusal handed back as though the admin had asked about them.
       *
       * Same doctrine as `notAGroup`'s invented branch: `said` is the one
       * copy she cannot have edited on the way through. Only when EVERY
       * missing name is unspoken, so a real typo they did say still gets
       * the ordinary "no group named" answer.
       */
      const heard = fold(args.said);
      const invented = scope.missing.filter((name) => !heard.includes(fold(name)));
      if (invented.length > 0 && invented.length === scope.missing.length) {
        // THE NAMES ARE WITHHELD, same rule as `notAGroup`. Handing her a
        // name and telling her not to say it is how "ALPHA, BETA and GAMMA
        // do not exist" reached the admin in the first place.
        const many = invented.length > 1;
        return {
          summary: `The ${many ? 'groups you passed are' : 'group you passed is'} not on the sheet `
            + `and THEY NEVER SAID ${many ? 'THOSE NAMES' : 'IT'}, so ${many ? 'they are names' : 'it is a name'} `
            + `you supplied. Do NOT name ${many ? 'them' : 'it'} back and do NOT report a missing `
            + `group: naming ${many ? 'them' : 'it'} at all tells them they asked something they `
            + 'did not. Ask which group they meant, or offer the whole sheet. The groups that '
            + `exist are: ${available.join(', ')}.`,
        };
      }
      unavailable.push(`${monthLabel(month)} has no group named ${scope.missing.map((g) => `"${g}"`).join(', ')}. Available groups: ${available.join(', ')}.`);
      continue;
    }
    const methods = requestedMethods(args);
    const narrowed = methods.length > 0
      ? rows.filter((row) => methods.includes(fold(row.payment_method)))
      : rows;
    for (const group of scope.groups) {
      const built = breakdownFor(narrowed, {
        group, rates, cryptoPercent, fx, localLocations,
      });
      records.push({ month, group, source, fx, ...built });
    }
  }

  const reply = [...records.map(recordText), ...unavailable].join('\n\n');
  /**
   * DRAWN (his call 2026-09-30): it was one paragraph with every place on a
   * single line. The card carries totals, USD and each method's places; the
   * bubble keeps the heading and the total, plus anything unavailable.
   */
  const many = records.length > 1;
  /**
   * BY COMPANY, when that is what they asked for. "Break that down by
   * company" came back by payment method and place. 2026-09-30. Off the
   * same rated rows the method totals are built from, so they agree.
   */
  if (records.length > 0 && (args.by === 'company' || /\b(?:by|per|each)\s+compan/i.test(String(args.said ?? '')))) {
    const sections = records.map((record) => {
      const byCompany = new Map();
      for (const row of record.rated ?? []) {
        const key = row.company || '(no company)';
        if (!byCompany.has(key)) byCompany.set(key, new Map());
        const cur = byCompany.get(key);
        cur.set(row.currency || 'GBP', (cur.get(row.currency || 'GBP') ?? 0) + Number(row.payable_amount ?? 0));
      }
      const rows = [...byCompany]
        .map(([name, cur]) => ({ name, cur: [...cur].map(([currency, total]) => ({ currency, total: round(total) })) }))
        .sort((a, b) => b.cur.reduce((n, c) => n + c.total, 0) - a.cur.reduce((n, c) => n + c.total, 0))
        .map(({ name, cur }) => ({ name, detail: moneyList(cur) }));
      return { label: `${monthLabel(record.month)} · ${record.group} · by company`, count: rows.length, rows };
    });
    const heads = records.map((record) => { const { head, totals } = recordParts(record); return `${head}: ${totals[0][1]}.`; });
    return {
      summary: `${reply}\n\nBY COMPANY, ALREADY DRAWN ON SCREEN: ${sections.map((s) => s.rows.map((r) => `${r.name} ${r.detail}`).join('; ')).join(' | ')}. `
        + 'Say the total and the biggest company in one sentence; do not read the list.',
      reply: heads.join('\n'),
      list: { kind: 'report', title: heads.join(' '), sections, rows: [] },
      computedReply: true,
      computedMonths: [...new Set(records.map((record) => record.month))],
      records,
    };
  }
  const cards = records.map((record) => recordCard(record, many));
  const short = [
    ...records.map((record) => { const { head, totals } = recordParts(record); return `${head}: ${totals[0][1]}.`; }),
    ...unavailable,
  ].join('\n');
  const list = records.length > 0 ? {
    kind: 'report',
    title: many ? `Breakdown, ${records.length} sections` : cards[0].head,
    note: [...new Set(records.flatMap((record) => recordParts(record).notes))].join('\n'),
    sections: cards.flatMap((card) => (many
      ? card.sections.map((s) => ({ ...s, label: `${card.head.split(',')[0]} · ${s.label}` }))
      : card.sections)),
    rows: [],
  } : undefined;
  return {
    summary: reply || 'No breakdown was available for that request.',
    reply: (list ? short : reply) || 'No breakdown was available for that request.',
    list,
    computedReply: true,
    computedMonths: [...new Set(records.map((record) => record.month))],
    records,
  };
}

const historicalBreakdown = {
  name: 'breakdown_master_sheet',
  description:
    'REPORT money breakdowns without opening an export. Use this for "the breakdown", group '
    + 'breakdowns, historical breakdowns, a breakdown BY COMPANY (by: company), bank versus cash versus crypto, how much goes to the '
    + 'UK, how much stays local/other, or UK send in GBP. It uses saved snapshots for past '
    + 'months and the same payment-breakdown arithmetic as the xlsx export. Never use '
    + 'export_sheet for these reporting questions.',
  parameters: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'One exact YYYY-MM month.' },
      months: {
        type: 'array', items: { type: 'string' },
        description: 'Every requested YYYY-MM month in one call.',
      },
      group: {
        type: 'string',
        description: 'One exact group. The literal group named ALL GROUPS belongs here.',
      },
      groups: {
        type: 'array', items: { type: 'string' },
        description: 'Several exact groups in one call. Each gets its own workbook-equivalent section.',
      },
      allGroups: {
        type: 'boolean',
        description: 'True only for every group. Do not use this for the literal group named ALL GROUPS.',
      },
      paymentMethod: { type: 'string', enum: ['bank', 'cash', 'crypto'] },
      paymentMethods: {
        type: 'array', items: { type: 'string', enum: ['bank', 'cash', 'crypto'] },
        description: 'Every requested payment method. Preserve all of them when the admin names several.',
      },
      by: {
        type: 'string',
        enum: ['company'],
        description: '"break it down by company" / "per company": one line per company instead of by method.',
      },
    },
  },
  handler,
};

module.exports = {
  historicalBreakdown,
  requestedMonths,
  priorSaid,
  priorLines,
  ratesFromRows,
  countedSnapshotRows,
  requestedGroups,
  requestedMethods,
  breakdownFor,
  recordText,
  rate,
};
