// ***************************************************
// * AN INSTRUCTION ANSWERED WITH A LOOKUP
// ***************************************************
//
// TWICE, ON DIFFERENT FIELDS, against the real model:
//
//   "make bram oakhurst a special case deal"  -> "Bram Oakhurst's special
//                                                case: No."
//   "set quillon marsh payable days to 7"     -> "Quillon Marsh's payable
//                                                days: 30."
//
// Both read back the CURRENT value of the field the admin was trying to
// change. That reads like a refusal and is not one, and in both runs the
// admin's next word was taken as the go ahead for a change never proposed.
//
// ===============================
// * THE HOLE WAS THE SHORTCUT, NOT THE ROUTING
// ===============================
// `find_and_show_details` hands back its own finished sentence, and
// runAgent ends the turn on it rather than spending a model round retyping
// it. Every reply guard runs on the model's prose, so a turn that ends
// this way passes none of them. The first fix looked right and changed
// nothing for two runs because of it.
//
// So the shortcut is denied when the admin gave an INSTRUCTION and nothing
// WROTE. She then gets the round, sees the card and the instruction
// together, and proposes the change: that is what the run that worked did
// on its own.
//
// IT COSTS A ROUND, NEVER A WRITE. Everything downstream is unchanged:
// `confirmSpecialCaseDeal` and the rest still hold, so the worst this can
// do is spend one model call on a sentence that was already fine.

/**
 * An imperative, at the START of the sentence.
 *
 * The position is the whole test. "set her days to 7" is an instruction;
 * "what would happen if I set her days to 7" is not, and neither is
 * "which deals are marked reviewed monthly". A question opens with a
 * question word, so requiring the verb first separates them without
 * listing every way of asking something.
 *
 * "show", "list" and "tell" are absent on purpose: they ask for a lookup,
 * which is what this exists to allow.
 */
// Her name and a leading WHEN are openers too: "hey diane, from next month
// bump him to 3800" is an order, and missing it ended the turn on a card. 2026-10-03.
const { MONTH_WORD } = require('../shared/when.helper');

const WHEN_LEAD = `(?:(?:from|starting(?:\\s+(?:in|from))?|beginning|as of|in|for|come)\\s+(?:the\\s+)?(?:next\\s+(?:month|\\d+\\s+months)|${MONTH_WORD}(?:\\s+\\d{4})?)\\b[,\\s]*)`;
const OPENERS = `(?:(?:(?:ok|okay|so|now|right|alright|well|and|then|also|um|uh|yeah|yep|hey|hi|please|cool|great|diane)\\b[,\\s]*)|${WHEN_LEAD})*`;
const POLITE = '(?:(?:can|could|would|will) you\\s+|i (?:need|want) you to\\s+|go ahead and\\s+|please\\s+)?';
// `resume`, `reopen` and `answer` were missing, so "resume zayn's deal"
// and "answer yes for zayn" read as questions and nothing happened. Found
// by sweeping the non money columns rather than by him, 2026-09-29.
const VERBS = '(?:set|change|update|make|mark|put|give|move|remove|clear|unset|turn|add|rename|delete|stop|resume|reopen|restart|answer|undo|revert|increase|raise|bump|lower|reduce|take|knock|deduct|end(?!\\s+of\\b)|close|finish|cancel)';
const IMPERATIVE = new RegExp(`^\\s*${OPENERS}${POLITE}${VERBS}\\b`, 'i');

/**
 * ===============================
 * * AND A SLIP IN THE VERB IS STILL THE VERB
 * ===============================
 * Live 2026-09-29: "aupdate A J Rayson status" was not an instruction, so
 * the turn fell through to the lookup path and drew a chooser at somebody
 * who had just given an order. One letter.
 *
 * ONLY THE FIRST WORD, only one edit, and only at five letters or more.
 * The position is what makes the whole test work ("what would happen if I
 * set her days to 7" is a question), so the slip is allowed in exactly the
 * place the verb has to be and nowhere else. Five letters because "add",
 * "end" and "put" are one edit from ordinary words, and the long verbs are
 * the ones people actually mistype.
 */
const SLIP_MIN = 5;

/**
 * One edit OR one adjacent swap. The swap is not a nicety: "udpate" and
 * "chnage" are the two most common ways to mistype these, and plain
 * Levenshtein scores both as TWO substitutions and misses them.
 */
function slipOf(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let prevPrev = [];
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], row[j - 1]);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], prevPrev[j - 2] + 1);
      }
    }
    if (Math.min(...row) > 1) return false;
    prevPrev = prev;
    prev = row;
  }
  return prev[b.length] <= 1;
}

