const ExcelJS = require('exceljs');
const env = require('../../../configs/env');
const { getClient } = require('../chatClient');
const { fold, within, oneTypo } = require('../tools/resolvePerson');
const { FIELDS, changeLine } = require('./planSteps');

/**
 * ***************************************************
 * * A SHEET THEY PASTE OR DROP IN, CHECKED AGAINST OURS, NOTHING MISSED
 * ***************************************************
 *
 * The admin's call 2026-10-06: paste a messy list or upload a file, and
 * Diane says what differs from the CRM, which groups were renamed, added or
 * dropped, and offers to make it match: add, update, stop, as one plan.
 *
 * Three rules, because "nothing missed" is the whole point:
 *
 *   1. A TABLE IS READ BY CODE. A header row naming the columns is read
 *      exactly; the model is only for text with no table in it.
 *   2. EVERY LINE IS ACCOUNTED FOR. A line is a row, a header, a total, a
 *      blank, or "could not read", and that last list is shown to them.
 *   3. EVERY FIGURE THE MODEL READ IS ON ITS LINE. A number it gives that
 *      is not in the words of the line it says it came from is a misread,
 *      and the row is shown as not read rather than trusted.
 *
 * The comparison itself never uses the model.
 */

// Header words, per field. First match wins; "amount" alone is the monthly.
const HEADERS = [
  ['person', /^(?:name|person|handler|staff|employee|worker|full ?name|who)$/],
  ['group', /^(?:group|grp|team|group ?name)$/],
  ['company', /^(?:company|client|comp|company ?name|business)$/],
  ['roleLabel', /^(?:role|position|title|seat|job)$/],
  ['payableDays', /^(?:days|payable ?days|pd|no\.? ?of ?days)$/],
  ['payableAmount', /^(?:payable|payable ?amount|to ?pay|owed|due|payout)$/],
  ['monthlyAmount', /^(?:monthly|monthly ?amount|salary|rate|amount|pay|monthly ?pay|monthly ?salary)$/],
  ['currency', /^(?:currency|ccy|cur)$/],
  ['paymentMethod', /^(?:method|payment ?method|paid ?by|payment|pay ?method|bank\/cash)$/],
  ['presetOn', /^(?:preset|preset ?date|preset ?on)$/],
  ['endOn', /^(?:end|end ?date|ends|end ?on)$/],
  ['notes', /^(?:notes?|comments?|remarks?)$/],
  ['label', /^(?:label|tag)$/],
];
const MONEY = new Set(['monthlyAmount', 'payableAmount']);
const CURRENCIES = /\b(AED|GBP|USD|EUR|EURO|£|\$|€)\b|[£$€]/i;

/** A file into text: every sheet a block, every row a tab separated line. */
async function fileToText(buffer, filename = '') {
  if (!/\.xlsx?$/i.test(filename)) return buffer.toString('utf8');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  const out = [];
  book.eachSheet((sheet) => {
    out.push(`## Sheet: ${sheet.name}`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      for (let c = 1; c <= row.cellCount; c += 1) {
        const v = row.getCell(c).value;
        const text = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10)
          : typeof v === 'object' ? (v.text ?? v.result ?? (v.richText ? v.richText.map((r) => r.text).join('') : '')) : v;
        cells.push(String(text).replace(/\s+/g, ' ').trim());
      }
      if (cells.some(Boolean)) out.push(cells.join('\t'));
    });
  });
  return out.join('\n');
}

/** "AED 4,500", "4.5k", "£1,000.50" → 4500, 4500, 1000.5. */
function numberIn(v) {
  const m = /(-?\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i.exec(String(v ?? ''));
  return m ? Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1) : null;
}
function currencyIn(v) {
  const m = CURRENCIES.exec(String(v ?? ''));
  if (!m) return null;
  const c = (m[1] ?? m[0]).toUpperCase();
  return { '£': 'GBP', $: 'USD', '€': 'EUR', EURO: 'EUR' }[c] ?? c;
}
/** 2026-10-01, 01/10/2026 (day first, as the business writes it). */
function dateIn(v, monthFirst = false) {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (!m) return null;
  const [day, month] = monthFirst ? [m[2], m[1]] : [m[1], m[2]];
  return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * DAY FIRST OR MONTH FIRST, decided per column from its own values: a
 * "10/25/2026" anywhere in it says month first, a "25/10/2026" says day
 * first. Day first when nothing says, as the business writes dates.
 */
function monthFirstIn(values) {
  let monthFirst = false;
  for (const v of values) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/.exec(String(v ?? '').trim());
    if (!m) continue;
    if (Number(m[1]) > 12) return false;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  return monthFirst;
}

/** One cell into the value it means for its field. */
function cellValue(field, raw) {
  const s = String(raw ?? '').trim();
  if (!s || /^[-–—]$/.test(s)) return undefined;
  if (MONEY.has(field) || field === 'payableDays') return numberIn(s) ?? undefined;
  if (field === 'presetOn' || field === 'endOn') return dateIn(s) ?? undefined;
  if (field === 'currency') return currencyIn(s) ?? s.toUpperCase();
  if (field === 'paymentMethod') return /cash/i.test(s) ? 'cash' : /bank|transfer/i.test(s) ? 'bank' : /crypto|usdt|btc/i.test(s) ? 'crypto' : s.toLowerCase();
  return s;
}

const splitCells = (line, sep) => (sep === 'space' ? line.split(/\s{2,}/) : line.split(sep)).map((c) => c.trim());

/**
 * A TABLE, read by code. Null when there is no header row naming a person
 * column and at least one other: then it is not a table and the model reads it.
 */
function readTable(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const result = { rows: [], unread: [], headerLines: [] };
  let header = null;
  let sep = null;
  let sheet = null;
  let found = false;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (!line.trim()) return;
    const sheetMark = /^## Sheet: (.+)$/.exec(line);
    if (sheetMark) { sheet = sheetMark[1].trim(); header = null; result.headerLines.push(n); return; }
    const guessSep = line.includes('\t') ? '\t' : line.includes('|') ? '|' : (line.match(/,/g) ?? []).length >= 2 ? ',' : line.includes(';') ? ';' : 'space';
    const cells = splitCells(line, guessSep);
    const map = cells.map((c) => HEADERS.find(([, re]) => re.test(c.toLowerCase().replace(/[:*]/g, '').trim()))?.[0] ?? null);
    if (map.includes('person') && map.filter(Boolean).length >= 2) {
      header = map;
      sep = guessSep;
      found = true;
      result.headerLines.push(n);
      return;
    }
    if (!header) { result.unread.push({ line: n, text: line, why: 'before any header row' }); return; }
    const row = { line: n, text: line, sheet };
    splitCells(line, sep).forEach((c, k) => {
      const field = header[k];
      if (!field) return;
      if (field === 'person' || field === 'group' || field === 'company') {
        if (c) row[field] = c;
        return;
      }
      const v = cellValue(field, c);
      if (v !== undefined) row[field] = v;
      if (MONEY.has(field) && !row.currency && currencyIn(c)) row.currency = currencyIn(c);
    });
    if (!row.person || /^(?:total|totals|sum|grand total)$/i.test(row.person)) {
      result.headerLines.push(n); // a total or a spacer row: understood, nothing to check
      return;
    }
    if (!row.group && sheet) row.group = sheet;
    result.rows.push(row);
  });
  return found ? result : null;
}

