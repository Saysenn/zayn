// HISTORICAL: last month's snapshot and the change log (data.mjs: Felix Orr
// was 1,300 last month and is 1,450 now).
import { shows, wordings } from './helpers.mjs';
import { LAST_MONTH } from './data.mjs';

export const READS = [
  ...wordings('HIS-001', 'Felix Orr was owed 1,300 last month', [
    'how much was felix orr owed last month',
    "what was felix on last month",
  ], { answer: { amount: 1300, currency: 'GBP', month: LAST_MONTH } }),
  ...wordings('HIS-002', 'what changed on Felix Orr: 1,300 to 1,450', [
    'what changed on felix orr recently?',
    "has felix's pay changed",
    // Both values are on the change list drawn beside her answer.
  ], { tools: ['recent_master_sheet_changes'], rows: shows('1,?300', '1,?450') }),
  ...wordings('HIS-003', 'this month against last month is the snapshot, never a guess', [
    'compare this month with last month',
    'how does this month look against last month',
  ], { tools: ['compare_months'] }),
];

export const WRITES = [];
