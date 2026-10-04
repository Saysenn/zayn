// ***************************************************
// * THE ADMIN SAID YES AND NOTHING HAPPENED
// ***************************************************
//
// THE INCIDENT, 2026-09-23. Asked to set three people to three different
// payable days, she called `bulk_update_master_sheet`, relayed the pending
// summary correctly, and waited. The admin said "yes, go ahead". She
// called the SAME tool with the SAME arguments and no `confirmed`, got the
// same pending summary back, and asked the identical question again.
// Reproduced every time in `scripts/dianeChat.js`.
//
// So no confirmed write could be completed by talking to her at all.
//
// IT WAS NOT A MISSING INSTRUCTION. `confirmFirst` ends every pending
// summary with "If they agree, call this again with confirmed true", and
// her prompt says it in six separate places. This is the case the rule in
// `.claude/CLAUDE.md` is about: PROMPTING IS NOT A GUARD, LEAST OF ALL
// ABOUT MONEY. When a sentence has been ignored, something has to catch it.
//
// ===============================
// * IT MAY ONLY CONFIRM WHAT SHE ALREADY SHOWED THEM
// ===============================
// The danger in replaying a call is confirming something the admin never
// saw: they say "yes" to one thing, she proposes another, and the runtime
// agrees to it on their behalf. That would be worse than the loop.
//
// So the replay is not "they said yes, so do it". It is "they said yes,
// and what this call is about to do is WHAT THE PREVIOUS ANSWER ALREADY
// DESCRIBED". Every figure and every name in the new pending summary has
// to be present in the message the admin was replying to. A proposal with
// one new name or one different number is not covered by their yes, and
// falls through to the ordinary second ask.

/**
 * A plain agreement, and nothing conditional.
 *
 * "yes but change Blake to 5" is NOT an agreement: it is a new
 * instruction, and the token check below would refuse it anyway. Kept
 * narrow here too so the two guards do not lean on each other.
 */