const ROW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['line', 'person', 'group', 'company', 'roleLabel', 'monthlyAmount', 'payableAmount', 'payableDays', 'currency', 'paymentMethod', 'notes'],
        properties: {
          line: { type: 'integer' },
          person: { type: 'string' },
          group: { type: 'string' },
          company: { type: 'string' },
          roleLabel: { type: 'string' },
          monthlyAmount: { type: 'string' },
          payableAmount: { type: 'string' },
          payableDays: { type: 'string' },
          currency: { type: 'string' },
          paymentMethod: { type: 'string' },
          notes: { type: 'string' },
        },
      },
    },
  },
};

/**
 * MESSY TEXT, read by the model, in chunks so a long paste is never cut,
 * then held to its own lines.
 */
async function readMessy(text, groups, onChunk = null, client = null) {
  const openai = client ?? getClient();
  if (!openai) throw new Error('no AI key');
  const lines = String(text ?? '').split(/\r?\n/);
  const numbered = lines.map((l, i) => `${i + 1}| ${l}`);
  const rows = [];
  for (let start = 0; start < numbered.length; start += 60) {
    onChunk?.(Math.floor(start / 60) + 1, Math.ceil(numbered.length / 60));
    // eslint-disable-next-line no-await-in-loop
    const res = await openai.chat.completions.create({
      model: env.openaiModel,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'Read payroll deal rows out of messy text. Each numbered line is "N| text". One row per deal '
            + 'mentioned: who, and any of group, company, role, monthly amount, payable amount, payable days, '
            + 'currency, payment method (cash/bank/crypto), notes. Give "line" as the N the deal is on. Copy '
            + 'figures exactly as written (no maths). Use "" for anything not written. Skip headers, totals and '
            + `chat. Known groups: ${groups.join(', ')}.`,
        },
        { role: 'user', content: numbered.slice(start, start + 60).join('\n') },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'rows', strict: true, schema: ROW_SCHEMA } },
    });
    rows.push(...(JSON.parse(res.choices?.[0]?.message?.content ?? '{"rows":[]}').rows ?? []));
  }
  const out = { rows: [], unread: [], headerLines: [] };
  const digits = (s) => String(s ?? '').replace(/[^\d.]/g, '');
  for (const r of rows) {
    const source = lines[r.line - 1] ?? '';
    const row = { line: r.line, text: source };
    let misread = null;
    for (const [field, value] of Object.entries(r)) {
      if (field === 'line' || value === '' || value == null) continue;
      if (field === 'person' || field === 'group' || field === 'company') { row[field] = value; continue; }
      const v = cellValue(field, value);
      if (v === undefined) continue;
      // HELD TO ITS LINE: a figure that is not on the line is not trusted.
      if (typeof v === 'number' && !digits(source.replace(/,/g, '')).includes(digits(String(value).replace(/,/g, '').replace(/k$/i, '')))) {
        misread = `${FIELDS[field]?.label ?? field} ${value} is not on that line`;
      }
      row[field] = v;
    }
    if (misread || !row.person) out.unread.push({ line: r.line, text: source, why: misread ?? 'no name' });
    else out.rows.push(row);
  }
  // EVERY LINE ACCOUNTED FOR: one with a figure or a name that no row used.
  const used = new Set([...out.rows, ...out.unread].map((r) => r.line));
  lines.forEach((l, i) => {
    if (!used.has(i + 1) && /\d/.test(l) && /[a-z]{3,}/i.test(l)) out.unread.push({ line: i + 1, text: l, why: 'not read as a deal' });
  });
  return out;
}

/** A paste with a table in it, or several lines of names and figures. */
function looksLikeSheet(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) return false;
  if (readTable(text)) return true;
  return lines.filter((l) => /\d/.test(l) && /[a-z]{3,}/i.test(l)).length >= 3;
}

