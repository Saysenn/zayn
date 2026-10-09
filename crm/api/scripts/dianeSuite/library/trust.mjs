// TRUST: she says what is not there, keeps look-alikes apart, and points
// out two facts that disagree instead of picking one (data.mjs).
import { all, none, wordings } from './helpers.mjs';

const NO_FIGURE = /(?:GBP|AED|USD|£)\s?\d/i;

export const READS = [
  // Things that do not exist: said so, nothing invented.
  ...wordings('TRU-001', 'an unknown person is said to be unknown, with no figure', [
    'how much is zara nightingale owed?',
    'show me zara nightingale',
  // ’ as well as ': gpt-5.x writes the curly one (2026-10-09, a right
  // "I can’t find anyone" was failed on the apostrophe)
  ], { reply: /no one|nobody|no person|not on the sheet|couldn[’']?t find|can[’']?t find|no match|nothing (?:on the sheet )?match|don[’']?t have/i, noReply: NO_FIGURE }),
  ...wordings('TRU-002', 'an unknown company is said to be unknown', [
    'who works on bluefin holdings?',
  ], { reply: /no company|not (?:a company )?on the sheet|couldn[’']?t find|can[’']?t find|no match|don[’']?t have|nobody/i, noReply: NO_FIGURE }),
  ...wordings('TRU-003', 'a deal that does not exist is never invented', [
    "what's otto fenn's deal with pinecrest?",
  ], { reply: /no deal|not on pinecrest|isn'?t on|doesn'?t have|Ironleaf/i, noReply: /Otto Fenn[^.]*Pinecrest[^.]*GBP/i }),
  ...wordings('TRU-004', 'a month with no record says so', [
    'how much was otto fenn owed in january 2019?',
  ], { reply: /no record|no (?:month )?snapshot|unavailable|don'?t have|not kept|nothing for|no data|wasn'?t/i, noReply: /1,500/ }),

  // Look-alikes: never merged.
  ...wordings('TRU-010', 'John Smith alone is 1,800, never added to Smithson or Jon', [
    'how much is john smith owed?',
  ], { answer: { amount: 1800, currency: 'GBP' }, noReply: /2,?700|3,?450|2,?550/ }),
  ...wordings('TRU-011', 'ABC Limited is Cole Pratt, never Rae Dunn', [
    'who is on abc limited?',
  ], { reply: all('Cole Pratt'), noReply: none('Rae Dunn') }),

  // Two facts that disagree: Juno Park is marked paid, and said unpaid.
  ...wordings('TRU-020', 'paid but said unpaid: she names both, never just one', [
    'has juno park been paid?',
    'is juno paid',
  ], { reply: /(?=[\s\S]*\bpaid\b)(?=[\s\S]*(unpaid|not received|didn'?t receive|said|but))/i }),
];

export const WRITES = [];