// "GO BACK TO WHAT IT WAS" is an undo, never a "go". It was refused as a yes
// to nothing and the change stayed. 2026-10-04.
const AGREED = /^(y|ya|yes|yep|yeah|yup|ok|okay|sure|go(?!\s+back\b)|go ahead|do it|confirm|confirmed|please do|proceed|correct|right|that's right|thats right|apply|save|send it)\b/i;

// A "but" or a question turns agreement into a discussion.
const NOT_PLAIN = /\b(but|except|although|instead|change|wait|hold|no)\b|\?/i;

/**
 * AN "OK" FOLLOWED BY A NEW INSTRUCTION IS THE INSTRUCTION. Live 2026-10-03:
 * "ok reopen souracore then" was read as a bare yes to nothing, the reopen
 * was refused, and she said the deal was "already back". An act aimed at
 * a NAME is new; aimed at it, that or them it is still the agreement
 * ("go ahead and close it").
 */
const NEW_ACT = /\b(?:reopen|close|set|add|stop|end|resume|rename|undo|delete|remove|mark|bump|raise|lower|scrap|cancel|move|park|schedule|answer|show|list|total)\s+(?!(?:it|that|them|this|those|these|him|her|now|ahead)\b)[a-z0-9]/i;

function agreed(said) {
  const text = String(said ?? '').trim();
  if (!text || text.length > 60) return false;
  if (NOT_PLAIN.test(text)) return false;
  if (NEW_ACT.test(text)) return false;
  return AGREED.test(text);
}

/**
 * ===============================
 * * A QUESTION OFFERING TWO READINGS, which a yes cannot answer
 * ===============================
 * "…as a flat amount from his fee, or 100 percent?" Live 2026-09-29: the
 * admin said "yes" and she ran a lookup, so the unanswered question was
 * buried under a figure.
 *
 * It sits beside `agreed` because they are one rule: what counts as an
 * agreement depends on what was asked, and splitting them is how one gets
 * updated without the other.
 *
 * THE LAST SENTENCE ONLY. Her answers carry prose before the question, and
 * an "or" anywhere in a paragraph is not an offer of two choices.
 *
 * `or` AS A WHOLE WORD between two things, in a sentence that ends in a
 * question mark. Narrow on purpose: a check that fired on every question
 * with the letters "or" in it would block every ordinary yes.
 */
const EITHER_OR = /[^.!?\n]*\S\s+\bor\b\s+\S[^.!?\n]*\?\s*$/i;

/**
 * THE SAME OFFER SPLIT ACROSS TWO SENTENCES. "I need to know if you meant
 * 100 as a currency amount or 100 percent off their fee. Could you please
 * clarify?" ends on a question with no "or" in it, and a yes to it ran a
 * total. 2026-09-29. Only a CLARIFY-shaped ending, and only right after a
 * sentence offering "meant X or Y", so "Shall I go ahead?" never trips it.
 */
const CLARIFY = /\b(?:clarify|which (?:one|is it|did you|do you|should|would|you)|let me know which|confirm which)\b[^.!?\n]*\?\s*$/i;
// "if you want to deduct 100 ... or reduce their fee" is the same offer.
const OFFERED = /\b(?:whether|if you|you meant|did you|do you|either|you want)\b[^.!?\n]*\S\s+\bor\b\s+\S/i;

function eitherOrAsked(answer) {
  const text = String(answer ?? '').trim();
  if (!text.endsWith('?')) return false;
  if (EITHER_OR.test(text)) return true;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const last = sentences[sentences.length - 1] ?? '';
  const before = sentences[sentences.length - 2] ?? '';
  return CLARIFY.test(last) && OFFERED.test(before);
}

/**
 * The parts of a change that identify WHICH change it is.
 *
 * Numbers and capitalised words: the figures and the names. Everything
 * else is the sentence around them, which she rewrites in her own voice
 * and so cannot be compared.
 *
 * READ FROM `confirming`, never from the whole summary. That text also
 * carries the instructions addressed to HER, and "Say what it would do and
 * the COUNT in one sentence" put COUNT among the facts of the change. Her
 * answer never contains it, so nothing was ever replayed. Found on the
 * first run against the real model.
 */
/**
 * SHE SPELLS SMALL NUMBERS AND THE TOOL DOES NOT. "(2 rows)" comes back as
 * "on two deals", so every count read as missing from her own answer and
 * nothing was ever replayed. Found on the first run against the real
 * model, after the guard was already written.
 *
 * Only as far as twelve: past that she writes digits, and a longer list is
 * more chances for an ordinary word to be read as a figure.
 */
const WORD_NUMBERS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
};

const { FOLLOWED_BY_COUNT_NOUN } = require('./countNoun');

// The word before a "one" that makes it a pronoun, not a figure.
const PRONOUN_ONE = /\b(?:each|every|any|no|which|this|that|the|some|another)\s+$/i;

// "0% to 5%", "1,400 to 1,500": what sits before the `to` is where the
// value is coming from. See the rule where it is used.
// A currency code may sit either side: "GBP 3,000 to GBP 3,500" left the
// 3,000 in, her "3,000 to 3,500" did not, and no yes was replayed. 2026-09-25.
const LEAVING = /^\s*%?\s*(?:[A-Z]{3}\s+)?to\s+(?:[A-Z]{3}\s+)?\d/i;

/**
 * ===============================
 * * A DATE IS ONE FACT, IN WORDS OR NUMBERS
 * ===============================
 * The tool writes "2026-10-01", she says "1 October 2026": read as 2026, 10
 * and 1 against 1 and 2026, a preset move could never be confirmed. Each date
 * becomes one token and leaves the text. 2026-09-25.
 */
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];
const ISO_DATE = /\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/g;
const WORD_DATE = new RegExp(`\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?)?(${MONTH_NAMES.join('|')})\\s+(\\d{4})\\b`, 'gi');