// TWO NAMES FOR THE SAME THING: a typo, "Ltd" or not, a word dropped.
const GENERIC = new Set(['ltd', 'limited', 'llc', 'inc', 'co', 'the', 'and', 'group', 'uk', 'payroll', 'pr', 'resourcing', 'recruitment', 'employment', 'services']);
const nameWords = (v) => String(v ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !GENERIC.has(w));
/**
 * NICKNAMES: "Jim" in their file is our "James". Each line is one name and
 * its usual short forms. Only the FIRST word is swapped, and the rest must
 * still match, so "Jim Brown" is not "James Smith".
 */
const NICKNAMES = [
  'james jim jimmy jamie', 'robert rob bob bobby robbie', 'william will bill billy liam', 'richard rich rick ricky dick',
  'michael mike mikey mick micky', 'thomas tom tommy', 'christopher chris kit', 'daniel dan danny', 'matthew matt matty',
  'anthony tony ant', 'joseph joe joey', 'edward ed eddie ted ned', 'andrew andy drew', 'stephen steve stevie', 'steven steve stevie',
  'nicholas nick nicky', 'benjamin ben benny', 'samuel sam sammy', 'alexander alex al sandy', 'jonathan jon jonny john',
  'david dave davey', 'peter pete', 'charles charlie chas chuck', 'patrick pat paddy', 'gregory greg', 'timothy tim timmy',
  'kenneth ken kenny', 'ronald ron ronnie', 'donald don donny', 'nathan nate nat', 'nathaniel nate nat', 'zachary zach zack',
  'elizabeth liz lizzie beth betty eliza', 'margaret maggie meg peggy', 'katherine kate katie kathy kat', 'catherine cat cathy kate katie',
  'jennifer jen jenny', 'rebecca becky becca', 'victoria vicky tori', 'samantha sam sammie', 'alexandra alex lexi sandra',
  'deborah deb debbie', 'susan sue suzy', 'patricia pat patty trish', 'jessica jess jessie', 'abigail abby abbie', 'nicola nicky nikki',
  'gloria glo', 'stuart stu', 'louis lou', 'leanne lea',
].map((l) => l.split(' '));
const nickOf = new Map();
for (const set of NICKNAMES) for (const n of set) nickOf.set(n, [...(nickOf.get(n) ?? []), ...set]);
const sameFirstName = (a, b) => a === b || (nickOf.get(a) ?? []).includes(b);
const nickname = (a, b) => {
  const wa = String(a ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const wb = String(b ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (!wa.length || !wb.length || wa[0] === wb[0] || !sameFirstName(wa[0], wb[0])) return false;
  const restA = wa.slice(1).join(' ');
  const restB = wb.slice(1).join(' ');
  // "Jim" and "James Heath": a surname on one side only is still them.
  return !restA || !restB || fold(restA) === fold(restB) || (Math.min(restA.length, restB.length) >= 4 && oneTypo(fold(restA), fold(restB)));
};
const closeName = (a, b) => {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return false;
  if (nickname(a, b)) return true;
  if (x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)))) return true;
  if (Math.min(x.length, y.length) >= 4 && oneTypo(x, y)) return true;
  const wa = nameWords(a);
  const wb = nameWords(b);
  // EVERY distinctive word of the shorter name is in the longer: "Social
  // work first PR" is NOT "Social work partners PR", though two words match.
  const [few, many] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return few.length > 0 && few.every((w) => many.some((v) => w === v || (Math.min(w.length, v.length) >= 4 && oneTypo(w, v))));
};

const DATES = new Set(['presetOn', 'endOn', 'assignedOn', 'paymentStartOn']);
const NUMBERS = new Set(['monthlyAmount', 'payableAmount', 'payableDays', 'addonPercent', 'feePercent']);
const asDay = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
// ONE NAME PER CURRENCY on both sides: the CRM writes EURO, a file may say
// EUR, € or Euro. Compared raw, every euro deal read as different. 2026-10-06.
const currencyKey = (v) => fold(currencyIn(v) ?? v).replace(/^euro?$/, 'eur');
const same = (field, theirs, ours) => {
  if (theirs === undefined) return true;
  if (field === 'currency') return currencyKey(theirs) === currencyKey(ours ?? '');
  if (NUMBERS.has(field)) return Math.abs(Number(theirs) - Number(ours ?? 0)) < 0.005;
  if (DATES.has(field)) return asDay(ours) === asDay(theirs);
  return fold(theirs) === fold(ours ?? '');
};
const COMPARED = ['monthlyAmount', 'payableAmount', 'payableDays', 'currency', 'paymentMethod', 'roleLabel', 'presetOn', 'endOn',
  'assignedOn', 'paymentStartOn', 'phone', 'bankDetails', 'accountNumber', 'sortCode', 'postcode', 'location', 'notes', 'label'];

/**
 * A MASTER SHEET FILE, read by the CRM's OWN import reader (masterSheet/
 * parseImport.js), which already knows his columns, his group tabs and his
 * header quirks on his real files. Live 2026-10-06: read here instead, his
 * headers were not recognised, all 92 rows went to the model for 72
 * seconds, and 85 of them came back as changes. Only the columns the file
 * HAS are compared: the reader fills an absent one with a default, and a
 * default is not something they wrote. Payable amount and days are worked
 * out by the reader, never read off the sheet, so the inputs behind them
 * are compared instead.
 */
const IMPORT_FIELDS = {
  monthlyAmount: 'monthly_amount', currency: 'currency', paymentMethod: 'payment_method', roleLabel: 'role_label',
  presetOn: 'preset_on', endOn: 'end_on', assignedOn: 'assigned_on', paymentStartOn: 'payment_start_on',
  addonPercent: 'addon_percent', feePercent: 'fee_percent', phone: 'phone', notes: 'notes', label: 'label',
};
function fromImportRows(rows = [], columns = []) {
  const present = new Set(columns);
  return {
    rows: rows.map((r) => {
      const row = {
        line: (r.uploadIndex ?? 0) + 1,
        text: `${r.personName} · ${r.groupName} · ${r.company}`,
        person: r.personName,
        group: r.groupName && r.groupName !== 'UNKNOWN' ? r.groupName : undefined,
        company: r.company || undefined,
      };
      for (const [field, column] of Object.entries(IMPORT_FIELDS)) {
        const v = r[field];
        if (present.has(column) && v !== undefined && v !== null && v !== '') row[field] = v;
      }
      return row;
    }).filter((r) => r.person),
    unread: [],
    headerLines: [],
  };
}

