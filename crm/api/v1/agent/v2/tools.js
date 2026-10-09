/**
 * ***************************************************
 * * DIANE V2'S TOOLS: THE READS AS THEY ARE, THE WRITES THROUGH THE BOX
 * ***************************************************
 * REDESIGNED 2026-10-09. The first v2 squeezed every read into one `read`
 * tool with a `what` enum and its own filters, then translated those onto
 * v1's tools. The translation lost things: "paid" became a should-be-paid
 * filter nobody asked for, and every pay list came back "Nobody". The model
 * understood the question; the door in between got it wrong.
 *
 * Now the model is FREE over the reads: it sees v1's read tools themselves
 * (READ_TOOLS), every option they have, and combines them as it judges,
 * one call or several. Nothing in between rewrites its arguments. Still
 * fixed, because it is about money, not wording:
 *
 *   every figure is computed by the tools, never by the model
 *   every change goes through `change` → one preview → their yes (box.js)
 *
 *   change   one or more changes, always PREVIEWED into the box
 *   undo     the last change, a batch, or only some of it
 *   export   the sheet as a file, through v1's export panel
 *   explain  the deals behind her last figure (agent/evidence.js)
 */

/** v1's read tools, offered as they are (~10k tokens against v1's ~30k a turn). */
const READ_TOOLS = [
  'list_people', 'show_person', 'find_and_show_details', 'filter_master_sheet', 'total_master_sheet',
  'compare_months', 'recent_master_sheet_changes', 'summarize_deals', 'list_monthly_review',
  'list_stopped_deals', 'list_companies', 'list_parked_work', 'audit_master_sheet',
  'breakdown_master_sheet', 'check_rates', 'exchange_rate',
];

/** The read tools in the Responses API's shape, from the context's own definitions. */
function readTools(context) {
  return READ_TOOLS.map((name) => context.tools.find((t) => t.name === name)).filter(Boolean).map((t) => ({
    type: 'function', name: t.name, description: t.description, parameters: t.parameters ?? { type: 'object', properties: {} }, strict: false,
  }));
}

const FILTERS = {
  type: 'object',
  description: 'Narrowing, only what they said.',
  additionalProperties: false,
  properties: {
    paymentMethod: { type: 'string', enum: ['cash', 'bank', 'crypto'] },
    currency: { type: 'string', enum: ['GBP', 'AED', 'EURO', 'USD'] },
    paid: { type: 'boolean', description: 'The Paid switch: marked paid or not' },
    shouldBePaid: { type: 'boolean', description: 'The Should be paid switch' },
    paymentReceived: { type: 'array', items: { type: 'string', enum: ['paid', 'unpaid', 'portion', 'awaiting'] }, description: 'What they ANSWERED on payday, never the Paid switch' },
    status: { type: 'string', enum: ['active', 'ended', 'not_started'], description: 'The payment period' },
    needsReview: { type: 'boolean' },
    paydayFlagged: { type: 'boolean' },
    missingPhone: { type: 'boolean' },
    missingBank: { type: 'boolean' },
    amountMin: { type: 'number', description: 'Monthly amount at least' },
    amountMax: { type: 'number', description: 'Monthly amount at most' },
    endWhen: { type: 'string', description: 'e.g. this_month, next_month, next_3_months, past' },
  },
};

/** A change's `filters` (everyone matching) as the bulk tool's arguments. */
const FILTER_ARGS = (f = {}) => ({
  ...(f.paymentMethod ? { paymentMethod: [f.paymentMethod] } : {}),
  ...(f.currency ? { currency: [f.currency] } : {}),
  ...(f.paid !== undefined ? { paid: f.paid } : {}),
  ...(f.shouldBePaid !== undefined ? { shouldBePaid: f.shouldBePaid } : {}),
  ...(f.paymentReceived?.length ? { paymentOutcome: f.paymentReceived } : {}),
  ...(f.status ? { status: [f.status] } : {}),
  ...(f.needsReview !== undefined ? { needsReview: f.needsReview } : {}),
  ...(f.paydayFlagged !== undefined ? { paydayFlagged: f.paydayFlagged } : {}),
  ...(f.missingPhone ? { missingPhone: true } : {}),
  ...(f.missingBank ? { missingBank: true } : {}),
  ...(f.amountMin != null ? { amountMin: f.amountMin, amountField: 'monthlyAmount' } : {}),
  ...(f.amountMax != null ? { amountMax: f.amountMax, amountField: 'monthlyAmount' } : {}),
  ...(f.endWhen ? { endWhen: [f.endWhen] } : {}),
});

