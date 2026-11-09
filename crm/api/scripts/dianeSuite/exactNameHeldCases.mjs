/**
 * EXACT COMPANY NAMES ON WINDING DOWN, HELD-OUT SET. SUITE_SET=exactheld.
 *
 * Written blind alongside exactNameDevCases.mjs and kept back: different
 * words, companies and near names, so a fix tuned on the dev set is judged
 * on what it was never shaped around. His rule (2026-11-04): same company
 * only when lower cased and space-tidied names match letter by letter; a
 * close name is asked "Did you mean X?", never acted on. Same seed
 * (sheetDevCases.mjs) and checks.
 */
import {
  extraSeed, all, playIs, liquidatorsAre, partyGone, audited, untouched, makeRead, makeWrite,
} from './sheetDevCases.mjs';
import { ASK, NOT_FOUND } from './exactNameDevCases.mjs';

export { extraSeed };
export const READS = [];
export const WRITES = [];
export const PENDING = [];

const read = makeRead(READS);
const write = makeWrite(WRITES);

// ================= READS =================
read('a space inside the name is a different name', [
  { say: 'iron leaf whats still outstanding', expect: { reply: ASK, noReply: /confirmation statement/i, db: untouched } },
  { say: 'yep', expect: { reply: /confirmation statement/i, db: untouched } },
]);
read('exact name, all lower case, no question', [
  { say: 'copperfield joinery liquidator?', expect: { reply: /Leonard Curtis/i, noReply: ASK, db: untouched } },
]);
read('first word only of a two word name', [
  { say: 'Saltmarsh, what stage is it at', expect: { reply: ASK, noReply: /voluntary/i, db: untouched } },
  { say: 'yes', expect: { reply: /voluntary|strike[\s-]?off/i, db: untouched } },
]);
read('two near names, yes to one by name', [
  { say: 'who did the director blame at quarry ln and harbor 9', expect: { reply: ASK, noReply: /Fairway/i, db: untouched } },
  { say: 'yes quarry lane', expect: { reply: /Fairway/i, db: untouched } },
]);

// ================= WRITES =================
write('nothing close on a write, not found, nothing done', [
  { say: 'add jo bell as case manager on greystone holdings', expect: { reply: NOT_FOUND, noReply: ASK, db: untouched } },
]);
write('two near names on a write, yes both, preview, applied', [
  { say: 'stick quary lane and brightwell ltd on leave', expect: { reply: ASK, db: untouched } },
  { say: 'yes both', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(playIs('quarry lane', 'leave'), playIs('brightwell', 'leave')) } },
]);
write('UK spelling of a US-spelt name is a different name', [
  { say: 'remove chloe fletcher from harbour nine', expect: { reply: ASK, db: untouched } },
  { say: 'yes', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(partyGone('harbor nine', /Chloe Fletcher/i), audited('harbor nine')) } },
]);
write('exact name with stray spaces, no question', [
  { say: 'add Tom Haines as joint liquidator on  Pinecrest ', expect: { noReply: ASK, db: untouched } },
  { say: 'yes', expect: { db: all(liquidatorsAre('pinecrest', [/FRP/i, /Tom Haines/i], { count: 2 }), audited('pinecrest')) } },
]);
