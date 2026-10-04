/**
 * HELD-OUT QUESTIONS: wording no rule was written for.
 *
 *   SUITE_SET=eval node scripts/dianeSuite/run.mjs
 *
 * The suite in cases.mjs is what she was fixed against, so passing it says
 * little about the next sentence nobody has tried. These are everyday
 * phrasings against the same seed (seed.mjs), with answers worked out from
 * that seed by hand. NEVER add a rule to make one of these pass by its own
 * words: that turns it into a suite case and the number stops meaning
 * anything. Fix the general fault, or leave it failing.
 *
 * The seed, for working out answers:
 *   BAKER  Kiran Vale Brightwell 3000 (fee 5%), Otto Fenn Ironleaf 1500, Mara Quill Pinecrest 1100,
 *          Juno Park Harbor Nine 600, Nell Arden Quarry Lane 2000 (ended), Wren Hollis Brightwell 500 (STOPPED)
 *   CORVID Kiran Vale Ironleaf 2500, Baker Jones Pinecrest 2200, Theo Brandt Brightwell 700,
 *          Felix Orr Ironleaf 1300, Silas Moor Quarry Lane 900 (ended)
 *   OTTER  Kiran Vale Harbor Nine AED 6000 cash, Karin Vole Pinecrest 1200, Ines Calder Ironleaf AED 4000 cash,
 *          Pia Torres Harbor Nine 800 (ended)
 *   Only Kiran Vale's BAKER deal has a phone (07700900001), so all 4 OTTER deals have none.
 */
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const deal = (db, person, company) => one(
  db, 'SELECT * FROM tb_mastersheet WHERE person_name = $1 AND company = $2 ORDER BY id DESC LIMIT 1', [person, company],
);
const q = (name, say, expect) => ({ name, turns: [{ say, expect }] });

export const READS = [
  q('people at a company', 'how many people work at ironleaf?', { reply: /\b4\b/ }),
  q("one person's monthly, short form", "what's otto on a month?", { reply: /1,?500/ }),
  q('a yes/no about cash', 'does kiran have any deals paid in cash?', { reply: /\b(?:one|1) deal|Harbor Nine|6,?000|yes/i }),
  q('a group total, casual', 'total for corvid please', { reply: /7,?600/ }),
  q('who is paid in a currency', "who's paid in aed?", { reply: /Ines Calder[\s\S]*Kiran Vale|Kiran Vale[\s\S]*Ines Calder/ }),
  q('missing phones in a group', 'anyone without a phone number in otter?', { reply: /\b4\b|four/i }),
  q('is someone on the sheet', 'is juno park on the sheet?', { reply: /Harbor Nine|600|yes/i, noReply: /not (?:on|found)/i }),
  q('everyone at a company', 'list everyone at pinecrest', { reply: /\b3\b/ }),
  q('one field, a role', "what's mara's role?", { reply: /Closer/i }),
  q('count of one person\'s deals', "how many deals has kiran got", { reply: /\b3\b/ }),
  q('ranking, top two', 'who are the top 2 earners this month', { reply: /Kiran Vale[\s\S]*Baker Jones/ }),
  q('a phone that is not there', "whats theo brandt's phone number", { reply: /no phone|not on file|not set|none|no number|isn'?t (?:one|a phone)/i, noReply: /07700900001/ }),
  q('who has been stopped', 'anyone stopped?', { reply: /Wren Hollis/ }),
  q('how many companies', 'how many companies do we deal with?', { reply: /\b5\b/ }),
  q('one person\'s monthly, possessive', "felix's monthly please", { reply: /1,?300/ }),
  q('two people in one question', "what's karin vole owed and also mara?", { reply: /1,?200[\s\S]*1,?100|1,?100[\s\S]*1,?200/ }),
  q('the AED rate', 'what rate are we using for dirhams?', { reply: /3\.67|AED/ }),
  q('a group by group comparison', 'compare baker and corvid this month', { reply: /BAKER[\s\S]*CORVID|CORVID[\s\S]*BAKER/i }),
  q('company with most deals', 'which company has the most deals?', { reply: /Ironleaf/i }),
  q('a deal that ended', 'whose deals have passed their end date?', { reply: /Nell Arden|Silas Moor|Pia Torres/ }),
];

export const WRITES = [
  {
    name: 'take an amount off, then put it back in plain words',
    turns: [
      { say: "knock 200 off baker jones's monthly" },
      { say: 'yes', expect: { db: async (db) => (Number((await deal(db, 'Baker Jones', 'Pinecrest')).monthly_amount) === 2000 ? null : 'not 2000') } },
      { say: 'put it back how it was' },
      { say: 'yes', expect: { db: async (db) => (Number((await deal(db, 'Baker Jones', 'Pinecrest')).monthly_amount) === 2200 ? null : 'not back to 2200') } },
    ],
  },
  {
    name: 'a group add-on, then take it back',
    turns: [
      { say: 'give everyone in otter a 2% add on' },
      { say: 'go ahead', expect: { db: async (db) => (Number((await deal(db, 'Karin Vole', 'Pinecrest')).addon_percent) === 2 ? null : 'add-on not set') } },
      { say: 'hmm no, take that back' },
      { say: 'yes', expect: { db: async (db) => (Number((await deal(db, 'Karin Vole', 'Pinecrest')).addon_percent) === 0 ? null : 'add-on still set') } },
    ],
  },
  {
    name: 'stop a deal said casually, then bring it back',
    turns: [
      { say: 'felix has left, end his deal' },
      { say: 'yep', expect: { db: async (db) => ((await deal(db, 'Felix Orr', 'Ironleaf')).stopped_on ? null : 'not stopped') } },
      { say: 'sorry wrong person, bring felix back' },
      { say: 'yes', expect: { db: async (db) => ((await deal(db, 'Felix Orr', 'Ironleaf')).stopped_on ? 'still stopped' : null) } },
    ],
  },
];

export const PENDING = [];