/**
 * THEIR ROWS AGAINST OURS. Code only. Groups first, since a renamed group
 * makes every deal in it look new.
 */
function compare(read, deals, knownGroups) {
  const live = deals.filter((d) => !d.stopped_on);
  const groupOf = (g) => {
    if (!g) return null;
    const want = fold(g);
    return knownGroups.find((k) => fold(k) === want) ?? knownGroups.find((k) => want.length >= 4 && within(want, fold(k), 1)) ?? null;
  };
  // ---- groups: renamed, new, not in their sheet ----
  const theirGroups = new Map();
  for (const r of read.rows) {
    if (!r.group) continue;
    const key = groupOf(r.group) ?? r.group.trim();
    if (!theirGroups.has(key)) theirGroups.set(key, new Set());
    theirGroups.get(key).add(fold(r.person));
  }
  const ourGroups = new Map();
  for (const d of live) {
    if (!ourGroups.has(d.group_name)) ourGroups.set(d.group_name, new Set());
    ourGroups.get(d.group_name).add(fold(d.person_name));
  }
  const renamed = [];
  const newGroups = [];
  for (const [g, people] of theirGroups) {
    if (ourGroups.has(g)) continue;
    let best = null;
    for (const [ours, theirsPeople] of ourGroups) {
      if (theirGroups.has(ours)) continue;
      const overlap = [...theirsPeople].filter((p) => people.has(p)).length / Math.max(theirsPeople.size, 1);
      if (overlap >= 0.6 && (!best || overlap > best.overlap)) best = { from: ours, overlap };
    }
    if (best) renamed.push({ from: best.from, to: g, deals: live.filter((d) => d.group_name === best.from) });
    else newGroups.push(g);
  }
  const renamedTo = new Map(renamed.map((r) => [r.to, r.from]));

  // ---- rows: matched, mismatched, new, unclear ----
  const mismatched = [];
  const notOnSheet = [];
  const unmatched = [];
  const matchedIds = new Set();
  const companies = new Set(live.map((d) => fold(d.company)));
  for (const r of read.rows) {
    // "gary manbat kp 6300": KP is a company here, read as his role. Live 2026-10-06.
    if (!r.company && r.roleLabel && companies.has(fold(r.roleLabel))) {
      r.company = r.roleLabel;
      delete r.roleLabel;
    }
    const group = r.group ? (groupOf(r.group) ?? renamedTo.get(r.group.trim()) ?? null) : null;
    const want = fold(r.person);
    let cands = live.filter((d) => fold(d.person_name) === want);
    if (cands.length === 0) cands = live.filter((d) => want.length >= 4 && within(fold(d.person_name), want, 1));
    if (cands.length === 0) {
      // THEIR group name for a new deal: a renamed group's deals land under
      // the NEW name, or the add would bring the old group back. Proof run 2026-10-06.
      notOnSheet.push({ ...r, group: r.group ? (groupOf(r.group) ?? r.group.trim()) : null });
      continue;
    }
    if (group) cands = cands.filter((d) => d.group_name === group);
    /**
     * THE COMPANY ON THE ROW COUNTS even for someone with one deal. Live
     * 2026-10-06: Nathan's row at "Social work partners PR" took our Nathan at
     * "Social work first PR" on the name alone, and his real first PR row
     * then looked new. A company that is clearly another one is not this deal.
     */
    if (r.company) {
      const sameCo = cands.filter((d) => closeName(d.company, r.company));
      if (sameCo.length) cands = sameCo;
      else if (cands.every((d) => d.company)) cands = [];
    }
    if (r.company && cands.length > 1) {
      const byCo = cands.filter((d) => fold(d.company).includes(fold(r.company)) || fold(r.company).includes(fold(d.company)));
      if (byCo.length) cands = byCo;
    }
    cands = cands.filter((d) => !matchedIds.has(d.id));
    if (cands.length === 0) {
      notOnSheet.push({ ...r, group: r.group ? (groupOf(r.group) ?? r.group.trim()) : null });
      continue;
    }
    // TWO DEALS AT ONE COMPANY are told apart by the role on the row.
    if (cands.length > 1 && r.roleLabel) {
      const byRole = cands.filter((d) => fold(d.role_label) === fold(r.roleLabel));
      if (byRole.length) cands = byRole;
    }
    if (cands.length > 1) {
      unmatched.push({ ...r, why: `${cands[0].person_name} has ${cands.length} deals (${cands.map((d) => d.group_name).join(', ')}) and the row does not say which` });
      continue;
    }
    const deal = cands[0];
    matchedIds.add(deal.id);
    const diffs = COMPARED.filter((f) => r[f] !== undefined && !same(f, r[f], deal[FIELDS[f].column]))
      .map((f) => ({ field: f, theirs: r[f], ours: deal[FIELDS[f].column] }));
    if (diffs.length) mismatched.push({ row: r, deal, diffs });
  }

  /**
   * ===============================
   * * THE SAME DEAL, SPELT ANOTHER WAY
   * ===============================
   * "Acqua resourcing" and "Acqua Resourcing Ltd", "Relia PA" and "Reliapay",
   * "Jim" and "James": exact matching made each a new deal AND a stop. A
   * row left over is matched to one deal of ours left over in the same group
   * when the person AND the company are close, and only when there is
   * exactly one such deal. It is compared as that deal, and the spelling is
   * shown so they can see the pairing.
   */
  const respelled = [];
  for (const r of [...notOnSheet]) {
    if (!r.person) continue;
    const group = r.group ? (groupOf(r.group) ?? renamedTo.get(String(r.group).trim()) ?? r.group) : null;
    const near = live.filter((d) => !matchedIds.has(d.id) && (!group || d.group_name === group)
      && closeName(d.person_name, r.person) && (!r.company || closeName(d.company, r.company)));
    if (near.length !== 1) continue;
    const deal = near[0];
    matchedIds.add(deal.id);
    notOnSheet.splice(notOnSheet.indexOf(r), 1);
    respelled.push({ row: r, deal });
    const diffs = COMPARED.filter((f) => r[f] !== undefined && !same(f, r[f], deal[FIELDS[f].column]))
      .map((f) => ({ field: f, theirs: r[f], ours: deal[FIELDS[f].column] }));
    if (diffs.length) mismatched.push({ row: r, deal, diffs });
  }

  // ---- ours, missing from theirs: only in the groups their sheet covers ----
  /**
   * A GROUP IS THEIRS TO REPORT ON ONLY WHEN THEIR SHEET HOLDS MOST OF IT.
   * Live 2026-10-06: four pasted lines named three groups, and every other
   * deal in those groups, 53 of them, was offered as a stop. A sheet that
   * matches 60% or more of a group's deals is that group's list; anything
   * thinner is a few lines about it, and the rest is left alone.
   */
  const matchedIn = (g) => live.filter((d) => d.group_name === g && matchedIds.has(d.id)).length;
  const named = [...new Set([...theirGroups.keys()].map((g) => renamedTo.get(g) ?? g).filter((g) => ourGroups.has(g)))];
  const covered = new Set(named.filter((g) => matchedIn(g) / Math.max(live.filter((d) => d.group_name === g).length, 1) >= 0.6));
  const partial = named.filter((g) => !covered.has(g))
    .map((g) => ({ group: g, matched: matchedIn(g), total: live.filter((d) => d.group_name === g).length }));
  const missing = live.filter((d) => covered.has(d.group_name) && !matchedIds.has(d.id));
  const notInTheirs = [...ourGroups.keys()].filter((g) => !named.includes(g) && !renamed.some((r) => r.from === g));

  /**
   * A DEAL THAT CHANGED GROUP IS A MOVE, not a new deal and a stop. Live
   * 2026-10-06: James King and Drew at Monument Marketing went from INDIGO to
   * MILKMAN and came back as two adds and two stops. Same person, same
   * company, one deal of ours not in their sheet: that deal moved.
   */
  const moved = [];
  for (const r of [...notOnSheet]) {
    if (!r.company || !r.group) continue;
    const was = live.filter((d) => !matchedIds.has(d.id) && fold(d.person_name) === fold(r.person)
      && fold(d.company) === fold(r.company) && d.group_name !== r.group);
    if (was.length !== 1) continue;
    const deal = was[0];
    matchedIds.add(deal.id);
    notOnSheet.splice(notOnSheet.indexOf(r), 1);
    const at = missing.indexOf(deal);
    if (at >= 0) missing.splice(at, 1);
    moved.push({ row: r, deal, from: deal.group_name, to: r.group });
    const diffs = COMPARED.filter((f) => r[f] !== undefined && !same(f, r[f], deal[FIELDS[f].column]))
      .map((f) => ({ field: f, theirs: r[f], ours: deal[FIELDS[f].column] }));
    if (diffs.length) mismatched.push({ row: r, deal, diffs });
  }

  /**
   * A ROW THAT IS A STOPPED DEAL OF OURS IS NOT NEW. Live 2026-10-06: five
   * "new deals" in his real file were deals already in the Archive, and a yes
   * would have added each one again. They are listed as stopped here and
   * still in the file; bringing one back is resume, said by them.
   */
  const archived = deals.filter((d) => d.stopped_on);
  const stoppedHere = [];
  for (const r of [...notOnSheet]) {
    const hit = archived.filter((d) => closeName(d.person_name, r.person)
      && (!r.company || closeName(d.company, r.company)) && (!r.group || d.group_name === r.group));
    if (!hit.length) continue;
    notOnSheet.splice(notOnSheet.indexOf(r), 1);
    stoppedHere.push({ row: r, deal: hit.sort((a, b) => String(b.stopped_on).localeCompare(String(a.stopped_on)))[0] });
  }

  /**
   * LAST MONTH'S SHEET IS NOT A LIST OF CHANGES. Live 2026-10-06: his file
   * was September's, the CRM had rolled to October, and 85 deals came back
   * as "preset 2026-10-01 → 2026-09-01, days 31 → 30". A yes would have put
   * the whole sheet back a month. When most of their preset dates are one
   * other month, the file is that month's: preset, payable days and payable
   * amount belong to the month and are not compared; everything else is.
   */
  const monthOf = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 7) : null);
  const count = (list) => list.reduce((m, k) => (k ? m.set(k, (m.get(k) ?? 0) + 1) : m), new Map());
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const theirMonths = count(read.rows.map((r) => monthOf(r.presetOn)));
  const [fileMonth, fileHits] = top(theirMonths);
  const [crmMonth] = top(count(live.map((d) => monthOf(d.preset_on))));
  // MOST OF THE WHOLE FILE, and at least three rows: one edited date in an
  // otherwise dateless file is an edit, not another month's sheet.
  const otherMonth = fileMonth && crmMonth && fileMonth !== crmMonth && fileHits >= 3 && fileHits >= 0.6 * read.rows.length;
  if (otherMonth) {
    const OF_THE_MONTH = new Set(['presetOn', 'payableDays', 'payableAmount']);
    for (let i = mismatched.length - 1; i >= 0; i -= 1) {
      mismatched[i].diffs = mismatched[i].diffs.filter((d) => !OF_THE_MONTH.has(d.field));
      if (!mismatched[i].diffs.length) mismatched.splice(i, 1);
    }
  }

  return {
    read: read.rows.length, mismatched, notOnSheet, unmatched, missing, renamed, newGroups, notInTheirs, partial, moved, respelled, stoppedHere,
    month: otherMonth ? { file: fileMonth, crm: crmMonth } : null,
    unread: read.unread,
  };
}

