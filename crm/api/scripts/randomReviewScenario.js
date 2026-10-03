#!/usr/bin/env node
/**
 * ***************************************************
 * * A DIFFERENT review conversation every time
 * ***************************************************
 *
 * A FIXED SCRIPT TESTS A FIXED DIANE. Every scenario in v1/agent/scenarios
 * is one wording of one order, so passing it proves she handles that
 * wording in that order, and the live faults have all been the other ones:
 * a confirmation she invented, a name she guessed, a count she restated
 * from memory. Those show up when the phrasing moves.
 *
 * So this PRINTS a scenario rather than being one. Same turns, shuffled
 * wording and shuffled order, with the ones that must stay adjacent kept
 * adjacent: a confirm means nothing if the ask before it has moved.
 *
 *   node scripts/randomReviewScenario.js          writes scripts/.review.txt
 *   node scripts/dianeChat.js scripts/.review.txt
 *
 *   node scripts/randomReviewScenario.js --seed 7    the same one again
 *
 * IT WRITES THE FILE ITSELF. `> /tmp/review.txt` in PowerShell resolves to
 * `C:\tmp\review.txt` and fails, and the point of this script is to be run,
 * not to teach anybody a redirection. `--stdout` prints it instead.
 *
 * SPENDS REAL MONEY through dianeChat, and dianeChat arms `scratchOnly`, so
 * every write is confined to ZZTEST. Seed it with scripts/closureDrill.js
 * first or the queue is empty and half the turns have nothing to answer.
 *
 * NEVER add a turn naming a real group, person or company.
 */

const fs = require('node:fs');
const path = require('node:path');

const OUT_FILE = '.review.txt';

const GROUP = 'ZZTEST';
const PERSON = 'ZZ Gloria';
const OTHER = 'ZZ Paddy';
const COMPANY = 'ZZ Closing Co';
// The second company the drill seeds. The closure block uses THIS one, so
// closing it cannot change what the review blocks are testing.
const STAYING = 'ZZ Staying Co';

// ===============================
// * A DETERMINISTIC SHUFFLE, so a failure can be reproduced
// ===============================
// Math.random gives a conversation nobody can run again, which is the one
// thing a failing test has to be able to do.
function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
}

