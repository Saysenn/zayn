const rowsRepo = require('../../repos/masterSheetRows.repo');
const settingsRepo = require('../../repos/settings.repo');
const peopleRepo = require('../../repos/people.repo');
const snapshotsRepo = require('../../repos/monthSnapshots.repo');
const fxRates = require('../../shared/fxRates.helper');
const { currentMonth } = require('../../shared/presetMonth.helper');
const { monthsInQuestion, monthForRead } = require('../../shared/guessedYear.helper');
const { totalInUsd } = require('../../shared/toUsd.helper');
const { reconcileMonths } = require('../../shared/monthReconcile.helper');
const { figuresFor } = require('../../masterSheet/takeSnapshot');
const { projectMonth } = require('../../masterSheet/projectMonth');
const { notAGroup, notACompany, groupsHeard, resolveDealScope } = require('./notAGroup');

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// ===============================
// * WHAT SHE ANSWERS FOR, AND WHAT SHE WILL READ
// ===============================
// `MAX_MONTHS` was applied with a silent `.slice()`, so a forty month ask
// came back as thirty six and said nothing. Same rule as a capped total: it
// is the ANSWER that is capped, and the answer has to say so. The months
// are gathered uncapped now and `compareHandler` cuts them where it can
// report the cut.
//
// `RANGE_LIMIT` only stops `rangeOf` looping: `1900-01` to `2100-01` is
// 2,400 iterations of nothing. Well above MAX_MONTHS, or the cut would
// happen here where nobody can see it.
// THREE, his call 2026-09-09: the two before this month, and this month.
// It was 36, which reached back years past the twelve months of snapshots
// that exist, so an eighteen month comparison was a row of empty points
// with a cap message nobody had asked about. The dashboard's own default is
// the same window; hers is the ceiling as well as the default for now, and
// widening it is a decision, not a setting.
const MAX_MONTHS = 3;
const RANGE_LIMIT = 120;
const DEFAULT_MONTHS = 3;

const fold = (value) => String(value ?? '').trim().toLocaleLowerCase('en');

// A short continuation of the question before it. The scope and the period
// both carry across one of these, and neither carries across a fresh
// subject, which is why it is this narrow.
const FOLLOW_UP = /\b(?:what about|and|also|same for|how about|those|them|only)\b/i;
const pence = (value) => Math.round(Number(value) * 100) / 100;

function shiftMonth(month, amount) {
  const [year, part] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, part - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month) {
  const [year, part] = month.split('-').map(Number);
  return new Date(Date.UTC(year, part - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function cleanMonths(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim())
    .filter((value) => MONTH.test(value)))].sort();
}