const TOOLS = [
  {
    type: 'function',
    name: 'change',
    description: [
      'Propose changes. NOTHING is written: every change is previewed in one list and applied only after they say yes.',
      'Read first when you need to know who matches (e.g. list_people, then one entry per person found).',
      'One entry per person or deal. Use set for a value ("monthly to 1500"), add for an amount moved BY ("add 100", "take 5 days off" = -5),',
      'action for stop / resume / add_deal / delete / answer_review. A switch: set.paid / set.shouldBePaid (the PERSON\'s, all their live deals).',
      'Payment received (what they answered on payday) is set.paymentReceived = paid or unpaid, never the Paid switch.',
      'A whole group or everyone matching: everyone = true with group and filters. Never guess a person: name them as they said.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        changes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: { type: 'string', enum: ['update', 'stop', 'resume', 'add_deal', 'delete', 'answer_review', 'person_rate', 'company'] },
              person: { type: 'string' },
              company: { type: 'string', description: 'Which of their deals, when they named it' },
              group: { type: 'string' },
              role: { type: 'string' },
              everyone: { type: 'boolean', description: 'Every deal matching group and filters' },
              filters: FILTERS,
              set: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  monthlyAmount: { type: 'number' }, payableAmount: { type: 'number' }, payableDays: { type: 'number' },
                  paymentMethod: { type: 'string', enum: ['cash', 'bank', 'crypto'] }, currency: { type: 'string' },
                  groupName: { type: 'string' }, company: { type: 'string' }, roleLabel: { type: 'string' },
                  presetOn: { type: 'string' }, endOn: { type: 'string' }, paymentStartOn: { type: 'string' }, assignedOn: { type: 'string' },
                  addonPercent: { type: 'number' }, feePercent: { type: 'number' },
                  paid: { type: 'boolean' }, shouldBePaid: { type: 'boolean' },
                  paymentReceived: { type: 'string', enum: ['paid', 'unpaid'] },
                  phone: { type: 'string' }, location: { type: 'string' }, notes: { type: 'string' }, label: { type: 'string' },
                  specialCaseDeal: { type: 'boolean' }, status: { type: 'string', description: 'For a company' },
                  answer: { type: 'string', enum: ['yes', 'no', 'final'], description: 'For answer_review' },
                },
              },
              add: {
                type: 'object',
                additionalProperties: false,
                properties: { monthlyAmount: { type: 'number' }, payableAmount: { type: 'number' }, payableDays: { type: 'number' }, addonPercent: { type: 'number' }, feePercent: { type: 'number' } },
              },
              deal: {
                type: 'object',
                description: 'For add_deal: the new deal',
                additionalProperties: false,
                properties: {
                  personName: { type: 'string' }, companies: { type: 'array', items: { type: 'string' } }, groupName: { type: 'string' },
                  roleLabel: { type: 'string' }, monthlyAmount: { type: 'number' }, currency: { type: 'string' },
                  paymentMethod: { type: 'string' }, assignedOn: { type: 'string' }, paymentStartOn: { type: 'string' },
                },
              },
              when: { type: 'string', description: 'YYYY-MM, only for a later month ("from next month")' },
            },
            required: ['action'],
          },
        },
      },
      required: ['changes'],
    },
  },
  {
    type: 'function',
    name: 'undo',
    description: 'Put changes back. last = the latest change; or only some of the last batch by people / group / except; or the numbered items of the last result ("undo 2 and 5"). Previewed first.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        last: { type: 'integer', description: 'The last N changes; 1 for "undo that"' },
        items: { type: 'array', items: { type: 'integer' }, description: 'Numbers from the last result list' },
        people: { type: 'array', items: { type: 'string' } },
        group: { type: 'string' },
        except: { type: 'array', items: { type: 'string' }, description: '"all except MILKMAN": the names or groups kept' },
      },
    },
  },
  {
    type: 'function',
    name: 'export',
    description: 'The sheet as a file (Standard, Bank, Cash, Crypto, Driver). Opens the export panel; they finish it there.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        template: { type: 'string', enum: ['standard', 'bank', 'cash', 'crypto', 'driver'] },
        groups: { type: 'array', items: { type: 'string' } },
        month: { type: 'string' },
      },
    },
  },
  {
    type: 'function',
    name: 'explain',
    description: 'Where her last figure came from: the deals behind it. No arguments.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
];

