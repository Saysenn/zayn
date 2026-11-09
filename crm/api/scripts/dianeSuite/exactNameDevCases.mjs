/**
 * EXACT COMPANY NAMES ON WINDING DOWN, DEV SET. SUITE_SET=exactdev.
 *
 * His rule, 2026-11-04: two company names are the same company only when,
 * lower cased and with leading, trailing and double spaces dropped, they
 * match letter by letter. Anything else is a different company: "Pinecrest
 * Ltd" is not "Pinecrest". So a close name (typo, Ltd / Limited, shortened)
 * is never read, changed or answered for: she asks only "Did you mean X?"
 * and changes nothing. A yes carries out the original request with the
 * exact name (a write still previews, a second yes applies). An exact name
 * in any case or spacing is acted on at once; a name with nothing close is
 * "not found", no guess.
 *
 * Written BLIND, from the rule, not from the code. The held-out set is
 * exactNameHeldCases.mjs. Same seed as sheetDevCases.mjs (imported): Quarry
 * Lane, Pinecrest, Ironleaf, Harbor Nine, Brightwell, Copperfield Joinery
 * and Saltmarsh Bakery on the page.
 */
import {
  extraSeed, all, fieldIs, playIs, audited, untouched, makeRead, makeWrite,
} from './sheetDevCases.mjs';

export { extraSeed };
export const READS = [];
export const WRITES = [];
export const PENDING = [];

const read = makeRead(READS);
const write = makeWrite(WRITES);

// She asked whether a close name was meant.
export const ASK = /did you mean|do you mean|exact name|\bmeant\b|closest match/i;
// She said there is no such company.
export const NOT_FOUND = /not found|no company|can'?t find|couldn'?t find|could not find|cannot find|isn'?t on|not on (?:the|our)|don'?t have|do not have|no record|doesn'?t exist|does not exist|no (?:such|one called)|nothing (?:on|called)/i;
/** Both names in the reply, any order. */
export const both = (a, b) => new RegExp(`(?=[\\s\\S]*${a})(?=[\\s\\S]*${b})`, 'i');

// ================= READS: exact, any case or spacing, no question =================
read('exact name, shouty caps and extra spaces', [
  { say: '  QUARRY   LANE   who r the liquidators', expect: { reply: both('Kate Morris', 'Gareth Lyle'), noReply: ASK, db: untouched } },
]);

// ================= READS: a close name is asked, never answered =================
read('typo, asked then answered on yes', [
  { say: 'harbr nine OR?', expect: { reply: ASK, noReply: /Mark Tolley/i, db: untouched } },
  { say: 'yes', expect: { reply: /Mark Tolley/i, db: untouched } },
]);
read('Ltd added to a name on file without it', [
  { say: 'who is the liquidator on pinecrest ltd', expect: { reply: ASK, noReply: /FRP/i, db: untouched } },
  { say: 'yes', expect: { reply: /FRP/i, db: untouched } },
]);
read('a shortened name', [
  { say: 'copperfield - who else is involved?', expect: { reply: ASK, noReply: /Amira Shah/i, db: untouched } },
  { say: 'yes', expect: { reply: /Amira Shah/i, db: untouched } },
]);
read('two close names in one question, yes both', [
  { say: 'liquidators on quarry lane ltd and harbour nine?', expect: { reply: ASK, noReply: /Kate Morris|Mark Tolley/i, db: untouched } },
  { say: 'yes both', expect: { reply: both('Kate Morris', '(?:Mark Tolley|Official Receiver)'), db: untouched } },
]);
read('a no to the question, nothing answered', [
  { say: 'whats unresolved at brightwel', expect: { reply: ASK, noReply: /6,?200|VAT/i, db: untouched } },
  { say: 'no', expect: { noReply: /6,?200|VAT/i, db: untouched } },
]);

// ================= READS: nothing close, not found =================
read('nothing close, not found, no guess', [
  { say: 'whats the next step for silverbirch', expect: { reply: NOT_FOUND, noReply: ASK, db: untouched } },
]);

// ================= WRITES: exact name, no question =================
write('exact name in odd case and spacing, previewed then applied', [
  { say: 'put SALTMARSH  bakery on chase', expect: { noReply: ASK, db: untouched } },
  { say: 'yes', expect: { db: all(playIs('saltmarsh bakery', 'chase'), audited('saltmarsh bakery')) } },
]);

// ================= WRITES: close name, asked, then preview, then applied =================
write('Limited added, asked, previewed, applied', [
  { say: 'brightwell limited is do not contact now', expect: { reply: ASK, db: untouched } },
  { say: 'yes', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(playIs('brightwell', 'do_not_contact'), audited('brightwell')) } },
]);
write('typo on a text field write', [
  { say: 'last action on quary lane: rang begbies, they want the payroll by friday', expect: { reply: ASK, db: untouched } },
  { say: 'yes', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(fieldIs('quarry lane', 'last_action', /begbies|payroll/i), audited('quarry lane')) } },
]);
write('one exact, one shortened, nothing done till the question is answered', [
  { say: 'chase ironleaf and copperfield', expect: { reply: ASK, db: untouched } },
  { say: 'yes', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(playIs('ironleaf', 'chase'), playIs('copperfield joinery', 'chase')) } },
]);
write('two close names, yes to one by name', [
  { say: 'put pinecrest ltd and harbour nine on leave', expect: { reply: ASK, db: untouched } },
  { say: 'yes harbor nine', expect: { db: untouched } },
  { say: 'yes', expect: { db: all(playIs('harbor nine', 'leave'), playIs('pinecrest', 'wait')) } },
]);
