/**
 * FIFTH HELD-OUT SET, 2026-10-04, written after every fix of the session and
 * never fixed against: the honest number for that session, old code against
 * new. Answers from the seed (see evalCases.mjs).
 *
 *   SUITE_SET=eval5 node scripts/dianeSuite/run.mjs
 */
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const deal = (db, person, company) => one(
  db, 'SELECT * FROM tb_mastersheet WHERE person_name = $1 AND company = $2 ORDER BY id DESC LIMIT 1', [person, company],
);
const q = (name, say, expect) => ({ name, turns: [{ say, expect }] });

export const READS = [
  {
    name: 'a person, then a follow-up about them',
    turns: [
      { say: 'otto fenn, how much?', expect: { reply: /1,?500/ } },
      { say: 'and his company?', expect: { reply: /Ironleaf/ } },
    ],
  },
  q('a company total', "what's the total for brightwell?", { reply: /3,?700|3,?550/ }),
  q('under an amount', 'who earns less than 1000?', { reply: /Juno Park|\b4\b|four/i }),
  q('anyone at a company', 'anyone at quarry lane?', { reply: /Nell Arden|Silas Moor|\b2\b|two/i }),
  q('people with more than one deal', 'how many people have more than one deal?', { reply: /\b1\b|\bone\b|Kiran/i }),
  q('an average', "what's the average monthly in baker?", { reply: /1,?640/ }),
  q('the cash deals', 'show me the cash deals', { reply: /\b2\b|two/i }),
  q('is someone in a group', 'is mara quill in corvid?', { reply: /BAKER|\bno\b|not/i }),
];

export const WRITES = [
  {
    name: 'a new figure said as "should be", then go back',
    turns: [
      { say: "otto's monthly should be 1550" },
      { say: 'yes', expect: { db: async (db) => (Number((await deal(db, 'Otto Fenn', 'Ironleaf')).monthly_amount) === 1550 ? null : 'not 1550') } },
      { say: 'go back to what it was' },
      { say: 'yes', expect: { db: async (db) => (Number((await deal(db, 'Otto Fenn', 'Ironleaf')).monthly_amount) === 1500 ? null : 'not back to 1500') } },
    ],
  },
  {
    name: 'stop someone in two words, then bring her back',
    turns: [
      { say: 'stop pia torres' },
      { say: 'yes', expect: { db: async (db) => ((await deal(db, 'Pia Torres', 'Harbor Nine')).stopped_on ? null : 'not stopped') } },
      { say: 'bring her back' },
      { say: 'yes', expect: { db: async (db) => ((await deal(db, 'Pia Torres', 'Harbor Nine')).stopped_on ? 'still stopped' : null) } },
    ],
  },
];

export const PENDING = [];
