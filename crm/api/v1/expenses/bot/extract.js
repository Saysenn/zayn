const { ask } = require('./ai');
const { intake } = require('../../agent/engine/intake');
const { fold } = require('../../masterSheet/dealKey');

// ***************************************************
// * EXPENSES OUT OF WHATEVER THEY SENT
// ***************************************************
//
// Text, a photo of a receipt, a PDF, or a spreadsheet/Word file. The model
// READS (what was bought, for how much, from whom, when); code checks every
// value afterwards (check.js). A file with rows is not read row by row by
// the model: it says what each COLUMN means from a sample, and code reads
// every row by that, so nothing is skipped or copied wrong. The same as
// Diane's file check.

const LINE = {
  type: 'object',
  additionalProperties: false,
  required: ['groupName', 'spentOn', 'description', 'payee', 'rawAmount', 'currency', 'spentBy', 'source', 'doubt'],
  properties: {
    groupName: { type: 'string' },
    spentOn: { type: 'string' },
    description: { type: 'string' },
    payee: { type: 'string' },
    rawAmount: { type: 'string' },
    currency: { type: 'string' },
    spentBy: { type: 'string' },
    source: { type: 'string' },
    doubt: { type: 'string' },
  },
};
const LINES = {
  type: 'object',
  additionalProperties: false,
  required: ['expenses'],
  properties: { expenses: { type: 'array', items: LINE } },
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function rules(today, groups = []) {
  const wd = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
  return [
    groups.length ? `groupName: the company group it is for, ONLY if they name one of: ${groups.join(', ')}. "" otherwise.` : 'groupName: always "".',
    'You read business EXPENSES (money spent) sent by an admin to a company bot. Output JSON only.',
    `Today is ${wd} ${today}. Dates as YYYY-MM-DD: "today", "yesterday", "monday" mean the most recent such day.`,
    'Day-first dates (UK and UAE): 06/10 is 6 October. A receipt date is the date of the expense.',
    'A date word belongs ONLY to the expense it is said with ("parking 20, ink 180 yesterday": only the ink is',
    'yesterday), unless they say it is for all of them. An expense with no date said gets spentOn "".',
    'One entry per separate spend. A receipt is ONE expense (its total), never one per item, unless they say otherwise.',
    'description: what it was for, short ("Taxi to office", "Team lunch", "Printer ink").',
    'payee: who was paid, as its short business name ("Careem", "Zuma", "ENOC", "Carrefour"), never a branch, address or',
    'station number. From the receipt header or "paid to/at/from X".',
    'rawAmount: the number only, no symbols or commas ("1250.50"). For a receipt, the final total paid.',
    'currency: ONLY if said or printed (AED, GBP, EUR, USD, £, €, $, "dirhams"). "" if not shown.',
    'spentBy: only if they say someone else spent it ("Ali paid", "spent by Sara"). "" otherwise.',
    'source: where it came from: "message", "photo 1", "photo 2", "pdf".',
    'doubt: "" or a short note when something is unclear or hard to read ("total hard to read", "two totals on receipt").',
    'NEVER invent a value. Anything not given is "". If it is not an expense at all, return no expenses.',
    'A payroll list, salaries, a master sheet of deals or a list of staff and their monthly pay is NOT expenses: return none.',
  ].join('\n');
}

/** From their words. */
async function fromText(text, { today, client, groups } = {}) {
  const got = await ask({ name: 'expenses', system: rules(today, groups), user: String(text), schema: LINES, client });
  return got.expenses ?? [];
}

/**
 * From photos (receipts) and PDFs, with the caption they wrote. One call for
 * all of them, so "these are yesterday's" applies to every one.
 * @param {{ mime: string, base64: string, filename?: string }[]} media
 */
async function fromMedia(media, caption, { today, client, groups } = {}) {
  let photo = 0;
  const parts = [{ type: 'text', text: `Their message with it: "${caption || '(none)'}"` }];
  for (const m of media) {
    if (/^image\//.test(m.mime)) {
      photo += 1;
      parts.push({ type: 'text', text: `photo ${photo}:` });
      parts.push({ type: 'image_url', image_url: { url: `data:${m.mime};base64,${m.base64}`, detail: 'high' } });
    } else if (/pdf/.test(m.mime)) {
      parts.push({ type: 'text', text: 'pdf:' });
      parts.push({ type: 'file', file: { filename: m.filename || 'receipt.pdf', file_data: `data:application/pdf;base64,${m.base64}` } });
    }
  }
  const got = await ask({ name: 'expenses', system: rules(today, groups), user: parts, schema: LINES, client });
  return got.expenses ?? [];
}

// ---- a spreadsheet, CSV or Word table ----

const FIELDS = ['groupName', 'spentOn', 'description', 'payee', 'rawAmount', 'currency', 'spentBy', 'other'];
const MAP = {
  type: 'object',
  additionalProperties: false,
  required: ['tables'],
  properties: {
    tables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'isExpenses', 'columns', 'currency'],
        properties: {
          id: { type: 'string' },
          isExpenses: { type: 'boolean' },
          currency: { type: 'string' },
          columns: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['index', 'field'],
              properties: { index: { type: 'integer' }, field: { type: 'string', enum: FIELDS } },
            },
          },
        },
      },
    },
  },
};

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

