/**
 * A SECOND HELD-OUT SET, written after the first one had been used to find
 * faults. evalCases.mjs stopped being held out the moment it drove fixes;
 * this one is run against the code from before and after, untouched by
 * either, so the comparison is fair.
 *
 *   SUITE_SET=eval2 node scripts/dianeSuite/run.mjs
 *
 * Answers from the seed by hand (see evalCases.mjs for the seed table).
 */
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const deal = (db, person, company) => one(
  db, 'SELECT * FROM tb_mastersheet WHERE person_name = $1 AND company = $2 ORDER BY id DESC LIMIT 1', [person, company],
);
const q = (name, say, expect) => ({ name, turns: [{ say, expect }] });

export const READS = [
  q('a group total in one currency', "what's the total for otter in dirhams?", { reply: /10,?000/ }),
  q("a person's pay, informal", 'how much does ines get', { reply: /4,?000/ }),
  q("who's in a group", "who's in baker?", { reply: /Otto Fenn|\b5\b/ }),
  q('one person earns', 'what does silas moor earn', { reply: /\b900\b/ }),
  // The names are on screen in the drawn list (a list is never recited back), so the count answers it.
  q('over an amount', 'is anyone on more than 2,000 a month?', { reply: /Baker Jones|\b5\b|five/i }),
  q('lowest in a group', "whats the lowest monthly in corvid", { reply: /Theo Brandt|\b700\b/ }),
  q('a fee that is not there', 'has otto got any fees', { reply: /no fee|\b0 ?%|none|doesn'?t|no,|not/i, noReply: /\b5 ?%/ }),
  q('people at a company', 'which people are at brightwell', { reply: /Theo Brandt/ }),
  q('deals in total', 'how many deals in total?', { reply: /\b14\b/ }),
  q("someone's fee", "what's kiran's fee", { reply: /5 ?%/ }),
  q('who works at a company', 'who works at harbor nine', { reply: /Juno Park/ }),
  q('count people in a group', 'count the people in corvid', { reply: /\b5\b/ }),
  q('a role', "what is juno park's role", { reply: /\bKP\b/ }),
  q('a company for a person', "whats otto fenn's company", { reply: /Ironleaf/ }),
  q('cash in a group', 'anyone in otter paid in cash?', { reply: /Ines Calder|Kiran Vale/ }),
  q('the smallest deal', "who's got the smallest deal", { reply: /Juno Park/ }),
  q('what someone does', 'remind me what karin vole does', { reply: /Sales/i }),
  q("a person's total", 'total owed to kiran vale', { reply: /5,?350/ }),
  q('list the groups', 'list the groups', { reply: /(?=[\s\S]*BAKER)(?=[\s\S]*CORVID)(?=[\s\S]*OTTER)/i }),
  q("a company's monthly worth", "what's pinecrest worth to us a month", { reply: /4,?500/ }),
];

export const WRITES = [
  {
    name: 'a bump in short words, then undo',
    turns: [
      { say: 'bump juno park to 650' },
      { say: 'yes', expect: { db: async (db) => (Number((await deal(db, 'Juno Park', 'Harbor Nine')).monthly_amount) === 650 ? null : 'not 650') } },
      { say: 'nah undo that' },
      { say: 'yes', expect: { db: async (db) => (Number((await deal(db, 'Juno Park', 'Harbor Nine')).monthly_amount) === 600 ? null : 'not back to 600') } },
    ],
  },
  {
    name: 'a fee in words, then scrap it',
    turns: [
      { say: "set mara quill's fee to 3 percent" },
      { say: 'yes', expect: { db: async (db) => {
        const r = await deal(db, 'Mara Quill', 'Pinecrest');
        const p = await one(db, "SELECT fee_percent FROM tb_people WHERE lower(display_name) = 'mara quill'");
        return Number(r.fee_percent) === 3 || Number(p?.fee_percent) === 3 ? null : 'fee not 3';
      } } },
      { say: 'actually scrap that' },
      { say: 'yes', expect: { db: async (db) => {
        const r = await deal(db, 'Mara Quill', 'Pinecrest');
        const p = await one(db, "SELECT fee_percent FROM tb_people WHERE lower(display_name) = 'mara quill'");
        return Number(r.fee_percent) === 0 && !(Number(p?.fee_percent) > 0) ? null : 'fee still set';
      } } },
    ],
  },
];

export const PENDING = [];
