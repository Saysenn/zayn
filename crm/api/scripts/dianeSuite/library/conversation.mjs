// IN NORMAL USE (plan items 23-24): she shows where a figure came from, and
// a follow up reuses the conversation instead of searching again. The
// scorecard's rounds and tool calls per turn are what "quick" is measured by.
import { all } from './helpers.mjs';
import { dealOf } from './data.mjs';

export const READS = [
  {
    id: 'CON-001',
    name: '"where did that come from?" lists the deal behind the figure, with no tool',
    turns: [
      { say: 'how much is otto fenn owed this month', expect: { answer: { amount: 1500, currency: 'GBP' } } },
      { say: 'where did that come from?', expect: { reply: all('Otto Fenn', 'Ironleaf', '1,500'), noTools: ['total_master_sheet', 'filter_master_sheet', 'find_and_show_details'] } },
    ],
  },
  {
    id: 'CON-002',
    name: 'a total over three deals shows all three, rated as the total was',
    turns: [
      { say: 'how much is kiran vale owed in pounds', expect: { answer: { amount: 5350, currency: 'GBP' } } },
      { say: 'how did you get that?', expect: { reply: all('Brightwell', 'Ironleaf', '2,850', '2,500') } },
    ],
  },
  {
    id: 'CON-003',
    name: '"what about AED?" carries the person over',
    turns: [
      { say: 'how much is kiran vale owed in pounds', expect: { answer: { amount: 5350, currency: 'GBP' } } },
      { say: 'what about AED?', expect: { answer: { amount: 6000, currency: 'AED' } } },
    ],
  },
];

export const WRITES = [
  {
    id: 'CON-010',
    name: '"mark him paid" after a question about him is him',
    turns: [
      { say: 'how much is jon smith owed', expect: { answer: { amount: 750, currency: 'GBP' } } },
      { say: 'mark him paid' },
      { say: 'yes', expect: { db: async (db) => ((await dealOf(db, 'Jon Smith', 'Brightwell'))?.override_paid === true ? null : 'Jon Smith not paid') } },
    ],
  },
];
