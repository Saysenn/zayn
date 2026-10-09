// REGRESSION: every bug she ever had, as the conversation that showed it,
// plus new wordings around it. A case here is REG-nnnn and is NEVER
// removed: every future Diane passes it. Who is who: data.mjs.
import { all, none, shows, everyDeal, wordings } from './helpers.mjs';
import { dealOf, dealsOf } from './data.mjs';

export const READS = [
  // 2026-10-08: the read router sent a bank details question to the new
  // people tool, which answered with everyone's pay state.
  ...wordings('REG-0002', 'a bank details question is about bank details, never pay', [
    'does anyone have no bank details?',
    "who's missing bank details",
  ], { noTools: ['list_people'], noReply: /Payment received|Should be paid/i }),

  // 2026-10-08, library: a first name alone was not a person, so the whole
  // sheet was totalled.
  ...wordings('REG-0003', 'a first name only one person has is that person', [
    'how much do we pay otto',
    "what's otto getting this month",
    'otto money',
  ], { answer: { amount: 1500, currency: 'GBP' } }),

  // "what's kiran getting in GBP" drew her deals, not her amount.
  ...wordings('REG-0004', '"what is X getting" is an amount', [
    "what's kiran getting in GBP",
    'what is kiran vale getting in pounds',
  ], { answer: { amount: 5350, currency: 'GBP' } }),

  // "Felix Orr's monthly: 1450", no currency.
  ...wordings('REG-0005', 'a monthly asked alone is said as money', [
    "what's felix orr's monthly",
    "felix orr's monthly?",
  ], { reply: /GBP\s?1,450/ }),

  // A first name found nothing in a saved month.
  ...wordings('REG-0006', 'last month by a first name is the saved month', [
    'what was felix on last month',
    'how much did felix get last month',
  ], { answer: { amount: 1300, currency: 'GBP' } }),

  // "has felix's pay changed" was answered with today's total.
  ...wordings('REG-0007', 'has X\'s pay changed reads the change log', [
    "has felix's pay changed",
    "did felix's monthly change",
  ], { tools: ['recent_master_sheet_changes'], rows: shows('1,?300', '1,?450') }),

  // "who is on abc" was asked whether ABC was a show or a person.
  ...wordings('REG-0008', 'half a company name that starts two of them is asked about, both named', [
    'who is on abc',
    'what do we pay abc?',
    'abc deals',
  ], { reply: all('ABC Ltd', 'ABC Limited') }),

  // "show all unpaid people" listed deals.
  ...wordings('REG-0009', 'unpaid PEOPLE are people', [
    'show all unpaid people',
    'list the people who are not paid',
  ], { tools: ['list_people'], reply: all('Theo Brandt'), noReply: none('Otto Fenn') }),

  // "who has not answered the payday check" added the unpaid.
  ...wordings('REG-0010', 'not answered the payday check is Awaiting only', [
    'who has not answered the payday check',
    "who hasn't replied to payday",
  ], { reply: all('Felix Orr'), noReply: none('Theo Brandt', 'Juno Park') }),

  // "otto's deal with pinecrest" never said there is none.
  ...wordings('REG-0011', 'a deal they do not have is said to be none', [
    "what's otto fenn's deal with pinecrest?",
    'show me otto fenn at pinecrest',
  ], { reply: /no deal|not on pinecrest|isn'?t on|doesn'?t have|Ironleaf/i }),

  // "john smith" ran on into "owed" and became John Smithson.
  ...wordings('REG-0012', 'a full name typed exactly is that person, never the look-alike', [
    'how much is john smith owed?',
    'john smith owed this month',
  ], { answer: { amount: 1800, currency: 'GBP' }, noReply: /Smithson/ }),
  ...wordings('REG-0013', 'and the look-alike typed in full is the look-alike', [
    'how much is john smithson owed?',
  ], { answer: { amount: 900, currency: 'GBP' } }),

  // 2026-10-08, library: the read router gave Otto as a list of one person
  // ("people": ["Otto Fenn"]), and the whole sheet was totalled.
  ...wordings('REG-0016', 'one person read as a list of one is still that person', [
    'whats otto owed',
    'how much r we paying otto this month',
    'otto fenn total pls',
  ], { answer: { amount: 1500, currency: 'GBP' } }),

  // 2026-10-08, library: "has felix's pay changed" looked for "Felix" in the
  // log and said nothing changed.
  ...wordings('REG-0017', 'a first name in a change question is the one person who has it', [
    "has felix's pay changed",
    'did felixs monthly change',
    'any changes on felix',
  ], { rows: shows('1,?300', '1,?450') }),

  // 2026-10-08, main set: "export the baker sheet" opened the Standard sheet
  // while export is off. The button is named and nothing is drawn.
  ...wordings('REG-0018', 'an export ask while export is off names the button', [
    'export the baker sheet for me',
    'can u download the corvid sheet pls',
    'export otter',
  ], { reply: /Export/, noDraw: true }),

  // 2026-10-08, main set: "owed ... in usd" was read as deals PAID in USD,
  // and the whole sheet was "owed nothing".
  ...wordings('REG-0019', '"owed in usd" is the total said in USD, never a filter', [
    'whats the whole sheet owed this month in usd',
    'total owed in dollars this month',
    'how much do we owe everyone in usd',
  ], { reply: /USD [\d,]/, noReply: /owed nothing/i }),

  // 2026-10-08, main set: the read router took "what have we got scheduled?"
  // as a sheet filter and asked "which schedule?".
  ...wordings('REG-0020', 'what is scheduled is the parked list, never "which schedule?"', [
    'what have we got scheduled?',
    'anything parked for next month',
    'show me whats lined up',
  ], { noReply: /clarify|what (?:type|kind) of schedule|which schedule/i }),
];

