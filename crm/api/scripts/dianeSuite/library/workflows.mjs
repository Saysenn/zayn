// WORKFLOWS and TWO-TOOL QUESTIONS: several steps, one answer or one act.
// Every step is checked: what she read, what she asked, and the database.
import { all, none, everyDeal, wordings } from './helpers.mjs';
import { dealsOf } from './data.mjs';

export const READS = [
  // Two tools' worth: who is unpaid AND still has a live deal. Theo Brandt
  // is both; the three past their end date are not live this month.
  ...wordings('WRK-001', 'unpaid with an active deal: Theo Brandt, and never Otto', [
    "who's unpaid with an active deal",
  ], { reply: all('Theo Brandt'), noReply: none('Otto Fenn') }),
  ...wordings('WRK-002', 'unpaid totals by company add up to the sheet, never invented', [
    'find everyone unpaid this month and total it by company',
  ], { noReply: none("I can't", 'I cannot') }),
];

export const WRITES = [
  {
    id: 'WRK-010',
    name: 'find the unpaid in OTTER with live deals, then mark them should be paid: one preview, one yes',
    risky: true,
    turns: [
      { say: 'who in otter is unpaid?', expect: { reply: all('Karin Vole') } },
      {
        say: 'mark all of them should be paid',
        expect: { db: async (db) => ((await dealsOf(db, 'Karin Vole')).some((r) => r.override_should_be_paid === true) ? 'wrote before the yes' : null) },
      },
      { say: 'yes', expect: { db: everyDeal(dealsOf, 'Karin Vole', (r) => r.override_should_be_paid === true, 'Karin not should be paid') } },
    ],
  },
];