const LONG_VERBS = VERBS.replace(/^\(\?:|\)$/g, '').split('|')
  .map((v) => v.replace(/\(\?!.*?\)/g, ''))
  .filter((v) => v.length >= SLIP_MIN);

/**
 * ===============================
 * * AN INFLECTION IS A REAL WORD, not a slip
 * ===============================
 * "closer look at zayn" is a QUESTION, and "closer" is one letter from
 * "close". Read as a slip it turns a question into an instruction, which
 * is the expensive direction to be wrong in.
 *
 * Every false positive worth having is the verb plus an ordinary ending,
 * so those are excluded by construction rather than by a word list nobody
 * would keep current.
 */
const ENDINGS = ['s', 'r', 'd', 'n', 'es', 'ed', 'er', 'en', 'ing', 'ers'];
const isInflection = (word) => LONG_VERBS.some(
  (v) => ENDINGS.some((e) => word === v + e || word === v.replace(/e$/, '') + e),
);

/** The first word, one slip from a verb it is neither already nor bent from. */
function verbSlipped(text) {
  const first = String(text).trim().split(/[^a-z]+/i)[0]?.toLowerCase() ?? '';
  if (first.length < SLIP_MIN) return false;
  if (LONG_VERBS.includes(first) || isInflection(first)) return false;
  return LONG_VERBS.some((v) => slipOf(first, v));
}

/** Is this sentence telling her to do something, rather than asking? */
function isSetInstruction(said) {
  const text = String(said ?? '').trim();
  if (!text) return false;
  // A QUESTION MARK IS NOT A GET OUT. "can you set her to 7?" is an
  // instruction with a polite ending, and IMPERATIVE already takes the
  // "can you" off the front.
  // ARITHMETIC IS NOT AN EDIT: "add gloria and zayn together" was taken as a write,
  // her correct total was refused, and she reached for the edit tool. 2026-09-28.
  if (SUMS.test(text) || ASKS_FOR.test(text)) return false;
  return IMPERATIVE.test(text) || verbSlipped(text) || SHOULD_BE.test(text) || terseEdit(text);
}

/**
 * ===============================
 * * THE ORDER WITH NO VERB IN FRONT
 * ===============================
 * Bulk sweep on gpt-4.1, 2026-10-06, every one read as a lookup and
 * answered "Kiran Vale has 3 deals:":
 *
 *   "dudcut 200 to kiran vales deals"            a two letter slip
 *   "kiran vale monthly 2750 every deal"          no verb at all
 *   "switch all kiran vale deals to aed"          a verb nobody listed
 *   "door no 12b for kiran all deals"             a field and a value
 *   "label all kiran deals VIP"                   the field IS the verb
 *   "kiran accepts postals, set it on all"        the verb after the name
 *
 * A STATEMENT, never a question: a question word in front, a question
 * mark at the end, or a lookup verb ("show", "list", "how much") keeps
 * the turn a lookup. Then any ONE of these makes it an order:
 *
 *   an edit verb ANYWHERE in it, or a two letter slip of a long one
 *   a field named with a value after it
 *   "on all", "every deal", "all his deals", "everywhere"
 *
 * Wrong costs a model round, never a write: see the note at the top.
 */
const LOOKUP_LEAD = /^\s*(?:(?:ok|okay|so|now|hey|diane|please)\b[,\s]*)*(?:what|which|who|whose|when|where|why|how|is|are|was|were|does|do|did|has|have|any|show|list|find|display|count|total|sum|compare|export|download|print|tell|give me|get me|look|check|see|view|open)\b/i;
const EDIT_ANYWHERE = /\b(?:set|change|update|make|mark|put|move|switch|swap|replace|rename|label|tag|note|flag|clear|remove|add|deduct|subtract|minus|take|knock|bump|raise|increase|lower|reduce|cut|drop|apply|assign|give)\b/i;
const FIELD_WORDS = /\b(?:monthly|payable(?:\s+(?:amount|days))?|days|currency|aed|gbp|euro|usd|paid|payment\s+method|method|bank|cash|crypto|location|door(?:\s+(?:no|number))?|postcode|post\s*code|postals?|acc(?:ount)?\s*(?:no|number)?|sort\s*code|label|note|notes|role|fee|add[\s-]?on|preset|end\s+date|start(?:\s+date)?|payment\s+start|appointment|appointed|special\s+case|review|reviewed)\b/i;
const VALUE = /(?:\d|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(?:yes|no|true|false|vip)\b|:\s*\S|\bto\s+\S|\bis\s+\S|\bnow\b)/i;
const SCOPE_ALL = /\b(?:on|for|to)\s+(?:all|every|each|any)\b|\b(?:all|every|each)\s+(?:of\s+)?(?:\w+'?s?\s+){0,3}deals?\b|\bevery\s*where\b|\ball\s+(?:his|her|their|of\s+them)\b/i;
const LONG_SLIP_MIN = 6;

/** A long verb two edits away in any word: "dudcut" is "deduct". */
function verbSlippedAnywhere(text) {
  return String(text).toLowerCase().split(/[^a-z]+/).some((w) => w.length >= LONG_SLIP_MIN
    && !LONG_VERBS.includes(w) && !isInflection(w)
    && LONG_VERBS.some((v) => v.length >= LONG_SLIP_MIN && slip2(w, v)));
}

function slip2(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length] <= 2;
}

