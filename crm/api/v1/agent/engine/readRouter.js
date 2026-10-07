const { getClient } = require('../chatClient');
const env = require('../../../configs/env');
const { fold, oneTypo, baseOf } = require('../tools/resolvePerson');

// ***************************************************
// * THE READ ROUTER: A QUESTION READ ONCE, IN CODE'S SHAPE
// ***************************************************
//
// His call 2026-10-07: reads should be as efficient as writes. A question
// went to the full model with every tool on the table, and some took four
// rounds of 25k tokens ($0.18–0.28): "cash deals over 1000 in all groups",
// "which deals start next month". Some picked the wrong tool ("who's on
// more than 1k" answered with a total; "gloria difference" compared months).
//
// Now: ONE light call reads the question into a strict shape, with every
// person, group and company name in front of it (her "copy of the names").
// Code checks the names against the sheet, the read guard checks the
// filters against their words, and the tool is called directly. Not sure,
// or not a shape this knows? `null`, and the turn goes on as before.

const FILTERS = {
  type: 'object',
  additionalProperties: false,
  required: ['paymentMethod', 'currency', 'paid', 'status', 'amountMin', 'amountMax', 'endWhen', 'paymentStartWhen', 'appointmentWhen', 'dealStatus', 'roleLabel', 'missingPhone', 'missingBank', 'needsReview'],
  properties: {
    paymentMethod: { type: 'string', enum: ['', 'cash', 'bank', 'crypto'] },
    currency: { type: 'string', enum: ['', 'GBP', 'AED', 'EURO', 'USD'] },
    paid: { type: 'string', enum: ['', 'paid', 'unpaid'], description: 'ONLY whether the deal is marked paid. "cash paid" is the METHOD, not this.' },
    status: { type: 'string', enum: ['', 'active', 'ended', 'not_started'] },
    amountMin: { type: ['number', 'null'], description: 'Monthly amount over this. Only a number they said ("1k" = 1000).' },
    amountMax: { type: ['number', 'null'] },
    endWhen: { type: 'string', enum: ['', 'soon', 'this-month', 'future', 'past', 'none'] },
    paymentStartWhen: { type: 'string', enum: ['', 'past', 'this-month', 'future'], description: '"start next month" is future.' },
    appointmentWhen: { type: 'string', enum: ['', 'past', 'this-month', 'future'] },
    dealStatus: { type: 'string', enum: ['', 'active', 'going_concern', 'review'] },
    roleLabel: { type: 'string', description: 'A role they named (Director, Mid 1…), else empty.' },
    missingPhone: { type: 'boolean' },
    missingBank: { type: 'boolean' },
    needsReview: { type: 'boolean' },
  },
};

const SHAPE = {
  type: 'object',
  additionalProperties: false,
  required: ['sure', 'ask', 'person', 'people', 'groups', 'company', 'filters', 'rank', 'preset', 'month'],
  properties: {
    sure: { type: 'boolean', description: 'true when it is one of the asks below; false only for a change, comparing months, a breakdown, history or rates' },
    ask: {
      type: 'string',
      enum: ['list', 'count', 'total', 'details', 'sheet', 'other'],
      description: 'list = show/which/who ARE (deals or people matching); count = how many; total = how much is owed/paid/earned (a person, people, a group); '
        + 'details = one person\'s deals in full ("show me X", "X\'s details"); sheet = the export\'s Standard/Bank/Cash/Crypto sheet; '
        + 'other = anything else: comparing months, breakdowns, history, rates, companies, changes, chat.',
    },
    person: { type: 'string', description: 'ONE person exactly as in the Names list, else empty. The LONGEST name in their words wins ("gloria difference" is the person Gloria difference).' },
    people: { type: 'array', items: { type: 'string' }, description: 'Two or more people, as in the Names list ("gloria + gloria difference"). Else empty.' },
    groups: { type: 'array', items: { type: 'string' }, description: 'Groups as in the Groups list; empty for every group. "all groups" means every group, not the group ALL GROUPS, unless they say "the ALL GROUPS group".' },
    company: { type: 'string', description: 'A company as in the Companies list, else empty.' },
    filters: FILTERS,
    rank: { type: ['integer', 'null'], description: 'who earns the most = 1, top 3 = 3, the least = -1. Else null.' },
    preset: { type: 'string', enum: ['', 'standard', 'bank', 'cash', 'crypto'], description: 'Only for ask = sheet.' },
    month: { type: 'string', description: 'YYYY-MM only if they named another month or year, else empty.' },
  },
};

const PROMPT = [
  'You read ONE question about the master sheet of deals (who is paid what) into the JSON shape. You never answer it.',
  'Only fill what their words say. Empty is always safe. Never guess a filter.',
  'Use the previous messages ONLY to complete a short follow up ("and in milkman?", "how about gloria?" asks the same as before about the new name or group).',
  '"which deals start next month" is a LIST with paymentStartWhen future. "who\'s on more than 1k" is a LIST with amountMin 1000. "who earns the most" is a TOTAL with rank 1. "how much is X owed" is a TOTAL.',
  'A name followed by "difference" ("gloria difference") is the PERSON of that name, never a comparison.',
  'ask = other (and sure = false) only for a change, comparing months, a breakdown, history, rates, or deals that ENDED, STOPPED or LEFT (those live in the stopped archive).',
  'Two or more people named together ("gloria + gloria difference", "nathan and gab together") is a TOTAL with people.',
].join('\n');

/**
 * @returns {Promise<null | object>} the shape, or null when not sure
 */
