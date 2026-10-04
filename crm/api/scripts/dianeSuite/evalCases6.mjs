/**
 * SIXTH HELD-OUT SET, 2026-10-04, written after the general summarize tool
 * and never fixed against. A broad mix, the way he actually asks. Answers
 * from the seed (see evalCases.mjs).
 *
 *   SUITE_SET=eval6 node scripts/dianeSuite/run.mjs
 */
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const deal = (db, person, company) => one(
  db, 'SELECT * FROM tb_mastersheet WHERE person_name = $1 AND company = $2 ORDER BY id DESC LIMIT 1', [person, company],
);
const q = (name, say, expect) => ({ name, turns: [{ say, expect }] });

export const READS = [
  q('sum per group', "what's each group costing us a month?", { reply: /(?=[\s\S]*BAKER)(?=[\s\S]*CORVID)(?=[\s\S]*OTTER)/i }),
  q('average in a group', 'average pay in corvid?', { reply: /1,?520/ }),
  q('people per company', 'how many people at each company?', { reply: /Ironleaf[\s\S]*4|4[\s\S]*Ironleaf/i }),
  q('membership, yes', 'is otto fenn in baker?', { reply: /\byes\b|BAKER|Ironleaf/i, noReply: /\bnot in\b/i }),
  q('membership, no', 'is felix orr in otter?', { reply: /\bno\b|not|CORVID/i }),
  // GBP 1,200 is USD 1,635 and AED 6,000 is USD 1,634 at the fallback rate: Karin.
  q('biggest single deal in a group', 'biggest deal in otter?', { reply: /Karin Vole|1,?200/ }),
  q('total of one currency', 'how much in aed do we pay altogether?', { reply: /10,?000/ }),
  q('a role lookup', "what's felix orr's role?", { reply: /Accounts/i }),
  {
    name: 'follow-up on a company',
    turns: [
      { say: 'who works at brightwell?', expect: { reply: /Theo Brandt|Kiran Vale|\b2\b/ } },
      { say: 'and at pinecrest?', expect: { reply: /Mara Quill|Karin Vole|Baker Jones|\b3\b/ } },
    ],
  },
  q('more than N deals', 'does anyone have more than two deals?', { reply: /Kiran Vale/ }),
  q('lowest in a company', 'lowest paid at ironleaf?', { reply: /Felix Orr|1,?300|Ines Calder/ }),
  q('a person, in usd', 'how much is ines calder in dollars?', { reply: /USD\s?1,?0\d\d|1,?0\d\d(\.\d+)?\s?USD/ }),
];

export const WRITES = [
  {
    name: 'needs-to-be change, then undo',
    turns: [
      { say: "felix's monthly needs to be 1400" },
      { say: 'yes', expect: { db: async (db) => (Number((await deal(db, 'Felix Orr', 'Ironleaf')).monthly_amount) === 1400 ? null : 'not 1400') } },
      { say: 'undo', expect: {} },
      { say: 'yes', expect: { db: async (db) => (Number((await deal(db, 'Felix Orr', 'Ironleaf')).monthly_amount) === 1300 ? null : 'not back to 1300') } },
    ],
  },
];

export const PENDING = [];