function terseEdit(text) {
  if (LOOKUP_LEAD.test(text) || /\?\s*$/.test(text)) return false;
  if (EDIT_ANYWHERE.test(text) || verbSlippedAnywhere(text)) return true;
  if (FIELD_WORDS.test(text) && VALUE.test(text.replace(FIELD_WORDS, ' '))) return true;
  return SCOPE_ALL.test(text);
}

/**
 * "OTTO'S MONTHLY SHOULD BE 1550" IS AN INSTRUCTION. Held-out wording
 * 2026-10-04: read as a question, she looked Otto up, and the "yes" that
 * followed changed nothing. A field said to be a figure, as a statement
 * (no question mark), is a change.
 */
const SHOULD_BE = /\b(?:should|needs? to|ought to|has to|must|is supposed to)\s+be\s+(?:on\s+|at\s+)?(?:£|gbp\s*|aed\s*)?\d[\d,.]*\s*%?\s*[.!]?\s*$/i;

/**
 * ===============================
 * * A VALUE HANDED BACK IS STILL THE INSTRUCTION
 * ===============================
 * "deduct 100 to zayn milkman", then asked what she meant, "100 aed". The
 * second line is not an imperative and this test only ever saw the LAST
 * one, so the follow up fell through to the details path and drew every
 * field of both his deals under "the full details are on screen". Live
 * 2026-09-29.
 *
 * The instruction is still open: they have not asked to see anything since
 * giving it, they answered a question it raised.
 *
 * A QUESTION CLOSES IT, whatever came before. Otherwise "what is his
 * monthly?" one line after an edit would be read as part of the edit and
 * answered with no card at all, which is the same fault pointing the other
 * way.
 */
const ASKS = /^\s*(?:what|which|who|whose|when|where|why|how|is|are|was|were|does|do|did|has|have|any)\b/i;

function isSetInstructionRecent(said, saidRecent) {
  const text = String(said ?? '').trim();
  if (isSetInstruction(text)) return true;
  if (!text) return false;
  if (ASKS.test(text) || text.endsWith('?') || ASKS_FOR.test(text) || SUMS.test(text)) return false;
  // `recentSaid` joins the last turns with newlines, newest first, and the
  // imperative test is anchored to the start of a line.
  return String(saidRecent ?? '').split('\n').some((line) => isSetInstruction(line));
}

// A SUM ASKED FOR, not a change: "add X and Y together", "add them up", and "add
// Gloria and Gloria Difference then convert it": two names and no figure between.
// An edit's add carries one ("add 500 to Suki", "add a 5% fee").
const SUMS = /\badd\b[^.?!]*\b(?:together|up)\b|\badd up\b|\bsum\b|\bcombined?\b|\badd\s+[a-z][^\d%.?!]*?\band\b/i;
// "GIVE ME her totals", "show me", "tell me": asking to be handed something, not
// to change it. "give" alone stays an edit ("give Suki a 3% fee"). 2026-09-28.
const ASKS_FOR = new RegExp(`^\\s*${OPENERS}${POLITE}(?:give|get|show|tell|send|find|pull)\\s+(?:me|us)\\b`, 'i');

// ===============================
// * AND THE ONE FIELD THAT NEEDED SAYING TWICE
// ===============================
// `special_case_deal` was renamed on 2026-09-23 and her card, her field
// description and her prompt each still carried a different old name for
// it. The correction below names the tool and the field, because a bare
// "you looked it up" left her looking it up again.

// Both directions, since "stop her being a special case" is a set too.
const SETS = /\b(?:make|set|mark|flag|turn|stop|remove|undo|unset|clear)\b/i;

// The switch's name however it is ordered. See shared/specialCase.js.
/**
 * "SPECIAL" ON ITS OWN COUNTS TOO.
 *
 * "make zayn milkman special" and "stop zayn being special" both missed,
 * because this wanted the noun after it. Nothing else on a deal is called
 * special, so the word alone is not ambiguous, and it is how somebody
 * types it in a hurry. Found by sweeping the non money columns rather than
 * by him, 2026-09-29.
 */
const NAMES_IT = /\bspecial(\s+(?:case|deal)(?:\s+(?:case|deal))?)?\b/i;

