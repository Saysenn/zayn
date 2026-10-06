const env = require('../../../configs/env');
const { getClient } = require('../chatClient');
const { fold } = require('../tools/resolvePerson');

/**
 * ***************************************************
 * * WHAT EACH TABLE IS, AND WHAT EACH COLUMN MEANS
 * ***************************************************
 *
 * One model call per file, on the headers and a few rows of each table,
 * never on all of it: the model decides the MEANING, and code then reads
 * every row by that meaning, exactly. So any layout is read, and no row is
 * skipped or copied wrong by a model working through hundreds of them.
 *
 * Nothing here knows a particular sheet. "Name of individual", "Staff",
 * "Handler" and "Who" are all the person because the model says so.
 */

// What a column can mean. One vocabulary for every kind of table.
const FIELDS = [
  'person', 'group', 'company', 'role', 'monthlyAmount', 'payableAmount', 'payableDays', 'currency', 'paymentMethod',
  'presetOn', 'endOn', 'assignedOn', 'paymentStartOn', 'phone', 'email', 'bankDetails', 'accountNumber', 'sortCode',
  'location', 'postcode', 'notes', 'label', 'tier', 'status', 'oldGroup', 'addonPercent', 'feePercent', 'amount', 'date', 'description', 'other',
];
const KINDS = ['deals', 'people', 'companies', 'expenses', 'payments', 'summary', 'other'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tables'],
  properties: {
    tables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'groupFrom', 'columns'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          groupFrom: { type: 'string', enum: ['column', 'sheet', 'none'] },
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

const PROMPT = [
  'You read the LAYOUT of tables from a file sent to a payroll CRM. For each table you get its id, its tab',
  '(sheet) name, its headers by index, and a few rows. Say what the table is and what each column means.',
  'kind: deals (people paid on a company, with amounts/dates/roles), people (who someone is: phone, bank, email),',
  'companies (company list: tier, status), expenses, payments, summary (totals, pivots, "Row Labels", "Sum of"),',
  'or other. columns: one entry per header index, field from the list; "other" when it means nothing listed.',
  'person = the individual\'s name. company = the company/client they are on. role = their role/position/seat.',
  'monthlyAmount = monthly pay/salary/rate. payableAmount = what is paid this month. payableDays = days payable.',
  'presetOn = preset/month date. endOn = end date. assignedOn = appointment/start date. paymentStartOn = payment start.',
  'groupFrom: "column" if a column holds the group, "sheet" if the TAB NAME is the group (tabs named like groups,',
  'no group column), else "none". Decide from the headers and rows only; never invent.',
].join('\n');

/** The question asked about each table: enough to read its meaning, no more. */
function brief(table) {
  return {
    id: table.id,
    sheet: table.sheet,
    headers: table.headers.map((h, index) => ({ index, header: h })),
    rows: table.rows.slice(0, 6).map((r) => r.cells),
  };
}

/**
 * @param {object[]} tables from intake.js
 * @param {{ groups?: string[], client?: object }} opts `client` is for tests
 * @returns {Promise<Map<string, { kind, groupFrom, fields: string[] }>>} per table id
 */
/**
 * FASTER ON BIG WORKBOOKS, 2026-10-06 (9 to 15 s on many tabs):
 *   - tabs laid out the same (same headers) are asked about ONCE, and the
 *     answer is copied to the rest: MANBAT, INDIGO and MILKMAN tabs are one
 *     question, not three;
 *   - a layout seen before (the same file sent again) is remembered, so a
 *     re-check costs no AI call at all.
 */
const seen = new Map();
const LIMIT = 200;
const shapeOf = (t) => fold(`${t.headers.join('|')}`);

async function understand(tables, { groups = [], client = null } = {}) {
  const out = new Map();
  if (!tables.length) return out;
  // A test's stand-in model is never remembered for the real one.
  const groupKey = `${client ? `test${Math.random()}` : 'live'}|${groups.join('|')}`;
  const byShape = new Map();
  for (const t of tables) {
    const key = `${groupKey}::${shapeOf(t)}`;
    if (!byShape.has(key)) byShape.set(key, []);
    byShape.get(key).push(t);
  }
  const ask = [...byShape.entries()].filter(([key]) => !seen.has(key)).map(([, ts]) => ts[0]);
  if (ask.length) {
    const openai = client ?? getClient();
    if (!openai) throw new Error('no AI key');
    const res = await openai.chat.completions.create({
      model: env.openaiModel,
      temperature: 0,
      messages: [
        { role: 'system', content: `${PROMPT}\nGroups in this CRM: ${groups.join(', ')}.` },
        { role: 'user', content: JSON.stringify(ask.map(brief)) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'layout', strict: true, schema: SCHEMA } },
    });
    const parsed = JSON.parse(res.choices?.[0]?.message?.content ?? '{"tables":[]}');
    for (const t of parsed.tables ?? []) {
      const table = ask.find((x) => x.id === t.id);
      if (!table) continue;
      const fields = table.headers.map(() => 'other');
      for (const c of t.columns ?? []) if (c.index >= 0 && c.index < fields.length) fields[c.index] = c.field;
      if (seen.size >= LIMIT) seen.delete(seen.keys().next().value);
      seen.set(`${groupKey}::${shapeOf(table)}`, { kind: t.kind, groupFrom: t.groupFrom, fields });
    }
  }
  for (const [key, ts] of byShape) {
    const got = seen.get(key);
    if (got) for (const t of ts) out.set(t.id, { ...got, fields: [...got.fields] });
  }
  return out;
}

module.exports = { understand, FIELDS, KINDS };
