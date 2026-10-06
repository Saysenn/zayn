const env = require('../../../configs/env');
const { getClient } = require('../chatClient');
const { fold } = require('../tools/resolvePerson');

/**
 * ***************************************************
 * * A QUESTION ABOUT THEIR FILE, ANSWERED BY CODE
 * ***************************************************
 *
 * "Who in this file isn't in the CRM?", "total the salaries by team", "who
 * is paid in cash?". The model only turns the question into a small query;
 * the counting, filtering and adding up are done here, over every row, so a
 * figure is never the model's arithmetic. The admin's call 2026-10-06.
 */

const SOURCES = ['file', 'not_in_crm', 'missing_from_file', 'different', 'matched'];
const QUERY = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'source', 'filters', 'groupBy', 'measure', 'field'],
  properties: {
    kind: { type: 'string', enum: ['question', 'check'] },
    source: { type: 'string', enum: SOURCES },
    filters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'op', 'value'],
        properties: {
          field: { type: 'string' },
          op: { type: 'string', enum: ['is', 'is_not', 'contains', 'above', 'below', 'empty', 'not_empty'] },
          value: { type: 'string' },
        },
      },
    },
    groupBy: { type: 'string' },
    measure: { type: 'string', enum: ['list', 'count', 'sum'] },
    field: { type: 'string' },
  },
};

/** Their words into a query, or kind "check" when they want the file checked or changed. */
async function readQuestion(said, fields, client = null) {
  const openai = client ?? getClient();
  if (!openai) throw new Error('no AI key');
  const res = await openai.chat.completions.create({
    model: env.openaiModel,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: [
          'An admin attached a file to a payroll CRM and wrote a message. Decide:',
          'kind "check" if they want the file checked against the CRM, what is wrong, what needs updating, or',
          'want changes made from it. kind "question" if they ask something to be found, listed, counted or added up.',
          'For a question: source = file (the rows of their file), not_in_crm (file rows not in the CRM),',
          'missing_from_file (CRM deals not in the file), different (rows whose figures differ from the CRM), matched',
          '(rows found in the CRM). filters on these fields: ' + fields.join(', ') + '. groupBy: a field or "".',
          'measure: list, count or sum (sum needs field). field: the field summed, or "".',
          'For kind "check" give source "file", no filters, groupBy "", measure "list", field "".',
        ].join('\n'),
      },
      { role: 'user', content: said },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'query', strict: true, schema: QUERY } },
  });
  return JSON.parse(res.choices?.[0]?.message?.content ?? '{"kind":"check"}');
}

const matches = (row, f) => {
  const v = row[f.field];
  const want = f.value;
  switch (f.op) {
    case 'empty': return v === undefined || v === null || v === '';
    case 'not_empty': return !(v === undefined || v === null || v === '');
    case 'above': return Number(v) > Number(want);
    case 'below': return Number(v) < Number(want);
    case 'contains': return fold(v ?? '').includes(fold(want));
    case 'is_not': return fold(v ?? '') !== fold(want);
    default: return fold(v ?? '') === fold(want);
  }
};

const money = (n) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 });

/**
 * THE ANSWER, worked out here. `found` is the comparison (sheetCheck.compare),
 * so "not in the CRM" and "different" are the same lists the check would give.
 */
function answer(query, { rows, found }) {
  const pick = {
    file: rows,
    not_in_crm: found.notOnSheet,
    missing_from_file: found.missing.map((d) => ({
      person: d.person_name, group: d.group_name, company: d.company, monthlyAmount: Number(d.monthly_amount), currency: d.currency, line: null,
    })),
    different: found.mismatched.map((m) => ({ ...m.row, differs: m.diffs.map((d) => d.field).join(', ') })),
    matched: rows.filter((r) => !found.notOnSheet.includes(r) && !found.unmatched.some((u) => u.line === r.line)),
  }[query.source] ?? rows;
  const list = pick.filter((r) => (query.filters ?? []).every((f) => matches(r, f)));
  const label = (r) => [r.person ?? r.company ?? r.description, r.group, r.company && r.person ? r.company : null].filter(Boolean).join(' · ');
  const value = (r) => (query.measure === 'sum' ? Number(r[query.field]) || 0 : 1);

  if (query.groupBy) {
    const groups = new Map();
    for (const r of list) {
      const k = r[query.groupBy] ?? '(none)';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    const sections = [...groups.entries()].map(([k, rs]) => ({
      label: `${k} · ${query.measure === 'sum' ? money(rs.reduce((n, r) => n + value(r), 0)) : rs.length}`,
      rows: rs.map((r) => ({ name: label(r), where: r.line ? `line ${r.line}` : 'in the CRM', detail: query.measure === 'sum' ? money(value(r)) : r.differs ?? '' })),
    }));
    const head = [...groups.entries()].map(([k, rs]) => `${k}: ${query.measure === 'sum' ? money(rs.reduce((n, r) => n + value(r), 0)) : rs.length}`).join(', ');
    return { reply: head || 'Nothing in your file matches that.', sections };
  }
  if (query.measure === 'sum') {
    const total = list.reduce((n, r) => n + value(r), 0);
    return { reply: `${money(total)} across ${list.length} ${list.length === 1 ? 'row' : 'rows'}.`, sections: [{ label: `${list.length} rows`, rows: list.map((r) => ({ name: label(r), where: r.line ? `line ${r.line}` : '', detail: money(value(r)) })) }] };
  }
  if (query.measure === 'count') {
    return { reply: `${list.length}.`, sections: [{ label: `${list.length} rows`, rows: list.map((r) => ({ name: label(r), where: r.line ? `line ${r.line}` : '' })) }] };
  }
  // THE NAMES, not just a count, when they fit in a sentence.
  const names = list.slice(0, 8).map(label).join('; ');
  return {
    reply: list.length ? `${list.length} ${list.length === 1 ? 'row' : 'rows'}: ${names}${list.length > 8 ? `, and ${list.length - 8} more (all listed below)` : ''}.` : 'None.',
    sections: [{ label: `${list.length} rows`, rows: list.map((r) => ({ name: label(r), where: r.line ? `line ${r.line}` : 'in the CRM', detail: r.differs ?? '' })) }],
  };
}

module.exports = { readQuestion, answer };