/** A cell as a YYYY-MM-DD day, day first. Null when it is not a date. */
function dayOf(v, year) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim().toLowerCase();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
    if (Number(m[2]) > 12 || Number(m[1]) > 31) return null;
    return `${y}-${pad(m[2])}-${pad(m[1])}`;
  }
  const monthNum = (w) => MONTHS[w.slice(0, 4)] ?? MONTHS[w.slice(0, 3)] ?? null;
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?(?:\s+(\d{4}))?$/.exec(s);
  if (m && monthNum(m[2])) return `${m[3] ?? year}-${pad(monthNum(m[2]))}-${pad(m[1])}`;
  m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$/.exec(s);
  if (m && monthNum(m[1])) return `${m[3] ?? year}-${pad(monthNum(m[1]))}-${pad(m[2])}`;
  return null;
}

/** "AED 1,250.50", "£45" → { amount: 1250.5, currency: 'AED' }. */
function moneyOf(v) {
  if (v === null || v === undefined || v === '') return { amount: null, currency: null };
  if (typeof v === 'number') return { amount: v, currency: null };
  const s = String(v);
  const cur = /\b(AED|GBP|EUR|USD|SAR|INR|PHP)\b|([£€$])/i.exec(s);
  const n = /-?\d[\d,]*(?:\.\d+)?/.exec(s.replace(/\s/g, ''));
  return {
    amount: n ? Number(n[0].replace(/,/g, '')) : null,
    currency: cur ? (cur[1] ?? { '£': 'GBP', '€': 'EUR', $: 'USD' }[cur[2]]).toUpperCase() : null,
  };
}

const TOTAL_ROW = /^(?:grand\s+)?(?:sub\s*)?totals?\b|^sum\b/i;

/**
 * Every row of every expenses table, read by code from the column meanings.
 * @returns {{ items: object[], skipped: string[] }}
 */