function takeDates(text, out) {
  const pad = (n) => String(n).padStart(2, '0');
  return text
    .replace(ISO_DATE, (_, y, m, d) => { out.add(d ? `${y}-${m}-${d}` : `${y}-${m}`); return ' '; })
    .replace(WORD_DATE, (_, d, month, y) => {
      const m = pad(MONTH_NAMES.indexOf(month.toLowerCase()) + 1);
      out.add(d ? `${y}-${m}-${pad(d)}` : `${y}-${m}`);
      return ' ';
    });
}

function facts(text) {
  const out = new Set();
  // A ROW NUMBER ("#1459") is the system's handle, never something agreed to:
  // she never says it, so a delete that named one could not be confirmed. 2026-09-28.
  const said = takeDates(String(text ?? '').replace(/#\d+/g, ' '), out);
  // Spelled the same way and dropped for the same reason: "one deal" is a
  // count, not a value. See the rule below.
  for (const [word, digit] of Object.entries(WORD_NUMBERS)) {
    for (const m of said.matchAll(new RegExp(`\\b${word}\\b`, 'gi'))) {
      if (FOLLOWED_BY_COUNT_NOUN.test(said.slice(m.index + word.length))) continue;
      // "each one is already over" is a pronoun: read as 1, no review stop
      // could be confirmed. 2026-09-25.
      if (PRONOUN_ONE.test(said.slice(0, m.index))) continue;
      out.add(digit);
    }
  }
  // A FIGURE IS ONE TOKEN, separators and pennies included: "1,000.00" read
  // as "1,000" and "00", her "1,000" lacked the "00", and no close confirmed.
  for (const m of said.matchAll(/[A-Z][a-zA-Z'-]{2,}|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    const token = m[0];
    /**
     * ===============================
     * * A COUNT OF ROWS IS NOT A FACT ABOUT THE CHANGE
     * ===============================
     * The per person bulk summary lists "(1 row)" after each name. She
     * never repeats it: she writes "each on one deal" or leaves it out
     * entirely. So every remembered confirmation carried a 1 her answer
     * did not, read as a change the admin had not been shown, and the
     * loop this file exists to close stayed open for the exact case that
     * found it. See countNoun.js.
     *
     * The names and the VALUES still have to match, which is what makes
     * a change identifiable. A count is derived from them.
     */
    if (/^\d/.test(token)
      && FOLLOWED_BY_COUNT_NOUN.test(said.slice(m.index + token.length))) continue;
    /**
     * ===============================
     * * THE VALUE IT IS LEAVING IS NOT WHAT THEY AGREED TO
     * ===============================
     * 2026-09-24. "update nathan and nicola add on rates to 5%" was
     * confirmed with `add on 0% to 5%`, and her own question said "to 5%"
     * and nothing about the 0. So the 0 read as a change they had not been
     * shown, "yes pls proceed" fell through, and she asked the identical
     * question a second time.
     *
     * A summary writes a change FROM AND TO, ALWAYS (rateChange.js). The
     * destination is the change; where it started is context. Two pendings
     * that differ only in where they start end in the same place, so
     * dropping it cannot confirm a different outcome.
     */
    if (/^\d/.test(token) && LEAVING.test(said.slice(m.index + token.length))) continue;
    /**
     * ALL CAPS IS THE TOOL SHOUTING, never a name. "set a DIFFERENT value
     * on each of them" put DIFFERENT among the facts, and she writes it in
     * ordinary case if at all, so nothing was ever replayed. Two runs were
     * lost to this class of word before the rule was drawn.
     *
     * A GROUP NAME is all caps too and is dropped with them. That only
     * makes the check weaker, never wrong: the figures and the people are
     * what identify a change, and they still have to match.
     */
    if (/^[A-Z]{2,}$/.test(token)) continue;
    // Compared AS A NUMBER: "1,000", "1000" and "1,000.00" are one figure,
    // and "3,118.5" is "3,118.50", never "31185" against "311850".
    if (/^\d/.test(token)) { out.add(String(Number(token.replace(/,/g, '')))); continue; }
    // AND THE POSSESSIVE, which is how she writes a name the tool does
    // not: "Quillon Marsh's payable days" against "Quillon Marsh:". Left
    // in, every name in a summary read as missing from her own answer and
    // nothing was ever replayed.
    out.add(token.toLowerCase().replace(/'s$/, '').replace(/'$/, ''));
  }
  return out;
}

/**
 * Is every fact in this pending summary one the admin has already been
 * shown? Direction matters: the previous answer may say MORE (her own
 * wording, a greeting, a question) but it may not say LESS.
 */
function alreadyShown(confirming, priorAnswer) {
  const want = facts(confirming);
  // A summary with nothing identifiable in it cannot be matched, so it is
  // never replayed. There is no such pending summary today; if one is
  // written later it asks twice rather than confirming itself.
  if (want.size === 0) return false;
  const shown = facts(priorAnswer);
  if (shown.size === 0) return false;
  for (const fact of want) if (!shown.has(fact)) return false;
  return true;
}

/**
 * Should this pending call be re-issued as confirmed?
 *
 * @param {object} result     what the handler just returned
 * @param {string} said       the admin's last message, verbatim
 * @param {string} prior      the assistant answer they were replying to
 */
function shouldConfirm(result, said, prior) {
  if (!result?.pending) return false;
  if (!agreed(said)) return false;
  // `confirming` is the change alone. An older pending shape without it
  // asks twice rather than confirming itself, which is the safe direction.
  return alreadyShown(result.confirming, prior);
}

/**
 * ***************************************************
 * * AND WHEN SHE DOES NOT RE-ISSUE IT AT ALL
 * ***************************************************
 *
 * `shouldConfirm` above only helps when she calls the SAME pending tool
 * again. In one run of three she answered "yes, go ahead" by calling
 * `update_master_sheet_row` with `perPerson`, a shape it does not take,
 * then wandered into three unrelated lookups. The agreed change was never
 * made and she never said so.
 *
 * So the pending call is remembered, and the agreement is acted on by the
 * RUNTIME rather than by her. She is left to narrate what happened, which
 * is the part she is reliable at.
 *
 * IN MEMORY, AND SMALL. A pending confirmation is answered in the next
 * breath or not at all: this is not state worth a table, and a restart
 * losing it costs one repeated question. Bounded so a long session cannot
 * grow it without limit.
 *
 * KEYED BY NOTHING. There is no conversation id to key on, and inventing
 * one would be a bigger change than this is worth. Instead every remembered
 * call is checked the same way `shouldConfirm` checks one: it is only
 * recalled when its facts are all present in the answer the admin is
 * replying to. Another conversation's pending change cannot match, because
 * its names and figures are not in this conversation's last answer.
 */
const REMEMBERED = [];
const KEEP = 20;

/**
 * A PROPOSAL ANSWERS THE NEXT MESSAGE ONLY. Twenty turns after Orla's undo was shown,
 * a "yes" to another question matched her name and applied it. 2026-09-25.
 */
let TURN = 0;
function nextTurn() {
  TURN += 1;
  for (let i = REMEMBERED.length - 1; i >= 0; i -= 1) {
    if (REMEMBERED[i].turn < TURN - 1) REMEMBERED.splice(i, 1);
  }
}

/**
 * ===============================
 * * THE NEWEST PROPOSAL ABOUT A PERSON SUPERSEDES THE OLDER
 * ===============================
 * 2026-09-25: a one deal "+500 for Suki" was pending, then a per person
 * "+500 Suki, +750 Ines". Her answer restated both, one "yes" applied both,
 * and Suki went 3,000 to 4,000. A person is named as "First Last".
 */
const PERSON = /\b([A-Z][a-z'-]{2,}) ([A-Z][a-z'-]{2,})\b/g;
const peopleIn = (text) => new Set([...String(text ?? '').matchAll(PERSON)].map((m) => `${m[1]} ${m[2]}`.toLowerCase()));

function remember(name, args, confirming) {
  if (!confirming) return;
  const mine = peopleIn(confirming);
  for (let i = REMEMBERED.length - 1; i >= 0; i -= 1) {
    if ([...peopleIn(REMEMBERED[i].confirming)].some((p) => mine.has(p))) REMEMBERED.splice(i, 1);
  }
  REMEMBERED.push({ name, args, confirming, at: Date.now(), turn: TURN });
  while (REMEMBERED.length > KEEP) REMEMBERED.shift();
}

/**
 * ===============================
 * * EVERY PENDING CALL THIS AGREEMENT ANSWERS, NOT ONE OF THEM
 * ===============================
 * 2026-09-24. "update nathan and nicola add on rates to 5%" is TWO pending
 * calls, one per person. This returned the newest, the runtime applied it,
 * and told her it was done. She narrated both as done. Nicola was written
 * and Nathan was not, and nobody was told.
 *
 * One question was asked, so one answer settles all of it. Each call still
 * has to pass `alreadyShown` on its own, so a pending the admin never saw
 * is no more applicable in a set than it was alone.
 *
 * Ten minutes, because a confirmation older than that is a question the
 * admin has forgotten asking and should be shown again rather than applied.
 *
 * @returns {object[]} in the order she proposed them, so the newest of two
 *   calls on the same thing lands last and wins.
 */
const STALE_MS = 10 * 60 * 1000;

function recallAll(said, priorAnswer) {
  if (!agreed(said)) return [];
  const now = Date.now();
  const seen = new Set();
  const held = [];
  // Newest first HERE, so a change proposed twice keeps the latest of the
  // two identical shapes. Reversed before it is handed back.
  for (let i = REMEMBERED.length - 1; i >= 0; i -= 1) {
    const one = REMEMBERED[i];
    if (now - one.at > STALE_MS) continue;
    if (!alreadyShown(one.confirming, priorAnswer)) continue;
    const shape = shapeOf(one.name, one.args);
    // THE SAME PROPOSAL under two argument shapes is one change. Applying
    // both put one undo back twice, and the second reached an older change.
    const proposal = `${one.name}|${one.confirming}`;
    if (seen.has(shape) || seen.has(proposal)) continue;
    seen.add(shape);
    seen.add(proposal);
    held.push(one);
  }
  return held.reverse();
}

/**
 * ===============================
 * * HER `confirmed: true` IS NOT THE ADMIN'S YES
 * ===============================
 * 2026-09-25. Asked to add 3% to Orla and Ines, she showed Orla's line only,
 * was told "yes please", sent confirmed herself, and Ines was written unseen.
 * A confirmed call stands only for a pending this answer showed, agreed to.
 */
function confirmationHeld(name, args, said, priorAnswer) {
  if (!agreed(said)) return false;
  const shape = shapeOf(name, args);
  const now = Date.now();
  // NOTHING TO CHECK is not "never shown": "paid to true" over a group has no
  // name or figure, and her confirm deadlocked. The same call, pending from
  // before and agreed to, is what stands then.
  return REMEMBERED.some((one) => shapeOf(one.name, one.args) === shape
    && now - one.at <= STALE_MS
    && (facts(one.confirming).size === 0 || alreadyShown(one.confirming, priorAnswer)));
}

// A bare refusal, the whole message. "No, set it to 4" is a new instruction.
const DECLINED = /^(?:no|nope|nah|no thanks|no thank you|cancel(?: it| that)?|don'?t|leave it|never ?mind|forget it)[.!\s]*$/i;

const declined = (said) => DECLINED.test(String(said ?? '').trim());

/** A "no" drops every proposal that answer showed, so a later yes cannot apply it. */
function dropShown(priorAnswer) {
  for (let i = REMEMBERED.length - 1; i >= 0; i -= 1) {
    if (alreadyShown(REMEMBERED[i].confirming, priorAnswer)) REMEMBERED.splice(i, 1);
  }
}

/** Once it has been acted on it is not pending any more. */
function forget(held) {
  const at = REMEMBERED.indexOf(held);
  if (at !== -1) REMEMBERED.splice(at, 1);
}

/**
 * ***************************************************
 * * AND A YES TO SOMETHING ALREADY FINISHED
 * ***************************************************
 *
 * 2026-09-24. "set quillon marsh payable days to 19" wrote 19 and said so.
 * The next message was a bare "yes", answering nothing, and she called the
 * same tool with the same arguments and wrote 19 again.
 *
 * Nothing caught it. `notTwice` is per TURN, and this is the next turn;
 * `recall` above only fires when something is PENDING, and nothing was.
 * The values were identical so no figure moved, which is luck: the same
 * shape on a tool that ADDS rather than SETS would double it.
 *
 * SO A FINISHED WRITE IS REMEMBERED TOO, and a bare agreement may not
 * repeat it. Only an EXACT repeat: same tool, same arguments. A different
 * value is a new instruction and goes through untouched.
 */
const FINISHED = [];

// `confirmed` is the runtime's, not theirs, so two calls that differ only
// by it are the same instruction.
/**
 * Keys sorted at EVERY level. A replacer array filters nested keys too, so
 * every two person perPerson call read `{"perPerson":[{},{}]}`: a payable add
 * was refused as the special case already done. 2026-09-25.
 */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
}

const shapeOf = (name, args) => {
  const { confirmed, ...rest } = args ?? {};
  return `${name}(${JSON.stringify(stable(rest))})`;
};

/**
 * ONLY A CALL THAT WROTE, which the runtime reads off the write itself
 * (shared/writeTap.helper.js). A "which company?" and a refusal were both
 * remembered as done, and the next "yes" made her claim writes nobody made.
 */
function completed(name, args, result = null) {
  FINISHED.push({
    shape: shapeOf(name, args),
    at: Date.now(),
    // WHAT IT SAID, so the refusal quotes it rather than asserting "done".
    answer: String(result?.reply ?? result?.summary ?? '').slice(0, 400),
  });
  while (FINISHED.length > KEEP) FINISHED.shift();
}

/**
 * Would this call just redo what the last one did, on a bare "yes"?
 *
 * ONLY ON AN AGREEMENT. Told "set it to 19" twice, deliberately, she
 * should write it twice: the admin repeating themselves is an instruction,
 * and refusing it would be the worse failure.
 */
function alreadyDone(name, args, said) {
  if (!agreed(said)) return null;
  const shape = shapeOf(name, args);
  const now = Date.now();
  return [...FINISHED].reverse().find((f) => f.shape === shape && now - f.at <= STALE_MS) ?? null;
}

// Anything proposed on the last turn still waiting on a yes.
const somethingHeld = () => REMEMBERED.some((r) => r.turn >= TURN - 1);

/**
 * THE ONE PROPOSAL, when her question dropped its details. Live 2026-09-30:
 * an undo was held, she asked "...on 5 deals for.", and the plain yes
 * matched nothing, because recallAll looks for the facts in her words. With
 * exactly one thing held from the last turn, a plain yes is a yes to it.
 */
function onlyHeld() {
  const last = REMEMBERED.filter((r) => r.turn >= TURN - 1);
  // The NEWEST, when there are two: her question is about the last thing she
  // proposed, and a plain yes answers that question. 2026-09-30.
  return last.length > 0 ? last[last.length - 1] : null;
}

module.exports = {
  somethingHeld,
  onlyHeld,
  shouldConfirm,
  eitherOrAsked,
  agreed,
  alreadyShown,
  facts,
  remember,
  recallAll,
  forget,
  completed,
  alreadyDone,
  confirmationHeld,
  declined,
  dropShown,
  nextTurn,
};