/**
 * WHAT IT FOUND, AS A PLAN: every fix a step, shown once, done on a yes.
 * Missing deals are a stop step (never a delete), and a group rename is one
 * step over all its deals. What cannot be a step is listed under the plan.
 */
function toPlan(found, request) {
  const steps = [];
  const n = () => steps.length + 1;
  for (const r of found.renamed) {
    steps.push({
      n: n(), action: 'update', person: '', group: r.from, kind: 'rename_group', from: r.from, to: r.to,
      changes: [{ field: 'groupName', mode: 'set', value: r.to }],
      ids: r.deals.map((d) => d.id),
      lines: [{ name: `${r.from} → ${r.to}`, detail: `rename the group on its ${r.deals.length} deals` }],
    });
  }
  for (const m of found.moved ?? []) {
    steps.push({
      n: n(), action: 'update', person: m.deal.person_name, kind: 'move_deal', from: m.from, to: m.to,
      changes: [{ field: 'groupName', mode: 'set', value: m.to }],
      ids: [m.deal.id],
      before: { [m.deal.id]: { groupName: m.from } },
      lines: [{ id: m.deal.id, name: m.deal.person_name, where: m.deal.company, detail: `moved group ${m.from} → ${m.to}` }],
    });
  }
  for (const m of found.mismatched) {
    steps.push({
      n: n(), action: 'update', person: m.deal.person_name,
      changes: m.diffs.map((d) => ({ field: d.field, mode: 'set', value: String(d.theirs) })),
      ids: [m.deal.id],
      // What it held when they were shown it, checked again before writing.
      before: { [m.deal.id]: Object.fromEntries(m.diffs.map((d) => [d.field, d.ours ?? null])) },
      lines: [{ id: m.deal.id, name: m.deal.person_name, where: `${m.deal.group_name} · ${m.deal.company}`, detail: m.diffs.map((d) => changeLine(m.deal, d, d.theirs)).join(' · ') }],
    });
  }
  for (const r of found.notOnSheet) {
    const need = ['group', 'company', 'roleLabel', 'monthlyAmount'].filter((f) => r[f] === undefined || r[f] === null || r[f] === '');
    // From another month's sheet, the month's own figures are left for the
    // CRM to work out for this one.
    const changes = ['roleLabel', 'monthlyAmount', 'payableDays', 'currency', 'paymentMethod', 'presetOn', 'endOn', 'notes', 'label']
      .filter((f) => r[f] !== undefined && !(found.month && ['presetOn', 'payableDays'].includes(f)))
      .map((f) => ({ field: f, mode: 'set', value: String(r[f]) }));
    steps.push({
      n: n(), action: 'add_deal', person: r.person, group: r.group ?? null, company: r.company ?? null, changes, need, line: r.line,
      question: need.length ? `New deal for ${r.person} (line ${r.line}) still needs: ${need.join(', ')}.` : null,
      lines: [{ name: r.person, where: [r.group, r.company].filter(Boolean).join(' · '), detail: changes.map((c) => `${FIELDS[c.field].label} ${c.value}`).join(' · ') || 'new deal' }],
    });
  }
  // A deal in a group renamed above is found under its NEW name by then.
  const renamedFrom = new Map(found.renamed.map((r) => [r.from, r.to]));
  for (const d of found.missing) {
    const groupNow = renamedFrom.get(d.group_name) ?? d.group_name;
    steps.push({
      n: n(), action: 'stop', person: d.person_name,
      deals: [{ id: d.id, person: d.person_name, company: d.company, group: groupNow }], ids: [d.id], changes: [],
      lines: [{ id: d.id, name: d.person_name, where: `${d.group_name} · ${d.company}`, detail: 'not in your sheet: stop this deal (it moves to the Archive)' }],
    });
  }
  const notes = [];
  if (found.stoppedHere?.length) {
    notes.push({
      label: `Stopped here, still in your file · ${found.stoppedHere.length}`,
      rows: found.stoppedHere.map((x) => ({
        id: x.deal.id,
        name: x.deal.person_name,
        where: `${x.deal.group_name} · ${x.deal.company}`,
        detail: `stopped ${String(x.deal.stopped_on instanceof Date ? x.deal.stopped_on.toISOString() : x.deal.stopped_on).slice(0, 10)}${x.deal.stopped_reason ? ` (${String(x.deal.stopped_reason).replace(/_/g, ' ')})` : ''}: not offered as new. Say "resume ${x.deal.person_name}" to bring it back`,
      })),
    });
  }
  if (found.respelled?.length) {
    notes.push({
      label: `Matched despite spelling · ${found.respelled.length}`,
      rows: found.respelled.map((x) => ({ id: x.deal.id, name: `${x.row.person} · ${x.row.company ?? ''}`, where: `line ${x.row.line}`, detail: `taken as our ${x.deal.person_name} · ${x.deal.company}` })),
    });
  }
  if (found.month) {
    notes.push({ label: 'Another month\'s sheet', rows: [{ name: `Your file is for ${monthName(found.month.file)}; the CRM is on ${monthName(found.month.crm)}`, detail: 'preset date, payable days and payable amount are not compared, so nothing is moved back a month' }] });
  }
  if (found.unmatched.length) notes.push({ label: `Could not match for sure · ${found.unmatched.length}`, rows: found.unmatched.map((u) => ({ name: u.person, where: `line ${u.line}`, detail: u.why })) });
  if (found.unread.length) notes.push({ label: `Could not read · ${found.unread.length}`, rows: found.unread.map((u) => ({ name: `line ${u.line}`, where: u.why, detail: String(u.text).slice(0, 80) })) });
  if (found.newGroups.length) notes.push({ label: 'New groups in your sheet', rows: found.newGroups.map((g) => ({ name: g, detail: 'new deals in it are added above' })) });
  if (found.partial?.length) {
    notes.push({
      label: 'Groups only partly in your sheet (the rest left alone)',
      rows: found.partial.map((p) => ({ name: p.group, detail: `${p.matched} of its ${p.total} deals are in your sheet, so missing ones are not offered as stops` })),
    });
  }
  if (found.notInTheirs.length) notes.push({ label: 'Groups not in your sheet (left alone)', rows: found.notInTheirs.map((g) => ({ name: g, detail: 'not checked' })) });
  return {
    id: require('crypto').randomUUID(),
    request,
    // Stopped deals still in their file, kept so "resume Louis" can add them.
    stoppedHere: (found.stoppedHere ?? []).map((x) => ({
      id: x.deal.id, person: x.deal.person_name, company: x.deal.company, group: x.deal.group_name,
    })),
    status: steps.some((s) => s.question) ? 'asking' : steps.length ? 'preview' : 'clean',
    steps,
    notes,
    checked: found.read,
  };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym) => { const m = /^(\d{4})-(\d{2})/.exec(String(ym ?? '')); return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : String(ym); };

