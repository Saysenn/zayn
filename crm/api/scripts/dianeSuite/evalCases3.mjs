/**
 * THE THIRD HELD-OUT SET, written last and never fixed against. evalCases
 * and evalCases2 both drove fixes on 2026-10-03, so they stopped measuring
 * unseen wording; this one is only ever run, old code against new, for the
 * comparison. Do not change Diane to make one of these pass.
 *
 *   SUITE_SET=eval3 node scripts/dianeSuite/run.mjs
 *
 * Answers from the seed by hand (see evalCases.mjs for the seed table).
 */
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const deal = (db, person, company) => one(
  db, 'SELECT * FROM tb_mastersheet WHERE person_name = $1 AND company = $2 ORDER BY id DESC LIMIT 1', [person, company],
);
const q = (name, say, expect) => ({ name, turns: [{ say, expect }] });

export const READS = [
  q('pay for one person, very short', 'baker jones pay?', { reply: /2,?200/ }),
  q('which group someone is in', 'what group is theo brandt in', { reply: /CORVID/i }),
  q('everyone on a role', 'who are the directors?', { reply: /Kiran Vale|Nell Arden/ }),
  q('a company total', 'how much do we pay ironleaf people altogether', { reply: /5,?300/ }),
  q('the highest monthly', "what's the highest monthly anyone has?", { reply: /Kiran Vale|6,?000|3,?000/ }),
  q('number of people in otter', 'how many people are in otter', { reply: /\b4\b|four/i }),
  q('does someone have a phone', 'have we got a number for kiran?', { reply: /07700900001/ }),
  q('the ended ones in a group', 'any ended deals in baker?', { reply: /Nell Arden|Wren Hollis/ }),
  q('two people in one go', 'what do otto and felix get?', { reply: /1,?500[\s\S]*1,?300|1,?300[\s\S]*1,?500/ }),
  q('which company someone works at', 'where does karin vole work', { reply: /Pinecrest/ }),
  q('the stopped one by name', 'is wren hollis still active?', { reply: /stopped|archive|not active|no longer/i }),
  q('a currency question', 'is anyone paid in euros?', { reply: /no(?:body|one)?\b|none|not|0/i, noReply: /Kiran Vale.*EUR/ }),
  q('group with most deals', 'which group has the most deals?', { reply: /BAKER|CORVID/i }),
  q('a rate in plain words', 'how many dirhams to a dollar right now?', { reply: /3\.67/ }),
  q('who is owed nothing', 'is anyone owed nothing this month?', { reply: /no(?:body|one)?\b|none|0|every/i }),
];

export const WRITES = [
  {
    name: 'a raise said as "give", then reversed',
    turns: [
      { say: 'give otto fenn a raise to 1600' },
      { say: 'sure', expect: { db: async (db) => (Number((await deal(db, 'Otto Fenn', 'Ironleaf')).monthly_amount) === 1600 ? null : 'not 1600') } },
      { say: 'oops reverse that' },
      { say: 'yes', expect: { db: async (db) => (Number((await deal(db, 'Otto Fenn', 'Ironleaf')).monthly_amount) === 1500 ? null : 'not back to 1500') } },
    ],
  },
  {
    name: 'pausing a person\'s only deal in plain words, then back',
    turns: [
      { say: 'juno park is done with us, stop her deal' },
      { say: 'yes', expect: { db: async (db) => ((await deal(db, 'Juno Park', 'Harbor Nine')).stopped_on ? null : 'not stopped') } },
      { say: 'my mistake, put juno back on' },
      { say: 'yes', expect: { db: async (db) => ((await deal(db, 'Juno Park', 'Harbor Nine')).stopped_on ? 'still stopped' : null) } },
    ],
  },
];

export const PENDING = [];
