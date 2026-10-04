/**
 * A FOURTH HELD-OUT SET, 2026-10-04: harder on purpose. Follow-ups that lean
 * on the previous answer, corrections, mixed currencies, dates. Written
 * before any fix it might drive; its first run against the current code is
 * the number, whatever it says. Answers worked from the seed (evalCases.mjs).
 *
 *   SUITE_SET=eval4 node scripts/dianeSuite/run.mjs
 */
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const deal = (db, person, company) => one(
  db, 'SELECT * FROM tb_mastersheet WHERE person_name = $1 AND company = $2 ORDER BY id DESC LIMIT 1', [person, company],
);
const q = (name, say, expect) => ({ name, turns: [{ say, expect }] });

export const READS = [
  {
    name: 'a follow-up that leans on the last answer',
    turns: [
      { say: 'how much is otto fenn owed this month?', expect: { reply: /1,?500/ } },
      { say: 'and felix?', expect: { reply: /1,?300/ } },
    ],
  },
  {
    name: 'a correction of the person',
    turns: [
      { say: "what's karin vole on?", expect: { reply: /1,?200/ } },
      { say: 'sorry I meant mara', expect: { reply: /1,?100/ } },
    ],
  },
  {
    name: 'from a group to one of its people',
    turns: [
      { say: 'who is in otter?', expect: { reply: /\b4\b|four|Ines Calder|Karin Vole/i } },
      { say: 'how much does the first one get?', expect: { reply: /\d/ } },
    ],
  },
  q('mixed currencies for one person, in usd', "what's kiran vale owed in dollars?", { reply: /USD\s?[\d,]+/ }),
  q('a total across two groups', 'what do baker and otter cost us together this month?', { reply: /together|combined|\bGBP\b/i }),
  q('payment start for a person', "when does nell arden's payment start?", { reply: /\b\d{4}\b|20\d\d/ }),
  q('who has no end date', 'which deals have no end date?', { reply: /\bno\b|none|\b0\b|nobody|every/i }),
  q('appointed when', 'when was otto fenn appointed?', { reply: /20\d\d/ }),
  q('a person in two groups', 'which groups is kiran vale in?', { reply: /(?=[\s\S]*BAKER)(?=[\s\S]*CORVID)(?=[\s\S]*OTTER)/i }),
  q('count of deals at one company', 'how many deals at pinecrest?', { reply: /\b3\b|three/i }),
  q('the gbp total only', 'just the gbp total for this month please', { reply: /GBP\s?[\d,]+/ }),
  q('is a person owed anything', 'is wren hollis owed anything this month?', { reply: /no\b|nothing|stopped|archive/i, noReply: /GBP 500 /i }),
  q('fees anywhere', 'does anyone have a fee?', { reply: /Kiran Vale/ }),
];

export const WRITES = [
  {
    name: 'two changes in one message',
    turns: [
      { say: "set juno park's monthly to 700 and theo brandt's to 800" },
      { say: 'yes please', expect: { db: async (db) => {
        const j = Number((await deal(db, 'Juno Park', 'Harbor Nine')).monthly_amount);
        const t = Number((await deal(db, 'Theo Brandt', 'Brightwell')).monthly_amount);
        return j === 700 && t === 800 ? null : `juno ${j} theo ${t}`;
      } } },
      { say: 'undo both', expect: {} },
      { say: 'yes', expect: { db: async (db) => {
        const j = Number((await deal(db, 'Juno Park', 'Harbor Nine')).monthly_amount);
        const t = Number((await deal(db, 'Theo Brandt', 'Brightwell')).monthly_amount);
        return j === 600 && t === 700 ? null : `after undo juno ${j} theo ${t}`;
      } } },
    ],
  },
  {
    name: 'a change, then changing the change',
    turns: [
      { say: "make silas moor's monthly 950" },
      { say: 'yes', expect: { db: async (db) => (Number((await deal(db, 'Silas Moor', 'Quarry Lane')).monthly_amount) === 950 ? null : 'not 950') } },
      { say: 'actually make it 1000' },
      { say: 'yes', expect: { db: async (db) => (Number((await deal(db, 'Silas Moor', 'Quarry Lane')).monthly_amount) === 1000 ? null : 'not 1000') } },
    ],
  },
];

export const PENDING = [];