function summary(found) {
  const bits = [
    `${found.read} ${found.read === 1 ? 'row' : 'rows'} checked`,
    found.month && `your file is ${monthName(found.month.file)}'s sheet and the CRM is on ${monthName(found.month.crm)}, so preset, payable days and payable amount are left out`,
    found.mismatched.length && `${found.mismatched.length} different from ours`,
    found.moved?.length && `${found.moved.length} moved to another group`,
    found.notOnSheet.length && `${found.notOnSheet.length} not on our sheet`,
    found.missing.length && `${found.missing.length} of ours missing from yours`,
    found.renamed.length && `${found.renamed.length} group ${found.renamed.length === 1 ? 'renamed' : 'renames'} (${found.renamed.map((r) => `${r.from} → ${r.to}`).join(', ')})`,
    found.unmatched.length && `${found.unmatched.length} I could not match for sure`,
    found.unread.length && `${found.unread.length} ${found.unread.length === 1 ? 'line' : 'lines'} I could not read`,
    found.others && `${found.others} people or companies to update`,
  ].filter(Boolean);
  return bits.join(', ');
}

/**
 * ===============================
 * * EVERY ROW, BY THE MEANING layout.js GAVE ITS TABLE
 * ===============================
 * Code, not the model, so every row is read the same way and none is
 * skipped without a reason. A row is used, or it is listed: a total, a
 * blank name, a summary table.
 */