async function readRoute(said, { recent = [], people = [], groups = [], companies = [], client = null, model = null } = {}) {
  const openai = client ?? getClient();
  if (!openai || !String(said ?? '').trim()) return null;
  const res = await openai.chat.completions.create({
    model: model ?? env.openaiModel,
    temperature: 0,
    messages: [
      { role: 'system', content: `${PROMPT}\nNames: ${people.join(', ')}.\nGroups: ${groups.join(', ')}.\nCompanies: ${companies.join(', ')}.` },
      ...recent.slice(-3).map((m) => ({ role: m.role, content: String(m.content ?? '').slice(0, 400) })),
      { role: 'user', content: String(said) },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'read', strict: true, schema: SHAPE } },
  });
  const shape = JSON.parse(res.choices?.[0]?.message?.content ?? 'null');
  // ITS "sure" IS NOT TRUSTED EITHER WAY: right readings came back unsure.
  // What protects the answer is code: names held to the sheet, filters
  // held to their words. Only "other" goes back to the normal turn.
  return shape && shape.ask !== 'other' ? shape : null;
}

/** A name it gave, held to the sheet's names: exact, or the one name a slip away. */
function onSheet(name, names) {
  if (!name) return '';
  const exact = names.find((n) => fold(n) === fold(name));
  if (exact) return exact;
  const close = names.filter((n) => fold(n).length >= 4 && oneTypo(fold(n), fold(name)));
  return close.length === 1 ? close[0] : null;
}

/**
 * The tool and its arguments, or null when a name is not on the sheet (the
 * turn goes on as before, where the tools ask about it properly).
 */
function toolCall(shape, { people = [], groups = [], companies = [], said = '' } = {}) {
  const person = onSheet(shape.person, people);
  const named = (shape.people ?? []).map((n) => onSheet(n, people));
  if (person === null || named.includes(null)) return null;
  let gs = (shape.groups ?? []).map((g) => onSheet(g, groups));
  if (gs.includes(null)) return null;
  // "IN ALL GROUPS" IS EVERY GROUP, not the group called ALL GROUPS, unless
  // they said that group itself. Clone 2026-10-07: "cash deals over 1000 in
  // all groups" listed the 4 in ALL GROUPS instead of the 20 everywhere.
  if (/\b(?:in |across |for )?(?:all|every) groups?\b/i.test(said) && !/\bthe all groups\b|\ball groups group\b|\bgroup all groups\b/i.test(said)) {
    gs = gs.filter((g) => fold(g) !== 'allgroups');
  }
  const company = onSheet(shape.company, companies);
  if (company === null) return null;
  const f = shape.filters ?? {};
  const filters = {
    ...(f.paymentMethod ? { paymentMethod: [f.paymentMethod] } : {}),
    ...(f.currency ? { currency: [f.currency] } : {}),
    ...(f.paid ? { paid: f.paid === 'paid' } : {}),
    ...(f.status ? { status: [f.status] } : {}),
    ...(f.amountMin != null ? { amountMin: f.amountMin, amountField: 'monthlyAmount' } : {}),
    ...(f.amountMax != null ? { amountMax: f.amountMax, amountField: 'monthlyAmount' } : {}),
    ...(f.endWhen ? { endWhen: [f.endWhen] } : {}),
    ...(f.paymentStartWhen ? { paymentStartWhen: [f.paymentStartWhen] } : {}),
    ...(f.appointmentWhen ? { appointmentWhen: [f.appointmentWhen] } : {}),
    ...(f.dealStatus ? { dealStatus: [f.dealStatus] } : {}),
    ...(f.roleLabel ? { roleLabel: [f.roleLabel] } : {}),
    ...(f.missingPhone ? { missingPhone: true } : {}),
    ...(f.missingBank ? { missingBank: true } : {}),
    ...(f.needsReview ? { needsReview: true } : {}),
    ...(company ? { company: [company] } : {}),
  };
  const where = gs.length > 1 ? { groups: gs } : gs.length ? { group: gs[0] } : {};
  const month = /^\d{4}-\d{2}$/.test(shape.month ?? '') ? { month: shape.month } : {};
  // SEVERAL PEOPLE TOGETHER IS ALWAYS THEIR TOTAL: "gloria + gloria
  // difference" came back as one person's card, and as a month comparison
  if (named.length > 1) {
    return { name: 'total_master_sheet', args: { people: named, ...where, ...filters, ...month } };
  }
  switch (shape.ask) {
    case 'list':
    case 'count':
      // a list of ONE person's deals is their details
      if (person && !Object.keys(filters).length) return { name: 'find_and_show_details', args: { name: person, ...(gs[0] ? { groupName: gs[0] } : {}) } };
      return { name: 'filter_master_sheet', args: { ...where, ...filters, ...(person ? { q: person } : {}) } };
    case 'total': {
      const who = named.length > 1 ? { people: named } : person ? { person } : {};
      return { name: 'total_master_sheet', args: { ...who, ...where, ...filters, ...month, ...(Number.isInteger(shape.rank) && shape.rank !== 0 && !person ? { rank: shape.rank } : {}) } };
    }
    case 'details':
      return person ? { name: 'find_and_show_details', args: { name: person, ...(gs[0] ? { groupName: gs[0] } : {}) } } : null;
    case 'sheet':
      return shape.preset ? { name: 'show_sheet_preset', args: { preset: shape.preset, ...(gs.length ? { group: gs.join(',') } : {}), ...month } } : null;
    default:
      return null;
  }
}

module.exports = { readRoute, toolCall, onSheet, SHAPE };
// (baseOf is the "Gloria difference" rule; the tools apply it, see resolvePerson.js)
void baseOf;