function rangeOf(from, to) {
  if (!MONTH.test(String(from)) || !MONTH.test(String(to))) return [];
  const out = [];
  let cursor = from;
  while (cursor <= to && out.length < RANGE_LIMIT) {
    out.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return out;
}

function countFromSaid(said) {
  const text = String(said ?? '').toLowerCase();
  if (/\b(?:past|last|previous)\s+year\b/.test(text)) return 12;
  const hit = /\b(?:past|last|previous|next|coming)\s+(\d{1,2})\s+months?\b/.exec(text);
  return hit ? Number(hit[1]) : null;
}

function directionFrom(args) {
  if (args.direction) return args.direction;
  return /\b(?:forecast|project|next|future|coming|ahead)\b/i.test(String(args.said ?? ''))
    ? 'forecast'
    : 'history';
}

// EVERY MONTH ASKED FOR, uncapped. `compareHandler` cuts it to MAX_MONTHS
// and says by how much; cutting here is how the cap became invisible.
function monthsRequested(args, now = currentMonth()) {
  /**
   * ===============================
   * * A GUESSED YEAR IS REPAIRED IN THE ARRAY TOO
   * ===============================
   * `monthForRead` was applied to the single `month` argument and never to
   * `months`. Live 2026-09-08: "and last august?" arrived as 2025-08 and
   * was answered verbatim, then carried into the next four turns, so a
   * whole conversation was about a year nobody had said.
   *
   * Same repair as `total_master_sheet` and `breakdown_master_sheet`:
   * theirs when they chose it, repaired to the nearest when she guessed a
   * year over a month they named, dropped when there is nothing to repair
   * to. A dropped month falls through to the words below.
   */
  /**
   * THE WORDS COME FIRST, which is the order `breakdown_master_sheet`
   * already uses: "In September 2026, 'last August' is August 2026, never
   * an older year the model guessed." This read them LAST, so an explicit
   * 2025-08 won and five turns of one conversation were about 2025.
   *
   * `monthForRead` stays underneath for the other half: a far off month
   * when the sentence names none at all.
   */
  const named = monthsInQuestion(args.said, now);
  if (named.length > 0) return named;

  const explicit = cleanMonths(args.months)
    .map((month) => monthForRead(month, args.said, now))
    .filter(Boolean);
  if (explicit.length > 0) return [...new Set(explicit)].sort();

  const range = rangeOf(args.fromMonth, args.toMonth);
  if (range.length > 0) return range;

  // A short scope follow-up keeps the period from the immediately recent
  // user turn. This is deliberately limited to follow-up wording, so a
  // fresh question cannot inherit "last month" from an older subject.
  if (FOLLOW_UP.test(String(args.said ?? ''))) {
    const recent = monthsInQuestion(args.saidRecent, now);
    if (recent.length > 0) return recent;
  }

  const direction = directionFrom(args);
  const count = Math.min(RANGE_LIMIT, Math.max(1,
    Number(args.count ?? countFromSaid(args.said) ?? DEFAULT_MONTHS)));
  const includeCurrent = Boolean(args.includeCurrent);
  const first = includeCurrent ? 0 : (direction === 'forecast' ? 1 : -count);
  const last = includeCurrent ? count - 1 : (direction === 'forecast' ? count : -1);
  const offsets = [];
  if (direction === 'forecast') {
    for (let index = first; index <= last; index += 1) offsets.push(index);
  } else {
    const historyFirst = includeCurrent ? -(count - 1) : first;
    for (let index = historyFirst; index <= last; index += 1) offsets.push(index);
  }
  return offsets.map((offset) => shiftMonth(now, offset));
}

// ===============================
// * A CAP KEEPS THE MONTHS NEAREST NOW
// ===============================
// Taking the FIRST 36 threw away the useful end. "The last 40 months" from
// September 2026 is May 2023 to August 2026, and the cut removed May, June,
// July and August 2026: the only four months with a snapshot in them. She
// answered with thirty six "unavailable" lines and no data at all.
//
// Distance from the current month, then back into month order. A range that
// straddles now keeps the middle, which is the part it is about.
function monthsApart(month, now) {
  const [ay, am] = String(month).split('-').map(Number);
  const [by, bm] = String(now).split('-').map(Number);
  return Math.abs(((ay - by) * 12) + (am - bm));
}

/**
 * ===============================
 * * HER WINDOW IS THE DASHBOARD'S: 2 PAST, THIS MONTH, NEXT
 * ===============================
 * One cap could not say that. `MAX_MONTHS` of 3 let her look three months
 * FORWARD, which is three times what the dashboard projects, so the same
 * question answered on two screens disagreed about how far ahead anyone
 * can see. His call 2026-09-09.
 *
 * Counted from now, so the two halves are capped separately and a question
 * straddling now keeps its share of each.
 */
const MAX_HISTORY_MONTHS = MAX_MONTHS; // 3: the two before this one, and this one
const MAX_FORECAST_MONTHS = 1; // next month, and no further

function monthsAhead(month, now) {
  const [ay, am] = String(month).split('-').map(Number);
  const [by, bm] = String(now).split('-').map(Number);
  return ((ay - by) * 12) + (am - bm);
}

function nearestMonths(months, now, limit = MAX_MONTHS) {
  // PAST AND FUTURE ARE CAPPED APART. A flat "nearest 3" would answer a
  // forecast question with two future months, which is one more than
  // anything else in the CRM will project.
  const withinWindow = months.filter((month) => monthsAhead(month, now) <= MAX_FORECAST_MONTHS);
  if (withinWindow.length <= limit) return withinWindow;
  return [...withinWindow]
    .sort((a, b) => monthsApart(a, now) - monthsApart(b, now))
    .slice(0, limit)
    .sort();
}

// ===============================
// * THE MONTHS ANSWERED MUST MATCH THE DIRECTION ASKED
// ===============================
// Live 2026-09-07: "how did indigo do over the past 6 months", asked after
// a forecast turn, answered March to August 2027. Every figure honest,
// every label right, and the whole answer to a question nobody asked.
//
// The model passed those months EXPLICITLY, so no amount of tightening the
// argument path catches it. Only comparing what came back against the
// admin's own words does.
const PAST_WORDS = /\b(?:past|last|previous|earlier|ago|so far|to date|history|historical|did we|have we)\b/i;
const FUTURE_WORDS = /\b(?:next|coming|upcoming|ahead|future|forecast|forecasting|project|projected|projection|will we)\b/i;

/**
 * `past`, `future`, or null when it is not clearly one.
 *
 * BOTH PRESENT MEANS NOTHING IS DONE. "the last 3 months and the next 3"
 * is a real question, and a guard that clamps it breaks the answer it was
 * meant to protect.
 */
function directionAsked(said) {
  const text = String(said ?? '');
  const past = PAST_WORDS.test(text);
  const future = FUTURE_WORDS.test(text);
  if (past === future) return null;
  return past ? 'past' : 'future';
}

/**
 * Keeps the months on the side that was asked about.
 *
 * THIS MONTH IS NEITHER SIDE: it is kept for both, or a past question loses
 * the baseline it is being measured against.
 *
 * If NOTHING survives, the model's months are unusable rather than merely
 * wide, so the period is rebuilt from the words alone. Returning nothing
 * would be a dead end on a read, which `monthForRead` already refuses to
 * be.
 */
function alignToDirection(months, args, now) {
  const want = directionAsked(args.said);
  if (!want) return { months, note: null };

  const fits = (month) => (want === 'past' ? month <= now : month >= now);
  const keep = months.filter(fits);
  if (keep.length === months.length) return { months, note: null };

  const side = want === 'past' ? 'before' : 'after';
  if (keep.length > 0) {
    const dropped = months.length - keep.length;
    return {
      months: keep,
      note: `They asked about the ${want}, so ${dropped} month${dropped === 1 ? '' : 's'} `
        + `${side === 'before' ? 'after' : 'before'} ${monthLabel(now)} ${dropped === 1 ? 'is' : 'are'} left out.`,
    };
  }

  // Rebuilt from the WORDS only: the supplied months are dropped entirely,
  // so `monthsRequested` cannot hand the same wrong ones straight back.
  const rebuilt = monthsRequested({
    said: args.said,
    count: args.count,
    includeCurrent: args.includeCurrent,
    direction: want === 'past' ? 'history' : 'forecast',
  }, now).filter(fits);
  if (rebuilt.length === 0) return { months, note: null };
  return {
    months: rebuilt,
    note: `They asked about the ${want} and every month worked out was ${side === 'before' ? 'after' : 'before'} `
      + `${monthLabel(now)}, so this is the ${want} instead.`,
  };
}

function scopeValues(args, one, many) {
  return [...new Set([
    args[one],
    ...(Array.isArray(args[many]) ? args[many] : []),
  ].map((value) => String(value ?? '').trim()).filter(Boolean))];
}

// ===============================
// * ONE NAME IN TWO ARGUMENTS IS NOT AN INTERSECTION
// ===============================
// The model sent NEXUS as the GROUP and as the COMPANY. `matchesScope`
// needs both to match, and no row has a company called NEXUS, so a month
// holding GBP 4,775 came back as "nothing" and the scope line read
// "For NEXUS, NEXUS". A name repeated across arguments is the model saying
// one thing twice, never two filters.
function dropRepeatedScope(args) {
  const group = fold(args.group);
  if (!group) return args;
  const out = { ...args };
  const same = (value) => fold(value) === group;
  for (const [one, many] of [['company', 'companies'], ['person', 'people']]) {
    if (same(out[one])) delete out[one];
    if (Array.isArray(out[many])) {
      const kept = out[many].filter((value) => !same(value));
      if (kept.length > 0) out[many] = kept; else delete out[many];
    }
  }
  return out;
}

// Case insensitively, so "manbat" and "MANBAT" are one name. It printed
// "For manbat, MANBAT" because a Set of raw strings sees two.
function uniqueNames(values) {
  const seen = new Map();
  for (const value of values.filter(Boolean)) {
    if (!seen.has(fold(value))) seen.set(fold(value), value);
  }
  return [...seen.values()];
}

// Whether a month holds any money at all. An empty net converts to zero,
// and "USD 0 converted using that month's saved rate" is a figure she made
// up for a month she had nothing for.
function hasMoney(parts) {
  return Object.values(parts?.net ?? {}).some((amount) => Number(amount) !== 0);
}

function matchesScope(row, args) {
  const people = scopeValues(args, 'person', 'people').map(fold);
  const companies = scopeValues(args, 'company', 'companies').map(fold);
  if (people.length > 0 && !people.includes(fold(row.person_name ?? row.personName))) return false;
  if (companies.length > 0 && !companies.includes(fold(row.company))) return false;
  if (args.group && fold(row.group_name ?? row.group) !== fold(args.group)) return false;
  return true;
}

function emptyParts() {
  return { amount: {}, addon: {}, crypto: {}, fee: {}, net: {}, deals: 0 };
}

function add(into, currency, value) {
  into[currency] = pence((into[currency] ?? 0) + (Number(value) || 0));
}

function fromDeals(deals, args) {
  const out = emptyParts();
  for (const deal of deals.filter((item) => matchesScope(item, args))) {
    const currency = deal.currency || 'GBP';
    add(out.amount, currency, deal.amount);
    add(out.addon, currency, deal.addon);
    add(out.crypto, currency, deal.crypto);
    add(out.fee, currency, deal.fee);
    add(out.net, currency, deal.net);
    out.deals += 1;
  }
  return out;
}

function fromStoredTotals(totals) {
  const out = {
    amount: { ...(totals.grand ?? {}) },
    addon: { ...(totals.addon ?? {}) },
    crypto: { ...(totals.crypto ?? {}) },
    fee: { ...(totals.fee ?? {}) },
    net: { ...(totals.net ?? {}) },
    deals: Number(totals.counted ?? 0),
  };
  if (Object.keys(out.net).length === 0) {
    const currencies = new Set([
      ...Object.keys(out.amount), ...Object.keys(out.addon),
      ...Object.keys(out.crypto), ...Object.keys(out.fee),
    ]);
    for (const currency of currencies) {
      out.net[currency] = pence((out.amount[currency] ?? 0) + (out.addon[currency] ?? 0)
        + (out.crypto[currency] ?? 0) - (out.fee[currency] ?? 0));
    }
  }
  return out;
}

function snapshotParts(snapshot, args) {
  const scoped = scopeValues(args, 'person', 'people').length > 0
    || scopeValues(args, 'company', 'companies').length > 0 || Boolean(args.group);
  const deals = snapshot?.totals?.deals;
  if (Array.isArray(deals)) return fromDeals(deals, args);
  if (!scoped) return fromStoredTotals(snapshot?.totals ?? {});
  return null;
}

// The rows AND the deals they produced. Split out because the account below
// needs the deals, and computing them a second time would be a second
// figuresFor call that could disagree with the one the money came from.
function liveFigures(rows, month, args, settings, rates, fx) {
  const scoped = rows.filter((row) => matchesScope(row, args));
  const projected = month === currentMonth() ? scoped : projectMonth(scoped, month);
  return {
    rows: projected,
    totals: figuresFor(projected, month, {
      useEndDate: Boolean(settings?.color_uses_end_date),
      cryptoPercent: Number(settings?.crypto_percent ?? 0),
      rates,
      fx,
    }),
  };
}

function liveParts(rows, month, args, settings, rates, fx) {
  return fromStoredTotals(liveFigures(rows, month, args, settings, rates, fx).totals);
}

// ===============================
// * MONEY KEEPS ITS PENCE, A PERCENTAGE DOES NOT
// ===============================
// One helper formatted both, so money lost its trailing zero: "AED 54,342.5"
// reads as a typo beside the CRM's own $128,162.05 for the same money.
// `checkFigures` rounds both sides to pence before comparing, so the extra
// zero cannot make a correct figure look wrong.
function amountText(value) {
  return Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ===============================
// * ONE ROUNDING FOR A MONTH ON MONTH PERCENTAGE, BOTH SIDES
// ===============================
// She printed 1.89% and the dashboard printed 1.9% for the same move.
// A CONTRACT, not a shared file: `crm/web/src/helpers/trend.js`
// `trendPercentText` pins the other half at one decimal. Neither side may
// change alone.
const PERCENT_DIGITS = 1;
function percentText(value) {
  return Number(value).toLocaleString('en-GB', { maximumFractionDigits: PERCENT_DIGITS });
}

// SORTED, the way a step line already is. `Object.entries` gives insertion
// order, so one month read EURO, AED, GBP and the next GBP, EURO, AED in the
// same answer. A column you have to hunt for on every line is not a column.
function moneyLine(parts) {
  const values = Object.entries(parts.net).sort(([a], [b]) => a.localeCompare(b));
  if (values.length === 0 || values.every(([, amount]) => Number(amount) === 0)) return 'nothing';
  return values.map(([currency, amount]) => `${currency} ${amountText(amount)}`).join(' and ');
}

// Two months hold the same money when the same currencies hold the same
// amounts. Written out rather than JSON compared, because key order differs
// between a snapshot and a projection of the same figures.
function sameMoney(a, b) {
  const keys = [...new Set([...Object.keys(a?.net ?? {}), ...Object.keys(b?.net ?? {})])];
  return keys.every((key) => pence(Number(a?.net?.[key] ?? 0)) === pence(Number(b?.net?.[key] ?? 0)));
}

/**
 * ===============================
 * * ONE LINE PER STEP, EVERY CURRENCY NAMED ON IT
 * ===============================
 *
 * This printed one line per currency and left the currency OUT of the "no
 * change" branch, so three currencies came back as:
 *
 *   From November 2026 to December 2026: no change, 0%.
 *   From November 2026 to December 2026: no change, 0%.
 *   From November 2026 to December 2026: up GBP 1,733.33, 1.89%.
 *
 * Two lines identical to the eye and a third contradicting them. EURO and
 * AED had not moved; GBP had. Every currency is still named, on ONE line
 * per step: three months and three currencies was nine lines of which six
 * said nothing had happened.
 *
 * It also compared only the FIRST month against the LAST, so a twelve month
 * range came back as one delta and every month between them was invisible.
 * Consecutive pairs answer "how did it move", which is the question.
 */
function stepLine(before, after) {
  const currencies = [...new Set([...Object.keys(before.parts.net), ...Object.keys(after.parts.net)])].sort();
  const moves = currencies.map((currency) => {
    const from = Number(before.parts.net[currency] ?? 0);
    const to = Number(after.parts.net[currency] ?? 0);
    const delta = pence(to - from);
    // NAMED EVEN WHEN NOTHING MOVED. "no change" alone is the same sentence
    // for every currency on the sheet. "up GBP 250" is the sentence she
    // already says and reads aloud properly, so only the zero branch
    // differs: it gains the name it was missing.
    if (delta === 0) return `${currency} unchanged`;
    const percent = from === 0 ? '' : ` (${percentText(Math.abs((delta / from) * 100))}%)`;
    return `${delta > 0 ? 'up' : 'down'} ${currency} ${amountText(Math.abs(delta))}${percent}`;
  });
  // The step LEAVES from the last month of the entry before it, which is not
  // its first when that entry is a folded run.
  const from = before.until ?? before.month;
  // HOW FAR THE STEP REACHES. "August 2026 to December 2026: up GBP 16,129"
  // is four months of movement written as one, and read as one month's.
  const span = monthsApart(from, after.month);
  const over = span > 1 ? ` over ${span} months` : '';
  return `${monthLabel(from)} to ${monthLabel(after.month)}: ${moves.join(', ')}${over}.`;
}

// Why a record has no figures, or null when it has some. The two reasons
// read differently and must not be folded into one run.
function reasonOf(record) {
  if (record.source === 'missing') return 'unavailable, no month snapshot was saved';
  if (!record.parts) return 'unavailable for this filter, that older snapshot has no deal breakdown';
  return null;
}

/**
 * Consecutive months that say the SAME THING become one entry spanning them.
 *
 * Two kinds fold: months empty for the same reason, and months holding the
 * same money from the same source. A twelve month projection off an
 * unchanged sheet was twelve identical lines and eleven "unchanged" steps
 * under them, with the months that actually moved buried in the middle.
 *
 * NEVER ACROSS SOURCES. A live estimate and a projection can carry the same
 * figure, and folding them would put a fact and a guess on one line.
 */
function foldRuns(records) {
  const out = [];
  for (const record of records) {
    const reason = reasonOf(record);
    const last = out.at(-1);
    const joinsEmpty = reason && last?.reason === reason;
    const joinsSame = !reason && last && !last.reason
      && last.source === record.source && sameMoney(last.parts, record.parts);
    if (joinsEmpty || joinsSame) {
      last.until = record.month;
      last.run += 1;
      continue;
    }
    out.push({ ...record, reason, until: record.month, run: 1 });
  }
  // A run of ONE is just that month, said the way it always was.
  return out.map((entry) => (entry.run === 1 ? { ...entry, run: 0 } : entry));
}

/**
 * ===============================
 * * A GAP IS NEVER BRIDGED
 * ===============================
 * This filtered the unusable months out FIRST and then paired what was
 * left, so August, no September, October came back as "From August 2026 to
 * October 2026: up GBP X, 1.9%": two months of movement reported as one
 * step. The month line above it said September was unavailable and the
 * delta still read as a single month's move.
 *
 * Pairs are taken in the ORDER ASKED now, and a pair with a hole in it is
 * NOT drawn. Adjacency in this list, not in the calendar: asked for
 * January and June alone, those two are the step.
 *
 * Given FOLDED entries, so a run of unchanged months has no steps inside
 * it: they all said "unchanged" and the run's own line already says so.
 */
/**
 * ===============================
 * * THE STEP SAYS WHAT MOVED. THIS SAYS WHAT MADE IT MOVE.
 * ===============================
 *
 * "Why is she bigger this September" is not a question about a cause, it is
 * an ACCOUNT: every pound of the difference named, and anything left over
 * SAID rather than absorbed. A list of events that does not add up to the
 * difference is the answer looking right and being wrong.
 *
 * The arithmetic is `shared/monthReconcile.helper`, the same one the
 * dashboard reads. Nothing is worked out here: this turns its answer into
 * the finished sentences, because a tool that computes a figure hands back
 * the sentence.
 */

// Long enough for a real month's movement, short enough to stay an answer.
// Over it, the TRUE count is stated and the rest are not invented away.
const ACCOUNT_MAX_LINES = 12;

const BUCKET_WORDS = Object.freeze({
  added: { sign: '+', words: 'added' },
  removed: { sign: '-', words: 'removed from the sheet' },
  ended: { sign: '-', words: 'ended' },
  notCounted: { sign: '-', words: 'not counted this month' },
});

// The four components of a net change, in the words the CRM uses for them.
const PART_WORDS = Object.freeze({
  amount: 'amount', addon: 'add on', crypto: 'crypto charge', fee: 'fee',
});

function whoOf(entry) {
  return [entry.personName, entry.company, entry.role].filter(Boolean).join(', ');
}

function changeWords(entry) {
  const parts = Object.entries(entry.parts ?? {});
  // NAME WHICH PART MOVED. On the net alone an add on going up reads as the
  // wage going up, which is a different conversation with a different fix.
  if (parts.length === 0) return `${entry.was} to ${entry.now}`;
  return parts
    .map(([name, delta]) => `${PART_WORDS[name] ?? name} ${delta > 0 ? 'up' : 'down'} ${entry.currency} ${amountText(Math.abs(delta))}`)
    .join(', ');
}

function accountLines(account) {
  if (!account?.available) return [];
  const lines = [];
  // Only the currencies that actually moved get a balance line. A sheet
  // with four currencies would otherwise close with three sentences about
  // money nobody asked about.
  const moved = new Set();

  for (const [bucket, { sign, words }] of Object.entries(BUCKET_WORDS)) {
    for (const entry of account[bucket] ?? []) {
      moved.add(entry.currency);
      lines.push(`  ${sign} ${entry.currency} ${amountText(entry.net)} ${words}: ${whoOf(entry)}`
        + `${entry.reason ? `, ${entry.reason}` : ''}`);
    }
  }
  for (const entry of account.changed ?? []) {
    moved.add(entry.currency);
    lines.push(`  ${entry.delta > 0 ? '+' : '-'} ${entry.currency} ${amountText(Math.abs(entry.delta))} changed: ${whoOf(entry)}, ${changeWords(entry)}`);
  }

  const shown = lines.slice(0, ACCOUNT_MAX_LINES);
  // A CAP YOU CANNOT SEE IS THE BUG, so the true count leads the cut.
  if (lines.length > ACCOUNT_MAX_LINES) {
    shown.push(`  ...and ${lines.length - ACCOUNT_MAX_LINES} more of ${lines.length} changes. Narrow it to one person or group to see them all.`);
  }

  // THE BALANCE, PER CURRENCY, and a hole is stated out loud. A
  // reconciliation that quietly does not add up is worse than none: it
  // reads as complete.
  for (const [currency, ledger] of Object.entries(account.currencies ?? {})) {
    if (!moved.has(currency) && ledger.delta === 0) continue;
    if (!ledger.balances) {
      shown.push(`  ${currency}: WARNING, ${currency} ${amountText(Math.abs(ledger.residual))} of the change is NOT explained by the deals above. Say so; do not present this as a complete account.`);
      continue;
    }
    // A FLAT MONTH WITH MOVEMENT IN IT IS THE SURPRISING CASE, so it says
    // so rather than falling silent. Calling it a "rise of 0" was worse.
    shown.push(ledger.delta === 0
      ? `  ${currency}: those cancel out exactly. ${currency} ${amountText(ledger.to)} both months, and every change above is accounted for.`
      : `  ${currency}: that accounts for the whole ${currency} ${amountText(Math.abs(ledger.delta))} ${ledger.delta > 0 ? 'rise' : 'fall'}, with nothing left over.`);
  }
  return shown;
}

/**
 * THE SAME ACCOUNT AS ROWS, for the card (his call 2026-09-30). Uncut: the
 * card scrolls, so the cap that keeps the spoken text short does not apply.
 * The balance lines go in the note, since they are about the whole section.
 */
function accountRows(account) {
  if (!account?.available) return { rows: [], balance: [] };
  const rows = [];
  for (const [bucket, { sign, words }] of Object.entries(BUCKET_WORDS)) {
    for (const entry of account[bucket] ?? []) {
      rows.push({
        name: entry.personName || '(no handler)',
        where: [entry.company, entry.role].filter(Boolean).join(' · '),
        detail: `${sign} ${entry.currency} ${amountText(entry.net)} ${words}${entry.reason ? ` · ${entry.reason}` : ''}`,
      });
    }
  }
  for (const entry of account.changed ?? []) {
    rows.push({
      name: entry.personName || '(no handler)',
      where: [entry.company, entry.role].filter(Boolean).join(' · '),
      detail: `${entry.delta > 0 ? '+' : '-'} ${entry.currency} ${amountText(Math.abs(entry.delta))} · ${changeWords(entry)}`,
    });
  }
  const balance = accountLines(account).filter((line) => /^\s{2}[A-Z]{3}: /.test(line)).map((line) => line.trim());
  return { rows, balance };
}

function deltaLines(entries) {
  const lines = [];
  for (let i = 1; i < entries.length; i += 1) {
    const before = entries[i - 1];
    const after = entries[i];
    if (!before.parts || !after.parts) continue;
    // Nothing either side is no step: it printed "September 2026 to October 2026: .". 2026-09-28.
    if (!hasMoney(before.parts) && !hasMoney(after.parts)) continue;
    lines.push(stepLine(before, after));
  }
  return lines;
}

// ===============================
// * A COMBINED FIGURE, ONLY WHEN THE QUESTION IS ABOUT ONE
// ===============================
// `answerEach` says months are reported one at a time and never added,
// because a combined number answers a question nobody asked. That stands.
// This is the exception: a question that IS about the combined figure.
// "did we earn past months" got three months and two steps and never
// answered what was asked.
const ASKS_COMBINED = /\b(?:earn(?:ed|ings)?|in total|altogether|combined|all together|overall|sum|gain(?:ed)?|lost|loss|how much did we (?:make|get))\b/i;

/**
 * The span, as three facts: what it adds up to, what it moved, and WHAT IT
 * COUNTED. The last one is not optional. Five of six months with no
 * snapshot makes "the past 6 months" mean one month, and a sum hides its
 * own holes in a way a list of months does not.
 *
 * OWED, never earned. The sheet holds what is payable; `paid` says whether
 * the money arrived.
 */
function spanLines(records, asked) {
  const withMoney = records.filter((record) => hasMoney(record.parts));
  if (withMoney.length < 2) return [];

  const summed = {};
  for (const record of withMoney) {
    for (const [currency, amount] of Object.entries(record.parts.net)) {
      summed[currency] = pence((summed[currency] ?? 0) + Number(amount || 0));
    }
  }
  const total = Object.entries(summed).sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => `${currency} ${amountText(amount)}`).join(' and ');

  const missing = asked - withMoney.length;
  const counted = missing > 0
    ? `, from the ${withMoney.length} months with figures. ${missing} of the ${asked} asked for `
      + 'have none and are not in this total'
    : '';
  const lines = [`Over the ${asked} months asked for: ${total} owed${counted}.`];

  // First to last, which is the "did we gain or lose" half. It says how far
  // apart they are, because two months four apart is not one month's move.
  const first = withMoney[0];
  const last = withMoney.at(-1);
  if (first !== last) lines.push(`Across the whole span, ${stepLine(first, last)}`);
  return lines;
}

async function compareHandler(rawArgs) {
  // The one scope rule every deal read uses: "milman" sent as a company answered "For milman". 2026-09-28.
  const resolved = await resolveDealScope(dropRepeatedScope(rawArgs));
  if (resolved.question) return { summary: resolved.question };
  const args = dropRepeatedScope(resolved.args);
  /**
   * ===============================
   * * A GROUP THE SENTENCE NEVER NAMED IS ONE SHE SUPPLIED
   * ===============================
   * "did we gain or lose over the past 3 months" came back "For ALL
   * GROUPS": a real group, silently narrowing a question about the whole
   * sheet. `groupsHeard` is the one test for this (a slip included), and it
   * matches only whole names actually in the admin's own sentence.
   *
   * Dropped, not refused: the question is still answerable, just over
   * everything, which is what they asked.
   */
  if (args.group && String(args.said ?? '').trim()) {
    const heard = await groupsHeard(args.said);
    let named = heard.some((name) => fold(name) === fold(args.group));
    /**
     * A FOLLOW-UP CARRIES THE SCOPE, so the previous lines count as having
     * said it. Live 2026-09-08: "which of those three earned most" names no
     * group, this dropped all three, and she answered with three copies of
     * the whole sheet total. `requestedGroups` in historicalBreakdown reads
     * current words, then the prior lines, then the model; this is the same
     * order with the last step still refused.
     */
    if (!named && FOLLOW_UP.test(String(args.said))) {
      const recent = await groupsHeard(String(args.saidRecent ?? ''));
      named = recent.some((name) => fold(name) === fold(args.group));
    }
    if (!named) delete args.group;
  }
  if (args.group) {
    const invalidGroup = await notAGroup(args.group, args.said);
    if (invalidGroup) return { summary: invalidGroup };
  }
  const now = currentMonth();
  // A CAP YOU CANNOT SEE IS THE BUG. The ask is gathered whole, cut here,
  // and the cut is the first thing the reply says.
  // The direction is settled BEFORE the cap, or the cap trims months that
  // were already on the wrong side of today.
  const requested = monthsRequested(args, now);
  const aligned = alignToDirection(requested, args, now);
  const asked = aligned.months;
  const months = nearestMonths(asked, now);
  const cut = asked.length - months.length;
  // NOTHING LEFT INSIDE HER WINDOW: "and the month after" asked for November and
  // crashed reading the first of no months. She says what she can see. 2026-09-28.
  if (asked.length > 0 && months.length === 0) {
    const reply = `${asked.map(monthLabel).join(' and ')} is further ahead than I can see. I can answer from `
      + `${monthLabel(shiftMonth(now, -(MAX_HISTORY_MONTHS - 1)))} to ${monthLabel(shiftMonth(now, MAX_FORECAST_MONTHS))}.`;
    return { summary: reply, reply, computedReply: true };
  }
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
  /**
   * A FIRST NAME IS THE ONE PERSON WHO HAS IT. Library 2026-10-08: "what was
   * felix on last month" matched no full name and answered "nothing, saved
   * actual". Only when exactly one person has that first name: "john" with
   * three Johns stays as said, and is never three people added up. The
   * names are the ones these months hold: a past month is read from its
   * snapshot alone, never from live deals (unit test, 2026-10-08).
   */
  if (args.person && !/\s/.test(String(args.person).trim())) {
    const names = [...new Set([
      ...[...saved.values()].flatMap((s) => (s.totals?.deals ?? []).map((d) => d.personName)),
      ...(live?.rows ?? []).map((r) => r.person_name),
    ].filter(Boolean))];
    if (!names.some((n) => fold(n) === fold(args.person))) {
      const hits = names.filter((n) => fold(String(n).trim().split(/\s+/)[0]) === fold(args.person));
      if (hits.length === 1) args.person = hits[0];
    }
  }

  const records = months.map((month) => {
    if (month < now) {
      const snapshot = saved.get(month);
      if (!snapshot) return { month, source: 'missing', parts: null, fx: null, side: null };
      return {
        month,
        source: 'saved',
        parts: snapshotParts(snapshot, args),
        fx: snapshot.totals?.fx ?? null,
        // What the month HELD, kept beside what it totalled, so the account
        // below works off the same deals the figure came from.
        side: Array.isArray(snapshot.totals?.deals)
          ? {
            month,
            rows: snapshot.rows ?? [],
            deals: snapshot.totals.deals,
            // THE RULE AS IT STOOD THAT MONTH, not as it stands today. A
            // settings change since would otherwise rewrite why an old row
            // fell out of an old month.
            useEndDate: Boolean(snapshot.totals?.settings?.useEndDate),
          }
          : null,
      };
    }
    const figures = liveFigures(live.rows, month, args, live.settings, live.rates, live.fx);
    return {
      month,
      source: month === now ? 'live' : 'projected',
      parts: fromStoredTotals(figures.totals),
      fx: live.fx,
      side: {
        month,
        rows: figures.rows,
        // The whole sheet, not the scope: a deal that moved group is only
        // findable here. See monthReconcile's "still on the sheet".
        allRows: live.rows,
        deals: figures.totals.deals,
        useEndDate: Boolean(live.settings?.color_uses_end_date),
      },
    };
  });

  // ===============================
  // * A SCOPE THAT MATCHED NOTHING ANYWHERE IS OFTEN THE WRONG NAME
  // ===============================
  // "milman payment last august" answered "nothing, saved actual" and
  // "milkman" on the next line answered AED 3,675 and GBP 19,145.95. A
  // zero for a name that does not exist reads as a fact about the
  // business, which is the whole reason these guards exist. Checked only
  // when EVERY month came back empty: a real name with a quiet month must
  // still be allowed to say so.
  const scoped = scopeValues(args, 'person', 'people').length > 0
    || scopeValues(args, 'company', 'companies').length > 0 || Boolean(args.group);
  if (scoped && records.every((record) => !hasMoney(record.parts))) {
    // ONLY the group and company slots. A PERSON name is in neither list,
    // so including them told a real person with a quiet month "there is no
    // group called Gloria". Both guards answer "is this word a group or a
    // company", and a person is correctly neither.
    const names = uniqueNames([
      ...scopeValues(args, 'company', 'companies'),
      args.group,
    ]);
    for (const name of names) {
      // BOTH LISTS, and it only complains when the name is in NEITHER.
      // Each guard returns null when the name is real for its own kind, so
      // asking one alone calls every real group a missing company.
      // eslint-disable-next-line no-await-in-loop
      const asGroup = await notAGroup(name, args.said);
      if (!asGroup) continue;
      // eslint-disable-next-line no-await-in-loop
      const asCompany = await notACompany(name, args.said);
      if (!asCompany) continue;
      // The GROUP correction is the one returned: it carries the near miss
      // that turns "Milman" into "did you mean MILKMAN".
      return { summary: asGroup };
    }
  }

  for (const record of records) {
    // NOTHING DOES NOT CONVERT TO ZERO. An empty net went through the
    // converter and printed "USD 0 converted using that month's saved
    // rate" for a month she simply had no figures for.
    if (!args.convertTo || !record.parts || !hasMoney(record.parts)) continue;
    if (!record.fx?.usdPerGbp) continue;
    const converted = totalInUsd(
      new Map(Object.entries(record.parts.net)), record.fx.usdPerGbp, record.fx.perUsd,
    );
    record.converted = converted;
  }

  const scope = uniqueNames([
    ...scopeValues(args, 'person', 'people'),
    ...scopeValues(args, 'company', 'companies'),
    args.group,
  ]).join(', ') || 'the whole sheet';
  const entries = foldRuns(records);
  const lines = entries.map((record) => {
    // A RUN THAT SAYS ONE THING IS ONE LINE. Asked for forty months with
    // four snapshots between them she printed thirty six identical
    // sentences; a twelve month projection off an unchanged sheet printed
    // twelve identical figures with eleven "unchanged" steps under them.
    if (record.run && record.reason) {
      return `${monthLabel(record.month)} to ${monthLabel(record.until)}: ${record.reason} (${record.run} months).`;
    }
    if (record.run) {
      const source = record.source === 'projected' ? 'projected from current deals' : 'saved actual';
      return `${monthLabel(record.month)} to ${monthLabel(record.until)}: ${moneyLine(record.parts)}, `
        + `${source}, unchanged across ${record.run} months.`;
    }
    if (record.source === 'missing') {
      return `${monthLabel(record.month)}: unavailable because no month snapshot was saved.`;
    }
    if (!record.parts) {
      return `${monthLabel(record.month)}: unavailable for this filter because that older snapshot has no deal breakdown.`;
    }
    const source = record.source === 'saved'
      ? 'saved actual'
      : (record.source === 'projected' ? 'projected from current deals' : 'live current estimate');
    let line = `${monthLabel(record.month)}: ${moneyLine(record.parts)}, ${source}.`;
    if (record.converted) {
      // ONLY A SAVED MONTH HAS A SAVED RATE. This said "that month's saved
      // rate" on every line, so a projected month claimed a rate for a
      // month that has not happened, in the same sentence that called
      // itself projected. A live or future month is converted at today's.
      const rate = record.source === 'saved' ? "that month's saved rate" : "today's rate";
      line += ` USD ${amountText(record.converted.usd)} converted using ${rate}.`;
      if (record.converted.unconvertible.length > 0) {
        line += ` Not converted: ${record.converted.unconvertible.map((item) => item.currency).join(', ')}.`;
      }
    }
    return line;
  });
  // ===============================
  // * SHORT, AND THE CUT FIRST
  // ===============================
  // Scope, the months, the steps between them, and nothing else. The cut
  // leads: it is a fact about the answer, so it cannot sit under it.
  const capped = cut > 0
    ? [`Answering ${months.length} of the ${asked.length} months asked for, the ones nearest now: ${monthLabel(months[0])} to ${monthLabel(months.at(-1))}.`]
    : [];
  const steps = deltaLines(entries);
  /**
   * WHAT MADE IT MOVE, under what moved.
   *
   * Consecutive RECORDS, never the folded entries: a folded run means
   * nothing changed, so it has nothing to account for, and walking the real
   * pairs keeps each account against the two months it is actually about.
   */
  const accounts = [];
  const movedSections = [];
  const balances = [];
  for (let i = 1; i < records.length; i += 1) {
    const before = records[i - 1];
    const after = records[i];
    if (!before.side || !after.side) continue;
    const account = reconcileMonths(before.side, after.side, {
      matches: (deal, row) => matchesScope(row ?? deal, args),
      useEndDate: after.side.useEndDate,
    });
    const lines = accountLines(account);
    if (lines.length === 0) continue;
    accounts.push(`What moved between ${monthLabel(before.month)} and ${monthLabel(after.month)}:`, ...lines);
    const { rows: movedRows, balance } = accountRows(account);
    if (movedRows.length) {
      movedSections.push({ label: `What moved, ${monthLabel(before.month)} to ${monthLabel(after.month)}`, count: movedRows.length, rows: movedRows });
    }
    balances.push(...balance);
  }
  // WHY THERE ARE NO COMPARISONS. Two months with a hole between them draw
  // no step, and so does a scoped question over snapshots with no deal
  // breakdown. Both left the answer simply ending, with nothing said.
  const withFigures = records.filter((record) => record.parts).length;
  const noSteps = steps.length === 0 && withFigures > 0 && records.length > 1
    && records.some((record) => hasMoney(record.parts))
    ? ['No month can be compared with another here: the months between them have nothing saved.']
    : [];
  // Only when the words ask for a combined figure. Never volunteered.
  const span = ASKS_COMBINED.test(String(args.said ?? ''))
    ? spanLines(records, months.length)
    : [];
  const wrongWay = aligned.note ? [aligned.note] : [];
  const scheduled = await scheduledFor(records, scope);
  const reply = [
    ...wrongWay, ...capped, `For ${scope}:`, ...lines, ...scheduled, ...steps, ...accounts, ...noSteps, ...span,
  ].join('\n');

  /**
   * DRAWN (his call 2026-09-30). The bubble keeps the months and the steps
   * between them, which ARE the answer; the card carries every deal that
   * moved, uncut, and the balance line that says whether it all adds up.
   */
  const list = movedSections.length > 0 ? {
    kind: 'report',
    title: `${scope}: what moved`,
    note: balances.join('\n'),
    sections: movedSections,
    rows: [],
  } : undefined;
  const short = [...wrongWay, ...capped, `For ${scope}:`, ...lines, ...scheduled, ...steps, ...noSteps, ...span].join('\n');

  return {
    summary: reply,
    reply: list ? short : reply,
    list,
    computedReply: true,
    computedMonths: records.filter((record) => record.parts).map((record) => record.month),
    records,
  };
}

/**
 * A projection is today's deals; a change SCHEDULED for that month is not in
 * it. Said beside the figure, so "what will he get in November" is not 1,000
 * when 1,300 is already booked to apply.
 */
async function scheduledFor(records, scope) {
  const future = new Set(records.filter((r) => r.source === 'projected').map((r) => r.month));
  if (future.size === 0) return [];
  const queue = require('../../repos/scheduledActions.repo');
  const fold = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const names = scope === 'the whole sheet' ? [] : scope.split(', ').map(fold);
  const rows = (await queue.upcoming(currentMonth()).catch(() => []))
    .filter((r) => future.has(r.due_month) && (names.length === 0 || names.some((n) => fold(r.said).includes(n))));
  return rows.map((r) => `Scheduled for ${monthLabel(r.due_month)}, not in that figure yet: ${r.said}.`);
}

const compareMonths = {
  name: 'compare_months',
  description:
    'Use this for any saved month history, month comparison, trend, past period, or future projection. '
    + 'ALSO USE IT FOR WHY: "why is she bigger this month than last", "what changed", "what did we lose". '
    + 'It returns the ACCOUNT of the difference, deal by deal: what was added, what was removed from the '
    + 'sheet, what ended, what is still live but marked for another month, and what changed amount. It '
    + 'says whether those add up to the whole difference. Never work the difference out yourself and never '
    + 'guess a cause: read back what it returns. '
    + 'Past months come only from immutable snapshots. Future months simulate the existing deals and never change a preset. '
    + 'This returns the finished figures and labels actual, live, projected, or unavailable itself.',
  parameters: {
    type: 'object',
    properties: {
      months: {
        type: 'array', items: { type: 'string' },
        description: 'Exact YYYY-MM months. Put every requested month in this one array.',
      },
      fromMonth: { type: 'string', description: 'First YYYY-MM in an inclusive range.' },
      toMonth: { type: 'string', description: 'Last YYYY-MM in an inclusive range.' },
      count: { type: 'integer', minimum: 1, maximum: MAX_MONTHS },
      direction: { type: 'string', enum: ['history', 'forecast'] },
      includeCurrent: { type: 'boolean' },
      person: { type: 'string' },
      people: {
        type: 'array', items: { type: 'string' },
        description: 'Several people combined only when the admin asked for a combined trend.',
      },
      company: { type: 'string' },
      companies: { type: 'array', items: { type: 'string' } },
      group: { type: 'string' },
      convertTo: { type: 'string', enum: ['USD'] },
    },
  },
  handler: compareHandler,
};

module.exports = {
  compareMonths,
  monthsRequested,
  nearestMonths,
  foldRuns,
  dropRepeatedScope,
  directionAsked,
  alignToDirection,
  snapshotParts,
  fromStoredTotals,
  deltaLines,
  accountLines,
  // Exported so the tests assert the BEHAVIOUR against whatever the cap is,
  // rather than hardcoding a number that then has to be chased on every
  // change. It moved 36 -> 3 on 2026-09-09 and three tests broke for no
  // reason other than the literal.
  MAX_MONTHS,
};