// The older wording, which carries its own verb. Wants an OBJECT, so the
// passive question "should they be paid anyway" is not one.
const INSTRUCTS_ALONE = /\bpay\s+\S+\s+anyway\b/i;

function isSpecialCaseInstruction(said) {
  const text = String(said ?? '');
  if (INSTRUCTS_ALONE.test(text)) return true;
  return SETS.test(text) && NAMES_IT.test(text);
}

/**
 * Did this turn answer an instruction without writing anything?
 *
 * @param {string} said         the admin's sentence this turn
 * @param {boolean} wrote       whether any tool that CHANGES DATA ran
 * @param {object[]} toolResults every tool result this turn
 */
function answeredWithoutWriting(said, wrote, toolResults = []) {
  if (wrote) return false;
  if (!isSetInstruction(said) && !isSpecialCaseInstruction(said) && !KEEPS_REVIEW.test(String(said ?? ''))) return false;
  /**
   * A QUESTION SHE HAD TO ASK IS NOT A FAILURE TO ACT.
   *
   * More than one candidate means she MUST ask which, and pushing her past
   * that is the one thing `resolvePerson` exists to stop.
   */
  return !toolResults.some((r) => r?.ambiguous);
}

// "mark suki and ines as paid" went to the review queue. 2026-09-25.
const MARKS_PAID = /\b(?:mark|set|make|flag)\b[^.?!]*\b(?:un)?paid\b/i;

// "end dov's deals that are marked for review" was answered with a total.
const ENDS_REVIEW = /\b(?:end|stop|close|finish)\b[^.?!]*\breview\b/i;

/** What to send her back with. The field specific one lands better where it fits. */
// "Keep her review deal going" was denied as not up for review, no tool called. 2026-09-25.
const KEEPS_REVIEW = /\bkeep\b[^.?!]*\breview\b|\breview\b[^.?!]*\bkeep\b[^.?!]*\b(?:going|running)\b/i;

function correctionFor(said) {
  if (KEEPS_REVIEW.test(String(said ?? ''))) {
    return 'THEY TOLD YOU TO KEEP A DEAL UP FOR REVIEW RUNNING. That is answer_monthly_review with '
      + 'person (and company if they hold several) and answer "yes". It writes at once: call it, then '
      + 'say what it answered. Never say they are not up for review without calling list_monthly_review.';
  }
  if (ENDS_REVIEW.test(String(said ?? ''))) {
    return 'THEY TOLD YOU TO END DEALS UP FOR REVIEW AND YOU LOOKED SOMETHING UP. That is '
      + 'bulk_answer_monthly_review with person (or company) and answer "no" for over, or "final" '
      + 'to pay this month and then stop. It comes back pending: show it and wait for them to agree.';
  }
  if (MARKS_PAID.test(String(said ?? ''))) {
    // SET PER PERSON since 2026-10-08: every live deal, no "which deal?".
    return 'THEY TOLD YOU TO DO SOMETHING AND YOU LOOKED IT UP INSTEAD. "Paid" is the PAID SWITCH, '
      + 'nothing to do with the monthly review, and it is set PER PERSON: every live deal they hold. '
      + 'Call bulk_update_master_sheet with `people` and set: { overridePaid: true } (false for '
      + 'unpaid). Do not ask which deal. Only when they named ONE company is it update_master_sheet_row '
      + 'for that deal. It comes back pending: show it and wait for them to agree.';
  }
  if (isSpecialCaseInstruction(said)) {
    return 'THEY TOLD YOU TO DO SOMETHING AND YOU LOOKED IT UP INSTEAD. "Make them a special '
      + 'case" is an instruction, not a question about the field, so reading its current value '
      + 'back at them answers nothing.\n\n'
      + 'Call update_master_sheet_row with specialCaseDeal, naming the deal you just found. It '
      + 'comes back PENDING: nothing changes, and you then say which month it is for and what '
      + 'figure it adds, and wait for them to agree.';
  }
  return 'THEY TOLD YOU TO DO SOMETHING AND YOU LOOKED IT UP INSTEAD. Reading the current value '
    + 'back at them answers nothing, and they are waiting for a change that has not been '
    + 'proposed.\n\n'
    + 'Call the tool that makes it, naming the deal you just found. If it comes back pending, '
    + 'say what it would do and wait for them to agree. If the name matches more than one '
    + 'person, ask which one. If you genuinely cannot do it, say so plainly.';
}

module.exports = {
  KEEPS_REVIEW,
  verbSlipped,
  verbSlippedAnywhere,
  isSetInstruction,
  isSetInstructionRecent,
  isSpecialCaseInstruction,
  answeredWithoutWriting,
  correctionFor,
};