// ---------- change: each entry onto the v1 write tool that previews it ----------

const SET_FIELD = { paid: 'overridePaid', shouldBePaid: 'overrideShouldBePaid' };
const OUTCOME = { paid: 'confirmed', unpaid: 'not_received' };

/** The v1 fields for a `set`, with the person's switches and payment received renamed. */
function v1Fields(set = {}) {
  const out = {};
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined || k === 'answer' || k === 'status') continue;
    if (k === 'paymentReceived') out.paymentOutcome = OUTCOME[v] ?? v;
    else out[SET_FIELD[k] ?? k] = v;
  }
  return out;
}

/** One change entry, as the v1 calls that preview it. */
function changeCalls(c) {
  const fields = v1Fields(c.set);
  const when = c.when ? { when: c.when } : {};
  switch (c.action) {
    case 'stop':
      return [{ name: 'stop_deal', args: { person: c.person, ...(c.company ? { company: c.company } : {}), ...(c.group ? { group: c.group } : {}), ...when } }];
    case 'resume':
      return [{ name: 'resume_deal', args: { person: c.person, ...(c.company ? { company: c.company } : {}), ...(c.group ? { group: c.group } : {}) } }];
    case 'delete':
      return [{ name: 'delete_master_sheet_row', args: { ...(c.person ? { people: [c.person] } : {}), ...(c.group ? { group: c.group } : {}), ...(c.company ? { company: c.company } : {}) } }];
    case 'add_deal': {
      const d = c.deal ?? {};
      return [{ name: 'add_deal', args: { ...d, ...(d.companies?.length === 1 ? { company: d.companies[0], companies: undefined } : {}) } }];
    }
    case 'answer_review':
      return [{ name: 'answer_monthly_review', args: { person: c.person, ...(c.company ? { company: c.company } : {}), ...(c.group ? { group: c.group } : {}), answer: c.set?.answer } }];
    case 'person_rate':
      return [{ name: 'update_person', args: { person: c.person, ...(fields.addonPercent != null ? { addonPercent: fields.addonPercent } : {}), ...(fields.feePercent != null ? { feePercent: fields.feePercent } : {}), ...(c.add?.addonPercent != null ? { addonPercentDelta: c.add.addonPercent } : {}), ...(c.add?.feePercent != null ? { feePercentDelta: c.add.feePercent } : {}), ...when } }];
    case 'company':
      return [{ name: 'update_company', args: { name: c.company, ...(c.set?.status ? { status: c.set.status } : {}), ...(c.set?.notes ? { notes: c.set.notes } : {}) } }];
    case 'update':
    default:
      // EVERYONE MATCHING, or ONE PERSON'S DEALS, are the bulk tool: one
      // preview line per deal, the person's switches on every live deal.
      if (c.everyone) {
        // A RAISE BY PERCENT is the bulk tool's own; an "add N to everyone"
        // has no bulk form in v1, so it is not offered here.
        return [{ name: 'bulk_update_master_sheet', args: { ...(c.group ? { group: c.group } : {}), ...FILTER_ARGS(c.filters), ...(Object.keys(fields).length ? { set: fields } : {}) } }];
      }
      return [{
        name: 'update_master_sheet_row',
        args: {
          targetPerson: c.person, ...(c.company ? { targetCompany: c.company } : {}), ...(c.group ? { targetGroup: c.group } : {}),
          ...(c.role ? { targetRole: c.role } : {}), ...fields, ...(c.add ? { add: c.add } : {}), ...when,
        },
      }];
  }
}

module.exports = { TOOLS, READ_TOOLS, readTools, changeCalls, v1Fields };
