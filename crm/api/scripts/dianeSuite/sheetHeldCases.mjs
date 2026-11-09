/**
 * THE CLOSURE SHEET'S FIELDS ON WINDING DOWN, HELD-OUT SET. SUITE_SET=sheetheld.
 *
 * Written blind alongside sheetDevCases.mjs and kept back: different words,
 * different companies and fields, so a fix tuned on the dev set is judged on
 * what it was never shaped around. Same seed and checks (imported).
 */
import {
  extraSeed, isoIn, longIn, said, all, fieldIs, playIs, stageDateIs, liquidatorsAre, partyGone,
  audited, untouched, makeRead, makeWrite, CONTACTS,
} from './sheetDevCases.mjs';

export { extraSeed };
export const READS = [];
export const WRITES = [];
export const PENDING = [];

const read = makeRead(READS);
const write = makeWrite(WRITES);

// ================= READS =================
read('which are do not contact', [
  { say: 'any of the closures on do not contact?', expect: { reply: /Harbou?r Nine/i, noReply: /\b(?:Pinecrest|Ironleaf)\b/i, db: untouched } },
]);
read('liquidator and the rest of the case, a no-deals company', [
  { say: "who's the liquidator for copperfield joinery and who else is on that case", expect: { reply: /(?=[\s\S]*Leonard Curtis)(?=[\s\S]*Amira Shah)/i, db: untouched } },
]);
read('what the director said, by the person', [
  { say: 'remind me what kiran vale said re harbor nine', expect: { reply: /bank|lost (?:his|the) payment/i, db: untouched } },
]);
read('anything outstanding, slang', [
  { say: 'anythin left outstandin on ironleaf?', expect: { reply: /confirmation statement/i, db: untouched } },
]);
read('the last thing done', [
  { say: 'what was the last thing we did on pinecrest', expect: { reply: /statement of affairs/i, db: untouched } },
]);
read('not on the master sheet', [
  { say: "which closures aren't on the master sheet at all, like nobody's paid from them", expect: { reply: /(?=[\s\S]*Copperfield)(?=[\s\S]*Saltmarsh)/i, db: untouched } },
]);
read('the change log of one company', [
  { say: 'show me the change log for harbor nine, who did what', expect: { reply: /marcus/i, db: untouched } },
]);
read('the next step for a no-deals company names its loose end', [
  { say: 'copperfield joinery, whats our next move', expect: { tools: ['liquidation_next_step'], reply: /loan|12,?400/i, db: untouched } },
]);
read('a question about the play writes nothing', [
  { say: 'should we be chasing pinecrest or not?', expect: { db: untouched } },
]);
read('when the stage happened, a strike off proposal', [
  { say: 'what date was ironleaf gazetted', expect: { reply: said(-20), db: untouched } },
]);

// ================= WRITES =================
write('stop chasing, wait instead', [
  { say: 'bin the chasing on quarry lane, we just wait for begbies now', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(playIs('quarry lane', 'wait'), audited('quarry lane')) } },
]);
write('a second liquidator, keep the first', [
  { say: 'copperfield joinery got a second liquidator, Priya Desai also at Leonard Curtis. keep the other one on', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(liquidatorsAre('copperfield joinery', [/Leonard Curtis/i, /Priya Desai/i]), audited('copperfield joinery')) } },
]);
write('the suspension date, with the news', [
  { say: `someone objected to ironleaf's strike off, its been suspended since ${longIn(-3)}`, expect: { db: untouched } },
  { say: 'yes', expect: { db: all(stageDateIs('ironleaf', isoIn(-3)), fieldIs('ironleaf', 'stage', 'strike_off_suspended')) } },
]);
write('a party taken off, asked first', [
  { say: "brightwell hasn't got an hmrc officer on it anymore, take dev rana off", expect: { db: untouched } },
  { say: 'yes', expect: { db: all(partyGone('brightwell', /Dev Rana/i), audited('brightwell')) } },
]);
write('two companies, two different fields', [
  { say: "OR for saltmarsh bakery is Lisa Grant. and quarry lane's last action: chased HMRC on the payment plan", expect: { db: untouched } },
  { say: 'yes', expect: { db: all(
    fieldIs('saltmarsh bakery', 'official_receiver', /Lisa Grant/i),
    fieldIs('quarry lane', 'last_action', /HMRC/i),
    fieldIs('quarry lane', 'last_action', /payment plan/i),
    audited('saltmarsh bakery'), audited('quarry lane'),
  ) } },
]);
write('an unresolved matter added, then undone', [
  { say: "pinecrest unresolved: director still hasn't given back the company laptop", expect: { db: untouched } },
  { say: 'yes', expect: { db: all(fieldIs('pinecrest', 'unresolved', /laptop/i), audited('pinecrest')) } },
  { say: 'actually undo that', expect: {} },
  { say: 'yes', expect: { db: all(fieldIs('pinecrest', 'unresolved', ''), audited('pinecrest', 'undo')) } },
]);
write('do not contact set, then the next step respects it', [
  { say: 'brightwell is do not contact from now on, the director complained', expect: { db: untouched } },
  { say: 'yes', expect: { db: playIs('brightwell', 'do_not_contact') } },
  { say: 'so whats the next step on brightwell', expect: { tools: ['liquidation_next_step'], noReply: CONTACTS, db: playIs('brightwell', 'do_not_contact') } },
]);