async function fromTables(tables, { today, client, groups = [] } = {}) {
  if (!tables.length) return { items: [], skipped: [] };
  const briefs = tables.map((t) => ({
    id: t.id, sheet: t.sheet, headers: t.headers.map((h, index) => ({ index, header: h })), rows: t.rows.slice(0, 6).map((r) => r.cells),
  }));
  const map = await ask({
    name: 'expense_columns',
    system: [
      'You read the LAYOUT of tables from a file of business expenses. For each table say if it lists expenses',
      '(a payroll or master sheet of people, roles, companies and monthly or payable pay is NOT expenses: isExpenses false)',
      '(isExpenses), and what each column means: groupName (company group / team), spentOn (date), description (what for), payee (paid to / vendor /',
      'merchant), rawAmount (amount / cost / total), currency, spentBy (who spent / paid by / staff), or other.',
      'currency: the currency the whole table is in if a header or title says so ("Amount (AED)"), else "".',
      'Decide from the headers and rows only; never invent.',
    ].join('\n'),
    user: JSON.stringify(briefs),
    schema: MAP,
    client,
  });
  const year = Number(String(today).slice(0, 4));
  const items = [];
  const skipped = [];
  for (const t of tables) {
    const m = (map.tables ?? []).find((x) => x.id === t.id);
    if (!m?.isExpenses) { skipped.push(`${t.sheet ? `${t.sheet} tab` : 'a table'}: not expenses`); continue; }
    const col = (f) => m.columns.find((c) => c.field === f)?.index;
    // A TAB NAMED AFTER A GROUP is that group's expenses: the October
    // workbook has a MANBAT tab, an INDIGO tab… and every row came back
    // "group missing" (test sweep 2026-10-07).
    const tabGroup = t.sheet ? groups.find((g) => fold(g) === fold(t.sheet)) ?? '' : '';
    const at = Object.fromEntries(FIELDS.map((f) => [f, col(f)]));
    for (const r of t.rows) {
      const get = (f) => (at[f] === undefined ? null : r.cells[at[f]]);
      const money = moneyOf(get('rawAmount'));
      const description = get('description');
      if (TOTAL_ROW.test(String(description ?? '').trim()) || r.cells.some((c) => TOTAL_ROW.test(String(c ?? '').trim()) && money.amount !== null && !get('spentOn'))) continue;
      if (money.amount === null && !description) continue;
      const rawDay = get('spentOn');
      const spentOn = dayOf(rawDay, year);
      items.push({
        groupName: get('groupName') == null ? tabGroup : String(get('groupName')),
        spentOn: spentOn ?? '',
        description: description == null ? '' : String(description),
        payee: get('payee') == null ? '' : String(get('payee')),
        rawAmount: money.amount == null ? '' : String(money.amount),
        currency: String(get('currency') ?? '') || money.currency || m.currency || '',
        spentBy: get('spentBy') == null ? '' : String(get('spentBy')),
        source: `${t.sheet ? `${t.sheet} ` : ''}line ${r.line}`,
        doubt: rawDay && !spentOn ? `date "${rawDay}" not understood` : '',
      });
    }
  }
  return { items, skipped };
}

/**
 * Everything they sent this turn, as expense lines.
 * @param {{ text?: string, attachments?: { filename, mime, base64 }[] }} msg
 */
async function extract(msg, { today, client, groups = [] } = {}) {
  const files = msg.attachments ?? [];
  const media = files.filter((f) => /^image\//.test(f.mime) || /pdf/.test(f.mime));
  const docs = files.filter((f) => !media.includes(f));
  const out = [];
  const notes = [];
  for (const d of docs) {
    // eslint-disable-next-line no-await-in-loop
    const got = await intake({ buffer: Buffer.from(d.base64, 'base64'), filename: d.filename }).catch((err) => ({ error: err.message }));
    if (got.error) {
      notes.push(/not a kind of file I can read/.test(got.error)
        ? `I can't read ${String(d.filename).split('.').pop().toUpperCase()} files. Send a photo, PDF, Excel, CSV, Word or PowerPoint file`
        : `${d.filename}: could not open it (${got.error})`);
      continue;
    }
    if (got.tables?.length) {
      // eslint-disable-next-line no-await-in-loop
      const read = await fromTables(got.tables, { today, client, groups });
      out.push(...read.items);
      notes.push(...read.skipped);
    } else if (String(got.text ?? '').trim()) {
      // eslint-disable-next-line no-await-in-loop
      out.push(...(await fromText(`${msg.text ? `${msg.text}\n\n` : ''}From the file ${d.filename}:\n${got.text}`, { today, client, groups })));
    } else {
      notes.push(`${d.filename}: nothing in it to read`);
    }
  }
  // A BURST OF RECEIPTS is read six at a time: one call per handful keeps
  // each read sharp, and one bad photo cannot spoil twenty.
  for (let i = 0; i < media.length; i += 6) {
    // eslint-disable-next-line no-await-in-loop
    out.push(...(await fromMedia(media.slice(i, i + 6), msg.text, { today, client, groups })));
  }
  if (!media.length && !docs.length && String(msg.text ?? '').trim()) out.push(...(await fromText(msg.text, { today, client, groups })));
  return { items: out.map((x, i) => ({ ...x, n: i + 1 })), notes };
}

module.exports = {
  extract, fromText, fromMedia, fromTables, dayOf, moneyOf, fold, LINE_SCHEMA: LINE,
};