export const WRITES = [
  {
    // 2026-10-08: the person-level "mark paid" handed over only the last
    // person named, dropping the first (perDealBulk.test.js has the unit side).
    id: 'REG-0001',
    name: '"mark otto fenn and kiran vale paid" is both people, every live deal',
    risky: true,
    turns: [
      { say: 'mark otto fenn and kiran vale as paid' },
      {
        say: 'yes',
        expect: { db: async (db) => (await everyDeal(dealsOf, 'Kiran Vale', (r) => r.override_paid === true, 'Kiran')(db))
          ?? everyDeal(dealsOf, 'Otto Fenn', (r) => r.override_paid === true, 'Otto')(db) },
      },
    ],
  },
  {
    // 2026-10-08, library: "set payment received to paid" wrote the Paid switch.
    id: 'REG-0014',
    name: 'payment received set by name is payment received, never the switch',
    turns: [
      // Juno: PAY-011 already sets Theo, and an unchanged row proves nothing.
      { say: "change juno park's payment received to paid" },
      { say: 'yes', expect: { db: async (db) => { const r = await dealOf(db, 'Juno Park', 'Harbor Nine'); return r.payment_outcome === 'confirmed' ? null : `payment_outcome ${r.payment_outcome}, paid ${r.override_paid}`; } } },
    ],
  },
  {
    // 2026-10-08, library: "mark all of them should be paid" after a list was nobody.
    id: 'REG-0015',
    name: '"all of them" after a people list is those people',
    risky: true,
    turns: [
      // CORVID: WRK-010 already does OTTER.
      { say: 'who in corvid is unpaid?', expect: { reply: all('John Smith') } },
      { say: 'mark all of them should be paid' },
      { say: 'yes', expect: { db: everyDeal(dealsOf, 'John Smith', (r) => r.override_should_be_paid === true, 'John Smith not should be paid') } },
    ],
  },
  // 2026-10-08, main set: the router's "bulk_edit" sent a percentage raise
  // to the plan engine, which has no percentage: "Done 0 of 1", nothing
  // written. The bulk tool does it, every deal listed. Then put back.
  ...[
    ["raise everyone's monthly in otter by 10%", 'REG-0021-a'],
    ['otter monthly +10% pls', 'REG-0021-b'],
    ['bump all the otter deals by 10 percent', 'REG-0021-c'],
  ].map(([say, id]) => ({
    id,
    name: `a percentage raise on a group is applied, every deal, and undone: "${say}"`,
    turns: [
      { say },
      { say: 'yes', expect: { db: async (db) => (Number((await dealOf(db, 'Karin Vole', 'Pinecrest'))?.monthly_amount) === 1320 ? null : 'Karin Vole not raised to 1,320') } },
      { say: 'undo that' },
      { say: 'yes', expect: { db: async (db) => (Number((await dealOf(db, 'Karin Vole', 'Pinecrest'))?.monthly_amount) === 1200 ? null : 'Karin Vole not back to 1,200') } },
    ],
  })),
  // 2026-10-08, main set: "stop otto fenn end of this month" went to the
  // engine, which stopped him TODAY. A later day is parked by the stop tool.
  ...[
    ['stop mara quill end of this month', 'REG-0022-a'],
    ["end mara quill's deal at the end of the month", 'REG-0022-b'],
  ].map(([say, id]) => ({
    id,
    name: `a stop at the end of the month is parked, never today: "${say}"`,
    turns: [
      { say },
      { say: 'yes', expect: { db: async (db) => ((await dealOf(db, 'Mara Quill', 'Pinecrest'))?.stopped_on ? 'stopped today, not parked' : null) } },
      { say: 'cancel the mara one' },
      { say: 'yes' },
    ],
  })),
  // 2026-10-08, main set: one change and a question in one line was read as
  // a plan of "1 change" and the question was lost. One preview, the yes
  // writes it, and the undo puts it back.
  ...[
    ["make baker jones's monthly 2300 and whats he owed now", 'REG-0023-a'],
    ['set baker jones to 2300 a month, how much is that this month?', 'REG-0023-b'],
  ].map(([say, id]) => ({
    id,
    name: `a change with a question in one line is one change: "${say}"`,
    turns: [
      { say, expect: { db: async (db) => (Number((await dealOf(db, 'Baker Jones', 'Pinecrest'))?.monthly_amount) === 2200 ? null : 'written before the yes') } },
      { say: 'yes', expect: { db: async (db) => (Number((await dealOf(db, 'Baker Jones', 'Pinecrest'))?.monthly_amount) === 2300 ? null : 'monthly not 2,300') } },
      { say: 'undo that' },
      { say: 'yes', expect: { db: async (db) => (Number((await dealOf(db, 'Baker Jones', 'Pinecrest'))?.monthly_amount) === 2200 ? null : 'not back to 2,200') } },
    ],
  })),
];
