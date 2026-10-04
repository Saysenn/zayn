/**
 * ===============================
 * * WANDERING: RANDOM CONVERSATIONS, THE WAY A PERSON ACTUALLY TALKS
 * ===============================
 * 2026-10-04. Every other set is scripted, so it only ever proves the
 * wordings somebody thought of. This one deals random turns from every
 * capability, with typos, short follow-ups, changes of mind, yes / no /
 * "actually", undo, scheduling and history, in a random order.
 *
 * The checks are only the ones true of ANY reply: there is one, it is not a
 * failure, it does not read her instructions out, it has no "undefined" or
 * "NaN" in it. Whether the answer is RIGHT is read from the transcript
 * (SUITE_VERBOSE=1), which is the point: a person reading it.
 *
 *   SUITE_SET=wander SUITE_SEED=7 SUITE_VERBOSE=1 node scripts/dianeSuite/run.mjs
 */
let seed = Number(process.env.SUITE_SEED ?? Date.now()) % 2147483647 || 1;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (list) => list[Math.floor(rand() * list.length)];

const PEOPLE = ['kiran vale', 'baker jones', 'otto fenn', 'karin vole', 'mara quill', 'theo brandt', 'ines calder', 'juno park', 'felix orr'];
const FIRST = ['kiran', 'otto', 'karin', 'mara', 'theo', 'ines', 'juno', 'felix'];
const GROUPS = ['baker', 'corvid', 'otter'];
const COMPANIES = ['pinecrest', 'ironleaf', 'brightwell', 'harbor nine', 'quarry lane'];
const typo = (s) => (rand() < 0.25 && s.length > 5
  ? (() => { const i = 1 + Math.floor(rand() * (s.length - 2)); return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2); })()
  : s);

// One turn each, with what may follow it.
const ASKS = [
  () => `how much is ${typo(pick(PEOPLE))} owed this month`,
  () => `whats ${pick(FIRST)} on`,
  () => `${pick(FIRST)} pay?`,
  () => `who is in ${pick(GROUPS)}`,
  () => `total for ${pick(GROUPS)} this month`,
  () => `average monthly in ${pick(GROUPS)}?`,
  () => `how many people at each company`,
  () => `who earns the most`,
  () => `lowest paid at ${pick(COMPANIES)}?`,
  () => `which company has the most deals`,
  () => `whats ${pick(FIRST)}'s phone number`,
  () => `what group is ${pick(PEOPLE)} in`,
  () => `is ${pick(PEOPLE)} in ${pick(GROUPS)}?`,
  () => `anyone paid in cash?`,
  () => `any deals ending soon?`,
  () => `which deals have no end date`,
  () => `whats the aed to usd rate`,
  () => `what changed recently`,
  () => `anything up for review this month?`,
  () => `what have i got scheduled`,
  () => `what did we decide about ${pick(FIRST)} before?`,
  () => `show me the last conversation we had`,
  () => `who is stopped`,
  () => `how many deals do we have`,
  () => `what can you do`,
];
const FOLLOW_UPS = [
  () => `and ${pick(FIRST)}?`,
  () => 'and in dollars?',
  () => `what about ${pick(GROUPS)}`,
  () => 'sorry i meant last month',
  () => 'thanks',
  () => 'ok',
];
const CHANGES = [
  () => `set ${pick(FIRST)}'s monthly to ${pick([650, 900, 1250, 1800])}`,
  () => `raise everyone in ${pick(GROUPS)} by ${pick([3, 5, 10])}%`,
  () => `give ${pick(PEOPLE)} a ${pick([2, 3])}% add-on`,
  () => `${pick(FIRST)}'s monthly should be ${pick([700, 1000, 1400])}`,
  () => `from next month put ${pick(PEOPLE)} on ${pick([800, 1500, 2100])}`,
  () => `stop ${pick(PEOPLE)}'s deal, they left`,
  () => `close ${pick(COMPANIES)} at the end of this month`,
  () => `delete my conversations from before ${pick(['august', 'september'])}`,
];
const ANSWERS = ['yes', 'yes please', 'go ahead', 'no', 'no leave it', 'actually make it 1100', 'wait which one?'];
const AFTER = ['undo that', 'go back to what it was', 'thanks', `and ${pick(FIRST)}?`, 'what have i got scheduled'];

// THE CHECKS TRUE OF ANY REPLY.
const ANY = {
  noReply: /going round in circles|That failed|NOTHING HAS BEEN CHANGED|BEGIN RECORD|\bundefined\b|\bNaN\b|\[object|could not determine data type/i,
};

function conversation(n) {
  const turns = [];
  const length = 3 + Math.floor(rand() * 5);
  while (turns.length < length) {
    const r = rand();
    if (r < 0.5) {
      turns.push({ say: pick(ASKS)(), expect: ANY });
      if (rand() < 0.4) turns.push({ say: pick(FOLLOW_UPS)(), expect: ANY });
    } else {
      turns.push({ say: pick(CHANGES)(), expect: ANY });
      turns.push({ say: pick(ANSWERS), expect: ANY });
      if (rand() < 0.4) turns.push({ say: pick(AFTER), expect: ANY });
    }
  }
  return { name: `wander ${n}`, turns };
}

// SEQUENTIAL: they write, so they cannot share the sheet in parallel.
const count = Number(process.env.SUITE_WANDER ?? 12);
export const READS = [];
export const WRITES = Array.from({ length: count }, (_, i) => conversation(i + 1));
export const PENDING = [];