const LAYOUT_TO_FIELD = { role: 'roleLabel' };
const TEXT_FIELDS = new Set(['person', 'group', 'company', 'phone', 'email', 'bankDetails', 'accountNumber', 'sortCode', 'location', 'postcode', 'notes', 'label', 'tier', 'status', 'oldGroup', 'description']);
const NAME_OF = { deals: 'person', people: 'person', companies: 'company', expenses: 'description', payments: 'person' };
// A TOTAL however it is written: "Total", "TOTAL GBP", "Grand total", "Sum".
const TOTAL_ROW = /\b(?:sub ?)?totals?\b|^\s*(?:sum|count)\b/i;

const DATE_FIELDS = new Set(['presetOn', 'endOn', 'assignedOn', 'paymentStartOn', 'date']);
const NUMBER_FIELDS = new Set(['monthlyAmount', 'payableAmount', 'payableDays', 'amount', 'addonPercent', 'feePercent']);

function valueFor(field, raw, monthFirst = false) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return undefined;
  if (DATE_FIELDS.has(field)) return dateIn(raw, monthFirst) ?? undefined;
  if (TEXT_FIELDS.has(field)) return String(raw).trim();
  if (field === 'amount' || field === 'addonPercent' || field === 'feePercent') return typeof raw === 'number' ? raw : numberIn(raw) ?? undefined;
  if (field === 'date') return dateIn(raw) ?? undefined;
  if (field === 'assignedOn' || field === 'paymentStartOn') return dateIn(raw) ?? undefined;
  if (typeof raw === 'number' && (MONEY.has(field) || field === 'payableDays')) return raw;
  return cellValue(field, raw);
}