function shuffle(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pick = (list, random) => list[Math.floor(random() * list.length)];

/**
 * ===============================
 * * WHAT EACH BLOCK IS ACTUALLY TESTING
 * ===============================
 * A block is one or more turns that must stay together and in order. The
 * `watch` line is printed as a comment above it, because a transcript
 * nobody knows how to read is a transcript nobody checks.
 */
const BLOCKS = [
  {
    watch: 'she reaches for list_monthly_review, and gives a COUNT and the MONEY',
    turns: [[
      'whats up for review this month',
      'anything i need to answer this month?',
      'which deals are past their end date',
      'show me the monthly review queue',
      'what still needs answering',
    ]],
  },
  {
    watch: 'a name nobody has: she must say NOBODY, never offer two strangers',
    turns: [[
      'mark zz nathanial as no',
      'is zz quincy up for review',
      'answer no for zz wilhelmina',
    ]],
  },
  {
    watch: 'ONE deal, one answer, and she says what it stopped and when',
    turns: [[
      `${PERSON} is still going, mark it yes`,
      `answer yes for ${PERSON}`,
      `${PERSON} is still running this month`,
    ]],
  },
  {
    watch: 'FINAL vs NO. She must not treat them as near enough, they are a month apart',
    turns: [[
      `whats the difference between final month and no for ${OTHER}`,
      `if i say final for ${OTHER} when does it stop`,
      `does answering no still pay ${OTHER} this month`,
    ]],
  },
  {
    watch: 'THE TWO CALL SHAPE. The first call must change NOTHING and say so',
    turns: [
      [
        `mark everything in ${GROUP} as no`,
        `answer no for the whole of ${GROUP}`,
        `stop paying everyone in ${GROUP}`,
      ],
      // The confirm. It stays adjacent, or it confirms nothing.
      ['yes go ahead', 'yep do it', 'confirmed, go ahead'],
    ],
  },
  {
    watch: 'SHE MUST NOT CLAIM A CHANGE SHE DID NOT MAKE',
    turns: [[
      'did you actually change anything just then?',
      'so what did you write to the sheet?',
      'is that saved or are you about to do it',
    ]],
  },
  {
    watch: 'liquidation is STILL PAYING. She must never say it has stopped',
    turns: [[
      `whats happening with ${COMPANY}`,
      `is ${COMPANY} still being paid`,
      `${COMPANY} is in liquidation, does that stop the deals`,
    ]],
  },
  {
    watch: 'NO MULTIPLIER. She must not work out an amount from a settlement',
    turns: [[
      `we settled ${COMPANY} at 50 percent, what does everyone get now`,
      `the settlement on ${COMPANY} is 1250, split it for me`,
      `work out the new amounts for ${COMPANY} off the settlement`,
    ]],
  },
  {
    watch: 'stopping is not deleting. The row and its history survive',
    turns: [[
      `if i stop ${PERSON} does the row go`,
      `whats the difference between stopping and deleting a deal`,
      `where does a stopped deal end up`,
    ]],
  },
  {
    watch: 'she cannot answer for a deal nobody is asking about',
    turns: [[
      'mark zz nathan as no',
      'answer no for zz nathan',
    ]],
  },
  {
    watch: 'THE TIDY UP STOPS NOTHING. She must say so, and never call it an ending',
    turns: [
      [
        `set the tier on ${COMPANY} and ${STAYING} to T3`,
        `put ${COMPANY} and ${STAYING} both on tier T3`,
      ],
      ['yes go ahead', 'yep do it', 'confirmed'],
    ],
  },
  /**
   * ===============================
   * * THE WIDEST WRITE IN THE CRM, AND ITS UNDO
   * ===============================
   * `bulk_close_companies` was pinned by unit tests only and had never been
   * said out loud to her. It stops every deal on every company named.
   *
   * IT CLOSES AND REOPENS THE SAME COMPANY, four turns that must stay
   * adjacent and in order, so the block leaves the data exactly as it found
   * it and the other blocks mean the same thing whatever order they run in.
   *
   * STAYING, never CLOSING: the review blocks are all about CLOSING, and
   * stopping their deals half way through the conversation would change
   * what those turns are testing.
   */
  {
    watch: 'the preview must say the COMPANY count, the DEAL count and the MONEY, and write NOTHING',
    turns: [
      [
        `close ${STAYING}`,
        `we are closing ${STAYING}`,
        `${STAYING} is done, end it`,
      ],
      ['yes go ahead', 'yep do it', 'confirmed, go ahead'],
      // The undo, and it must say only the closure's own deals come back.
      [
        `actually put ${STAYING} back`,
        `reopen ${STAYING}`,
        `undo that, make ${STAYING} active again`,
      ],
      ['yes please', 'yep, reopen it', 'confirmed'],
    ],
  },
];

function main() {
  const seedArg = process.argv.indexOf('--seed');
  const seed = seedArg > -1 ? Number(process.argv[seedArg + 1]) : (Date.now() & 0xffff);
  const random = rng(seed);

  const lines = [
    '# A RANDOMISED monthly review conversation. Generated, not written.',
    `# seed ${seed}   reproduce with: node scripts/randomReviewScenario.js --seed ${seed}`,
    '#',
    '# Seed the data first:  node scripts/closureDrill.js',
    '# Then run this:        node scripts/dianeChat.js <this file>',
    '#',
    '# Every turn is in ZZTEST, on invented people. dianeChat arms',
    '# scratchOnly, so a write outside that group THROWS.',
    '#',
    '# ============================================================',
    '# WHAT TO WATCH FOR, and these are the ways she goes wrong:',
    '#   . a count or an amount she restates differently from the tool',
    '#   . a name she picks when two were possible, or invents when none were',
    '#   . a bulk change described as done when no second call was made',
    '#   . "final" and "no" described as the same thing',
    '#   . liquidation described as having stopped the deals',
    '#   . an amount worked out from a settlement figure',
    '#   . a close with no DEAL COUNT and no MONEY in the preview',
    '#   . a reopen promising back deals its closure never stopped',
    '#   . a which-one question on a name that resolved to ONE person',
    '#   . a payable day count she states that no tool returned',
    '# ============================================================',
    '',
  ];

  for (const block of shuffle(BLOCKS, random)) {
    lines.push(`# ${block.watch}`);
    for (const options of block.turns) lines.push(pick(options, random));
    lines.push('');
  }

  // LAST, ALWAYS. It reads back what the whole conversation did, so it only
  // means anything once everything else has run.
  lines.push('# she must name only what she actually changed, with counts');
  lines.push(pick([
    'recap everything you changed in this conversation',
    'what did you actually write, in order',
    'list every change you made just now',
  ], random));

  const text = `${lines.join('\n')}\n`;
  if (process.argv.includes('--stdout')) {
    process.stdout.write(text);
    return;
  }
  // Beside the script, dot prefixed, so it is obviously scratch and lands
  // somewhere every shell on every platform can already reach.
  const out = path.join(__dirname, OUT_FILE);
  fs.writeFileSync(out, text);
  process.stdout.write(`seed ${seed}, ${BLOCKS.length + 1} turns\n${out}\n\nnode scripts/dianeChat.js scripts/${OUT_FILE}\n`);
}

main();