function fromLayout(tables, layouts) {
  const byKind = {};
  const readout = [];
  const skipped = [];
  for (const table of tables) {
    const given = layouts.get(table.id);
    if (!given) { skipped.push({ line: table.headerLine, sheet: table.sheet, why: 'table not understood' }); continue; }
    /**
     * THE READING IS CHECKED AGAINST THE VALUES. A column called a number
     * whose cells are mostly not numbers, or a second column given a meaning
     * already taken, is not trusted: it is set aside and said, so a misread
     * column cannot turn into a list of false changes.
     */
    const doubts = [];
    const fields = [...given.fields];
    const seen = new Set();
    fields.forEach((f, i) => {
      if (f === 'other') return;
      const values = table.rows.map((r) => r.cells[i]).filter((c) => c !== null && String(c).trim() !== '');
      if (NUMBER_FIELDS.has(f) && values.length >= 3) {
        const numeric = values.filter((c) => typeof c === 'number' || numberIn(c) !== null).length;
        if (numeric < values.length * 0.6) { doubts.push(`${table.headers[i]} did not look like ${f}`); fields[i] = 'other'; return; }
      }
      if (seen.has(f)) { doubts.push(`${table.headers[i]} also looked like ${f}; the first one is used`); fields[i] = 'other'; return; }
      seen.add(f);
    });
    const monthFirst = new Map(fields.map((f, i) => [i, DATE_FIELDS.has(f) && monthFirstIn(table.rows.map((r) => r.cells[i]))]));
    const layout = { ...given, fields };
    const where = table.sheet ? `${table.sheet} tab` : 'pasted text';
    const used = layout.fields.map((f, i) => ({ f, h: table.headers[i] })).filter((x) => x.f !== 'other' && x.h);
    const unused = layout.fields.map((f, i) => ({ f, h: table.headers[i] })).filter((x) => x.f === 'other' && x.h).map((x) => x.h);
    readout.push({
      table: table.id,
      where,
      kind: layout.kind,
      rows: table.rows.length,
      columns: used.map((x) => `${x.h} = ${x.f}`),
      group: layout.groupFrom === 'sheet' ? `group = the tab name (${table.sheet})` : layout.groupFrom === 'column' ? 'group = a column' : 'no group given',
      unused,
      doubts,
      monthFirst: [...monthFirst.entries()].filter(([, v]) => v).map(([i]) => table.headers[i]),
    });
    if (layout.kind === 'summary' || layout.kind === 'other') continue;
    const nameField = NAME_OF[layout.kind] ?? 'person';
    const list = (byKind[layout.kind] ??= { rows: [], unread: [], headerLines: [] });
    for (const r of table.rows) {
      const row = { line: r.line, sheet: table.sheet, text: r.cells.filter((c) => c !== null).join(' · ') };
      layout.fields.forEach((f, i) => {
        if (f === 'other') return;
        const v = valueFor(f, r.cells[i], monthFirst.get(i));
        if (v !== undefined) row[LAYOUT_TO_FIELD[f] ?? f] = v;
      });
      if (layout.groupFrom === 'sheet' && table.sheet && !row.group) row.group = table.sheet;
      if (row.monthlyAmount !== undefined && !row.currency) {
        const cur = currencyIn(r.cells.find((c) => typeof c === 'string' && CURRENCIES.test(c)));
        if (cur) row.currency = cur;
      }
      const first = r.cells.find((c) => c !== null && String(c).trim());
      if (TOTAL_ROW.test(String(first ?? '')) || TOTAL_ROW.test(String(row[nameField] ?? ''))) {
        skipped.push({ line: r.line, sheet: table.sheet, why: 'a total row' });
        continue;
      }
      if (!row[nameField]) {
        list.unread.push({ line: r.line, text: row.text, why: `no ${nameField === 'person' ? 'name' : nameField}` });
        continue;
      }
      list.rows.push(row);
    }
  }
  return { byKind, readout, skipped };
}

/**
 * "HOW I READ IT", IN THEIR WORDS. Their call 2026-10-06: the full column
 * list in code names ("assignedOn") read like another finding. Short and
 * plain when nothing is odd: what was read, where the group came from, what
 * was not used. The full column list only when something needs a look.
 */
const PLAIN = {
  person: 'name', group: 'group', company: 'company', role: 'role', monthlyAmount: 'monthly', payableAmount: 'payable',
  payableDays: 'payable days', currency: 'currency', paymentMethod: 'payment method', presetOn: 'preset date',
  endOn: 'end date', assignedOn: 'appointment date', paymentStartOn: 'payment start', phone: 'phone', email: 'email',
  bankDetails: 'bank details', accountNumber: 'account number', sortCode: 'sort code', location: 'location',
  postcode: 'postcode', notes: 'notes', label: 'label', tier: 'tier', status: 'status', oldGroup: 'old group',
  addonPercent: 'add on %', feePercent: 'fee %', amount: 'amount', date: 'date', description: 'description',
};
function readoutLines(readout) {
  return readout.map((t) => {
    if (t.kind === 'summary' || t.kind === 'other') return `${t.where}: a ${t.kind === 'summary' ? 'totals' : 'non-data'} table, skipped.`;
    const groupFrom = /tab name/.test(t.group) ? 'the tab name' : /column/.test(t.group) ? 'the Group column' : null;
    const odd = (t.doubts?.length ?? 0) + (t.monthFirst?.length ?? 0) > 0;
    const parts = [
      `Read ${t.rows} ${t.kind} from the ${t.where}.`,
      groupFrom ? `Group from ${groupFrom}.` : 'No group in it.',
      t.unused.length ? `Not used: ${t.unused.join(', ')}.` : '',
      t.monthFirst?.length ? `Dates read month first in: ${t.monthFirst.join(', ')}.` : '',
      t.doubts?.length ? `Set aside: ${t.doubts.map((d) => d.replace(/\b(\w+(?:Amount|Days|On|Percent|Method|Label))\b/g, (m) => PLAIN[m] ?? m)).join('; ')}.` : '',
      odd ? `Columns: ${t.columns.map((c) => c.replace(/= (\w+)$/, (m, f) => `= ${PLAIN[f] ?? f}`)).join(', ')}.` : '',
    ];
    return parts.filter(Boolean).join(' ');
  });
}

module.exports = {
  nickname,
  fromLayout, readoutLines, monthName,
  fileToText, fromImportRows, readTable, readMessy, looksLikeSheet, compare, toPlan, summary, numberIn, dateIn,
};
