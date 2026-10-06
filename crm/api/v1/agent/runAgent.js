const env = require('../../configs/env');
const logger = require('../../configs/logger');
const { resolveContext, openingTools, HELD_UNTIL_NEEDED } = require('./contexts');
// The admin agreed, so the pending call is re-issued as confirmed. Only
// ever for a change the previous answer already described.
const {
  shouldConfirm, remember, recallAll, forget, completed, alreadyDone, confirmationHeld,
  declined, dropShown, nextTurn, agreed, eitherOrAsked, somethingHeld, onlyHeld, facts, targetNamed,
} = require('./confirmReplay');
// Whether a call wrote, read off its broadcast rather than its wording.
const { watchWrites } = require('../shared/writeTap.helper');
const settingsRepo = require('../repos/settings.repo');
const rowsRepo = require('../repos/masterSheetRows.repo');
const { writeTarget, namedSomeoneElse, refusalFor } = require('./namedOther');
// Auto mode: the closed ALLOW list of confirmations that may be skipped,
// and the one time the admin is asked whether to turn it on.
const { couldSkip, spelledOut, autoConfirmOffer } = require('./autoConfirm');
const { stripMarkdown } = require('./stripMarkdown');
const { noDashes } = require('./noDashes');
const { dealWords } = require('./dealWords');
const { easeOffPetNames } = require('./petNames');
const { AppError } = require('../middlewares/errors');
// Renamed: runAgent's own `messages` array shadowed it, so a failed model call threw a TypeError.
const { messages: copy } = require('../shared/messages');
const { captureLog } = require('../shared/captureLog.helper');
const { checkFigures } = require('./checkFigures');
const { checkMonths } = require('./checkMonths');
const { checkPercents } = require('./checkPercents');
const { checkDays } = require('./checkDays');
const { checkAmbiguity } = require('./checkAmbiguity');
const { checkAgainstCard } = require('./checkAgainstCard');
const { checkCounts, checkCountsByGroup } = require('./checkCounts');
const { checkClaims } = require('./checkClaims');
const { checkQuestion, INSTEAD: QUESTION_INSTEAD } = require('./checkQuestion');
const { checkExportScope } = require('./checkExportScope');
const { unknownArgs, foldIntoSet, foldSearchWord } = require('./knownArgs');
const { cannotYet } = require('./cannotYet');
const { saidAlready } = require('./notTwice');
// Said ABOVE a recomputed block, never instead of it. The figures are the
// answer; this only says they were looked at again.
const LOOKED_AGAIN = 'I ran it again and it has not moved.';
// "we good?", "any issues?", "is everything ok": a question about the sheet's
// health, answered only by looking. Whole message, so "are we good on zayn's
// payable" (a narrower question) is left to her.
const STATUS_ASK = /^\s*(?:so\s+|and\s+|ok\s+)?(?:are\s+)?(?:we\s+(?:all\s+)?good|all\s+good|is\s+everything\s+(?:ok|okay|fine|good|alright)|everything\s+(?:ok|okay|fine|good)|any\s+(?:issues|problems|discrepancies)|anything\s+(?:wrong|off|to\s+fix)|how\s+(?:does|is)\s+(?:the\s+)?(?:sheet|it)\s+look(?:ing)?)\s*[?.!]*\s*$/i;

/**
 * QUESTIONS WITH ONE RIGHT TOOL, routed in code rather than hoped for.
 * The capability suite caught both of these picking the deal filter:
 * "which deals have been stopped" read the live sheet and said none had,
 * and "which companies are in baker" drew deals. 2026-09-30.
 */
const STOPPED_ASK = /\b(?:which|what|who|show|list|any(?:one|body)?)\b[^.?!]*\b(?:stopped|archived|in the archive)\b/i;
const COMPANIES_IN_ASK = /\b(?:which|what|list|show)\b[^.?!]*\bcompanies\b[^.?!]*\b(?:in|on|under)\s+\w/i;
// "give me the payment breakdown for corvid this month by company" was
// answered with nothing drawn in one run of three. A breakdown has one tool,
// whichever month, so the word is the route. 2026-10-03.
const BREAKDOWN_ASK = /\bbreak\s?(?:it |that |this |them )?down\b|\bbreakdown\b/i;
// "list the companies" alone drew a list of DEALS. 2026-10-03. The whole
// message is the ask, so "show me the companies' deals" is not caught.
const COMPANIES_LIST_ASK = /^\s*(?:please\s+)?(?:list|show(?: me)?|give me|what are|which are)\s+(?:all\s+)?(?:the\s+|our\s+)?companies\s*[.?!]*\s*$/i;
// A second request after the first: "... and also what's gab owed?".
// "whos", "who's", "hows many": typed as said. "how many deals in nexus and
// whos owed most there" lost its first half. Clone 2026-10-05.
const SECOND_ASK = /\b(?:and|also|plus|then)\b[^.!?]*\b(?:what'?s?|how'?s? (?:much|many)|who(?:'?s)?|which|show|tell|list|give)\b/i;
// "bring casey test's deal back" went to the deal filter twice. 2026-09-30.
// "actually put pino's nexus deal back" asked a question instead. 2026-10-03.
// A DEAL put back, so "put it back" stays an undo.
// "PUT JUNO BACK ON" too: once answered with no tool and a claim she was back. 2026-10-04.
const RESUME_ASK = /\b(?:resume|reinstate|un-?stop|bring\w* (?:[\w'’-]+ ){0,4}back|put (?:[\w'’-]+ ){0,4}deals? back|put (?:[\w'’-]+ ){1,3}back on\b(?!\s+(?:cash|bank|crypto|paypal|card|\d|£|\$|gbp|usd|aed|eur)))\b/i;
// A YES TO HER OWN "shall I resume it?" is a resume. Live 2026-10-03 she
// answered that yes with "it is back live" and called nothing.
const BARE_YES = /^\s*(?:y|ya|yes|yep|yeah|yup|ok|okay|sure|go ahead|do it|please do)[.!\s]*$/i;
// A DEAL put back, never a value: "put it back to 0%?" is an undo's offer.
const RESUME_OFFERED = /(?:\bresum\w*|\bdeals?\b[^?]*\bback\b)[^?]*\?\s*$/i;
// "no. set drew's fee on capilano associates to 3%" read the rates back
// instead of setting one. A rate set ON a named deal has one door. 2026-09-30.
const DEAL_RATE_SET = /\b(?:set|change|make|put)\b[^.?!]*\b(?:fee|add[\s-]?on)s?\b[^.?!]*\bon\s+(?!top\b)[a-z][^.?!]*\b\d+(?:\.\d+)?\s*(?:%|percent)/i;
// THE SCOPE SAID OUT LOUD: "his deals", "all", "every", "each", "both",
// "everywhere". "deal" alone is one of them, so it is not here.
const EVERY_DEAL = /\b(?:deals|all|every|each|both|everywhere|everything|any\s+deal)\b/i;

/**
 * AN EDIT TO EVERY DEAL IS THE BULK TOOL, on the first round. gpt-4.1
 * sweep 2026-10-06: told "dudcut 200 to zayn deals" she said "I'll show
 * you the change before anything is saved", recorded a claim and stopped,
 * twice, with no preview, so the yes that followed had nothing to apply
 * and she answered it with his total. Instructions alone did not move her;
 * the first round is made to call the tool whose preview IS the question.
 * Not the acts with their own doors: stop, delete, resume, undo, a review
 * answer, a new deal.
 */
// "change kiran", "update zayn pls", "edit otto": a verb, a name, nothing else.
const VAGUE_EDIT = /^\s*(?:(?:hey|hi|ok|okay|diane|pls|please|can you|could you)\b[,\s]*)*(?:change|update|edit|fix|modify|sort out|amend|adjust)\s+(?!all\b|every\b|the\s+\w+\s+(?:to|for)\b)[a-z][a-z' -]{1,40}?\s*(?:pls|please|thanks|thx)?[.!]?\s*$/i;

const LATER_MONTH = /\b(?:next month|from (?:next|the \d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|starting|beginning|as of|come (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|in (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|for the next \d+ months|schedul\w*|park\w*|end of (?:this|the) month)\b/i;

// What another tool owns: a rate, their own details, or ending and undoing.
const OWN_TOOL = /%|\bpercent|\bfees?\b|\badd[\s-]?ons?\b|\brates?\b|post\s*code|\bdoor\b|\bbank\b|\baccount\b|sort\s*code|\bphone\b|postals?\b|\b(?:stop|end|terminate|delete|remove|resume|restart|reopen|undo|revert|roll\s*back|answer|review|rename|close|archive)\b/i;

/**
 * ===============================
 * * EVERY FIELD THEY NAMED IS IN THE CALL, OR NOTHING IS WRITTEN
 * ===============================
 * Clone 2026-10-06: "paddy payable days 28, notes sweep five, label SWEEP5,
 * monthly 13800, payment method bank, mark paid" wrote five and dropped
 * "paid" without a word. Each field they name by its own word must be in
 * the one deal call, as a value or an add.
 */
const NAMED_FIELDS = [
  [['paid', 'overridePaid'], /\bmark(?:ed)?\s+(?:\w+\s+){0,2}(?:as\s+)?(?:un)?paid\b|\b(?:unpaid|not\s+paid)\b/i],
  [['notes'], /\bnotes?\b/i],
  [['label'], /\blabel\b/i],
  [['payableDays'], /\bpayable\s+days\b|\b\d+\s+days\b|\bdays\s+(?:to\s+)?\d/i],
  [['monthlyAmount'], /\bmonthly\b[^,.;?]{0,20}\d/i],
  [['payableAmount'], /\bpayable\s+amount\b[^,.;?]{0,20}\d/i],
  [['paymentMethod'], /\bpayment\s+method\b/i],
  [['currency'], /\bcurrency\b/i],
  [['presetOn'], /\bpreset\b/i],
  [['endOn'], /\bend\s+date\b/i],
  [['assignedOn'], /\bappointment\b/i],
  [['paymentStartOn'], /\bpayment\s+start\b/i],
  [['feePercent', 'feePercentDelta'], /\bfee\b/i],
  [['addonPercent', 'addonPercentDelta'], /\badd[\s-]?on\b/i],
];
function fieldsLeftOut(said, args = {}) {
  const sent = new Set([...Object.keys(args), ...Object.keys(args.add ?? {})]);
  return NAMED_FIELDS.filter(([keys, words]) => words.test(String(said ?? '')) && !keys.some((k) => sent.has(k)))
    .map(([keys]) => keys[0]);
}

/**
 * ===============================
 * * THE LIGHT MODEL FOR THE PLAIN TURNS, THE FULL ONE FOR THE REST
 * ===============================
 * The admin's call 2026-10-06: basic reads and one plain edit on one deal
 * go to the mini model; bulk, several people, rates, dates, scheduling,
 * stopping, undo, new deals, three or more fields, a typo, or an answer to
 * her own question go to the full one. Anything not plainly light is full.
 * AI_MODEL_LIGHT=off keeps every turn on the full model.
 */
const LIGHT_MODEL = (process.env.AI_MODEL_LIGHT ?? 'gpt-4.1-mini').trim();
const RISKY_FIELDS = new Set(['presetOn', 'endOn', 'assignedOn', 'paymentStartOn', 'currency', 'paymentMethod', 'feePercent', 'addonPercent']);
function lightTurn(asked, lastAnswer, { named, routedTool }) {
  const text = String(asked ?? '').trim();
  // A FEW WORDS ARE A FOLLOW UP ("both", "the indigo one"), read off what came before.
  const words = text.split(/\s+/).length;
  if (!text || words > 25 || /\n/.test(text) || (words <= 3 && !/\?\s*$/.test(text))) return false;
  if (/\?\s*$/.test(String(lastAnswer ?? '').trim())) return false;
  if (verbSlippedAnywhere(text) || LATER_MONTH.test(text) || OWN_TOOL.test(text)) return false;
  if (/\b(?:park\w*|schedul\w*|cancel|forecast|project\w*|export)\b/i.test(text)) return false;
  if (!isSetInstruction(text)) return true;
  if (routedTool && routedTool !== 'update_master_sheet_row') return false;
  if (named !== 1 || EVERY_DEAL.test(text)) return false;
  if (/\b(?:new|another|create|open)\b|\badd(?:ing)?\s+(?:a\s+|an\s+)?(?:\w+\s+)?deal\b/i.test(text)) return false;
  const fields = NAMED_FIELDS.filter(([, words]) => words.test(text)).map(([keys]) => keys[0]);
  return fields.length <= 2 && !fields.some((f) => RISKY_FIELDS.has(f));
}

/** JSON with keys sorted at every level, so two spellings of one call compare equal. */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  // "zayn" and "Zayn" are one person to her and to the sheet.
  return JSON.stringify(typeof value === 'string' ? value.trim().toLowerCase() : value);
}

const EVERY_DEAL_EDIT = {
  test: (said) => {
    const text = String(said ?? '');
    return isSetInstruction(text) && EVERY_DEAL.test(text)
      && !/\b(?:stop|end|terminate|delete|remove|resume|restart|reopen|undo|revert|roll\s*back|answer|review\s+answer)\b/i.test(text)
      && !/\badd\s+(?:a|an|another|new)\s+(?:deal|row|company|handler)/i.test(text)
      // A LATER MONTH is parked, one per deal, by the one row tool's `when`:
      // the bulk tool has no `when`, and forced there "add 5% to kiran vale
      // deals next month" went round in circles. 2026-10-06.
      && !LATER_MONTH.test(text)
      && !/\b(?:everyone|everybody|whole sheet|all groups|every group|all the groups)\b/i.test(text);
  },
};

const FORCED_ROUTES = [
  [RESUME_ASK, 'resume_deal'],
  // "JUNO PARK IS DONE WITH US, STOP HER DEAL" is a stop, said in so many
  // words: one run in three it went to the monthly review and nothing
  // stopped. An explicit stop or end of a DEAL is stop_deal. 2026-10-04.
  [/\b(?:stop|end|terminate)\s+(?:(?:her|his|their|the|that)\s+|[a-z]+(?:\s+[a-z]+)?['’]s\s+)?deals?\b(?!\s+(?:list|review|check))/i, 'stop_deal'],
  [DEAL_RATE_SET, 'update_master_sheet_row'],
  [STATUS_ASK, 'audit_master_sheet'],
  [STOPPED_ASK, 'list_stopped_deals'],
  [COMPANIES_IN_ASK, 'list_companies'],
  [COMPANIES_LIST_ASK, 'list_companies'],
  [BREAKDOWN_ASK, 'breakdown_master_sheet'],
  // THE ANSWER TO "WHICH ... SHOULD GET <change>?" is the change, on that
  // deal: "the umbrella one" was a lookup and the 900 was lost. 2026-10-04.
  [{
    test: (said, history = []) => /\bhas \d+ deals\. Which \w+ should get\b/.test(lastAssistantAnswer(history) ?? '')
      && String(said).trim().split(/\s+/).length <= 6 && !/\?\s*$/.test(String(said))
      // "show me zayns deals" is a new ask, not "both". Live 2026-10-06.
      && !NEW_REQUEST.test(String(said)),
  }, 'update_master_sheet_row'],
  // "THE QUICKEARN ONE" after a PROFILE preview narrows it to that deal:
  // it was answered with rates and the question asked again. 2026-10-04.
  [{
    test: (said, history = []) => /\bPROFILE\b/.test(lastAssistantAnswer(history) ?? '')
      && /\?\s*$/.test((lastAssistantAnswer(history) ?? '').trim())
      && /^\s*(?:just |only )?(?:on )?(?:the |his |her |their )?[\w &'-]{2,40}\s+(?:one|deal)\s*(?:only)?[.!]?\s*$/i.test(said),
  }, 'update_master_sheet_row'],
  // "WHO HAS THE MOST DEALS" counts deals per person, never money. 2026-10-04.
  [/\bwho\s+(?:has|holds|have|got)\s+the\s+(?:most|fewest|least)\s+deals\b/i, 'summarize_deals'],
  // "LIST THE GROUPS" is answered in code by the filter; left to her it was
  // met with "all groups, or in a specific context?". 2026-10-04.
  [/^\s*(?:list|show|give)(?: me)?(?: all)?(?: of)?(?: the| our)? groups\s*(?:please|pls)?[.?!]*\s*$|^\s*what groups (?:do we have|are there)\??\s*$/i, 'filter_master_sheet'],
  // "WHO IS IN CORVID" is the people in a group, not its companies. 2026-10-04.
  [/^\s*who(?:'s|s| is| are)\s+in\s+[a-z][\w &'-]{1,30}\s*\??\s*$/i, 'filter_master_sheet'],
  // THE ANSWER TO HER "TO ADD X I STILL NEED ..." goes back to add_deal,
  // however messy it is. 2026-10-04.
  [{
    test: (said, history = []) => /^To add .+ I still need\b|(?:is not a group on the sheet\. )?Which group is it/.test(lastAssistantAnswer(history) ?? '')
      && !/\?\s*$/.test(String(said)) && !CALLED_OFF_ADD.test(String(said)) && !NEW_REQUEST.test(String(said)),
  }, 'add_deal'],
  // AND A SHORT CORRECTION WHILE THE NEW DEAL IS SHOWN for a yes ("actually
  // make it corvid") is the same add, changed. 2026-10-04.
  [{
    // OR THE PREVIEW'S OWN DEAL LINE, however she worded around it ("here
    // is the deal as it will be added"): LA suite 2026-10-05.
    test: (said, history = []) => /\bas a new deal\b|\bnew deal\b|\b(?:ready )?to add\b|\bthe deal (?:for|to add)\b|\bwill be added\b|·[^\n]*\ba month\b[^\n]*·\s*appointed\b/i.test(lastAssistantAnswer(history) ?? '')
      && /^\s*(?:(?:actually|no|sorry|wait|oh|oops)[\s,]+)*(?:make it|change it to|it'?s|its|should be|put (?:her|him|them) in|not\b)/i.test(said),
  }, 'add_deal'],
  // "ADD A DEAL" / "NEW DEAL FOR X" starts it, in words. 2026-10-04.
  [/^\s*(?:(?:can you|please|pls|ok|okay)\s+)?(?:add|create|put in|set up)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:deal|handler|row|person)\b|\bnew deal for\b/i, 'add_deal'],
  // "DID JASON'S RAISE GO THROUGH?" is answered from what the runner did. 2026-10-04.
  [/\b(?:did|has|have)\b[^.?!]*\b(?:go(?:ne)? through|run|ran|appl(?:y|ied)|happen(?:ed)?|kick(?:ed)? in)\b/i, 'list_parked_work'],
  // "WHO'S PAID IN EUROS" names them: it came back as a total with no
  // names. The filter lists who; a total can follow. 2026-10-04.
  [/^\s*who(?:'s|s| is| are| gets?)\s+paid\s+(?:in|by|with|via)\b/i, 'filter_master_sheet'],
  // "PAY JOHNATHON BY BANK" IS A CHANGE to one person's method. It was
  // read as "who is paid by cash" and drew 32 INDIGO deals. Clone 2026-10-05.
  [/^\s*(?:(?:actually|ok(?:ay)?|so|now|and)[\s,]+)*(?:pay|put|switch|move|change)\s+(?!(?:every|all|everyone|everybody)\b)[a-z][\w' -]{1,40}?\s+(?:by|to|on(?:to)?|in|via)\s+(?:cash|bank|crypto|paypal)\b/i, 'update_master_sheet_row'],
  // "WHAT'S WRONG WITH LIAM'S DATES" is that person's sheet check. 2026-10-04.
  [/\b(?:what'?s|what is|whats)\s+(?:wrong|up|the (?:issue|problem))\s+with\b|\bwhy (?:is|are)\s+[\w' ]+\s+flagged\b/i, 'audit_master_sheet'],
  // "WHAT'S NATHAN ON" is what they are paid, deal by deal: twice it was
  // answered with their add on and fee rates. 2026-10-04.
  [/^\s*what(?:'s|s| is)\s+(?!the\b|it\b|that\b|this\b)[a-z][\w' -]{1,40}?\s+on\s*\??\s*$/i, 'find_and_show_details'],
  // "WHAT GROUP IS NATHAN IN" is that person's field: sent to the filter it
  // searched every column, matched KJ too and said "2 people". 2026-10-05.
  [/^\s*(?:what|which)\s+(?:groups?|compan(?:y|ies))\s+(?:is|are|does)\s+(?!(?:the|it|that|this|everyone|everybody)\b)[a-z][\w' -]{1,40}?\s+(?:in|on|at|with|work (?:at|for)|belong to)\s*\??\s*$/i, 'find_and_show_details'],
  // "IS BYRON IN NEXUS?" is a yes or no about one person. 2026-10-04.
  [/^\s*(?:is|are)\s+(?!(?:anyone|anybody|there|it|that|this|everyone|everybody|someone|somebody|he|she|they|we|i)\b)[a-z][\w' -]{1,40}?\s+(?:in|at|on|with|part of)\s+[a-z][\w &'-]{1,40}\?*\s*$/i, 'find_and_show_details'],
  // "WHICH COMPANY HAS THE MOST DEALS" is a count by name, never the sheet
  // audit (2 runs in 3 answered "58 things to look at"). 2026-10-04.
  [/\bwhich\s+(?:company|companies|group|groups|role|person|one)\b[^.?!]*\b(?:most|fewest|least|biggest|smallest)\b[^.?!]*\b(?:deals?|people)\b/i, 'filter_master_sheet'],
  // CONVERSATION HISTORY: deleting it, and seeing one word for word. 2026-10-04.
  [/\b(?:delete|remove|erase|forget|wipe|purge|clear|clean(?:\s+up)?)\b[^.?!]*\b(?:conversations?|chats?|chat history|history|transcripts?)\b/i, 'delete_past_conversations'],
  [/\b(?:show|open|read|give)\b[^.?!]*\b(?:conversation|chat|transcript)\b(?![^.?!]*\b(?:delete|forget|wipe)\b)|\bwhat (?:exactly )?did I (?:say|type|write)\b|\bword for word\b/i, 'show_past_conversation'],
  // AGGREGATES go to the general read: averages, and counts PER someone.
  [/\b(?:average|avg|mean|median)\b|\b(?:more than|at least|over)\s+(?:one|two|three|\d+)\s+deals?\b|\b(?:several|multiple)\s+deals\b|\b(?:per|at each|in each|for each|each)\s+(?:person|company|group|role)\b/i, 'summarize_deals'],
  [{ test: (said, history = []) => Boolean(changeAgain(said, history)) }, 'update_master_sheet_row'],
  // A RATE ABOUT A CURRENCY is the exchange rate, not an add on or a fee.
  [/\b(?:exchange|conversion|fx)\b|\brates?\b[^.?!]*\b(?:dirhams?|aed|pounds?|gbp|sterling|euros?|eur|dollars?|usd)\b|\b(?:dirhams?|aed|pounds?|gbp|euros?|eur|dollars?|usd)\b[^.?!]*\brates?\b/i, 'exchange_rate'],
  // "lowest monthly in corvid", "smallest deal": ordering DEALS. See sortBy.
  [{ test: (said) => /\b(?:lowest|smallest|cheapest|highest|biggest|largest|earliest|latest)\b/i.test(said)
    && /\b(?:deals?|monthly|payable)\b/i.test(said) && !/\b(?:owed|earners?|people)\b/i.test(said) }, 'filter_master_sheet'],
  // "actually cancel the gloria one" had no door at all. See cancel_parked_work.
  [/\b(?:cancel|scrap|call off|drop|don'?t do|do not do)\b[^.?!]*\b(?:scheduled|parked|planned|the \w+(?: \w+)? one|for (?:next month|january|february|march|april|may|june|july|august|september|october|november|december))\b/i, 'cancel_parked_work'],
  // A REVIEW ANSWER for a set: "the two at kryptonia are final this month" was
  // previewed in her own words, nothing was held, and the yes saved nothing
  // while she said it was answered. The tool previews it itself. 2026-10-03.
  [/\b(?:are|is|mark\w*|answer\w*|set)\b[^.?!]*\b(?:final(?: month| this month)?|yes|no)\b[^.?!]*\b(?:review|this month|for (?:october|november|december|january|february|march|april|may|june|july|august|september))\b|\breviews?\b[^.?!]*\b(?:as|to) (?:yes|no|final)\b|\b(?:are|is) final\b/i, 'bulk_answer_monthly_review'],
  // "close brightwell and quarryy lanez" was looked up rather than closed, one
  // run in three. A company close is one door; a DEAL is stop_deal. 2026-10-03.
  // "ACTUALLY CLOSE IT AT THE END OF NEXT MONTH INSTEAD" is a close too: with
  // "actually" in front it was taken as a cancel, and the new date was lost.
  [/^\s*(?:(?:ok|okay|actually|no|wait|sorry|please|can you|then)[\s,]+)*(?:close|shut(?:\s+down)?|dissolve|wind up)\b(?![^.?!]*\bdeals?\b)/i, 'bulk_close_companies'],
  // "reopen relia pa" listed the company and reopened nothing. 2026-10-03.
  [/^\s*(?:ok\s+|okay\s+|please\s+|can you\s+)?(?:reopen|re-open|unclose)\b/i, 'bulk_close_companies'],
  // A PERSON'S DETAIL is looked up every time, never recalled. 2026-10-03.
  [/\b(?:what'?s|what is|whats|give me|tell me|send me|do (?:we|you) have|have (?:we|you) got|is there|got)\b[^.?!]*\b(?:phone(?: number)?|mobile|post ?code|sort code|account number|bank details|(?:a|the|his|her|their) number)\b/i, 'find_and_show_details'],
  // "Who is owed the most" is a ranking: see rankAskedIn. 2026-10-03.
  [{ test: (said) => Boolean(rankAskedIn(said)) }, 'total_master_sheet'],
  [EVERY_DEAL_EDIT, 'bulk_update_master_sheet'],
];

// The read-only narrowing below. Off: see where it is used.
const NARROW_READ_TURNS = false;

// Words that ask to SEE a deal, which is the only time a card is drawn.
const CARD_ASKED = /\b(?:show|display|details?|card|cards|open|full|pull (?:up|out)|view|let me see|bring up|look at)\b/i;

// THE READ TOOLS a plain question is handed. Anything else is one call away
// through MORE_TOOLS. See "A PLAIN QUESTION GETS THE READ TOOLS ONLY".
const READ_TOOLS = new Set([
  'filter_master_sheet', 'find_and_show_details', 'get_master_sheet_row_details', 'total_master_sheet',
  'breakdown_master_sheet', 'compare_months', 'audit_master_sheet', 'explain_preset_rules',
  'check_rates', 'exchange_rate', 'recent_master_sheet_changes', 'list_stopped_deals',
  'list_dead_people', 'dead_person_details', 'list_monthly_review', 'list_companies',
  'active_companies', 'list_parked_work', 'recall_past_conversations', 'show_past_conversation',
  'say', 'state_claims',
]);
const MORE_TOOLS = Object.freeze({
  type: 'function',
  function: {
    name: 'more_tools',
    description: 'You were handed the READING tools only, because this looked like a question. Call '
      + 'this first if answering needs anything else: a change, a stop, scheduling, a company action, '
      + 'adding a deal, a review answer, deleting history, an average or a per-group figure. It hands '
      + 'you every tool. Never tell them you cannot do something without calling this.',
    parameters: { type: 'object', properties: {} },
  },
});
// Change wording: a message holding one of these is never narrowed.
const WRITE_WORDS = /\b(?:add|set|change|update|make|put|give|move|stop|end|resume|close|reopen|delete|remove|undo|revert|cancel|scrap|park|schedule|raise|bump|lower|cut|knock|mark|rename|answer|final|forget|wipe|clean|bring|instead|should be|needs to be|average|per|each|most deals)\b/i;

// What a held tool is for, in their words: see contexts.js HELD_UNTIL_NEEDED.
const ASKS_FOR_HELD = /\b(?:delete|deleting|erase|undo|revert|reverse|take (?:that|it) back|rename|close|closing|all|every|everyone|everybody|bulk|whole|each|average|avg|mean|median|per|costing|most deals|fewest deals|forget|wipe|purge|clean(?:\s+up)?|(?:more than|at least|over|several|multiple)\s+(?:\w+\s+)?deals?)\b/i;

// "the second one", "2nd", "the last one": a whole message picking from a list.
const ORDINALS = Object.freeze({
  first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, fifth: 4, '5th': 4, last: -1,
});
const ORDINAL_REPLY = /^\s*(?:the\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)(?:\s+(?:one|deal|row))?\s*[.!]?\s*$/i;
/**
 * ===============================
 * * "ACTUALLY MAKE IT 1000": THE CHANGE JUST MADE, CHANGED AGAIN
 * ===============================
 * Live 2026-10-04 (held-out wording): after "make silas moor's monthly 950"
 * was done, "actually make it 1000" looked Silas up and changed nothing. The
 * change she just reported is in her last answer, in the fixed words the
 * update tool builds ("X at Y in G updated. Monthly amount 950, ..."), so
 * "it" is read off that and the same deal and field get the new value.
 */
const CHANGE_AGAIN = /^\s*(?:(?:actually|no|nah|sorry|wait|oh|hmm|ok|okay)[,!.\s]+)*(?:make|set|change|put|bump|drop)\s+(?:it|that|this|them)\s+(?:to\s+|at\s+|up to\s+|down to\s+)?(?:£|gbp\s*|aed\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:instead|then|please)?[.!]*\s*$/i;
const UPDATED_FIELD = { 'Monthly amount': 'monthlyAmount', 'Payable amount': 'payableAmount', 'Payable days': 'payableDays', 'Fee %': 'feePercent', 'Add on %': 'addonPercent' };
function changeAgain(said, history) {
  const m = CHANGE_AGAIN.exec(String(said ?? ''));
  if (!m) return null;
  const last = lastAssistantAnswer(history);
  const w = /^(.+?) at (.+?)(?: in ([^.]+?))? updated\. (Monthly amount|Payable amount|Payable days|Fee %|Add on %)\b/.exec(String(last ?? ''));
  if (!w) return null;
  return {
    targetPerson: w[1], targetCompany: w[2], ...(w[3] ? { targetGroup: w[3] } : {}),
    field: UPDATED_FIELD[w[4]], value: Number(m[1].replace(/,/g, '')),
  };
}
// "NO FORGET IT" after "To add X I still need ..." calls the add off: it
// was sent back to add_deal, which answered "it has not moved". 2026-10-04.
// A DIFFERENT REQUEST ends the new deal questions. "delete sweep tester deal"
// was answered "Which group is it?" twice. Clone 2026-10-06.
const NEW_REQUEST = /^\s*(?:delete|remove|stop|end|undo|revert|show|list|how|what|who|why|set|change|update|raise|deduct|mark|give|cancel|from next)\b/i;
const CALLED_OFF_ADD = /^\s*(?:no|nah|nope|cancel|stop|scrap|forget|never ?mind|leave it|don'?t)\b|\bforget (?:it|about it)\b|\bdon'?t add\b/i;
const ORDINAL_IN_SENTENCE = /\bthe\s+(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+(?:one|person|deal|row|guy|lady)\b/i;

// "undo that", "revert it", "take that back": the whole message asks for the undo.
const UNDO_ASKED = /^\s*(?:ok\s+|please\s+|can you\s+)?(?:undo|revert|reverse|take (?:that|it) back|put (?:that|it) back)\b(?!.*\b(?:and|then)\b)/i;
// "undo that" re-sent the last CHANGE twice and then claimed the fee was
// "already 3%". An undo has one door. 2026-09-30.
FORCED_ROUTES.unshift([UNDO_ASKED, 'undo_master_sheet_change']);
// AND IN THEIR OWN WORDS: "actually scrap that", "cancel the change you just
// made to abe". A pattern object, so it sits in the same list. See undoIntent.js.
// NOT RIGHT AFTER A QUESTION: "cancel it" under "shall I set it?" is a no
// to the proposal, never an undo of an earlier change.
FORCED_ROUTES.unshift([{
  test: (said, history = []) => asksUndoPlainly(said) && !/\?\s*$/.test(lastAssistantAnswer(history).trim()),
}, 'undo_master_sheet_change']);
/**
 * ===============================
 * * "CANCEL THAT" RIGHT AFTER SCHEDULING IS THE SCHEDULED WORK
 * ===============================
 * Clone, 2026-10-04: "close whitestone swan at the end of this month",
 * yes, then "actually dont close it, cancel that". It went to the UNDO,
 * which reverted two review answers from 16 hours before, in another
 * conversation, while the closure stayed parked. Her last answer said
 * something was parked or scheduled, so "that" is the parked work.
 * First in line, ahead of both undo routes.
 */
const PARKED_JUST_NOW = /\b(?:parked|scheduled|will (?:close|apply|change|stop|go)\b[^.]*\b(?:on|from|in) (?:1 )?(?:january|february|march|april|may|june|july|august|september|october|november|december)|nothing has changed yet)\b/i;
const CALL_OFF = /\b(?:cancel|scrap|undo|revert|forget|drop|call (?:it|that) off|don'?t (?:close|do|change|apply)|never ?mind|take (?:that|it) back)\b/i;
FORCED_ROUTES.unshift([{
  test: (said, history = []) => CALL_OFF.test(said) && !/\binstead\b/i.test(said)
    && PARKED_JUST_NOW.test(lastAssistantAnswer(history) ?? '')
    && !/\?\s*$/.test((lastAssistantAnswer(history) ?? '').trim()),
}, 'cancel_parked_work']);
/**
 * AND "MAKE IT 1250 FROM DECEMBER INSTEAD" CHANGES THE SCHEDULED WORK. In the
 * browser on the clone, 2026-10-04, it was offered as a cancel only: the
 * new amount and month were lost. A new figure or month said after her
 * answer about scheduled work is the same change again, re-dated; the park
 * that follows replaces the old one ("instead").
 */
const RESCHEDULE = /\b(?:make it|change it to|instead|move it|push it)\b/i;
const NEW_FIGURE_OR_MONTH = new RegExp(`\\b\\d[\\d,.]*\\b|\\b${require('../shared/when.helper').MONTH_WORD}\\b|\\bnext month\\b`, 'i');
const reschedules = (said, history = []) => RESCHEDULE.test(said) && NEW_FIGURE_OR_MONTH.test(said)
  && PARKED_JUST_NOW.test(lastAssistantAnswer(history) ?? '') && !/\bclose|closure|reopen\b/i.test(said);
FORCED_ROUTES.unshift([{ test: reschedules }, 'update_master_sheet_row']);
const {
  drawnAlready, SAY_IT_INSTEAD, signature: listSignature,
} = require('./notTwice.list');
const { unseenCards } = require('./unseenCards');
const { interimHolds, workBesideInterim } = require('./interimLine');
const { shouldRouteWriteToBulk } = require('./writeIntent');
// A rule question answered with a total. See askShapes.js.
const { asksForRule, asksRateCheck } = require('./askShapes');
// A line she dropped from a confirmation list is agreement to something
// never shown. The tool asked her to relay it; that was a sentence.
const { checkRelayed } = require('./checkRelayed');
const { checkVerdict, verdictsIn, withVerdict } = require('./checkVerdict');
const { claimedWrite, claimedStop } = require('./checkClaimedWrite');
const { answeredFromMemory } = require('./checkEmptyClaim');
// "Shall I?" with nothing pending. See checkUnbackedAsk.js.
const { unbackedAsk } = require('./checkUnbackedAsk');
const { checkRateDirection } = require('./checkRateDirection');
// A turned off tool hands back a pointer to a real button. That she says
// it is a sentence, so it is checked.
const { checkPointed, DISABLED } = require('./disabledTools');
const { bypassAttempt, BYPASS_REPLY } = require('./blockBypass');
const { asksUndoPlainly } = require('./undoIntent');
const { fold, personMentionedIn, within, oneTypo } = require('./tools/resolvePerson');
const { parseEdit, callFor, followUp } = require('./directEdit');
const { looksMultiStep, pendingPlan } = require('./engine/planSteps');
const { route: routeMessage, asEdit } = require('./engine/router');
const { planTurn, sheetTurn } = require('./engine/runPlan');
const { looksLikeSheet } = require('./engine/sheetCheck');
const { PROMPT_PLACEHOLDERS } = require('./promptPlaceholders');
const { rankAskedIn } = require('./tools/masterSheet');
// A tool's own orders, read out to the admin. See checkLeak.js.
const { checkLeak } = require('./checkLeak');
const {
  answeredWithoutWriting, correctionFor, isSetInstruction, verbSlipped, verbSlippedAnywhere, KEEPS_REVIEW,
} = require('./setIntent');

/**
 * Diane's turn loop — workspace-agnostic on purpose.
 *
 * This file knows nothing about master sheets or deals. It asks for
 * a context, gets back a prompt and a tool list, and runs the loop. All
 * the workspace-specific knowledge lives in contexts.js and the files it
 * points at, so a new workspace never means editing this.
 *
 * Shape deliberately mirrors whatbot's agent/askModel.js: ask the model,
 * run whatever tools it asks for, feed the results back, repeat until it
 * stops asking for tools. Not shared code — separate deployments.
 */

const { getClient } = require('./chatClient');
const { screenReading } = require('./screenReading');
const { noteAiFailure } = require('./aiStatus');
const { PARKABLE } = require('./scheduled/parkable');
const { resolveWhen, saysLater, whenIn } = require('../shared/when.helper');
const { dealIdFor } = require('./tools/parkForMonth');

// A request naming two people ("update Deividas and Georgina...") needs a
// search + an update per person plus a final wrap-up round — 5 rounds
// minimum for just two names. 4 was too tight and cut real multi-person
// requests off mid-way; this leaves headroom for three or four names in
// one ask without being unbounded.
const MAX_TOOL_ROUNDS = 10;

/**
 * The output budget per call, and why it's this number.
 *
 * With no cap at all, one reply once degenerated into the same filler
 * sentence repeated 50+ times — a known small-model failure. 220 fixed
 * that and broke the opposite way, squeezing a genuinely detailed answer
 * down to bare names. `frequency_penalty` is what actually guards the
 * repetition; this is only a backstop.
 *
 * It can't be generous either, though: Groq counts input PLUS max_tokens
 * as the REQUESTED total against the daily allowance, so a large cap
 * charges for headroom it never uses. A real 429 read "Requested 6346"
 * for a one-line question.
 *
 * And the current model (openai/gpt-oss-120b) REASONS before it answers,
 * with those tokens counted here too — measured at ~30-50 for a trivial
 * reply and more for real work. Set this too low and the content comes
 * back completely empty with finish_reason "length", which the admin sees
 * as "I didn't catch that". Hence the retry below rather than a bigger
 * cap on every call: pay for the headroom only when it's actually needed.
 */
const MAX_TOKENS = 1200;
/**
 * Room for the LONGEST HONEST ANSWER she has, which is the recent-changes
 * relay: forty rows, each a heading plus its field diffs, verbatim and with
 * every date written out. 3,000 covered about half of that, so the retry
 * fixed the empty-reply case and still truncated the long one.
 *
 * Paid only on a retry, and only once per turn.
 */
const RETRY_MAX_TOKENS = 8000;

/**
 * Let every OPTIONAL parameter also be null.
 *
 * Real failure this fixes, reproduced exactly:
 *
 *   400 tool_use_failed
 *   search_master_sheet: `/groupName`: expected string, but got null
 *   failed_generation: {"q":"Zane","groupName":null}
 *
 * Models routinely fill an optional parameter with `null` to mean "not
 * setting this", which is a perfectly reasonable reading of an optional
 * field. Groq validates tool arguments against the schema BEFORE running
 * anything and rejects it outright, so the whole turn 400s and the admin
 * sees "my head went fuzzy" for a request that was never wrong.
 *
 * Widening the type is the right fix rather than telling the model in the
 * prompt not to do it: prompts are advice, schemas are enforced, and this
 * failure is invisible until it happens. Required parameters are left
 * strict — null there IS a mistake and should still be caught. Handlers
 * already treat null and undefined identically (`args.x ?? default`), so
 * nothing downstream changes.
 */
function allowNullOnOptional(parameters) {
  const properties = parameters?.properties;
  if (!properties) return parameters;

  const required = new Set(parameters.required ?? []);
  const widened = {};

  for (const [name, schema] of Object.entries(properties)) {
    if (required.has(name) || !schema?.type || Array.isArray(schema.type)) {
      widened[name] = schema;
      continue;
    }
    widened[name] = { ...schema, type: [schema.type, 'null'] };
  }

  return { ...parameters, properties: widened };
}

function toOpenAITools(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: allowNullOnOptional(t.parameters),
    },
  }));
}

/**
 * THE LIVE PANEL, from the transcript rather than from the model.
 *
 * The export panel is client state: they tick a column and nothing tells
 * the server. Asked to hide three columns she therefore had no idea what
 * the other twenty were, said she had done it, called no tool at all, and
 * the screen did not move.
 *
 * The client commits the panel to history and keeps that entry in step with
 * what is on screen, so the newest one IS the current state. Injected, not
 * a parameter: the model must never retype a draft it could get wrong, and
 * it would cost a paragraph of tokens on every round to let it.
 */
/**
 * Did the ADMIN just ask for the panel to be paused or dropped?
 *
 * Deliberately their words, not hers. Whether she then claimed to have
 * done it is beside the point: what matters is that they asked and the
 * screen must move.
 */
const PANEL_ACT = /\b(pause|park|hold on|not now|later|forget it|cancel|never mind|drop (it|the export|that))\b/i;

/**
 * An EDIT to the open card: a column out or back, a colour, a design.
 *
 * Live transcript: "drop the sort code" got "I have unchecked the sort code
 * column" with no tool call at all, and the card still showed eight. The
 * same fault as claiming to pause, on the field an admin is most likely to
 * check afterwards.
 */
const PANEL_EDIT = /\b(drop|remove|uncheck|hide|take out|delete|add|put back|include|show|use|set|change|switch|make it|pick|choose|keep|go with)\b/i;
const PANEL_THING = /\b(column|sort code|account|postcode|phone|address|door|postal|name|amount|colour|color|breakdown|standard|converted|blue|green|gold|maroon|orange|grey|gray|zip|one file|per group)\b/i;

/**
 * COMING BACK TO IT IS A TOOL CALL TOO.
 *
 * "Back to the sheet" got "welcome back, it is ready and waiting" with no
 * call at all, so the card stayed PAUSED while she said it was open.
 */
const PANEL_RESUME = /\b(carry on|back to (the|it|that)|resume|continue|the sheet|unpause|pick (it|that) back up)\b/i;

/**
 * Opening an export is a side effect on the screen, so a reporting noun is
 * not enough. "The MANBAT August breakdown" used to open the export card
 * because the model associated breakdown with an export template. The
 * user must explicitly ask to export, download, build or generate a file.
 */
const EXPLICIT_EXPORT = /\b(?:export|download)\b|\b(?:build|generate|create|make)\b.{0,30}\b(?:sheet|workbook|file|export)\b|\b(?:sheet|workbook|file)\b.{0,30}\b(?:export|download)\b/i;
const REPORTING_BREAKDOWN = /\b(?:breakdown|total|owed?|owing|how much|bank|cash|crypto|UK send|last month|forecast)\b/i;
// The words that ANSWER "which sheet?". One definition: the pending-intent
// check below and the step answers in exportContinuation both read it.
const SHEET_ANSWER = /\b(master sheet|sheet for (?:a|the) month|month sheet|bank|cash|expensing|division)\b/i;

/**
 * The sentence with the panel's OWN sheet type taken out of it.
 *
 * Only the type already chosen, and only where the panel is asking a
 * follow up question. Removing more would start waving real reporting
 * questions through as export answers.
 */
function withoutChosenSheet(said, draft) {
  const chosen = String(draft?.template ?? '').trim();
  if (!chosen) return said;
  // `bank`, and `master-sheet` as the two words an admin actually says.
  const words = chosen.split(/[^a-z0-9]+/i).filter((word) => word.length > 2);
  if (words.length === 0) return said;
  return said.replace(new RegExp(`\\b(?:${words.join('|')})\\b`, 'gi'), ' ');
}

function explicitExportRequest(said) {
  return EXPLICIT_EXPORT.test(String(said ?? ''));
}

function exportContinuation(history = []) {
  const draft = openPanel(history);
  if (!draft) return false;
  const said = String(saidLast(history)).trim();

  if (PANEL_ACT.test(said) || PANEL_RESUME.test(said)) return true;
  if (PANEL_EDIT.test(said) && PANEL_THING.test(said)) return true;
  if (answersCurrentPanelStep(history)) return true;

  // Short answers to the visible current step are legitimate even though
  // they do not repeat "export": "green", "standard", "one file", a
  // group name, "yes", or "build it".
  // eslint-disable-next-line global-require
  const { stagesFor } = require('./exportStages');
  const next = stagesFor(draft, draft.answered ?? []).next;
  if (!next || said.length > 120) return false;
  // ===============================
  // * THE SHEET THEY ALREADY CHOSE IS NOT EVIDENCE OF A REPORT
  // ===============================
  // "Give me the bank sheet for Nexus, please" was blocked here, because
  // REPORTING_BREAKDOWN carries the bare word `bank`. The panel never
  // rescoped, and the file built and handed over two turns later was every
  // group's 21 bank rows, described to the admin as NEXUS's 2.
  //
  // The word belongs in that list: it stops "how much bank do we have"
  // opening a card. But with a BANK panel already open and waiting for a
  // group, `bank` is the admin repeating the type they just picked. So the
  // chosen sheet is removed before the sentence is judged, and nothing else
  // is: "how much bank do we have" still reads as a report, because
  // `how much` survives the removal.
  if (next === 'groups') return !REPORTING_BREAKDOWN.test(withoutChosenSheet(said, draft));
  const answers = {
    sheet: SHEET_ANSWER,
    breakdown: /\b(none|no breakdown|standard|converted|usd|table)\b/i,
    colour: /\b(green|blue|gold|maroon|orange|grey|gray|red|purple|#[0-9a-f]{3,8})\b/i,
    delivery: /\b(one file|workbook|zip|separate|per group|tabs?)\b/i,
    columns: /\b(yes|done|keep|build it|all columns|these columns)\b/i,
  };
  return Boolean(answers[next]?.test(said));
}

/**
 * ===============================
 * * INTENT OUTLIVES THE TURN THAT CARRIED IT
 * ===============================
 *
 * "lets do an export" is explicit intent, and it granted permission for
 * exactly ONE turn. She spent that turn asking "which sheet would you
 * like?" in prose without calling the tool, so the panel never opened. The
 * next turn said "bank sheet", which carries no export word and has no
 * panel to continue, so it was refused. So was every turn after it: six in
 * a row, while she narrated a panel that did not exist.
 *
 * `exportContinuation` cannot help, because it needs an open panel and the
 * whole problem is that there is not one yet. So the intent is remembered
 * for the couple of turns it takes her to actually open the thing.
 *
 * STILL NARROW. It only fires with NO panel open, on a short sentence that
 * names a sheet, and only when what is left after removing that name is not
 * a reporting question. "bank sheet" opens the panel; "how much bank do we
 * have" does not, because `how much` survives the removal.
 */
function exportIntentPending(history = []) {
  if (openPanel(history)) return false;
  const said = String(saidLast(history)).trim();
  if (!said || said.length > 120) return false;
  if (!EXPLICIT_EXPORT.test(recentSaid(history))) return false;
  if (!SHEET_ANSWER.test(said)) return false;
  return !REPORTING_BREAKDOWN.test(said.replace(SHEET_ANSWER, ' '));
}

function exportToolAllowed(history = []) {
  const said = saidLast(history);
  return explicitExportRequest(said) || exportContinuation(history) || exportIntentPending(history);
}

/**
 * One reporting question is one deterministic breakdown call.
 *
 * The model sometimes fans five named groups into five calls even though
 * this tool accepts `groups`. Coalesce that choice below the model layer.
 * Original call ids are retained so the assistant/tool sequence remains
 * valid if a later round is ever needed.
 */
function coalesceBreakdownCalls(calls = []) {
  const matches = calls.filter((call) => call?.function?.name === 'breakdown_master_sheet');
  if (matches.length < 2) return calls;

  const merged = { months: [], groups: [], paymentMethods: [] };
  for (const call of matches) {
    let args = {};
    try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
    merged.months.push(...[args.month, ...(Array.isArray(args.months) ? args.months : [])].filter(Boolean));
    merged.groups.push(...[args.group, ...(Array.isArray(args.groups) ? args.groups : [])].filter(Boolean));
    merged.paymentMethods.push(...[
      args.paymentMethod, ...(Array.isArray(args.paymentMethods) ? args.paymentMethods : []),
    ].filter(Boolean));
    if (args.allGroups) merged.allGroups = true;
  }
  for (const key of ['months', 'groups', 'paymentMethods']) merged[key] = [...new Set(merged[key])];

  const first = {
    ...matches[0],
    function: { ...matches[0].function, arguments: JSON.stringify(merged) },
    combinedToolCallIds: matches.slice(1).map((call) => call.id),
  };
  let inserted = false;
  return calls.flatMap((call) => {
    if (call?.function?.name !== 'breakdown_master_sheet') return [call];
    if (inserted) return [];
    inserted = true;
    return [first];
  });
}

/**
 * SHE SAID THE PANEL CHANGED. Did anything actually change?
 *
 * The verb list will always miss something: it missed "use the Standard
 * breakdown", which read as a request rather than an edit. So her own words
 * are checked as well. If she claims the card now holds a value and no
 * export tool ran this turn, nothing on their screen moved.
 *
 * Deliberately about the PANEL, never about the data: "Gloria is owed
 * 2,000" is a figure, not a claim about the card.
 */
// WRITTEN AS LITERALS. The first attempt built these with `new RegExp` out
// of escaped strings and matched NOTHING, silently: a guard that is always
// false looks exactly like a guard that never needs to fire.
const CLAIMED_PANEL = [
  // "the breakdown is set to Standard", "the sheet is ready and waiting"
  /(breakdown|colou?r|columns?|delivery|sheet|export|panel|design).{0,40}\b(is|are|now|to)\b.{0,40}\b(set|changed|updated|selected|chosen|hidden|included|paused|cancelled|ready|waiting)\b/i,
  // "changed the breakdown to Standard", "I have hidden the sort code column"
  /\b(changed|switched|set|updated|hid|hidden|removed|added|restored)\b.{0,40}\b(breakdown|colou?r|column|delivery|template|sheet)\b/i,
  // "now uses the Standard breakdown"
  /\bnow (uses|has|shows|includes)\b.{0,30}\b(breakdown|colou?r|column|design)\b/i,
  /**
   * ===============================
   * * CLAIMING THE FILE IS BEING BUILT
   * ===============================
   * Everything above catches a claim that a SETTING moved. Nothing caught
   * a claim that the file itself is on its way, which is the one that
   * costs most: the admin stops and waits for a download.
   *
   * Live transcript 2026-09-06: "go export it" got "Building and exporting
   * the Nexus bank sheet now, sweetie!" with no tool call, and her own
   * export reminder contradicted her two lines later with "3 of 5 settled
   * and I still need the breakdown".
   *
   * `now` or `for you` is required so an explanation survives: "building
   * the sheet needs a breakdown first" is not a claim that it is building.
   * An OFFER survives too, because "shall I build it" has no gerund.
   */
  /\b(building|generating|creating|exporting|preparing|downloading)\b[^.?!]{0,60}\b(sheet|file|workbook|export)\b[^.?!]{0,20}\b(now|for you)\b/i,
  /\b(your|the)\s+(file|export|sheet|workbook)\b[^.?!]{0,30}\b(is|are)\b[^.?!]{0,20}\b(downloading|building|on its way|being built)\b/i,
];

const claimedPanel = (text) => CLAIMED_PANEL.some((r) => r.test(String(text ?? '')));

/**
 * A short answer to the card is still an instruction to change the card.
 * "All of them" contains no edit verb or field name, so the general panel
 * detector cannot see it. At the Groups step its meaning is unambiguous.
 */
function answersCurrentPanelStep(history = []) {
  const draft = openPanel(history);
  if (!draft) return false;
  // eslint-disable-next-line global-require
  const { stagesFor } = require('./exportStages');
  const next = stagesFor(draft, draft.answered ?? []).next;
  const said = String(saidLast(history)).trim();

  return next === 'groups'
    && /^(?:all(?: of them| groups?)?|every(?:one| group)?|the whole sheet)(?: please)?[.!?]*$/i.test(said);
}

/**
 * The tool result owns the order. If Diane asks about a later field, retry
 * before the reply reaches the admin. This is deliberately about questions,
 * not mentions: "All groups are set. Which breakdown?" is still correct.
 */
const EXPORT_QUESTION = Object.freeze({
  sheet: /\b(?:which|what)\b.{0,24}\b(?:shape|sheet|template)\b/i,
  groups: /\b(?:which|what)\b.{0,24}\bgroups?\b/i,
  breakdown: /\b(?:which|what)\b.{0,24}\b(?:breakdown|design)\b/i,
  colour: /\b(?:which|what)\b.{0,24}\b(?:colou?r|palette)\b/i,
  delivery: /\b(?:which|what|how)\b.{0,30}\b(?:delivery|file|workbook|zip|tabs?)\b/i,
  columns: /\b(?:which|what|any)\b.{0,24}\bcolumns?\b/i,
});

function asksWrongExportStep(reply, session) {
  if (!session?.draft) return false;
  // Prefer the stages returned with the exact card, but derive them for an
  // older session that predates that payload.
  // eslint-disable-next-line global-require
  const { stagesFor } = require('./exportStages');
  const stages = session.stages ?? stagesFor(session.draft, session.draft.answered ?? []);
  if (!stages.next) return false;

  const asked = Object.entries(EXPORT_QUESTION)
    .filter(([, pattern]) => pattern.test(String(reply ?? '')))
    .map(([step]) => step);
  return asked.length > 0 && !asked.includes(stages.next);
}

/**
 * Every real group name, for the export scope guard.
 *
 * Read through the same repo `notAGroup` uses, so the guard and the
 * correction it triggers cannot disagree about what a group is. Failure is
 * an EMPTY list, never a throw: a guard that cannot fetch its vocabulary
 * must wave the reply through rather than break the turn.
 */
async function knownGroupNames() {
  try {
    // eslint-disable-next-line global-require
    const peopleRepo = require('../repos/people.repo');
    return (await peopleRepo.filterOptions())?.groups ?? [];
  } catch {
    return [];
  }
}

function lastExportSession(results = []) {
  for (let i = results.length - 1; i >= 0; i -= 1) {
    if (results[i]?.exportSession) return results[i].exportSession;
  }
  return null;
}

function saidLast(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'user') return history[i].content ?? '';
  }
  return '';
}

/**
 * @param {string} [reply] her finished words this turn. Checked as well as
 *   theirs, because the verb list will always miss something and her own
 *   claim is the thing an admin will act on.
 */
/**
 * ===============================
 * * A FORM IS A SCREEN TOO
 * ===============================
 *
 * The check covered the export card and nothing else, so the same fault on
 * a FORM went straight through. Live: "actually put his end date to the
 * 31st of december" got "I updated Testy McTest's end date to 2026-12-31 on
 * the add a deal form" with no `fill_form` call. The form still said
 * nothing, and she had told the admin their screen had moved.
 *
 * Typing into a form is `fill_form`, exactly as changing the card is
 * `export_sheet`. Neither happens because she said it did.
 */
const openForm = (history = []) => history.some((t) => t?.form);

const CLAIMED_FORM = [
  /\bI (?:have )?(?:set|updated|filled|put|added|changed|entered|typed)\b.{0,60}\b(?:on|in|into|to) the (?:add a deal |edit |deal )?form\b/i,
  /\bthe form (?:now )?(?:shows|has|says|is set)\b/i,
];
const claimedForm = (text) => CLAIMED_FORM.some((r) => r.test(String(text ?? '')));

function wantsPanelAct(history = [], reply = '') {
  // A FORM claim is checked whether or not an export card is open: the two
  // screens are separate and either can be claimed without being touched.
  if (openForm(history) && claimedForm(reply)) return true;

  if (!openPanel(history)) return false;
  const said = saidLast(history);

  if (answersCurrentPanelStep(history)) return true;

  if (PANEL_ACT.test(said) || PANEL_RESUME.test(said)) return true;
  if (PANEL_EDIT.test(said) && PANEL_THING.test(said)) return true;

  // She said the card moved. If no tool ran, it did not.
  return claimedPanel(reply);
}

/**
 * ===============================
 * * AN INTERRUPTION PARKS THE SHEET AND SAYS SO
 * ===============================
 * They asked something else halfway through building an export. The card
 * stayed on screen and she answered, which is right, but nothing said the
 * export was still half done or what it was waiting on. "Where were we"
 * had no answer because nobody was keeping one.
 *
 * APPENDED IN CODE, not asked for in the prompt. A reminder that only
 * happens when the model remembers to give it is exactly the reminder that
 * goes missing on the turn it mattered. One short line, only when a card is
 * open with a step outstanding, and only on a turn that did NOT touch the
 * export: saying it after they just answered an export question would be
 * repeating them back to themselves.
 */
function withExportReminder(reply, history, touchedExport) {
  if (touchedExport || !reply) return reply;

  const draft = openPanel(history);
  if (!draft) return reply;

  // eslint-disable-next-line global-require
  const { stagesFor } = require('./exportStages');
  const stages = stagesFor(draft, draft.answered ?? []);
  if (!stages.next) return reply;

  /**
   * ONCE, THEN RARELY, AND NEVER THE SAME WORDS.
   *
   * The first version appended the identical sentence to EVERY unrelated
   * turn for as long as a card was open. Two replies in a row carried it
   * word for word in a live run.
   *
   * That is the fault we had just removed twice, from "Awww" and from the
   * pet names: a true thing said every single time stops being information
   * and becomes a tic. And it is the least necessary place for one, since
   * the card is on screen and the floating pill already shows the count.
   *
   * So: the first interruption gets it, then at most one every few turns.
   */
  const since = turnsSinceReminder(history);
  if (since !== null && since < REMINDER_GAP) return reply;

  const step = stages.steps.find((s) => s.id === stages.next);
  const what = draft.groups?.length ? `the ${draft.groups.join(', ')} sheet` : 'your sheet';
  const left = step.label.toLowerCase();
  const done = `${stages.done} of ${stages.total}`;

  // Rotated by how far in they are, so it is not the same line twice even
  // when the gap has passed.
  const lines = [
    `Your export is parked, by the way: ${what}, ${done} settled and I still need the ${left}. `
      + 'Say carry on when you want it back, or forget it to drop it.',
    `${what.charAt(0).toUpperCase()}${what.slice(1)} is still waiting on you, ${done} done, `
      + `just the ${left} left. Say carry on, or forget it.`,
    // EVERY VARIANT CARRIES THE WAY OUT. This one did not, and a reminder
    // that cannot be acted on is a dead end wearing a nudge's clothes.
    `Still holding ${what} for you: ${done}, and the ${left} to go. Carry on, or forget it.`,
  ];

  return `${reply}\n\n${lines[stages.done % lines.length]}`;
}

// Unrelated turns between reminders. Three is long enough that it reads as
// a nudge and short enough that a parked sheet is not forgotten.
const REMINDER_GAP = 3;

// Every variant's opening clause, so a reminder can be recognised however
// it was worded. Editing `lines` above means editing this too.
const REMINDER_HEADS = [
  /your export is parked/i,
  /is still waiting on you/i,
  /still holding the .* sheet|still holding your sheet/i,
];

/**
 * Assistant turns since she last mentioned it, or null if she never has.
 *
 * PROSE ONLY. A card, a list or a form is a RENDERING, not something she
 * said, and its history entry is a placeholder like "[showed Gloria's deal,
 * row #3]". Counting those burned the whole gap in one turn: showing four
 * cards looked like four replies, so the reminder came back immediately and
 * the nag returned in a live run.
 */
function turnsSinceReminder(history = []) {
  let seen = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn?.role !== 'assistant') continue;
    if (turn.card || turn.list || turn.form || turn.exportSession) continue;
    if (REMINDER_HEADS.some((r) => r.test(turn.content ?? ''))) return seen;
    seen += 1;
  }
  return null;
}

/**
 * Is this call the one that WRITES, or the dry run in front of it?
 *
 * A write tool called without `confirmed` returns a pending summary and
 * changes nothing. The panel says what she is doing while she does it, and
 * "Updating their profile…" over a question nobody has answered is a claim
 * she never made. Reported on sight 2026-09-24.
 *
 * FALSE ON ANYTHING UNREADABLE, which understates: a tool that writes with
 * no confirmation step reads as preparing, and that is the safe direction.
 */
function isConfirmed(rawArgs) {
  try {
    return JSON.parse(rawArgs || '{}')?.confirmed === true;
  } catch {
    return false;
  }
}

/** The admin's most recent message, verbatim. */
function lastSaid(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'user') return String(history[i].content ?? '');
  }
  return '';
}

/** Most recent prose answer, excluding cards and forms rendered as their own messages. */
function lastAssistantAnswer(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn?.role !== 'assistant' || turn.card || turn.list || turn.form || turn.exportSession) continue;
    return String(turn.content ?? '');
  }
  return '';
}

/**
 * ===============================
 * * A FOLLOW UP IS STILL THE SAME QUESTION
 * ===============================
 *
 * "Convert it to usd" then "I think that's wrong, double check". The second
 * sentence has no dollars in it, so the conversion was dropped, and she
 * answered without it and then OFFERED to convert. She was offering to do
 * what she had done one line earlier.
 *
 * Two turns, not the whole conversation: any wider and dollars asked for
 * ten minutes ago start appearing on unrelated answers, which is the fault
 * the guard was written for in the first place.
 *
 * NAMES ARE NOT READ FROM THIS, only intent. `said` stays one turn, or a
 * name from an earlier question would resolve the current one.
 */
const INTENT_TURNS = 2;

function recentSaid(history = [], turns = INTENT_TURNS) {
  const out = [];
  for (let i = history.length - 1; i >= 0 && out.length < turns; i -= 1) {
    if (history[i]?.role === 'user') out.push(String(history[i].content ?? ''));
  }
  return out.join('\n');
}

/**
 * Did they actually DOUBT the last answer?
 *
 * "I double-checked, and nothing has shifted" is only true when somebody
 * asked. Said to a new question it is a claim about work she did not do,
 * and it reads as though their question was a complaint.
 */
// A trailing \b cannot follow an alternative that ends in "?", because a
// question mark is not a word character and end-of-string after one is no
// boundary. `really?` and `sure?` silently never matched. The lookahead
// does what \b was there for: stop "certain" matching "certainly".
const ASKED_TO_CHECK = /\b(are you sure|you sure|sure\?|double ?check|check (it |that )?again|recheck|verify|is that (right|correct)|thats? (wrong|right)|that is (wrong|right)|really\?|certain|doubt|mistake)(?![a-z])/i;

function askedToCheck(said) {
  return ASKED_TO_CHECK.test(String(said ?? ''));
}

function openPanel(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn?.cancelled) return null;
    if (turn?.exportSession?.draft) return turn.exportSession.draft;
  }
  return null;
}

/**
 * Is auto mode on? Read ONCE per turn and held as the PROMISE, so two tool
 * calls in one round share the query rather than racing two of them.
 *
 * Off the turn rather than a module cache: a module level one is shared
 * between turns, and a setting changed mid session would keep applying the
 * value it was read at.
 *
 * UNREADABLE IS NOT PERMISSION. The repo's own fallback is false and this
 * adds a second: a settings failure must never mean "skip the preview".
 */
async function autoConfirmOn(turn) {
  const read = () => settingsRepo.agentAutoConfirm().catch(() => false);
  if (!turn) return read();
  if (turn.autoConfirm === undefined) turn.autoConfirm = read();
  return turn.autoConfirm;
}

/**
 * EVERY TOOL CALL IS LOGGED: name, what she sent, how long it took and what
 * came back. Before this it took DIANE_TRACE to see why she did anything,
 * so a wrong undo on 2026-10-03 could only be worked out from the database.
 */
async function invokeTool(tools, name, rawArgs, history = [], onEvent = null, turn = null) {
  const started = Date.now();
  let result;
  try {
    result = await invokeToolInner(tools, name, rawArgs, history, onEvent, turn);
    return result;
  } finally {
    logger.info({
      tool: name,
      args: String(rawArgs ?? '').slice(0, 500),
      ms: Date.now() - started,
      pending: Boolean(result?.pending),
      rows: Array.isArray(result?.rows) ? result.rows.length : undefined,
      summary: typeof result?.summary === 'string' ? result.summary.slice(0, 160) : undefined,
    }, 'diane: tool call');
  }
}

async function invokeToolInner(tools, name, rawArgs, history = [], onEvent = null, turn = null) {
  const tool = tools.find((t) => t.name === name);
  // Only reachable if the model invents a name — the tools it was given
  // are the only ones it can see, which is the whole point of scoping
  // them per context.
  if (!tool) {
    logger.warn({ tool: name }, 'diane: called a tool that does not exist here');
    captureLog({
      source: 'agent',
      level: 'warn',
      message: `Diane called an unknown tool: ${name}`,
      detail: { tool: name, available: tools.map((t) => t.name) },
    });
    return { summary: `No such tool here: ${name}` };
  }

  let args;
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch {
    // Nearly always a truncated call: the arguments ran past max_tokens
    // and the JSON is cut off mid-string. Said as something the model can
    // act on — retrying the same oversized call verbatim just truncates
    // again — rather than as a bare parse failure.
    logger.warn({ tool: name, length: rawArgs?.length }, 'diane: tool arguments were not valid JSON');
    captureLog({
      source: 'agent',
      level: 'warn',
      message: `Diane: truncated arguments for ${name}`,
      detail: { tool: name, length: rawArgs?.length },
    });
    return {
      summary:
        'Those arguments came through incomplete, probably too long. '
        + 'Split the change into smaller calls, or ask the admin for the remaining fields separately.',
    };
  }

  /**
   * WHEN IT APPLIES IS DECIDED HERE, in code. A later `when` goes to
   * park_for_month; a later month in their sentence with no `when` is
   * stopped and asked, so "starting next month" never lands this month.
   */
  if (PARKABLE[name]) {
    const { when: sentWhen, forMonths, ...rest } = args;
    const said = lastSaid(history);
    // THEIR SENTENCE'S MONTH WINS: left off, she was sent back and asked
    // them which month; sent, she once wrote "August 2024" for "the end of
    // this month". Hers is used only when their words name none. 2026-10-03.
    const when = (saysLater(said) ? whenIn(said) : null) ?? sentWhen;
    const at = when ? resolveWhen(when, forMonths) : { now: true };
    if (at.error) return { summary: `NOTHING WAS CHANGED. ${at.error}` };
    if (at.months) {
      logger.info({ tool: name, months: at.months }, 'diane: a later month, so it is parked');
      const { said: _s, saidRecent: _r, turn: _t, specialCaseAnswered: _a, ...change } = rest;
      let { confirmed, ...parked } = change;
      /**
       * AN ID SHE PICKED MUST BE THE PERSON THEY NAMED. "add 5% to zayn
       * deals next month" came as id 1, which is Johnathon's, and the
       * preview she wrote said "Zayn". Clone 2026-10-05.
       */
      if (name === 'update_master_sheet_row' && parked.id != null && !parked.targetPerson) {
        // eslint-disable-next-line global-require
        const row = await require('../repos/masterSheetRows.repo').findById(Number(parked.id)).catch(() => null);
        const heard = `${said}\n${recentSaid(history)}`.toLowerCase();
        const first = String(row?.person_name ?? '').toLowerCase().split(/\s+/)[0];
        if (!row || (first && !new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(heard))) {
          return {
            summary: `NOTHING WAS CHANGED OR SAVED. Deal #${parked.id} is ${row ? `${row.person_name}'s` : 'not on the sheet'}, `
              + 'and they did not name that person. Never guess an id: call again with targetPerson as they said it.',
          };
        }
      }
      // ALL OF A PERSON'S DEALS when they said so ("zayn's deals", "both",
      // "all"): one parked entry per live deal. 2026-10-05.
      if (name === 'update_master_sheet_row' && parked.id == null && parked.targetPerson
        && !parked.targetCompany && !parked.targetGroup && !parked.targetRole
        && /\b(?:deals|all|both|every|each)\b/i.test(said)) {
        // eslint-disable-next-line global-require
        const { resolvePerson } = require('./tools/resolvePerson');
        // eslint-disable-next-line global-require
        const found = await require('../repos/masterSheetRows.repo').searchFuzzy({ q: parked.targetPerson });
        const person = resolvePerson(found, parked.targetPerson, said);
        const live = person.matched && !person.ambiguous ? person.rows.filter((r) => !r.stopped_on) : [];
        if (live.length > 1) {
          const {
            targetPerson: _p, targetCompany: _c, targetGroup: _g, targetRole: _ro, ...exact
          } = parked;
          parked = { ...exact, ids: live.map((r) => r.id) };
        }
      }
      if (name === 'update_master_sheet_row' && parked.id == null && !parked.ids) {
        const id = await dealIdFor(parked, said);
        if (id == null) {
          return {
            summary: 'NOTHING WAS CHANGED OR SAVED. To save it for later it has to be ONE exact deal. Look '
              + 'it up with find_and_show_details, ask which deal if there are several, then call again '
              + 'with its id and the same `when`.',
          };
        }
        const {
          targetPerson: _p, targetCompany: _c, targetGroup: _g, targetRole: _ro, ...exact
        } = parked;
        parked = { ...exact, id };
      }
      // A STOP AT THE END OF THE MONTH names its deal the same way. Clone
      // 2026-10-05: "stop jay from reliapay end of this month" was refused
      // as "not a filter to run later" and went round ten model rounds.
      if (name === 'stop_deal' && parked.deal == null && parked.person) {
        const deal = await dealIdFor({ targetPerson: parked.person, targetCompany: parked.company, targetGroup: parked.group }, said);
        if (deal == null) {
          return {
            summary: 'NOTHING WAS CHANGED OR SAVED. To stop it later it has to be ONE exact deal. Ask '
              + 'which of their deals they mean, then call stop_deal again with that company and the same `when`.',
          };
        }
        parked = { ...parked, deal };
      }
      return invokeTool(tools, 'park_for_month', JSON.stringify({
        tool: name, args: parked, months: at.months, ...(confirmed ? { confirmed } : {}),
      }), history, onEvent, turn);
    }
    if (saysLater(said)) {
      return {
        summary: `NOTHING WAS CHANGED. They said a LATER month ("${said}"), and this change would land `
          + 'NOW. Call it again with `when` set to the month they said (and `forMonths` if they gave a '
          + 'run of months). If that month is the VALUE being set, such as a preset date, ask them.',
      };
    }
    args = rest;
  }

  /**
   * SEVERAL PEOPLE ON THE ONE DEAL TOOL become the per person bulk, in code.
   * "add 100 to otto fenn and mara quill" came here with `people`, was told
   * to use the bulk tool, sent it an `add` it does not take, and ended on
   * "I can't do both at once". The same change, one entry per person, is
   * exactly what `perPerson` is. 2026-09-29.
   */
  if (name === 'update_master_sheet_row' && Array.isArray(args.people) && args.people.length > 1) {
    const bulk = tools.find((t) => t.name === 'bulk_update_master_sheet');
    if (bulk) {
      const {
        people, add, confirmed, id, targetPerson, targetCompany, targetGroup, targetRole, ...set
      } = args;
      const perPerson = people.map((person) => ({
        person,
        ...(targetCompany || targetGroup ? { company: targetCompany ?? targetGroup } : {}),
        ...(Object.keys(set).length ? { set } : {}),
        ...(add ? { add } : {}),
      }));
      return invokeTool(tools, 'bulk_update_master_sheet', JSON.stringify({ perPerson, ...(confirmed ? { confirmed } : {}) }), history, onEvent, turn);
    }
  }

  /**
   * A write sentence containing "all deals" was being routed to the totals
   * tool because its description says it is the only amount tool. That
   * returned a valid figure and ended the turn before the confirmation flow.
   * Send the mistaken call back to the model, including a bare confirmation
   * on the following turn.
   */
  /**
   * ===============================
   * * A RULE QUESTION ANSWERED WITH A FIGURE
   * ===============================
   * Live 2026-09-24. "Explain why there's a special case" ran the TOTALS
   * tool and answered "Mayah is owed GBP 1,000". "What's the rule for
   * these special cases" restated one row's status a second time. A
   * figure is not a smaller version of a rule.
   *
   * The rule now EXISTS as something she can read out, in
   * `explain_preset_rules`. This is what stops the totals tool answering
   * for it, because a description saying so is a sentence.
   */
  if (name === 'total_master_sheet' && asksForRule(lastSaid(history))) {
    logger.info({ tool: name }, 'diane: totals tool selected for a rule question');
    return {
      summary: 'THEY ASKED FOR A RULE, NOT A FIGURE, so a total answers nothing. Call '
        + 'explain_preset_rules, which is where the rules actually live, and answer the question '
        + 'they asked from what it returns. If they asked about ONE ROW, look that row up too and '
        + 'say which part of the rule it turns on. Never quote an amount as the explanation.',
    };
  }

  if (shouldRouteWriteToBulk(name, history)) {
    const summary = 'This is an explicit bulk change request, not a totals or undo request. Use '
      + 'bulk_update_master_sheet with the requested preset date. The first call must '
      + 'show the exact deals and ask for confirmation; only a later confirmed true call may write.';
    logger.warn({ tool: name }, 'diane: totals tool selected for a write request');
    captureLog({
      source: 'agent',
      level: 'warn',
      message: 'Diane selected totals for a write request',
      detail: { tool: name, said: lastSaid(history) },
    });
    return { summary };
  }

  /**
   * A FILTER SHE DOES NOT HAVE IS REFUSED, NEVER IGNORED.
   *
   * A repo destructures the keys it knows, so an invented parameter is
   * dropped in silence and the query runs unfiltered. The rows that come
   * back are then the WHOLE SHEET, described as the answer to a narrower
   * question. See knownArgs.js.
   */
  /**
   * WHAT THE MODEL ACTUALLY SENT, before the injections below.
   *
   * A remembered pending call is re-issued on a LATER turn, so it must
   * not carry this turn|s `turn` object or its `onProgress`. Taken here
   * rather than filtered later: a new injected key would otherwise be
   * remembered by default, which is the wrong direction.
   */
  args = foldSearchWord(tool, foldIntoSet(tool, args));
  /**
   * A GROUP SENT AS A SEARCH WORD IS THE GROUP. "give me the payment
   * breakdown for corvid this month by company" arrived as q "corvid" one
   * run in three, and the breakdown, which has no q, refused the whole
   * call. On any tool that takes a group, a q, company or person that IS a
   * group name moves to group before anything is refused. 2026-10-03.
   */
  const props = tool.parameters?.properties ?? {};
  /**
   * ===============================
   * * HER ARGUMENTS, TIDIED THE SAME WAY FOR EVERY TOOL
   * ===============================
   * Measured on held-out wording 2026-10-03, each one a whole failed turn:
   *  - a possessive kept on a name: "felix's" was no one on the sheet;
   *  - a yes/no sent as a one item list: `paid: [true]` crashed the query
   *    ("invalid input syntax for type boolean") and she looped on it;
   *  - "paid in aed" read as the PAID switch, not the currency;
   *  - a group name sent as the free text search: "total for corvid" was
   *    "matching corvid is owed nothing".
   */
  const NAME_KEYS = ['person', 'name', 'q', 'targetPerson'];
  for (const key of NAME_KEYS) {
    if (typeof args[key] === 'string') args[key] = args[key].replace(/['’]s\b/gi, '').trim();
  }
  if (Array.isArray(args.people)) args.people = args.people.map((p) => (typeof p === 'string' ? p.replace(/['’]s\b/gi, '').trim() : p));
  for (const [key, spec] of Object.entries(props)) {
    if (spec?.type === 'boolean' && Array.isArray(args[key])) args[key] = args[key].length === 1 ? Boolean(args[key][0]) : undefined;
  }
  if (args.paid !== undefined && /\bpaid\s+(?:in|by|via|with|through)\b/i.test(lastSaid(history))
    && !/\b(?:marked|been|already|is|are|was|were|not)\s+paid\b/i.test(lastSaid(history))) {
    const { paid: _paid, ...rest } = args;
    args = rest;
  }
  /**
   * ===============================
   * * A DEAL IS PICKED BY WHAT THEY SAID, NEVER BY A GUESS
   * ===============================
   * Random conversation 2026-10-04: "kiran's monthly should be 700" (Kiran
   * has three deals) came with company "Harbor Nine", which nobody said, and
   * the preview offered AED 6,000 to 700 on that one. A yes would have cut
   * the wrong deal. On a write, a company / group / role that picks the deal
   * must be in their recent words, and a row id for somebody with several
   * live deals must be one they pointed at: its company or group said, or
   * the one card on screen. Otherwise it is dropped, and the tool asks which.
   */
  // NOT ON A CHANGE ALREADY AGREED: a plan step or a replay carries the
  // exact deal it was shown with, and "yes" names nothing. Clone 2026-10-06:
  // the plan's deal ids were swapped for the name and nothing was written.
  if (tool.writes && (props.targetPerson || props.id) && !turn?.applyingHeld) {
    const heard = fold(recentSaid(history, 3));
    // Whole, or one whole word of 4+ letters: "on harbor" is Harbor Nine.
    const heardWords = new Set(recentSaid(history, 3).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
    const said = (v) => typeof v === 'string' && v.trim() && (heard.includes(fold(v))
      || v.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 4 && heardWords.has(w)));
    for (const k of ['targetCompany', 'targetGroup', 'targetRole']) {
      if (args[k] !== undefined && !said(args[k])) {
        const { [k]: _dropped, ...rest } = args;
        args = rest;
      }
    }
    // `company` / `groupName` are VALUES to set; one nobody said that only
    // repeats the deal's own is a guess at which deal, not a change.
    for (const k of ['company', 'groupName']) {
      if (props[k] && args[k] !== undefined && !said(args[k]) && args.targetPerson) {
        const { [k]: _dropped, ...rest } = args;
        args = rest;
      }
    }
    if (args.id != null && props.targetPerson && !ORDINAL_REPLY.test(lastSaid(history) ?? '')) {
      try {
        // eslint-disable-next-line global-require
        const rows = require('../repos/masterSheetRows.repo');
        const row = await rows.findById(Number(args.id));
        if (row?.person_name) {
          const theirs = ((await rows.findAll({ q: row.person_name, pageSize: 50 }))?.rows ?? [])
            .filter((r) => !r.stopped_on && fold(r.person_name) === fold(row.person_name));
          const onScreen = [...history].reverse().find((m) => m.role === 'assistant' && (m.card || m.list));
          const pointedAt = onScreen?.card?.id === row.id
            || said(row.company) || said(row.group_name) || said(row.role_label);
          if (theirs.length > 1 && !pointedAt) {
            const { id: _id, ...rest } = args;
            args = { ...rest, targetPerson: row.person_name };
          }
        }
      } catch { /* a guard that cannot read the rows leaves the call alone */ }
    }
  }
  /**
   * ===============================
   * * A NAME IS WHAT WAS SAID, NEVER A SURNAME SHE MADE UP
   * ===============================
   * Random conversations 2026-10-04: "set theo's monthly" went to the tool
   * as "Theo Example" (a placeholder from her own prompt) and "kiran's
   * monthly" as "Kiran Patel", and both were told nobody is called that. A
   * person name nobody said is cut back to the words of it that were said,
   * by them or in her last answers ("and his phone?" after "Jim" is Jim).
   */
  {
    const heardWords = new Set(fold(`${recentSaid(history, 3)}`).length
      ? `${recentSaid(history, 3)} ${[...history].reverse().filter((m) => m.role === 'assistant').slice(0, 2).map((m) => `${m.content ?? ''} ${JSON.stringify(m.list ?? m.card ?? '')}`).join(' ')}`
        .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
      : []);
    const trimName = (v) => {
      if (typeof v !== 'string' || !v.trim()) return v;
      const words = v.trim().split(/\s+/);
      if (words.length < 2) return v;
      const kept = words.filter((w) => heardWords.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
      return kept.length > 0 && kept.length < words.length ? kept.join(' ') : v;
    };
    for (const k of ['targetPerson', 'person', 'name']) {
      if (props[k] && typeof args[k] === 'string') {
        const trimmed = trimName(args[k]);
        if (trimmed !== args[k]) args = { ...args, [k]: trimmed };
      }
    }
    if (props.people && Array.isArray(args.people)) {
      const people = args.people.map(trimName);
      if (people.some((p, i) => p !== args.people[i])) args = { ...args, people };
    }
  }
  // A SORT SENT TO THE TOTAL IS ITS RANK: "lowest paid at ironleaf" came to
  // total_master_sheet with sortBy/sortOrder, which it does not take, and
  // was refused. Lowest is a negative rank, the limit its size. 2026-10-04.
  if (props.rank && !props.sortBy && (args.sortBy !== undefined || args.sortOrder !== undefined)) {
    const { sortBy: _s, sortOrder, limit, ...rest } = args;
    const size = Math.abs(Number(rest.rank) || Number(limit) || 1);
    args = { ...rest, rank: (sortOrder === 'lowest' ? -1 : 1) * size };
  }
  // AN OPTION SENT INSIDE `set`: {set: {raiseMonthlyPercent: 10}} was refused
  // as "not a column" and the raise never ran. A key the tool takes at the
  // top level is moved there. 2026-10-04.
  if (args.set && typeof args.set === 'object' && !Array.isArray(args.set)) {
    const lifted = Object.keys(args.set).filter((k) => props[k] && k !== 'set' && args[k] === undefined);
    if (lifted.length) {
      const set = { ...args.set };
      const top = {};
      for (const k of lifted) { top[k] = set[k]; delete set[k]; }
      args = { ...args, ...top, ...(Object.keys(set).length ? { set } : {}) };
      if (!Object.keys(set).length) delete args.set;
    }
  }
  // "RAISE ... BY 10%" IS NEVER A NEW MONTHLY OF 0.1 OR 10. A percentage
  // said with "by" and no "to <amount>" turns a monthly SET into the raise
  // (or the cut). One run wrote Karin's monthly as 0.1. 2026-10-04.
  // AND A LIST OF NAMES WITH NO FIGURES: perPerson [{person: "Baker Jones"},
  // ...] and no percentage was refused for "no new amounts".
  const emptyPerPerson = Array.isArray(args.perPerson) && args.perPerson.length > 0
    && args.perPerson.every((p) => p && typeof p === 'object' && Object.keys(p).every((k) => ['person', 'name', 'company', 'id'].includes(k)));
  const setsMonthly = args.set && typeof args.set === 'object' && args.set.monthlyAmount != null;
  if (props.raiseMonthlyPercent && args.raiseMonthlyPercent == null && (setsMonthly || emptyPerPerson)) {
    const said = String(lastSaid(history) ?? '');
    const by = /\bby\s+(\d+(?:\.\d+)?)\s*(?:%|percent|per ?cent)/i.exec(said);
    const aboutMonthly = !/\b(?:add[- ]?on|fee)\b/i.test(said);
    if (by && aboutMonthly && !/\bto\s+(?:£|gbp\s*|aed\s*)?\d{2,}/i.test(said)) {
      const cut = /\b(?:lower|reduce|cut|drop|decrease|knock|take)\b/i.test(said);
      args = { ...args, raiseMonthlyPercent: (cut ? -1 : 1) * Number(by[1]) };
      if (setsMonthly) {
        const { monthlyAmount: _m, ...set } = args.set;
        if (Object.keys(set).length) args.set = set; else delete args.set;
      }
      if (emptyPerPerson) delete args.perPerson;
    }
  }
  // "WHO EARNS LESS THAN 1000" IS AN AMOUNT, not payable-versus-monthly:
  // the comparison flag came back alone and answered "owed nothing". Only
  // when the sentence names a figure and never compares to "their monthly".
  // 2026-10-04.
  if (props.payableVsMonthly && args.payableVsMonthly) {
    const said = String(lastSaid(history) ?? '');
    const bound = /\b(less than|under|below|fewer than|more than|over|above|greater than|at least|at most)\s+(?:£|gbp\s*|aed\s*)?(\d[\d,]*(?:\.\d+)?)\b/i.exec(said);
    if (bound && !/\btheir monthly\b|\bthan (?:the |their )?monthly\b/i.test(said)) {
      const n = Number(bound[2].replace(/,/g, ''));
      const word = bound[1].toLowerCase();
      const { payableVsMonthly: _pvm, ...rest } = args;
      const low = /less|under|below|fewer|at most/.test(word);
      const strict = !/at (?:least|most)/.test(word);
      args = rest.amountMin != null || rest.amountMax != null ? rest : {
        ...rest,
        amountField: rest.amountField ?? 'monthlyAmount',
        ...(low ? { amountMax: strict ? n - 0.01 : n } : { amountMin: strict ? n + 0.01 : n }),
      };
    }
  }
  // A PAYMENT METHOD NOBODY SAID: "who's paid in aed?" came with method
  // "bank" and answered "no deals are paid in AED by bank". 2026-10-04.
  if (props.paymentMethod && args.paymentMethod != null
    && !/\b(?:cash|bank|banks|banked|crypto|transfer|wire|usdt|btc)\b/i.test(recentSaid(history, 2))) {
    const { paymentMethod: _pm, ...rest } = args;
    args = rest;
  }
  // "WHO ARE THE DIRECTORS?" IS A ROLE: it came with no filter at all and
  // was answered with a count of the whole sheet. A word the sheet holds
  // as a role, said as "the <role>s", narrows to it. 2026-10-04.
  if (props.roleLabel && args.roleLabel == null) {
    const roleSaid = /\bwho (?:are|is|'s)\s+(?:the|our|all (?:the|our))\s+([a-z][a-z0-9 ]{1,20}?)s?\s*\??\s*$/i.exec(lastSaid(history) ?? '');
    if (roleSaid) {
      try {
        // eslint-disable-next-line global-require
        const spellings = await require('../repos/masterSheetRows.repo').knownSpellings?.();
        const hit = (spellings?.roles ?? []).find((r) => fold(r) === fold(roleSaid[1]));
        if (hit) args = { ...args, roleLabel: hit };
      } catch { /* left alone if the roles cannot be read */ }
    }
  }
  // GROUPS SENT AS PEOPLE: "compare baker and corvid this month" came as
  // people ["baker","corvid"] and was answered person by person. 2026-10-04.
  if (Array.isArray(args.people) && args.people.length > 0 && (props.groups || props.group)) {
    const known = await knownGroupNames();
    const asGroups = args.people.map((p) => known.find((g) => String(g).toLowerCase() === String(p).trim().toLowerCase()));
    if (asGroups.every(Boolean)) {
      const { people: _p, ...rest } = args;
      args = props.groups && asGroups.length > 1 ? { ...rest, groups: asGroups } : { ...rest, group: asGroups[0] };
    }
  }
  if (props.group && !args.group && typeof args.q === 'string') {
    const asGroup = (await knownGroupNames()).find((g) => String(g).toLowerCase() === args.q.trim().toLowerCase());
    if (asGroup) {
      const { q: _q, ...rest } = args;
      args = { ...rest, group: asGroup };
    }
  }
  /**
   * AN AMOUNT SENT AS A RATE. "knock 200 off baker jones's monthly" came as
   * addonPercentDelta -200 and was refused as a rate nobody named. With no
   * add on, fee or percent in their words, a delta is on the amount named.
   */
  // A ZERO DELTA IS NO CHANGE: sent beside a real add it once overwrote the
  // -200 with 0 and the "yes" changed nothing. 2026-10-03.
  for (const key of ['addonPercentDelta', 'feePercentDelta']) {
    if (args[key] != null && Number(args[key]) === 0) {
      const { [key]: _z, ...rest } = args;
      args = rest;
    }
  }
  if (props.add && (args.addonPercentDelta != null || args.feePercentDelta != null)) {
    // ON THE YES, THE INSTRUCTION'S WORDS, not "yes please": the replay of
    // "give theo a 3% add-on" read "yes please", found no percent in it and
    // added 3 to his monthly instead (700 to 703). 2026-10-04.
    // AND ON ANY SHORT ANSWER: "the quickearn one", after "give stuart s a
    // 2% add-on", has no percent in it either, and with auto mode on it put
    // 2 on his MONTHLY at once (1,000 to 1,002). The instruction is in the
    // last two things they said, whatever the last one is. 2026-10-04.
    const said = recentSaid(history, 2);
    if (!/\badd[\s-]?ons?\b|\bfees?\b|%|percent/i.test(said)) {
      const field = /\bpayable\b/i.test(said) ? 'payableAmount' : /\bdays?\b/i.test(said) ? 'payableDays' : 'monthlyAmount';
      const n = Number(args.addonPercentDelta ?? args.feePercentDelta);
      const { addonPercentDelta: _a, feePercentDelta: _f, ...rest } = args;
      // What she already put in `add` stands: this only fills a gap.
      args = { ...rest, add: { [field]: n, ...(rest.add ?? {}) } };
    }
  }
  if (props.group && !args.group) {
    for (const key of ['q', 'company', 'person']) {
      if (typeof args[key] !== 'string' || props[key]) continue;
      // eslint-disable-next-line no-await-in-loop
      const group = (await knownGroupNames()).find((g) => String(g).toLowerCase() === args[key].trim().toLowerCase());
      if (group) {
        const { [key]: _moved, ...rest } = args;
        args = { ...rest, group };
        break;
      }
    }
  }
  /**
   * AND A COMPANY SENT AS A GROUP IS THE COMPANY. "the two at kryptonia are
   * final this month" arrived as group "Kryptonia" and was told nothing was
   * up for review there. Only when it is no group and is a company.
   */
  if (props.group && props.company && typeof args.group === 'string' && !args.company) {
    const groups = (await knownGroupNames()).map((g) => String(g).toLowerCase());
    if (!groups.includes(args.group.trim().toLowerCase())) {
      try {
        // eslint-disable-next-line global-require
        const names = await require('../repos/companies.repo').names();
        const want = args.group.trim().toLowerCase();
        let hit = (names ?? []).map((n) => n?.name ?? n)
          .find((n) => String(n).trim().toLowerCase() === want);
        // A COMPANY ONLY THE SHEET NAMES: "lowest paid at ironleaf" came as
        // group IRONLEAF and found nothing, because Ironleaf is on deals but
        // not in the companies list. 2026-10-04.
        if (!hit) {
          // eslint-disable-next-line global-require
          const rows = (await require('../repos/masterSheetRows.repo').findAll({ q: args.group, pageSize: 50 }))?.rows ?? [];
          hit = rows.map((r) => r.company).find((c) => String(c ?? '').trim().toLowerCase() === want);
        }
        if (hit) {
          const { group: _g, ...rest } = args;
          args = { ...rest, company: hit };
        }
      } catch { /* a guard that cannot read companies leaves the call alone */ }
    }
  }
  /**
   * ===============================
   * * "DEDUCT 500" IS THE MONTHLY, UNLESS THEY SAID PAYABLE
   * ===============================
   * The admin's call 2026-10-06. "deduct 500 to paddy" went on the payable, so the
   * monthly stood and the next pro-rata put the 500 straight back. The
   * monthly is the rate and the payable follows it (recomputePayable); a
   * payable moves by hand only when they named it. Here, before the call is
   * remembered, so the preview and its "yes" are the same change. A
   * confirmed replay is the change already agreed and is not read again.
   */
  if (!args.confirmed && !/\bpay\s*able\b/i.test(recentSaid(history))) {
    const onMonthly = (add) => {
      if (add?.payableAmount === undefined || add.monthlyAmount !== undefined) return add;
      const { payableAmount, ...rest } = add;
      return { ...rest, monthlyAmount: payableAmount };
    };
    if (args.add) args = { ...args, add: onMonthly(args.add) };
    if (Array.isArray(args.perPerson)) {
      args = { ...args, perPerson: args.perPerson.map((e) => (e?.add ? { ...e, add: onMonthly(e.add) } : e)) };
    }
  }
  /**
   * "BOTH" AFTER ONE DEAL GOES ON THE DEALS THAT DID NOT GET IT, whatever
   * she sends. Clone 2026-10-06: told the ids, she sent the person alone and
   * the 100 landed on INDIGO a second time. See runAgentTurn.
   */
  const others = turn?.otherDeals;
  if (others && name === 'update_master_sheet_row') {
    const id = args.id == null ? null : Number(args.id);
    const next = others.rest.includes(id) ? id : others.rest[0];
    if (next != null) {
      const { targetPerson: _p, targetGroup: _g, targetCompany: _c, ...rest } = args;
      args = { ...rest, id: next };
      others.rest = others.rest.filter((r) => r !== next);
      others.done.push(next);
    } else if (id == null || others.done.includes(id)) {
      return { summary: 'NOTHING HAS BEEN CHANGED. Every one of their deals already has this change. Say what was done.' };
    }
  }
  /**
   * "ADD 5 DAYS" MOVES THE DAYS BY 5, it does not make them 5. Live
   * 2026-10-06: "add 5 days to zayn payable days" came as payableDays 5, a
   * preview of "5 to 5" on deals already at 5. Their words moved it BY a
   * number and never said "to" one, so the set becomes an add.
   */
  if (!args.confirmed && args.payableDays != null && args.add?.payableDays === undefined) {
    // Two turns, so "both" to "which group?" keeps the add it answers.
    const heard = recentSaid(history);
    const by = heard.match(/\b(add|plus|another|extra|deduct|minus|take\s+off|remove)\s+(\d+)\s+(?:more\s+|extra\s+)?(?:payable\s+)?days?\b|\b(\d+)\s+more\s+days?\b/i);
    const n = Number(by?.[2] ?? by?.[3]);
    if (by && n === Number(args.payableDays) && !/\bto\s+\d/i.test(heard)) {
      const less = /deduct|minus|take|remove/i.test(by[1] ?? '');
      const { payableDays: _d, ...rest } = args;
      args = { ...rest, add: { ...(args.add ?? {}), payableDays: less ? -n : n } };
    }
  }
  const modelArgs = { ...args };

  // WHAT SHE SENT TO A WRITE, kept. "deduct 500 to paddy" wrote 13,505 and
  // nothing on record said what she had called. 2026-10-06.
  if (tool.writes) {
    captureLog({
      source: 'agent',
      level: 'info',
      message: `Diane called ${name}`,
      detail: { tool: name, args: modelArgs, model: turn?.model },
    });
  }

  const refusal = unknownArgs(tool, args);
  if (refusal) {
    logger.warn({ tool: name, args: Object.keys(args) }, 'diane: called a tool with a filter that does not exist');
    captureLog({
      source: 'agent',
      level: 'warn',
      message: `Diane used a filter that does not exist on ${name}`,
      detail: { tool: name, sent: Object.keys(args) },
    });
    return { summary: refusal };
  }

  /**
   * HER `confirmed` STANDS ONLY FOR WHAT THE ADMIN WAS SHOWN. Otherwise it is
   * dropped and the call answers with its pending list again. See
   * confirmReplay.js `confirmationHeld`.
   */
  // A HELD CALL BEING APPLIED is the change that WAS shown and held: the
  // check below compares her last words, which may have dropped its figures.
  if (args.confirmed === true && !turn?.applyingHeld
    && !confirmationHeld(name, modelArgs, lastSaid(history), lastAssistantAnswer(history))) {
    logger.warn({ tool: name }, 'diane: confirmed a change the admin was not shown, asking again');
    delete args.confirmed;
  }
  /**
   * THE AUTO MODE OFFER, on EVERY door an agreed change comes through. It
   * was raised only when she re-issued the call without `confirmed`; she
   * usually sends it with, so after a real confirmation the bubble never
   * came. Once per conversation: a second offer is nagging. 2026-09-29.
   */
  if (args.confirmed === true && agreed(lastSaid(history)) && turn
    && !history.some((m) => m.offer?.kind === 'autoConfirm')) {
    const offer = autoConfirmOffer({ on: await autoConfirmOn(turn), tool, name, replayed: true });
    if (offer) turn.wrote.set('__offer', offer);
  }

  try {
    // The open panel travels with the call, never through the model.
    if (name === 'export_sheet') args.open = openPanel(history);

    /**
     * THEIR OWN WORDS, for anything that resolves a NAME.
     *
     * She shortens names. Asked to "show me gloria difference" she called
     * the tool with "Gloria", because `difference` reads as the English
     * word, and the wrong person's four deals came back. A prompt cannot
     * fix a plausible misreading, so `resolvePerson` checks the sentence
     * and takes the longest name actually in it.
     *
     * Injected, never a parameter: the point is that this is the one
     * version of the name she cannot have edited on the way through.
     */
    args.said = lastSaid(history);

    // WHAT THEY ASKED FOR, over the last two turns. Intent only, never a
    // name: a follow up like "double check" must not drop the conversion
    // they asked for one line earlier. See `recentSaid`.
    args.saidRecent = recentSaid(history);
    // A PLAN STEP IS NOT READ AGAINST THEIR WORDS AGAIN: it was read once,
    // checked, shown and agreed. Clone 2026-10-06: "add 100 to zayn indigo,
    // set paddy days to 31" had its second step refused as "an overwrite,
    // not an add", from the "add" in the first. The values stand as shown.
    if (turn?.planRun) {
      args.said = '';
      args.saidRecent = '';
    }
    if (['exchange_rate', 'undo_master_sheet_change', 'show_past_conversation', 'delete_past_conversations', 'add_deal'].includes(name)) args.priorAnswer = lastAssistantAnswer(history);
    // DEALS WHOSE "pay this month anyway?" was already answered on screen, so
    // the next edit does not ask it a second time. 2026-10-03.
    args.specialCaseAnswered = history
      .filter((m) => m.offer?.kind === 'specialCase' && m.answered && m.offer.dealId != null)
      .map((m) => Number(m.offer.dealId));

    /**
     * "THE SECOND ONE", answering the list on screen. She turned it into a
     * role ("Mid 1") and found nobody. The list she drew is in the history
     * with its ids in order, so the ordinal IS a row id. 2026-09-29.
     */
    // AND INSIDE A SENTENCE: "how much does the first one get?" after a list
    // of OTTER went looking for a made-up name. 2026-10-04.
    const ordinal = ORDINAL_REPLY.exec(args.said) ?? ORDINAL_IN_SENTENCE.exec(args.said);
    const toolProps = tool.parameters?.properties ?? {};
    if (ordinal && (toolProps.id || toolProps.person || toolProps.name)) {
      const shown = [...history].reverse().find((m) => m.role === 'assistant' && m.list?.rows?.length);
      const rows = shown?.list?.rows ?? [];
      const at = ORDINALS[ordinal[1].toLowerCase()];
      const row = at === -1 ? rows[rows.length - 1] : rows[at];
      if (row?.id != null && toolProps.id) {
        args.id = row.id;
        for (const k of ['targetPerson', 'targetGroup', 'targetCompany', 'targetRole']) delete args[k];
      } else if (row?.name) {
        const who = String(row.name).split(' · ')[0].trim();
        if (toolProps.person) args.person = who;
        else if (toolProps.name) args.name = who;
        delete args.people;
      }
    }

    // A TOOL THAT IS OFF ANSWERS FOR ITSELF. This gate ran first and said
    // "NO EXPORT CARD WAS OPENED", which implies there are exports to open;
    // she then described a pending one. See disabledTools.js.
    // NO FORM ON SCREEN, NOTHING TO TYPE INTO. "actually make it 1100" with
    // no form open was answered "I set the monthly amount to 1100 for the
    // new deal form", a form that did not exist. 2026-10-04.
    if (name === 'fill_form' && !openForm(history)) {
      return {
        summary: 'NOTHING WAS FILLED IN: no form is open on screen. Do not say you typed anything. '
          + 'If they gave a value for a deal, that is update_master_sheet_row; otherwise ask what '
          + 'they meant.',
      };
    }
    if (name === 'export_sheet' && !tool.disabledTool && !exportToolAllowed(history)) {
      logger.warn({ said: args.said }, 'diane: blocked an export card without export intent');
      return {
        summary: 'NO EXPORT CARD WAS OPENED. The admin asked for information, not a file. '
          + 'For a money or group breakdown call breakdown_master_sheet. Only call export_sheet '
          + 'after they explicitly ask to export, download, build or generate a sheet/file, or '
          + 'when they are answering the export card already visible on screen.',
      };
    }

    /**
     * PROGRESS, STRAIGHT TO THE SCREEN, for anything that writes in a loop.
     *
     * A mass edit that says nothing until it finishes is indistinguishable
     * from one that has hung, and if it fails half way nobody can tell
     * which half ran. Injected like the panel: never a model argument.
     */
    args.onProgress = (p) => onEvent?.({ type: 'progress', ...p });

    /**
     * ONE OBJECT FOR THE WHOLE TURN, so a tool can see what the OTHER
     * calls in this turn already did.
     *
     * A guard on a mass edit is worth nothing if the same write can be
     * reached by calling the single row tool three times, which is exactly
     * what happened: one phone number landed on three different people.
     * Injected like the rest, never a model argument.
     */
    args.turn = turn;

    /**
     * A BARE "YES" MAY NOT REDO WHAT IS ALREADY DONE.
     *
     * She wrote 19, said so, and a "yes" answering nothing made her write
     * 19 again. Identical values so no figure moved, which was luck. See
     * confirmReplay.js.
     */
    /**
     * TWO WRITES NOBODY ASKED FOR, 2026-09-25. After a "yes" applied an undo
     * she undid it again in the same turn; "is ines on a 2% fee?" was sent
     * to update_person. A yes turn has done its write, and a question has none.
     */
    if (tool.writes && turn?.wrote?.get('__held')) {
      return {
        summary: 'THIS TURN ALREADY APPLIED WHAT THEY AGREED TO, so nothing else is proposed or '
          + 'changed now. Tell them what was done, from the results you were given.',
      };
    }
    // A total beside a pending change is of the sheet BEFORE it: "GBP 4,650"
    // beside a preview moving it to 5,525. 2026-09-25.
    if (name === 'total_master_sheet' && turn?.wrote?.get('__pending')) {
      return {
        summary: 'NO TOTAL WAS WORKED OUT. A change is waiting for their yes, so any total now is of '
          + 'the sheet before it. Show the change lines you were given and ask; quote no other figure.',
      };
    }
    /**
     * "SHOW THEM AND TELL ME THEIR TOTAL" IS ONE SET. Live 2026-09-30: the
     * list was INDIGO, cash, monthly over 1,000 and the total dropped the
     * amount bound, so it counted deals the list did not show. The total
     * inherits every condition the filter used this turn that it was not given.
     */
    if (name === 'filter_master_sheet' && turn) turn.lastFilter = { ...modelArgs };
    if (name === 'total_master_sheet' && turn?.lastFilter && !modelArgs.person && !modelArgs.people?.length
      && /\b(?:their|those|them|these|that|the)\s+total\b|\btotal (?:of|for) (?:them|those|these)\b/i.test(String(args.said ?? ''))) {
      for (const [key, value] of Object.entries(turn.lastFilter)) {
        if (args[key] === undefined && !['said', 'saidRecent', 'turn', 'onProgress'].includes(key)) args[key] = value;
      }
    }
    // A change for someone they did not name. See namedOther.js.
    if (tool.writes && writeTarget(modelArgs) && args.said) {
      if (turn && !turn.sheetNames) {
        turn.sheetNames = await rowsRepo.knownSpellings().then((k) => k.people ?? []).catch(() => []);
      }
      const named = namedSomeoneElse(args.said, writeTarget(modelArgs), turn?.sheetNames ?? []);
      /**
       * THE ONE THEY NAMED, NOT A REFUSAL. "paddy notes sweep one" was sent
       * for Drew, refused, and she told the admin Paddy had no live deal.
       * Clone 2026-10-06. With no row id picked, the name is all she got
       * wrong, so the call goes to the person they named.
       */
      if (named && args.id == null) {
        logger.warn({ tool: name, named, target: writeTarget(modelArgs) }, 'diane: sent another name, put back to the one they named');
        const key = ['targetPerson', 'person', 'personName'].find((k) => String(args[k] ?? '').trim() === writeTarget(modelArgs));
        args = { ...args, [key]: named };
        // What a later "yes" replays, so it is the right person too.
        modelArgs[key] = named;
      } else if (named) {
        logger.warn({ tool: name, named, target: writeTarget(modelArgs) }, 'diane: refused a change for someone they did not name');
        return { summary: refusalFor(named, writeTarget(modelArgs)) };
      }
    }
    /**
     * "ADD 100 TO JOHNNY NOBODY" IS AN AMOUNT, NOT A NEW DEAL. Clone 2026-10-06:
     * nobody by that name, so she opened the new deal checklist for him.
     */
    /**
     * A NAME THEY NEVER SAID IS A GUESS. Clone 2026-10-06: "add 100 to johnny
     * nobody" matched nobody, she offered Johnathon, and the guard that keeps
     * her acting pushed her into adding 100 to him. A write goes to a person
     * whose first name they said in their last four messages, one slip allowed. A
     * message that names nobody ("add 100 to him") points at the screen.
     */
    const aimedAt = writeTarget(modelArgs);
    if (tool.writes && aimedAt && args.said && args.confirmed !== true && !turn?.applyingHeld && !/\b(?:him|her|them|his|hers|their|that|this|it|same|one)\b/i.test(lastSaid(history))) {
      const first = fold(aimedAt.split(/\s+/)[0]);
      const heard = recentSaid(history, 4).split(/[^a-z0-9]+/i).map(fold).filter(Boolean);
      if (first && !heard.some((w) => w === first || (first.length >= 4 && oneTypo(w, first)))) {
        logger.warn({ tool: name, target: aimedAt }, 'diane: a write for a name they never said');
        return {
          summary: `NOTHING HAS BEEN CHANGED. They never named ${aimedAt}. If the name they said matches `
            + 'nobody on the sheet, say so in one line and ask who they meant. Never pick a similar name.',
        };
      }
    }
    if (name === 'add_deal' && /\badd\s+[£$€]?\d[\d,.]*\s*k?\s*(?:aed|gbp|usd|eur)?\s+(?:to|on|for)\b/i.test(String(args.said ?? ''))
      && !/\b(?:deal|new|create|hire|onboard)\b/i.test(String(args.said ?? ''))) {
      return {
        summary: `NOTHING HAS BEEN CHANGED. They asked to add an AMOUNT to ${modelArgs.personName ?? 'someone'}, `
          + 'not for a new deal, and nobody by that name is on the sheet. Say so in one line and ask who they meant.',
      };
    }
    if (name === 'update_master_sheet_row' && modelArgs.confirmed !== true) {
      const missing = fieldsLeftOut(args.said, modelArgs);
      if (missing.length > 0) {
        logger.warn({ tool: name, missing }, 'diane: left out a field they named');
        return {
          summary: `NOTHING HAS BEEN CHANGED. They also named ${missing.join(', ')}, which this call left out. `
            + 'Call update_master_sheet_row again with EVERY field they named in this message.',
        };
      }
    }
    if (tool.writes && asksRateCheck(args.said)) {
      return {
        summary: 'NOTHING HAS BEEN CHANGED. They asked a question about a rate, not for a change. '
          + 'Call check_rates and open with the sentence it gives you.',
      };
    }

    // Not for a held call being applied: that is the NEW proposal they just agreed
    // to, and an earlier undo of the same shape blocked it as "already done". 2026-09-30.
    const finished = tool.writes && !turn?.applyingHeld ? alreadyDone(name, modelArgs, args.said) : null;
    if (finished) {
      logger.info({ tool: name }, 'diane: refused to redo a finished write on a bare yes');
      return {
        summary: 'THAT IS ALREADY DONE. You made this exact change a moment ago and told them '
          + 'so, and nothing has asked for it since. Do not call this again. Say it is already '
          + 'done, in your own words, and ask what else they need.'
          + (finished.answer ? `\n\nWhat it answered then: ${finished.answer}` : ''),
      };
    }

    /**
     * AN UNDO IS THE UNDO TOOL, never a fresh change dressed as one. Live
     * sweep 2026-09-29: "answer yes for nell arden", then "undo that", and
     * she answered NO, which stopped the deal. The change log puts the old
     * answer back; a new answer is a second change on top of the first.
     */
    if (tool.writes && UNDO_ASKED.test(String(args.said ?? ''))
      && !['undo_master_sheet_change', 'resume_deal'].includes(name)) {
      return {
        summary: 'NOTHING WAS CHANGED. They asked to UNDO the last change. That is '
          + 'undo_master_sheet_change, which puts the logged change back exactly. Call it. Never '
          + 'make a new change to imitate an undo.',
      };
    }

    /**
     * A BARE YES IS NEVER A "NO". After a muddled turn she answered "yes"
     * with a review answer of NO, which stopped the deal. A yes can agree
     * to an answer she proposed, so the word has to be in what she said.
     */
    if (name === 'answer_monthly_review' && agreed(args.said) && modelArgs?.answer
      && modelArgs.answer !== 'yes'
      && !new RegExp(`\\b${modelArgs.answer}\\b`, 'i').test(lastAssistantAnswer(history) ?? '')) {
      return {
        summary: `NOTHING WAS CHANGED. They said yes, and you never proposed answering "${modelArgs.answer}". `
          + 'Ask which answer they want for that deal: yes, final month, or no.',
      };
    }

    // A YES TO NOTHING writes nothing. After "Ines has no deals up for review", a
    // "yes" stopped one of Dov's through a tool that never asks first. 2026-09-25.
    // EVERY write, not only those with no preview: a yes after "updated" re-ran
    // the edit with extra fields and claimed it again. A held preview is
    // applied by the runtime before this, so nothing real is lost. 2026-09-29.
    // Not for a held call being applied: that yes IS to something. See applyingHeld.
    // ANY question in it, not only a last character: "Did you mean Otto
    // Fenn? Let me know and I'll add 100!" asked, and its yes was refused.
    if (tool.writes && agreed(args.said) && !turn?.applyingHeld
      && !/\?/.test(lastAssistantAnswer(history) ?? '')
      // A preview she showed without a question mark is still a preview.
      && !confirmationHeld(name, modelArgs, args.said, lastAssistantAnswer(history))
      && recallAll(args.said, lastAssistantAnswer(history)).length === 0) {
      return {
        summary: 'NOTHING NEW WAS CHANGED. They said yes, and your last answer asked them nothing, so '
          + 'there is nothing for it to agree to. Whatever your last answer reported as done IS done '
          + 'and saved: do not say it is pending, unsent or waiting. Ask what they would like next.',
      };
    }

    /**
     * ===============================
     * * AND A YES TO "A OR B" IS NOT AN ANSWER EITHER
     * ===============================
     * Live 2026-09-29. She asked "as a flat amount from his fee, or 100
     * percent?", the admin said "yes", and she answered with a TOTAL: a
     * figure for a question nobody asked, on the turn a change was waiting.
     *
     * The guard above cannot see it. Her answer DID end in a question mark,
     * so a yes looks like a real agreement; it is the SHAPE of the question
     * that makes it unanswerable. Two readings were offered and "yes" picks
     * neither, so the only correct move is to ask again naming both.
     *
     * READS, NOT JUST WRITES. Running a lookup here is how the unanswered
     * question got buried: the admin sees an answer and assumes the change
     * is in hand.
     */
    if (agreed(args.said) && eitherOrAsked(lastAssistantAnswer(history))) {
      return {
        summary: 'NOTHING WAS DONE. You offered them TWO readings and they said yes, which picks '
          + 'neither. Do not look anything up and do not guess which they meant: that choice is '
          + 'money. Ask the SAME question again in one short line, naming both readings so they '
          + 'can answer with one of them.',
      };
    }
    /**
     * ===============================
     * * AUTO MODE, AND IT ONLY EVER SKIPS THE PREVIEW
     * ===============================
     * His call 2026-09-29: "put 5% to zayn on milkman" should land rather
     * than open a dialogue. The flag is set HERE, before the handler, so
     * the tool runs its whole self exactly as it would after a yes.
     *
     * NOT A WAY ROUND A GUARD. Every refusal a tool carries is computed
     * before its preview and is unmoved by `confirmed`: an ambiguous name,
     * a group sent as a person, a month the write cannot reach. What this
     * removes is the SECOND look at a change the admin just described, and
     * nothing else. The closed list of what may skip is autoConfirm.js,
     * and it is an ALLOW list on purpose.
     */
    // `couldSkip` first, so the settings row is read only for a tool that
    // could ever skip a confirmation: 33 of 40 never can, and a round trip
    // to learn that on every call is a query for a foregone answer.
    /**
     * ===============================
     * * A SLIP IS A GUESS, AND A GUESS IS NEVER AUTO CONFIRMED
     * ===============================
     * His call 2026-09-29, and it is the right one. Auto mode skips the
     * SECOND look at a change the admin described; it must not skip the
     * only look at a change she had to reach for.
     *
     * "aupdate zayn milkman" is understood now, and understanding it took a
     * guess about what the first word was. That guess deserves a preview
     * whatever the setting says, because the cost of being wrong is a write
     * nobody read.
     *
     * A HUMAN YES IS STILL A YES. This only refuses the AUTOMATIC one: the
     * replay path below is untouched, so a slip they confirmed themselves
     * goes through exactly as anything else does.
     */
    const guessed = verbSlipped(args.said);
    if (guessed) logger.info({ tool: name }, 'diane: reached by a slip, so it asks first');
    /**
     * A PROFILE RATE REACHES EVERY DEAL, so auto mode still shows it first
     * when that is more than one. Clone 2026-10-04: "give stuart s a 2%
     * add-on" went onto all three of his deals at once, and "the quickearn
     * one" that followed (meaning ONLY that one) stacked a second 2% on it.
     * Auto mode is for a change to the one deal they named.
     */
    let reachesMany = false;
    if (name === 'update_person' && ['addonPercent', 'feePercent', 'addonPercentDelta', 'feePercentDelta'].some((k) => args[k] != null)) {
      const who = [args.person, ...(Array.isArray(args.people) ? args.people : [])].filter(Boolean);
      try {
        // eslint-disable-next-line global-require
        const rowsRepo = require('../repos/masterSheetRows.repo');
        for (const p of who) {
          // eslint-disable-next-line no-await-in-loop
          const live = ((await rowsRepo.findAll({ q: p, pageSize: 50 }))?.rows ?? [])
            .filter((r) => !r.stopped_on && fold(r.person_name).includes(fold(p)));
          if (live.length > 1 || who.length > 1) reachesMany = true;
        }
      } catch { reachesMany = true; }
      if (reachesMany) logger.info({ tool: name }, 'diane: a profile rate on several deals, so it asks first');
    }
    /**
     * TWO PEOPLE IN ONE SENTENCE ARE ONE CHANGE. Clone 2026-10-05, auto on:
     * "add 100 to craig sterling and dean cole" saved Craig at once, previewed
     * Dean alone, then said Craig "was not found", and the undo missed him.
     * Auto mode is for one deal they named, so this goes to the one preview.
     */
    if (!reachesMany && name === 'update_master_sheet_row' && couldSkip(name, tool)) {
      try {
        // eslint-disable-next-line global-require
        const { peopleIn } = require('./tools/resolvePerson');
        // eslint-disable-next-line global-require
        const all = await require('../repos/masterSheetRows.repo').findAll({ page: 1, pageSize: 2000 });
        if (peopleIn(all?.rows ?? [], lastSaid(history)).length > 1) {
          reachesMany = true;
          logger.info({ tool: name }, 'diane: several people named, so it asks first');
        }
      } catch { reachesMany = true; }
    }
    // OR THEY SPELLED IT OUT: every deal of a person they named. See
    // `spelledOut`. An answer to her own question
    // ("which group, or both?") counts the message it answers too.
    const answering = /\?\s*$/.test(String(lastAssistantAnswer(history) ?? '').trim());
    const mayStillSkip = !couldSkip(name, tool)
      && spelledOut(name, tool, modelArgs, answering ? recentSaid(history) : lastSaid(history));
    if (!guessed && !reachesMany && (couldSkip(name, tool) || mayStillSkip) && await autoConfirmOn(turn)) {
      logger.info({ tool: name }, 'diane: auto mode, no confirmation asked');
      args.confirmed = true;
      if (turn) turn.wrote.set('__auto', true);
    }

    /**
     * ONE CHANGE IS WRITTEN ONCE A TURN. Live 2026-10-06: "both" to "add 5
     * days to zayn" came as two calls with the same arguments in a different
     * order, the round's own fingerprint missed it, and both deals went 5 to
     * 10 to 15. Keyed on the arguments sorted, so order cannot hide it.
     */
    const sameChange = tool.writes ? `${name}:${stableJson({ ...modelArgs, confirmed: undefined })}` : null;
    if (sameChange && turn?.writtenChanges?.has(sameChange)) {
      logger.warn({ tool: name }, 'diane: the same change twice in one turn, the second not written');
      return { summary: 'ALREADY DONE in this turn, and NOT done again. Say once what was changed.' };
    }
    let { result, wrote } = await watchWrites(() => tool.handler(args));

    /**
     * A HAND OVER THEY SPELLED OUT LANDS TOO. "both", to her own "which
     * group, or both?", is built into the per person preview inside the one
     * deal tool, so the check above never saw it. Clone 2026-10-06, auto on:
     * it still asked "shall I go ahead?". Same rule, applied to the call the
     * preview stands for, through that tool's own handler and every guard.
     */
    const handed = result?.pending && result.redirect ? tools.find((t) => t.name === result.redirect.name) : null;
    if (handed && !guessed && !wrote
      && spelledOut(handed.name, handed, result.redirect.args, answering ? recentSaid(history) : lastSaid(history))
      && await autoConfirmOn(turn)) {
      logger.info({ tool: handed.name }, 'diane: auto mode, a spelled out hand over, no confirmation asked');
      ({ result, wrote } = await watchWrites(() => handed.handler({
        ...result.redirect.args, confirmed: true, said: args.said, saidRecent: args.saidRecent, turn: args.turn,
      })));
      if (turn) turn.wrote.set('__auto', true);
    }

    if (wrote && sameChange && turn) (turn.writtenChanges ??= new Set()).add(sameChange);
    // IT WROTE, so a later bare agreement cannot repeat it. A pending, a
    // question back or a refusal wrote nothing and is never "already done".
    if (tool.writes && wrote) completed(name, modelArgs, result);
    // The TURN knows it wrote, so her "it is done" can be held against it.
    if (wrote && turn) turn.wrote.set('__written', true);
    /**
     * A TOOL MAY ASK ONE QUESTION OF ITS OWN, in its own bubble.
     *
     * `add_deal` asks whether the new row is a special case, which is the
     * one thing about it that cannot be read off the row. Carried the same
     * way auto mode carries its offer, so there is one mechanism and one
     * place the web has to understand.
     */
    if (result?.offer && turn) turn.wrote.set('__offer', result.offer);
    if (wrote && turn && tool.stops) turn.wrote.set('__stopped', true);

    /**
     * ===============================
     * * THEY SAID YES, SO IT HAPPENS
     * ===============================
     * She asks, the admin agrees, and she asks the identical question
     * again: no confirmed write could be completed by talking to her.
     * See confirmReplay.js for the incident and for why this may only
     * ever confirm a change the previous answer already described.
     *
     * The handler is re-entered rather than the flag being patched onto
     * the result, so the write goes through every guard a second time and
     * this cannot become a way around one.
     */
    // AND IT WAS PENDING BEFORE THIS TURN. A DEAL level bulk pending made in
    // the same turn as the "yes" was confirmed off a profile question whose
    // only shared fact was "0". Nobody had seen it. 2026-09-25.
    if (shouldConfirm(result, args.said, lastAssistantAnswer(history))
      && confirmationHeld(name, modelArgs, args.said, lastAssistantAnswer(history))) {
      logger.info({ tool: name }, 'diane: admin agreed, re-issuing as confirmed');
      /**
       * AND THIS IS THE ONE MOMENT AUTO MODE IS WORTH OFFERING.
       *
       * They have just confirmed a change of a kind auto mode would have
       * skipped, so they have seen the shape of what they would be
       * agreeing to in advance. Offering before that is asking somebody to
       * sign off on something they have not been shown.
       *
       * It is an OFFER on the turn, not a sentence she says: the web draws
       * it as its own bubble with two buttons. A spoken offer would mean
       * her next turn reading "yes" as either an answer to this or a
       * confirmation of a write, which is exactly the ambiguity
       * confirmReplay exists to keep out of writes. A button cannot be
       * misheard.
       */
      const offer = autoConfirmOffer({
        on: await autoConfirmOn(turn), tool, name, replayed: true,
      });
      if (offer && turn && !history.some((m) => m.offer?.kind === 'autoConfirm')) turn.wrote.set('__offer', offer);
      return await tool.handler({ ...args, confirmed: true });
    }

    /**
     * AND IF SHE NEVER CALLS IT AGAIN, THE RUNTIME WILL.
     *
     * The replay above only fires when she re-issues the same call. In
     * one run of three she answered the agreement with a different tool
     * entirely and the change was never made. So the pending call is
     * held, and the next turn applies it. See confirmReplay.js.
     */
    /**
     * ===============================
     * * A TOOL THAT SAYS PENDING MUST BE ABLE TO HEAR CONFIRMED
     * ===============================
     * Live 2026-09-24. The rate confirm was added to `update_person` and
     * the `confirmed` parameter was not. The first call came back pending,
     * she called it again with confirmed, `knownArgs` refused the argument
     * as a filter that does not exist, and she told the admin it was done.
     * Nothing was written and nothing COULD have been.
     *
     * The two halves of the two call shape ship together or the tool is
     * unusable, so the mismatch is reported here rather than looking like
     * a model failure.
     */
    /**
     * ===============================
     * * AN AMBIGUOUS NAME ENDS THE TURN
     * ===============================
     * Live 2026-09-24. `resolvePerson` refused "Nicola Nathan" as two
     * people and said to change nothing. In the SAME message she asked
     * which one AND proposed a rate change for Nicola, with a confirm
     * waiting on a yes.
     *
     * The refusal was a summary she could talk past. It is a stop now: a
     * turn that has been told it cannot tell WHO may not also produce a
     * pending write about one of the candidates. She still asks; she just
     * cannot ask and propose in one breath.
     *
     * READ OFF `turn`, which every tool already shares, so the two calls
     * do not have to be in the same round to see each other.
     */
    // ABOUT A PERSON ONLY. A company has no "which one": "rename Souracore"
    // was refused because a lookup of Souracore had matched its two
    // holders, and renaming a company is not done for a person. 2026-10-03.
    const aboutCompany = /compan/i.test(name) && !modelArgs?.person && !(modelArgs?.people ?? []).length;
    if (result?.pending && turn?.askedWho && !aboutCompany) {
      logger.warn({ tool: name }, 'diane: proposed a write while a name was still ambiguous');
      return {
        summary: 'NOTHING HAS BEEN PROPOSED. You have already been told that name is more than '
          + 'one person, so there is nobody to propose this for yet. Ask which one they mean, '
          + 'give the names, and wait for an answer before touching anything.',
      };
    }
    if (result?.ambiguous && turn) turn.askedWho = true;

    if (result?.pending && !tool.parameters?.properties?.confirmed) {
      logger.error({ tool: name }, 'diane: tool returns pending but takes no confirmed argument');
      captureLog({
        source: 'agent',
        level: 'error',
        message: `Diane: ${name} asks for confirmation it cannot accept`,
        detail: { tool: name },
      });
      return {
        summary: `${name} asked them to confirm and has no way to be confirmed, so this change `
          + 'cannot be completed. Tell them plainly that you cannot make this change right now '
          + 'and that it needs looking at. Do NOT say it is done and do not try another tool.',
      };
    }

    // A pending another tool will carry out is remembered AS that call, so the
    // "yes" re-runs it and not this one. See handOverCall.
    if (result?.pending) {
      remember(result.redirect?.name ?? name, result.redirect?.args ?? modelArgs, result.confirming);
      if (turn) turn.wrote.set('__pending', true);
    }
    /**
     * "BUMP X TO 3600 AND WHATS HE OWED NOW", shown for a yes: no total is
     * given while a change waits (it would be the old figure), so the
     * preview says the figure comes with the yes, and the yes gives it (see
     * owedAskWaiting). Clone run 2026-10-05: the question was just dropped.
     */
    const said = lastSaid(history);
    if (result?.pending && tool.writes && (args.targetPerson || args.id != null) && !agreed(said)
      && SECOND_ASK.test(said) && /\b(?:owed|owe|total|how much)\b/i.test(said)) {
      const later = "I'll give you what they're owed once you say yes, so it is the new figure.";
      result.summary = `${result.summary ?? ''}\n\nTHEY ALSO ASKED WHAT IS OWED. Quote no figure for it now; `
        + `say this line, word for word, before asking for the yes:\n"${later}"`;
      if (typeof result.reply === 'string') {
        result.reply = /\n[^\n]*\?\s*$/.test(result.reply)
          ? result.reply.replace(/\n([^\n]*\?\s*)$/, `\n${later}\n$1`)
          : `${result.reply}\n${later}`;
      }
    }
    return result;
  } catch (err) {
    // The most important thing on this page. A tool throwing is a real
    // bug — a bad column, a constraint violation, a null where the
    // database wanted a date — and Diane swallows it into a soft "that
    // failed" so the admin isn't shown a stack trace. Without this the
    // actual cause existed nowhere.
    logger.error({ err, tool: name, args }, 'diane: tool handler threw');
    captureLog({
      source: 'agent',
      level: 'error',
      message: `Diane: ${name} failed — ${err.message}`,
      detail: { tool: name, args, stack: err.stack },
    });
    return { summary: `That failed: ${err.message}` };
  }
}

/**
 * Keep the conversation inside a size the model will actually accept.
 *
 * masterSheet.js already caps history at 20 MESSAGES, and that turned out
 * not to be the constraint that matters. A real session went like this: a
 * 21-line new-deal checklist, a 19-line read-back, a 28-line row dump —
 * three messages carrying more text than the twenty before them. Once
 * those were all in history, every following request failed, and the
 * admin saw "my head went fuzzy" three times in a row for a request as
 * small as "show me Zane's details".
 *
 * So the budget is in characters, not messages, and it's applied from the
 * most recent backwards — the newest exchange is the one the next reply
 * depends on. Individual giants are truncated rather than dropped, because
 * "you already read this list back to me" is context worth keeping even
 * when the list itself isn't.
 */
/**
 * THE BUDGET IS THE ONLY CAP THERE IS.
 *
 * It was 14,000 characters, about 3.5k tokens, and there was a second cap
 * of 20 messages on the route. Both were sized for a small-context
 * provider. `gpt-4.1-mini` holds roughly a million tokens, so 3.5k was
 * three tenths of one percent of the window, and Diane forgot the start of
 * an ordinary conversation: two card dumps and a read-back would push the
 * first half out.
 *
 * 200,000 characters is about 50k tokens, which is hundreds of turns and
 * still only five percent of what the model will take.
 *
 * WHY A NUMBER AT ALL, given the model could take twenty times this. The
 * whole history is resent on EVERY turn, so the cost of a conversation
 * grows with the square of its length: a session that reaches the cap pays
 * for 50k tokens on each remaining turn. A bound keeps a long day from
 * quietly becoming an expensive one, and the browser has to hold and post
 * the same text inside express.json's 2mb.
 *
 * Overridable, because the right number depends on the model and on what
 * the boss is willing to spend.
 */
const HISTORY_CHAR_BUDGET = Number(process.env.AGENT_HISTORY_CHARS) > 0
  ? Number(process.env.AGENT_HISTORY_CHARS)
  : 200000;

/**
 * The model call, streamed, reassembled into the exact shape the
 * non-streaming call returned.
 *
 * ===============================
 * * NOTHING REACHES THE SCREEN AS HER ANSWER UNTIL THE TURN COMMITS
 * ===============================
 * This used to emit the cleaned text as it arrived, and the admin watched
 * her write an answer and then instantly replace it. Three ways in, all
 * the same fault: TEXT WAS SHOWN BEFORE THE TURN HAD DECIDED IT WAS THE
 * ANSWER.
 *
 *   1. Prose in the same message as tool calls. "Let me check that for
 *      you" was typed out, the tools ran, and the real answer overwrote
 *      it. That prose was never the answer.
 *   2. A GUARD RETRY. Twelve retry flags, plus the length and empty-reply
 *      retries: any of them re-enters the loop and streams a second answer
 *      over the first, which the admin has already read in full.
 *   3. A tool's computed terminal reply replacing whatever was streamed.
 *
 * The client never cleared between rounds either, so the replacement
 * happened in place, mid sentence.
 *
 * So this STREAMS BUT SAYS NOTHING. The turn's one answer is the value
 * runAgent returns, after every guard has passed. That is the only text
 * the admin ever sees, and it is right the first time.
 *
 * ===============================
 * * WHY NOT "just suppress it when there are tool calls"
 * ===============================
 * That fixes 1 and leaves 2, and 2 is the one that grows: every guard
 * added from here would be a new way to show a wrong answer first. The
 * rule has to be about COMMITMENT, not about tool calls, or the next guard
 * reopens it.
 *
 * WHAT COVERS THE LATENCY: the `say` tool, which exists for exactly this
 * and is deliberate rather than accidental. She chooses to put a line up
 * mid turn, and that line is complete and final the moment it arrives.
 * `progress` events still report a bulk write as it runs.
 *
 * Everything downstream is untouched: the loop still gets
 * `{ choices: [{ message, finish_reason }] }`, so the tool rounds, the
 * empty-reply retry and the error handling all work as they did.
 *
 * TOOL CALLS ARE BUFFERED TOO. They arrive as deltas, indexed so several
 * can interleave, and they are arguments rather than prose: streaming half
 * a JSON payload into a chat bubble would be nonsense.
 */
/**
 * AN APOLOGY ONLY WHEN THEY SAID SOMETHING WAS WRONG. Live 2026-10-03:
 * "anyone paid in crypto?" opened "Sorry for the mix-up, darling!" about an
 * earlier answer, on a new question. The opening sentence goes when their
 * message corrected nothing; the answer after it stays.
 */
const APOLOGY_OPENING = /^\s*(?:oops|whoops|sorry|apologies|my (?:mistake|bad|apologies))\b[^.!?\n]{0,80}[.!?]+\s*/i;
const CORRECTED = /\b(?:no|nope|wrong|not right|incorrect|mistake|that'?s not|thats not|you said|why did|meant)\b/i;
function dropUnaskedApology(text, said) {
  const t = String(text ?? '');
  if (CORRECTED.test(String(said ?? '')) || !APOLOGY_OPENING.test(t)) return t;
  const rest = t.replace(APOLOGY_OPENING, '');
  return rest.trim() ? rest.charAt(0).toUpperCase() + rest.slice(1) : t;
}

async function streamCompletion(openai, params) {
  // TOKENS PER ROUND, so cost is measured rather than guessed. OpenAI only:
  // the other providers' streams are not promised to accept the option.
  const withUsage = env.aiProvider === 'openai' ? { stream_options: { include_usage: true } } : {};
  const started = Date.now();
  const stream = await openai.chat.completions.create({ ...params, ...withUsage, stream: true });

  let content = '';
  let finishReason = null;
  const toolCalls = [];
  let usage = null;

  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;

    const delta = choice.delta ?? {};

    if (delta.content) content += delta.content;

    for (const tc of delta.tool_calls ?? []) {
      const i = tc.index ?? 0;
      toolCalls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (tc.id) toolCalls[i].id = tc.id;
      if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
      if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
    }
  }

  const message = { role: 'assistant', content };
  const calls = toolCalls.filter(Boolean);
  if (calls.length > 0) message.tool_calls = calls;

  logger.info({
    model: params.model,
    ms: Date.now() - started,
    inputTokens: usage?.prompt_tokens,
    cachedTokens: usage?.prompt_tokens_details?.cached_tokens,
    outputTokens: usage?.completion_tokens,
    toolCalls: calls.map((c) => c.function?.name),
  }, 'diane: model round');

  return { choices: [{ message, finish_reason: finishReason }] };
}
/**
 * One message's own ceiling, so a single giant cannot eat the budget.
 *
 * Was 1,500, which truncated the very things worth remembering: a 21-line
 * new-deal checklist, a full read-back, a card dump. Diane would then be
 * asked "is that right?" about a list she could only see half of.
 *
 * 12,000 lets any single card, checklist or read-back through intact while
 * still stopping one pasted wall of text from filling the window.
 */
const MAX_MESSAGE_CHARS = 12000;

/**
 * THE MESSAGE BEING REPLIED TO IS NEVER CUT, however long it is.
 *
 * It was, and silently: a 30,000 character paste reached her as the first
 * 12,000 and a `… (trimmed)` marker, so she answered on 40% of what was
 * sent and nothing on screen said so. Asked to read a long list she read
 * the top of it.
 *
 * The ceiling still applies to EVERY OLDER message, which is what it was
 * for: one pasted wall of text must not fill the window for the rest of
 * the conversation. The newest is the exception because it is the thing
 * being answered.
 */
function trimHistory(history) {
  const kept = [];
  let used = 0;
  const newest = history.length - 1;

  for (let i = newest; i >= 0; i--) {
    const message = history[i];
    const full = String(message.content ?? '');
    const content = (i === newest || full.length <= MAX_MESSAGE_CHARS)
      ? full
      : `${full.slice(0, MAX_MESSAGE_CHARS)}\n… (trimmed)`;

    // Never DROP the newest either: replying to nothing is worse than any
    // size, so the budget is checked only once something is already kept.
    if (used + content.length > HISTORY_CHAR_BUDGET && kept.length > 0) break;

    kept.unshift({ role: message.role, content });
    used += content.length;
  }

  return kept;
}

/**
 * One turn.
 *
 * @param {Array} history  [{ role: 'user'|'assistant', content }]
 * @param {string} contextName  'master-sheet' — the only workspace since the refactor
 */
async function runAgentTurn(history, contextName, onEvent) {
  const openai = getClient();
  if (!openai) {
    // Human-facing. The env var name means nothing to the admin and
    // reads like a crash; the Logs page carries the real detail.
    captureLog({
      source: 'agent',
      level: 'error',
      message: 'Diane has no API key configured (AI_API_KEY / OPENAI_API_KEY unset)',
      detail: { provider: env.aiProvider },
    });
    throw new AppError(503, "I'm not connected to my brain right now, dear. Someone needs to set my API key before I can help.");
  }

  // An unknown context falls back to the default rather than erroring:
  // a stale tab sending a context we've since renamed should still get a
  // working Diane, not a broken one.
  const context = resolveContext(contextName);
  // fill_form only while a form is open: offered without one, it was used.
  const offered = openForm(history) ? context.tools : context.tools.filter((t) => t.name !== 'fill_form');
  const openAITools = toOpenAITools(offered);

  /**
   * ===============================
   * * WHAT A TURN COSTS, SAID ONCE AT THE START OF IT
   * ===============================
   * 2026-09-29: neither of us could say which requests were expensive, so
   * "trim the tool descriptions" was a guess about where the weight is.
   * Measured, it is 39 tools and roughly 21,000 tokens of schema on EVERY
   * round of every turn, before a word of the conversation.
   *
   * Logged rather than assumed, so the next decision about splitting the
   * context is made against a number. `schemaBytes` over four is the usual
   * rough token count and is close enough to rank by, which is all this is
   * for: nothing reads it to make a decision at runtime.
   */
  /**
   * ===============================
   * * THE FIRST ROUND CARRIES LESS
   * ===============================
   * The bulk and destructive tools are held back until the turn shows it
   * needs one, which is 26% of the schema off the round that decides most
   * turns. The rule and the reasoning are contexts.js's; this only carries
   * it out.
   *
   * `let`, so `needsEverything` below can widen it mid turn. She is never
   * told a held tool does not exist: her capability block is built from
   * ALL of them, and calling one is answered with "it is there now".
   */
  const openingAITools = toOpenAITools(openingTools(offered));
  let roundTools = openingAITools;
  let widened = false;
  /**
   * THEIR WORDS ASK FOR A HELD ONE, so it is there from the first round.
   * The model cannot call a tool that is not in the list it was handed, so
   * "delete juno park deal" became a stop and then "I cannot delete deals
   * here", and "undo that" never found the undo. Live sweep 2026-09-29.
   */
  if (ASKS_FOR_HELD.test(lastSaid(history))) {
    roundTools = openAITools;
    widened = true;
  }
  /**
   * ===============================
   * * A PLAIN QUESTION GETS THE READ TOOLS ONLY
   * ===============================
   * 2026-10-04. She was handed ~40 tools on every message, and most wrong
   * picks came from that crowd: an audit for "which company has the most
   * deals", rates for "what's nathan on". A message that only ASKS (no
   * change wording, not an answer to her question, nothing waiting on a
   * yes) gets the reading tools and one more: more_tools, which hands her
   * the full set the moment the request turns out to need it. Nothing is
   * ever out of reach; it costs one round only when the guess was wrong.
   */
  const asked = lastSaid(history);
  // OFF, 2026-10-04: measured, it cut tokens 6-17% but she never once called
  // more_tools, so a read set that was not enough gave a worse answer
  // instead ("is wren still active" went to the review list). Accuracy
  // first. Turn on again to try it with a stronger model.
  const onlyAsks = NARROW_READ_TURNS && !widened && !isSetInstruction(asked) && !WRITE_WORDS.test(asked)
    && !/\?\s*$/.test((lastAssistantAnswer(history) ?? '').trim())
    && !somethingHeld() && !openForm(history) && asked.trim().split(/\s+/).length > 1;
  if (onlyAsks) {
    roundTools = [...toOpenAITools(offered.filter((t) => READ_TOOLS.has(t.name))), MORE_TOOLS];
  }

  const schemaBytes = JSON.stringify(openAITools).length;
  const openingBytes = JSON.stringify(openingAITools).length;
  logger.info({
    context: context.key,
    tools: context.tools.length,
    opening: openingTools(context.tools).length,
    writes: context.tools.filter((t) => t.writes).length,
    schemaBytes,
    openingBytes,
    // The system prompt rides on every round too, and was the part not shown.
    promptBytes: String(context.prompt ?? '').length,
    savedTokens: Math.round((schemaBytes - openingBytes) / 4),
  }, 'diane: turn opened');

  const messages = [{ role: 'system', content: context.prompt }, ...trimHistory(history)];
  if (reschedules(lastSaid(history), history)) {
    messages.push({
      role: 'system',
      content: 'THEY ARE CHANGING THE SCHEDULED CHANGE YOU JUST DESCRIBED, not cancelling it. Call '
        + 'update_master_sheet_row for the SAME deal with the new value they said and `when` set to the '
        + 'month they said (or the same month if they named none). The old scheduled one is replaced '
        + 'automatically. Do not call cancel_parked_work.',
    });
  }
  const again = changeAgain(lastSaid(history), history);
  if (again) {
    messages.push({
      role: 'system',
      content: `THEY ARE CHANGING THE CHANGE YOU JUST MADE. Call update_master_sheet_row with targetPerson `
        + `"${again.targetPerson}", targetCompany "${again.targetCompany}"`
        + `${again.targetGroup ? `, targetGroup "${again.targetGroup}"` : ''} and ${again.field} ${again.value}. `
        + 'Do not look anybody up first.',
    });
  }
  /**
   * ===============================
   * * "HIS DEALS" IS EVERY DEAL, SO IT IS ONE BULK CHANGE
   * ===============================
   * gpt-4.1 bulk sweep, 2026-10-06: "dudcut 200 to kiran vales deals" was
   * looked up and answered "Kiran Vale has three deals, which one?", and
   * "kirans location is manchester now for every deal" went to the one row
   * tool, whose yes then asked "all of them, or one?". The scope was said:
   * deals, all, every, both, everywhere. So it goes straight to the bulk
   * tool, with the preview it always shows, and nobody is asked which.
   */
  /**
   * A NAME AND NO CHANGE. "change kiran" was answered "which one do you want
   * to STOP?": an act nobody said, on money. With no field and no value the
   * only right move is one short question. gpt-4.1 messy sweep, 2026-10-06.
   */
  if (VAGUE_EDIT.test(lastSaid(history))) {
    messages.push({
      role: 'system',
      content: 'THEY NAMED SOMEONE BUT NOT WHAT TO CHANGE. Ask ONE short question: what would they like '
        + 'changed for that person (which field, and to what). Do not assume stop, end, delete, paid or '
        + 'any field, and do not look anything up or change anything yet.',
    });
  }
  if (isSetInstruction(lastSaid(history)) && EVERY_DEAL.test(lastSaid(history)) && !LATER_MONTH.test(lastSaid(history))) {
    messages.push({
      role: 'system',
      content: 'THIS IS ONE CHANGE TO EVERY DEAL THEY NAMED (they said deals, all, every, each, both '
        + 'or everywhere). Call bulk_update_master_sheet straight away, without looking anybody up '
        + 'first and without asking which deal or which group: for ONE person, perPerson '
        + '[{ person: <the name as they said it>, allDeals: true, set: {...} or add: {...} }]; for '
        + 'several named people, `people`. A percentage on the monthly is raiseMonthlyPercent with '
        + '`people` [name]. "add/deduct N" with no field named is the MONTHLY amount (add: '
        + '{ monthlyAmount }, negative to take off); the payable follows it. payableAmount only when '
        + 'they said payable. Their own details (postcode, door number, bank, account, sort code, phone, '
        + 'accepting postals) go in that person\'s set too. If they named a GROUP, a company or '
        + '"everyone" rather than people, use those filters instead of perPerson. Do NOT use '
        + 'update_master_sheet_row.',
    });
  }
  const changedRowIds = new Set();
  const shownCardIds = new Set();
  // Lists drawn THIS turn, so two calls returning the same rows cannot
  // both paint. drawnAlready only sees the previous turn.
  const shownLists = new Set();
  // Every tool result this turn, so the reply can be checked against what
  // was actually computed. See checkFigures.
  const toolResults = [];
  let figureRetry = false;
  let unseenRetry = false;
  // Its own flag again: answering for a month nothing was computed for is
  // a different mistake from misquoting a figure that was.
  let monthRetry = false;
  // Its own flag: a rate is a claim no other guard can see, because every
  // percentage in the system is under checkFigures' floor of 100.
  let percentRetry = false;
  // Its own flag again: a day count sits under that same floor, and a wrong
  // one is a different mistake from a wrong rate.
  let dayRetry = false;
  // Its own flag: a refusal she was never handed is the opposite shape to
  // every other check here, which watch what she CLAIMS she did.
  let ambiguityRetry = false;
  // Its own flag: a value she stated about a row she did not look at. Text,
  // so no figure, count or percent guard can see it.
  let cardRetry = false;
  // Its own flag: a wrong count and a wrong amount are different mistakes,
  // and each is worth one correction rather than sharing a single retry.
  let countRetry = false;
  // Its own flag again: answering the wrong SHAPE of question is not a
  // wrong figure, and correcting one must not spend the other's retry.
  let questionRetry = false;
  let claimRetry = false;
  let repeatRetry = false;
  // Its own flag: offering something she cannot do and repeating herself
  // are different mistakes, and each is worth one correction.
  let promiseRetry = false;
  // Whether the export tool ran at all this TURN, for the panel guard
  // below: she claimed to have paused and to have cancelled, both times
  // having called nothing.
  let calledExport = false;
  // Its own flag: answering an instruction with a readout of the field is
  // not a wrong figure, a claim or a repeat, so no other guard here sees
  // it. See setIntent.js.
  let wroteThisTurn = false;
  let setRetry = false;
  // Its own flag: a dropped line is not a wrong figure, so no other guard
  // here can see it.
  let relayRetry = false;
  let namedRetry = false;
  // A retry that must call one tool: set by the guard, used on the next round only.
  let forceNextTool = null;
  // A yes or no question answered without its yes or no. See checkVerdict.js.
  let verdictRetry = false;
  // "It was increased" on a yes turn that wrote nothing. See checkClaimedWrite.js.
  let wroteClaimRetry = false;
  let stopClaimRetry = false;
  let askWhoRetry = false;
  let contactRetry = false;
  let emptyRetry = false;
  // A "shall I?" with nothing pending. See checkUnbackedAsk.js.
  let unbackedRetry = false;
  // A rate said to move the wrong way. See checkRateDirection.js.
  let directionRetry = false;
  // Its own flag: promising a tool that is off is not a wrong figure or a
  // repeat, so no other guard here sees it.
  let pointRetry = false;
  // Its own flag: reading a stage direction out is not a wrong figure, a
  // repeat or a claim, so nothing else here sees it.
  let leakRetry = false;
  let panelRetry = false;
  // A wrong scope on a REAL build is its own fault, so its own flag: the
  // panel guard above never sees it, because a tool did run.
  let scopeRetry = false;
  // Raised once, in-flight, if a reply comes back empty because the model
  // spent its whole budget reasoning — see the retry below.
  let maxTokens = MAX_TOKENS;
  let raisedBudget = false;

  /**
   * ===============================
   * * WHAT THIS TURN HAS ALREADY WRITTEN
   * ===============================
   *
   * A guard on the mass edit is worth nothing while the same write can be
   * reached by calling the single row tool once per person. Live: told to
   * "put the phone number on all three" she refused nothing, called
   * `update_master_sheet_row` three times, and one phone number landed on
   * three different people.
   *
   * So the tools share one object for the length of a turn and can see
   * what the other calls in it already did. Created here, injected by
   * `invokeTool`, and gone when the turn ends.
   */
  // `autoConfirm` is filled lazily by autoConfirmOn(), once per turn: a
  // settings query per tool call would be four round trips for one answer.
  const turnState = { wrote: new Map(), claims: [], autoConfirm: undefined };

  /**
   * ===============================
   * * THE AGREEMENT IS ACTED ON BEFORE SHE IS ASKED ANYTHING
   * ===============================
   *
   * She proposed a three person edit, the admin said "yes, go ahead", and
   * she answered it by calling a tool that does not take those arguments,
   * then wandered into three unrelated lookups. Nothing was written and
   * she never said so.
   *
   * So the pending call is applied HERE, by the runtime, and she is handed
   * the result to narrate. The part of a confirmation she cannot get right
   * is the part she is no longer doing.
   *
   * It may only ever apply a change the previous answer already spelled
   * out, fact for fact. See confirmReplay.js for why that bound is the
   * whole safety of this.
   */
  /**
   * ALL OF THEM, one after another. "Update Nathan and Nicola" is two
   * pending calls, and applying the newest alone wrote one of the two
   * while she said both were done. See recallAll.
   */
  /**
   * A BARE "NO" TO HER QUESTION ENDS IT, in code. Asked to exclude a name she
   * could not find, "no" got an offer to move every preset anyway. 2026-09-25.
   */
  // Anything proposed before the previous turn can no longer be agreed to.
  nextTurn();
  const prior = lastAssistantAnswer(history);
  if (declined(lastSaid(history)) && /\?\s*$/.test(String(prior ?? ''))) {
    dropShown(prior);
    return { reply: copy.agent.leftAlone, changedRowIds: [], context: context.key, claims: [] };
  }

  /**
   * ===============================
   * * THE BUBBLE, ANSWERED BY TYPING
   * ===============================
   * "Should Rowan Pike be paid this month anyway?" is two buttons, and a
   * typed "yes" under it went to the model, which reached for the special
   * case switch and was refused as a field nobody named. Typing yes to the
   * question on screen is pressing Yes, so it does what Yes does. A typed
   * no is already handled above as a decline.
   */
  const lastEntry = [...history].reverse().find((m) => m.role === 'assistant');
  if (lastEntry?.offer && !lastEntry.answered && agreed(lastSaid(history))) {
    const { offer } = lastEntry;
    if (offer.kind === 'autoConfirm') {
      await settingsRepo.setAgentAutoConfirm(true);
      return {
        reply: 'Done, auto mode is on. I will make one deal changes straight away now, and still ask before anything that deletes, closes or reaches many deals.',
        changedRowIds: [], context: context.key, claims: [],
      };
    }
    if (offer.kind === 'specialCase' && offer.dealId) {
      const update = context.tools.find((t) => t.name === 'update_master_sheet_row');
      const done = await update.handler({
        id: offer.dealId, specialCaseDeal: true, confirmed: true, said: 'make this deal special', turn: turnState,
      });
      onEvent?.({ type: 'tool-result', name: 'update_master_sheet_row', result: done });
      const ok = /^Updated #/.test(String(done?.summary ?? ''));
      return {
        reply: ok
          ? `Done, ${offer.who ?? 'that deal'} is a special case now and is paid this month.`
          : String(done?.reply ?? done?.summary ?? 'That did not go through, nothing was changed.'),
        changedRowIds: ok ? [offer.dealId] : [], context: context.key, claims: [],
      };
    }
  }

  /**
   * ===============================
   * * SEVERAL CHANGES IN ONE MESSAGE ARE A PLAN, and a reply to a plan is read by it
   * ===============================
   * See engine/. Ahead of the held calls, so a "yes" to a plan is the plan's.
   * A plan that cannot be made (no AI, nothing understood) hands back to her.
   */
  const pending = pendingPlan(history);
  // A FILE THEY DROPPED IN rides on their message; a pasted sheet is the message.
  const attachment = [...history].reverse().find((m) => m.role === 'user')?.attachment ?? null;
  const attached = attachment ? (attachment.text || attachment.tables?.length ? true : null) : null;
  const sheetGiven = !pending && (attached || looksLikeSheet(asked));

  /**
   * ===============================
   * * THE FRONT DOOR: one small call decides the path. See engine/router.js.
   * ===============================
   * Not for what is already decided for free: a reply to a plan, a file, an
   * everyday edit the parser reads whole, or a short answer to her own
   * question ("yes", "both", "indigo"). Without an answer from it (no AI,
   * an error) the old keyword guesses decide, as before.
   */
  const editsHere = context.tools.some((t) => t.name === 'update_master_sheet_row');
  let routed = null;
  let routerEdit = null;
  const shortAnswer = /\?\s*$/.test(String(lastAssistantAnswer(history) ?? '').trim()) && asked.trim().split(/\s+/).length <= 4;
  if (!pending && !sheetGiven && editsHere && !shortAnswer && !agreed(asked)) {
    const rosterNow = await require('../repos/people.repo').filterOptions().catch(() => null);
    const namesNow = { people: (rosterNow?.people ?? []).map((p) => p.name), groups: rosterNow?.groups ?? [] };
    if (!parseEdit(asked, namesNow)) {
      routed = await routeMessage(asked, {
        lastAnswer: lastAssistantAnswer(history),
        groups: namesNow.groups,
        model: LIGHT_MODEL && LIGHT_MODEL !== 'off' && env.aiProvider === 'openai' ? LIGHT_MODEL : null,
      }).catch((err) => { logger.warn({ err: err.message }, 'diane: the router could not be asked'); return null; });
      if (routed) {
        logger.info({ route: routed }, 'diane: routed');
        captureLog({ source: 'agent', level: 'info', message: `Diane routed: ${routed.kind}${routed.sure ? '' : ' (unsure)'}`, detail: { said: asked, route: routed } });
        // A PERSON IT NAMED MUST BE ON THE SHEET, by the same reading as everywhere.
        const edit = asEdit(routed);
        // ONE TYPO FROM TWO PEOPLE IS A QUESTION, never a pick. Clone
        // 2026-10-06: "zyan" is one slip from Zayn AND Ryan; the first in the
        // list was taken, and it could as easily have been the other's pay.
        // A GROUP GLUED TO THE NAME ("zyan indgo") is taken off it first, typos
        // allowed, the way the parser and the tools split them.
        if (edit) {
          const words = String(edit.person).split(/\s+/);
          const g = words.map((w) => namesNow.groups.find((x) => fold(x) === fold(w) || (fold(w).length >= 4 && oneTypo(fold(w), fold(x))))).find(Boolean);
          if (g && words.length > 1) {
            edit.person = words.filter((w) => !(fold(w) === fold(g) || (fold(w).length >= 4 && oneTypo(fold(w), fold(g))))).join(' ');
            edit.group = edit.group || g;
          }
        }
        const exact = edit && namesNow.people.find((n) => fold(n) === fold(edit.person) || personMentionedIn(edit.person, n));
        const close = edit && !exact
          ? namesNow.people.filter((n) => n.split(/\s+/).some((w) => fold(w).length >= 4 && oneTypo(fold(edit.person), fold(w))))
          : [];
        if (!exact && close.length > 1) {
          return {
            reply: `Did you mean ${close.slice(0, -1).join(', ')} or ${close[close.length - 1]}? Nothing has changed.`,
            changedRowIds: [],
            context: context.key,
            claims: [],
          };
        }
        const real = exact ?? (close.length === 1 ? close[0] : null);
        if (real) routerEdit = { ...edit, person: real };
      }
    }
  }
  const toEngine = routed
    ? routed.sure && (routed.kind === 'multi_step' || (routed.kind === 'bulk_edit' && routed.person && !routed.group))
    : looksMultiStep(asked);
  if ((pending || sheetGiven || toEngine) && editsHere) {
    try {
      const roster = await require('../repos/people.repo').filterOptions().catch(() => null);
      turnState.model = env.openaiModel;
      const turn = sheetGiven
        ? await sheetTurn({
          text: attachment ? (attachment.text ?? '') : asked,
          tables: attachment?.tables ?? null,
          said: asked,
          groups: roster?.groups ?? [],
          onEvent,
        })
        : await planTurn({
        said: asked,
        pending,
        groups: roster?.groups ?? [],
        invoke: async (name, args) => {
          turnState.applyingHeld = true;
          turnState.planRun = true;
          try {
            return await invokeTool(context.tools, name, JSON.stringify(args), history, onEvent, turnState);
          } finally {
            turnState.applyingHeld = false;
            turnState.planRun = false;
          }
        },
      });
      if (turn) {
        onEvent?.({ type: 'list', list: turn.card });
        const ran = turn.card.plan?.status === 'done' ? turn.card.plan.steps.filter((x) => x.result?.ok) : [];
        return {
          reply: turn.reply,
          changedRowIds: [...new Set(ran.flatMap((x) => x.ids ?? []))],
          context: context.key,
          claims: [],
        };
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'diane: a plan could not be made, she takes it');
    }
  }

  const heldCalls = recallAll(lastSaid(history), prior);
  // A plain yes to the ONE thing held, when her question lost its details. See onlyHeld.
  if (heldCalls.length === 0 && agreed(lastSaid(history)) && /^\s*(?:y|ya|yes|yep|yeah|yup|ok|okay|sure|go ahead|do it|confirm\w*)[.!\s]*$/i.test(lastSaid(history))) {
    const one = onlyHeld();
    // ONLY IF HER LAST WORDS WERE ABOUT IT. After "I got a bit lost going
    // round in circles", a plain yes applied the change held from that same
    // muddle, which she never showed. gpt-4.1 messy sweep, 2026-10-06. Her
    // question may lose the figures; it may not lose the person.
    const priorFacts = facts(String(prior ?? ''));
    // A name, or the GROUP it is aimed at ("undo the CORVID part of change"
    // answered "put every CORVID monthly back"): capitals are not facts, so
    // a group is matched as a word, in any case.
    const priorText = String(prior ?? '');
    const groupsIn = (one?.confirming ?? '').match(/\b[A-Z]{3,}\b/g) ?? [];
    const CODES = new Set(['GBP', 'AED', 'USD', 'EUR', 'EURO', 'NOT', 'AND', 'THE', 'YES']);
    const aboutIt = one && ([...facts(one.confirming)].some((f) => /[a-z]/.test(f) && priorFacts.has(f))
      || groupsIn.filter((g) => !CODES.has(g)).some((g) => new RegExp(`\\b${g}\\b`, 'i').test(priorText))
      || targetNamed(one.aimedAt, priorText));
    if (one && aboutIt) heldCalls.push(one);
  }
  /**
   * A BARE YES TO NO QUESTION. After "Added Kiran Vale ..." a stray "yes"
   * ran a filter, a total and a lookup, and ended by asking which deal.
   * Nothing asked, nothing held: it is an acknowledgement. 2026-09-30.
   */
  // A THANKS IS NOT A YES, and a NO to nothing is not a question: "no" after
  // "nothing matched" went to recall and claimed deleting by date was not
  // possible, which it is. Both answered here, in plain words. 2026-10-04.
  const bare = lastSaid(history).trim();
  if (heldCalls.length === 0 && /^To add .+ I still need\b/.test(String(prior ?? '')) && CALLED_OFF_ADD.test(bare)) {
    return { reply: 'Okay, nothing was added. What next?', changedRowIds: [], context: context.key, claims: [] };
  }
  if (heldCalls.length === 0 && !somethingHeld() && prior && !String(prior).includes('?')) {
    const reply = /^(?:y|ya|yes|yep|yeah|yup|sure)[.!\s]*$/i.test(bare) ? 'Nothing is waiting on a yes. What next?'
      : /^(?:thanks|thank you|thx|ty|cheers|cool|great|perfect|nice)[.!\s]*$/i.test(bare) ? "You're welcome. What next?"
        : /^(?:ok|okay|k|alright|got it)[.!\s]*$/i.test(bare) ? 'Okay. What next?'
          // A NO AFTER A CHANGE THAT IS ALREADY SAVED is not "nothing changed":
          // with auto mode on, "the souracore one" applied at once, and the
          // "no" that followed was told nothing changed. 2026-10-04.
          : /^(?:no|nope|nah|no thanks|no leave it|leave it)[.!\s]*$/i.test(bare)
            ? (/\b(?:updated|is now|are now|stopped from|resumed|deleted|done,|raised|set to|has been)\b/i.test(String(prior))
              ? 'Okay. That change is already saved, so say "undo that" if you want it taken back.'
              : 'Okay, nothing changed. What next?')
            : null;
    if (reply) return { reply, changedRowIds: [], context: context.key, claims: [] };
  }
  /**
   * AND A YES TO "CHANGE X AND WHAT IS SHE OWED" STILL OWES THE ANSWER. Clone
   * run 2026-10-05: the preview said "owed the same as before", the yes said
   * "updated", and the figure they asked for was never given.
   */
  const askBeforeYes = agreed(lastSaid(history))
    ? String(history.filter((m) => m.role === 'user').slice(-2, -1)[0]?.content ?? '') : '';
  const owedAskWaiting = SECOND_ASK.test(askBeforeYes) && /\b(?:owed|owe|total|how much)\b/i.test(askBeforeYes);
  const appliedSummaries = [];
  const heldWrites = new WeakSet();
  for (const heldCall of heldCalls) {
    logger.info({ tool: heldCall.name }, 'diane: admin agreed, applying the pending change');
    // Confirmed by construction: this IS the agreed change being applied.
    onEvent?.({ type: 'tool', name: heldCall.name, confirmed: true });
    // SEQUENTIAL, not in parallel: they share `turnState`, which is how
    // two writes in one turn see each other.
    // FORGOTTEN AFTER, never before: invokeTool asks for it to allow the
    // confirm. Either way it is answered once, and a failure cannot wait on.
    let applied;
    // Whether THIS call wrote, read off the write tap the same way the
    // turn is: the result's shape is the tool's wording, not the fact.
    const wroteBefore = turnState.wrote.get('__written');
    turnState.wrote.set('__written', false);
    try {
      turnState.applyingHeld = true;
      // eslint-disable-next-line no-await-in-loop
      applied = await invokeTool(
        context.tools,
        heldCall.name,
        JSON.stringify({ ...heldCall.args, confirmed: true }),
        history,
        onEvent,
        turnState,
      );
    } finally {
      turnState.applyingHeld = false;
      forget(heldCall);
    }
    const heldWrote = Boolean(turnState.wrote.get('__written'));
    turnState.wrote.set('__written', Boolean(wroteBefore) || heldWrote);
    if (heldWrote && applied && typeof applied === 'object') heldWrites.add(applied);
    onEvent?.({ type: 'tool-result', name: heldCall.name, result: applied });
    // INTO THE SAME PLACES A NORMAL CALL LANDS: the figure guards check her
    // narration against it, and the pages refresh for the rows it touched.
    toolResults.push(applied);
    for (const r of applied.rows ?? []) changedRowIds.add(r.id);
    appliedSummaries.push(applied.summary);
  }
  /**
   * ONE HELD CHANGE, A PLAIN YES, A FINISHED SENTENCE: nothing left to say.
   * A second model round only to phrase "done" was most of a 30 second
   * yes. 2026-09-30. Anything more in their message still gets its round.
   */
  const onlyApplied = heldCalls.length === 1 ? toolResults[toolResults.length - 1] : null;
  if (onlyApplied?.computedReply && onlyApplied.reply
    && /^\s*(?:y|ya|yes|yep|yeah|yup|ok|okay|sure|go ahead|do it|confirm\w*)[.!\s]*$/i.test(lastSaid(history))) {
    // The owed figure they asked for with the change, worked out in code
    // after the write: no model round, and never the old figure.
    let owedLine = '';
    // By its deal id too: she often finds the deal first and sends only the id.
    const owedFor = heldCalls[0].args?.targetPerson ?? heldCalls[0].args?.person
      ?? (heldCalls[0].args?.id != null
        ? (await require('../repos/masterSheetRows.repo').findById(Number(heldCalls[0].args.id)).catch(() => null))?.person_name
        : undefined);
    if (owedAskWaiting && owedFor && !onlyApplied.pending && context.tools.some((t) => t.name === 'total_master_sheet')) {
      const owed = await invokeTool(context.tools, 'total_master_sheet', JSON.stringify({ person: owedFor }), history, onEvent, turnState)
        .catch(() => null);
      onEvent?.({ type: 'tool-result', name: 'total_master_sheet', result: owed });
      owedLine = /SAY EXACTLY THIS[^\n]*\n"([^"]+)"/.exec(String(owed?.summary ?? ''))?.[1] ?? '';
    }
    return {
      reply: owedLine ? `${onlyApplied.reply}\n${owedLine}` : onlyApplied.reply,
      changedRowIds: [...changedRowIds],
      context: context.key,
      claims: [],
      offer: turnState.wrote.get('__offer') ?? null,
    };
  }
  // Set AFTER the held calls, so they themselves still run. See invokeTool.
  if (appliedSummaries.length > 0) turnState.wrote.set('__held', true);
  if (appliedSummaries.length > 0) {
    /**
     * TOLD TO HER AS DONE, and `turnState` is what stops her doing it
     * again: it carries into the call below, so a repeat is refused by
     * `notTwice` rather than by this sentence.
     *
     * ONE MESSAGE CARRYING EVERY RESULT. Two messages and she narrated the
     * last one; this is the whole of what happened, in order.
     */
    /**
     * ONLY WHAT TOOK IS "DONE". Live 2026-09-30: the held change was
     * refused on the yes ("no deal matching harbor"), this still said
     * THIS IS DONE ALREADY, and she told them the monthly had changed.
     * A result that wrote rows or finished its own sentence took.
     *
     * AND ONE THE DATABASE SAYS WROTE took, whatever it returned. Live
     * 2026-10-03: a bulk fee change wrote all 6 rows, returned `rows: []`
     * (the list is on screen), and she was told NOTHING WAS CHANGED.
     */
    const heldResults = toolResults.slice(-heldCalls.length);
    const took = heldResults.some((r) => (r && typeof r === 'object' && heldWrites.has(r))
      || (!r?.pending && (r?.rows?.length > 0 || r?.computedReply)));
    messages.push({
      role: 'system',
      content: took
        ? 'THIS IS DONE ALREADY. They agreed, and the change was applied before you were '
          + 'asked anything. Do not call a tool to do it again and do not ask them to confirm it a '
          + 'second time: tell them what happened, from these results, ALL of them.\n\n'
          + appliedSummaries.join('\n\n')
        : 'WHAT THEY AGREED TO DID NOT GO THROUGH, and NOTHING WAS CHANGED. Do NOT say it was '
          + 'done or changed in any words. Tell them plainly why, from this result, and ask what '
          + 'it tells you to ask:\n\n'
          + appliedSummaries.join('\n\n'),
    });
  }

  // A plain no, before any tool can read the rest of the sentence. See blockBypass.js.
  const bypass = heldCalls.length === 0 ? bypassAttempt(lastSaid(history)) : null;
  if (bypass) {
    logger.warn({ pattern: bypass }, 'diane: possible attempt to bypass her rules');
    captureLog({
      source: 'agent',
      level: 'warn',
      message: 'possible attempt to bypass access rules',
      detail: { pattern: bypass, text: lastSaid(history).slice(0, 60) },
    });
    return { reply: BYPASS_REPLY, changedRowIds: [], context: context.key, claims: [] };
  }

  /**
   * AN EXPORT ASKED FOR WHILE EXPORT IS OFF is answered here, in its own
   * fixed words. Left to the model, "export the milkman sheet for me" was
   * answered with a filter and 26 deals, and the button was never named:
   * a turned off tool is one she is told not to call, so nothing routed the
   * ask to its refusal. 2026-10-03.
   */
  if (heldCalls.length === 0 && explicitExportRequest(lastSaid(history))
    && context.tools.some((t) => t.name === 'export_sheet' && t.disabledTool)) {
    return { reply: DISABLED.export_sheet, changedRowIds: [], context: context.key, claims: [] };
  }

  /**
   * A GREETING IN FRONT IS NOT THE QUESTION. "hi diane, quick one - is zayn
   * in nexus?" missed the yes or no route that "is zayn in nexus?" takes,
   * and the answer listed his deals with no yes or no. Clone 2026-10-05.
   */
  const routeSaid = String(lastSaid(history))
    .replace(/^\s*(?:(?:hi|hey|hello|hiya|yo|morning|good (?:morning|afternoon|evening)|ok(?:ay)?|so|right|diane|babe|darling|quick (?:one|q(?:uestion)?)|question|sorry|pls|please)\b[\s,.!:;-]*)+(?=\S)/i, '');
  const forcedTool = (FORCED_ROUTES
    .find(([asked, tool]) => (asked.test(lastSaid(history), history) || (routeSaid !== lastSaid(history) && asked.test(routeSaid, history)))
      && context.tools.some((t) => t.name === tool))?.[1] ?? null)
    ?? (BARE_YES.test(lastSaid(history)) && RESUME_OFFERED.test(lastAssistantAnswer(history))
      && heldCalls.length === 0 && context.tools.some((t) => t.name === 'resume_deal') ? 'resume_deal' : null);
  /**
   * A YES WITH NOTHING HELD, TO AN EDIT SHE ONLY TALKED ABOUT. She said "I'll
   * show you the change first, ok?" without calling anything, and the yes
   * was answered with a total. The yes is to the edit before it: run that
   * edit's preview now. It still asks before writing. gpt-4.1, 2026-10-06.
   */
  const askedBefore = String(history.filter((m) => m.role === 'user').slice(-2, -1)[0]?.content ?? '');
  const yesToTalkedEdit = !forcedTool && heldCalls.length === 0 && BARE_YES.test(lastSaid(history))
    && /\?\s*$/.test(String(lastAssistantAnswer(history) ?? '').trim())
    && EVERY_DEAL_EDIT.test(askedBefore) && context.tools.some((t) => t.name === 'bulk_update_master_sheet');
  if (yesToTalkedEdit) {
    messages.push({
      role: 'system',
      content: `THEY SAID YES TO THE CHANGE THEY ASKED FOR JUST BEFORE: "${askedBefore}". Nothing was previewed yet. `
        + 'Call bulk_update_master_sheet for exactly that change now, WITHOUT confirmed, so they see the real '
        + 'rows; then read the preview back and ask once.',
    });
  }
  /**
   * ===============================
   * * "DID YOU MEAN OTTO FENN?" "YES" IS THE ORIGINAL ORDER, FOR OTTO FENN
   * ===============================
   * gpt-4.1 messy sweep, 2026-10-06: "otto fen add 100", "did you mean Otto
   * Fenn?", "yes", and she tried to ADD A DEAL for him, because the yes
   * arrived with nothing held and the order was a turn behind. The yes
   * settles the name; the order is the one they gave. Re-run it, with its
   * preview, for the person she named.
   */
  let yesToName = null;
  if (!forcedTool && !yesToTalkedEdit && heldCalls.length === 0 && BARE_YES.test(lastSaid(history))
    && /\bdid you mean\b|\bdo you mean\b|\bmeant\b[^?]*\?/i.test(String(lastAssistantAnswer(history) ?? ''))
    && askedBefore && (isSetInstruction(askedBefore) || EVERY_DEAL.test(askedBefore))) {
    const people = (await require('../repos/people.repo').filterOptions().catch(() => null))?.people ?? [];
    const prior = String(lastAssistantAnswer(history) ?? '');
    const quoted = (prior.match(/"([^"]+)"/) ?? [])[1] ?? '';
    const named = [...new Set(people.map((p) => p.name))]
      .filter((n) => personMentionedIn(prior, n) && n.toLowerCase() !== quoted.toLowerCase());
    if (named.length === 1) {
      yesToName = named[0];
      messages.push({
        role: 'system',
        content: `THEY CONFIRMED THE PERSON IS ${yesToName}. Their request was: "${askedBefore}". Do exactly `
          + `that request now, for ${yesToName} (use that spelling), with its preview if it changes `
          + 'anything. Do not look them up again and do not ask anything else.',
      });
    }
  }
  /**
   * SEVERAL PEOPLE WHO ALREADY HAVE DEALS, EACH WITH A FIGURE, IS AN EDIT.
   * "felix orr monthly 1400 and juno park monthly 650" was taken as two new
   * deals and she asked which group and company each should go on; both
   * already had one. gpt-4.1 messy sweep, 2026-10-06. When an order names
   * two or more people on the sheet and asks for nothing new, the first
   * round is the bulk change, one entry per person.
   */
  let severalExisting = false;
  if (!forcedTool && heldCalls.length === 0 && isSetInstruction(lastSaid(history))
    && !LATER_MONTH.test(lastSaid(history))
    && !/\b(?:new|another|second|extra|create|open)\b|\badd(?:ing)?\s+(?:a\s+|an\s+)?(?:\w+\s+)?deal\b/i.test(lastSaid(history))
    && context.tools.some((t) => t.name === 'bulk_update_master_sheet')) {
    const everyone = (await require('../repos/people.repo').filterOptions().catch(() => null))?.people ?? [];
    const named = [...new Set(everyone.map((p) => p.name))].filter((n) => personMentionedIn(lastSaid(history), n));
    if (named.length >= 2) {
      severalExisting = true;
      messages.push({
        role: 'system',
        content: `${named.join(' and ')} ALREADY HAVE DEALS: this changes them, nothing new is added. Call `
          + 'bulk_update_master_sheet once with perPerson, one entry per person (allDeals true), with exactly '
          + 'what they said for each, so one preview covers everyone.',
      });
    }
  }
  /**
   * ===============================
   * * ONE PERSON AND AN EDIT IS THE ONE DEAL TOOL, FIRST
   * ===============================
   * The admin's call 2026-10-06. "deduct 100 from zayn" went three rounds of
   * her own "which deal?", each caught (an ambiguity no tool reported, an
   * instruction answered with a lookup), before she called anything, and one
   * named a group Zayn is not in. The tool asks which deal itself, from the
   * rows, so the first round is the tool. A rate or their own details is
   * update_person, and every deal or a later month already go elsewhere.
   */
  let oneExisting = false;
  if (!forcedTool && !severalExisting && heldCalls.length === 0 && isSetInstruction(asked)
    && !LATER_MONTH.test(asked) && !EVERY_DEAL.test(asked) && !OWN_TOOL.test(asked)
    && !/\b(?:new|another|second|extra|create|open)\b|\badd(?:ing)?\s+(?:a\s+|an\s+)?(?:\w+\s+)?deal\b/i.test(asked)
    && context.tools.some((t) => t.name === 'update_master_sheet_row')) {
    const everyone = (await require('../repos/people.repo').filterOptions().catch(() => null))?.people ?? [];
    oneExisting = new Set(everyone.map((p) => p.name).filter((n) => personMentionedIn(asked, n))).size === 1;
  }

  /**
   * ===============================
   * * "BOTH" AFTER A CHANGE THAT WENT ON ONE DEAL
   * ===============================
   * Clone 2026-10-06: "deduct 100 from zayn" landed on INDIGO, then "both",
   * and she answered "there's only one Zayn on the sheet" without looking.
   * He has two. "Both" there is the same change on the deals that did not
   * get it, so they are handed over by id, and the one already changed is
   * named as done so it is not changed twice.
   */
  let bothAfterOne = false;
  const lastAnswer = lastAssistantAnswer(history) ?? '';
  if (!forcedTool && !severalExisting && !oneExisting
    && /^\s*(?:both|all|both of them|all of them|both deals|all (?:of )?(?:his|her|their) deals|the other(?: one)? too|everywhere)\s*[.!]*\s*$/i.test(asked)
    && !/\?\s*$/.test(lastAnswer.trim())) {
    const before = recentSaid(history, 2).split('\n')[1] ?? '';
    const everyone = isSetInstruction(before)
      ? (await require('../repos/people.repo').filterOptions().catch(() => null))?.people ?? [] : [];
    const named = [...new Set(everyone.map((p) => p.name).filter((n) => personMentionedIn(before, n)))];
    if (named.length === 1) {
      const rows = ((await require('../repos/masterSheetRows.repo').findAll({ q: named[0], pageSize: 50 }).catch(() => null))?.rows ?? [])
        .filter((r) => !r.stopped_on && fold(r.person_name) === fold(named[0]));
      const done = rows.filter((r) => r.group_name && fold(lastAnswer).includes(fold(`in ${r.group_name}`)));
      const rest = rows.filter((r) => !done.includes(r));
      if (done.length > 0 && rest.length > 0) {
        bothAfterOne = true;
        turnState.otherDeals = { done: done.map((r) => Number(r.id)), rest: rest.map((r) => Number(r.id)) };
        messages.push({
          role: 'system',
          content: `"${asked}" MEANS THEIR LAST REQUEST ("${before}") ON ${named[0]}'s OTHER DEALS TOO. `
            + `Already done, do NOT change again: ${done.map((r) => `#${r.id} (${r.group_name})`).join(', ')}. `
            + `Call update_master_sheet_row once for each of these, by id, with the same change: `
            + `${rest.map((r) => `#${r.id} (${r.company}${r.group_name ? ` in ${r.group_name}` : ''})`).join(', ')}.`,
        });
      }
    }
  }

  /**
   * ===============================
   * * "NO, I MEANT INDIGO" PUTS THE LAST CHANGE BACK, THEN DOES IT THERE
   * ===============================
   * Clone 2026-10-06: "add 100 to zayn milkman", then "no I meant indigo",
   * added 100 to INDIGO and left MILKMAN's 100 in place. A correction names
   * which change is wrong, the one she reported a moment ago, so that one is
   * put back here, and only when the newest change on the sheet is hers on
   * the deal that answer named. Anything else is left to ask.
   */
  if (!forcedTool && heldCalls.length === 0
    && /^\s*(?:no+|nope|sorry|oops|wait|actually)\b[,!.\s]*(?:,?\s*)(?:i\s+)?(?:meant|mean|wanted)\b/i.test(asked)
    && /\bupdated\b|^Done\b/i.test(lastAnswer)) {
    try {
      const db = require('../../configs/db');
      const newest = (await db.query(
        `SELECT c.id, c.row_id, m.person_name, m.group_name FROM tb_mastersheet_changes c
           JOIN tb_mastersheet m ON m.id = c.row_id
          WHERE c.reverted_at IS NULL AND c.changed_via = 'diane' AND c.changed_at > now() - interval '15 minutes'
            AND c.changed_at = (SELECT max(changed_at) FROM tb_mastersheet_changes WHERE reverted_at IS NULL)`,
      ))?.rows ?? [];
      const ours = newest.length > 0 && newest.every((c) => fold(lastAnswer).includes(fold(c.person_name))
        && (!c.group_name || fold(lastAnswer).includes(fold(`in ${c.group_name}`))));
      if (ours) {
        const { done } = await require('../repos/masterSheetRows.repo')
          .revertChangeBatch(newest.map((c) => c.id), null, { via: 'diane', batchId: require('crypto').randomUUID() });
        const before = recentSaid(history, 2).split('\n')[1] ?? '';
        const where = `${newest[0].person_name}${newest[0].group_name ? ` in ${newest[0].group_name}` : ''}`;
        logger.info({ reverted: done.length, where }, 'diane: a correction, the last change put back');
        messages.push({
          role: 'system',
          content: `THEY CORRECTED THE LAST CHANGE. It has been PUT BACK on ${where} already, do not undo anything. `
            + `Now make their earlier request ("${before}") on what they name now ("${asked}"), and in the reply `
            + `say both: that ${where} is back as it was, and what changed instead.`,
        });
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'diane: a correction could not put the last change back');
    }
  }

  const routedTool = forcedTool ?? (severalExisting ? 'bulk_update_master_sheet' : null)
    ?? (oneExisting || bothAfterOne ? 'update_master_sheet_row' : null) ?? (yesToTalkedEdit
    || (yesToName && EVERY_DEAL_EDIT.test(askedBefore)) ? 'bulk_update_master_sheet' : null);
  if (routedTool && !roundTools.some((t) => t.function?.name === routedTool)) roundTools = openAITools;
  /**
   * AN INSTRUCTION IS ANSWERED BY A TOOL, FIRST. Clone 2026-10-06: "stop
   * paddy deal", "delete sweep tester deal", "add 100 to johnny nobody" each
   * opened with her own question or lookup in words, the checks threw it out
   * ("answered an instruction with a lookup", "invented an ambiguity") and
   * she went again: three rounds, paid for, before anything was looked at.
   * The tools ask the real question from the rows. `say` is a tool, so a
   * line of her own is still open to her.
   */
  const mustAct = !routedTool && heldCalls.length === 0 && isSetInstruction(asked) && !CALLED_OFF_ADD.test(asked);

  /**
   * ===============================
   * * THE EVERYDAY EDIT IS READ IN CODE, not by the model
   * ===============================
   * See directEdit.js. Read exactly, then handed to the tool she would have
   * called, through invokeTool, so every guard, preview, auto mode rule and
   * the "yes" that follows are the same as hers. A finished sentence from
   * the tool ends the turn with no model round at all; anything else is
   * handed to her to word.
   */
  if (!forcedTool && heldCalls.length === 0 && !turnState.otherDeals && !bothAfterOne
    && context.tools.some((t) => t.name === 'update_master_sheet_row')) {
    const roster = await require('../repos/people.repo').filterOptions().catch(() => null);
    const names = { people: (roster?.people ?? []).map((p) => p.name), groups: roster?.groups ?? [] };
    const edit = parseEdit(asked, names)
      ?? followUp(asked, recentSaid(history, 2).split('\n')[1] ?? '', lastAnswer, names)
      // THE ROUTER'S single edit, sure and on a real person, takes the same road.
      ?? routerEdit;
    if (edit) {
      const call = callFor(edit);
      turnState.model = 'code';
      logger.info({ edit, tool: call.name }, 'diane: an everyday edit, read in code');
      const result = await invokeTool(context.tools, call.name, JSON.stringify(call.args), history, onEvent, turnState);
      onEvent?.({ type: 'tool-result', name: call.name, result });
      if (result?.list?.rows?.length) onEvent?.({ type: 'list', list: result.list });
      for (const r of result?.rows ?? []) changedRowIds.add(r.id);
      if (typeof result?.reply === 'string' && result.reply.trim()) {
        return {
          reply: result.reply,
          changedRowIds: [...changedRowIds],
          context: context.key,
          claims: [],
          offer: turnState.wrote.get('__offer') ?? null,
        };
      }
      messages.push({
        role: 'system',
        content: `THIS WAS ALREADY CALLED FOR THEM, as ${call.name} ${JSON.stringify(call.args)}. It answered:\n`
          + `${result?.summary ?? ''}\nTell them what it says, in your own short words. Do not call it again.`,
      });
    }
  }

  // Which model this turn starts on. See `lightTurn`.
  let namedCount = 0;
  if (isSetInstruction(asked)) {
    const everyone = (await require('../repos/people.repo').filterOptions().catch(() => null))?.people ?? [];
    namedCount = new Set(everyone.map((p) => p.name).filter((n) => personMentionedIn(asked, n))).size;
  }
  const light = env.aiProvider === 'openai' && LIGHT_MODEL && LIGHT_MODEL !== 'off'
    && LIGHT_MODEL !== env.openaiModel && heldCalls.length === 0 && !severalExisting && !bothAfterOne
    && !turnState.otherDeals && (routed
      ? routed.sure && ['question', 'chat'].includes(routed.kind)
      : lightTurn(asked, lastAnswer, { named: namedCount, routedTool }));
  let turnModel = light ? LIGHT_MODEL : env.openaiModel;
  turnState.model = turnModel;
  logger.info({ model: turnModel }, 'diane: model for this turn');
  // A RETRY GOES TO THE FULL MODEL: a round that answered in words and was
  // sent round again by a check is the light model out of its depth.
  let lastHadTools = true;

  /**
   * A TOTAL TAKEN BEFORE A CHANGE IN THE SAME MESSAGE IS STALE. "make felix
   * orr's monthly 1400 and also whats he owed" totalled first, changed
   * second, and answered with the old 1,300. Once a write follows a total in
   * this turn, she is told to total again before answering. 2026-10-04.
   */
  let totalledBeforeWrite = false;
  let staleTotalPending = false;
  let staleTotalNudged = false;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (round > 0 && !lastHadTools && turnModel !== env.openaiModel) {
      turnModel = env.openaiModel;
      turnState.model = turnModel;
      logger.info({ model: turnModel, round }, 'diane: a retry, so the full model');
    }
    if (staleTotalPending && !staleTotalNudged) {
      staleTotalNudged = true;
      staleTotalPending = false;
      messages.push({
        role: 'system',
        content: totalledBeforeWrite
          ? 'THE TOTAL YOU GOT WAS WORKED OUT BEFORE THE CHANGE YOU JUST MADE, so it is the old '
            + 'figure. Call total_master_sheet again now and answer the question with the new one.'
          : `THE CHANGE IS DONE, and they also asked: "${askBeforeYes}". Call total_master_sheet now `
            + 'for that and say the new figure after saying what changed.',
      });
    }
    let completion;
    try {
      if (forceNextTool && !roundTools.some((t) => t.function?.name === forceNextTool)) roundTools = openAITools;
      completion = await streamCompletion(openai, {
        model: turnModel,
        temperature: 0.2,
        // Real incident: with no cap, one reply degenerated into the same
        // filler sentence repeated 50+ times with no line breaks — a
        // known small-model failure mode, not a markdown/formatting issue.
        // 220 fixed that but then cut the OTHER way: a genuinely detailed
        // reply (25 rows of recent changes) got squeezed down to bare
        // names to fit the budget instead of relaying the real per-row
        // detail. frequency_penalty is what actually guards against the
        // repetition failure; the token cap is just a backstop, so it can
        // afford to be generous.
        //
        // Raised from 700 after a second real incident: answering the new
        // deal checklist in one go (21 fields on one line) produced an
        // add_master_sheet_row call whose JSON arguments alone ran past the
        // cap. The call came back truncated, so there was no content and
        // no usable tool call, and the admin saw "I didn't catch that" for
        // a perfectly good answer. A whole row's worth of arguments is the
        // largest single thing she ever has to emit, so the cap has to
        // clear it comfortably.
        //
        max_tokens: maxTokens,
        frequency_penalty: 0.4,
        messages,
        tools: roundTools,
        // "WE GOOD?" RUNS THE CHECK. Asked it live, she answered "everything
        // looks smooth, no flags" having looked at nothing, with 29 findings
        // on the sheet. The first round is made to call it. 2026-09-30.
        ...((round === 0 && routedTool) || forceNextTool
          ? { tool_choice: { type: 'function', function: { name: forceNextTool ?? routedTool } } }
          : (round === 0 && mustAct ? { tool_choice: 'required' } : {})),
      });
      forceNextTool = null;
    } catch (err) {
      // The SDK's own status and body, not just err.message — "Request
      // failed" tells nobody anything, and this used to be the only trace
      // of three consecutive failures in a row. A 429 (rate/token limit)
      // and a 400 (request too large) need completely different responses
      // and looked identical from the outside.
      const detail = {
        status: err?.status,
        code: err?.error?.code ?? err?.code,
        providerMessage: err?.error?.message ?? err?.message,
        provider: env.aiProvider,
        model: env.openaiModel,
        context: context.key,
        round,
        historyChars: messages.reduce((n, m) => n + String(m.content ?? '').length, 0),
      };
      logger.error({ err, ...detail }, 'diane: model call failed');

      // Also to the Logs page. The generic error handler only captures
      // 5xx, and every model failure is a 4xx — a rate limit, a rejected
      // tool call — so these were reaching the console and nowhere else.
      // They're the single most useful thing to have on that page: the
      // admin sees "I've used up today's allowance", and this is where
      // the actual limit, usage and model behind it can be read.
      captureLog({
        source: 'agent',
        level: 'error',
        message: `Diane: model call failed (${detail.status ?? 'no status'})`,
        detail,
      });

      // NO CREDIT OR A REFUSED KEY LOCKS HER, and is not a rate limit: a 429 with
      // no balance said "give me a moment" when no moment would help. 2026-09-28.
      const lockedBy = noteAiFailure(err);
      if (lockedBy) throw new AppError(503, copy.agent.locked[lockedBy]);
      if (err?.status === 429) {
        // Say WHICH limit and for HOW LONG. "Try again in a few seconds"
        // was a guess, and a wrong one: a per-day token quota comes back
        // in minutes or hours, and being told to retry immediately means
        // burning more of an allowance that has already run out. Groq puts
        // the real wait in its own message, so it's lifted rather than
        // invented.
        // The trailing `.` is stripped because the character class has to
        // allow the decimal in "3m33.408s" and would otherwise swallow the
        // sentence's own full stop, giving "in about 20m30.768s.." — two
        // periods, which reads as a typo in the chat bubble.
        const wait = /try again in ([\dhms.]+)/i.exec(err?.error?.message ?? '')?.[1]?.replace(/\.+$/, '');
        const daily = /tokens per day/i.test(err?.error?.message ?? '');
        throw new AppError(
          429,
          daily
            ? `I've used up today's model allowance${wait ? `, it frees up in about ${wait}` : ''}. Nothing's broken, I just can't think again until then.`
            : `I'm being rate limited${wait ? `, try me again in about ${wait}` : ', give me a moment'}.`,
        );
      }
      if (err?.status === 400) {
        throw new AppError(400, copy.agent.tooMuchAtOnce);
      }
      throw new AppError(502, copy.agent.unreachable);
    }

    const choice = completion.choices[0]?.message;
    lastHadTools = (choice?.tool_calls ?? []).length > 0;
    if (!choice) throw new AppError(502, "Something came back garbled on my end, sweetie. Try me once more?");

    const finishReason = completion.choices[0]?.finish_reason;

    /**
     * CHANGES FIRST, READS AFTER, within one round. Live 2026-09-30: "make
     * drew's monthly 1300 and whats gab owed" ran the total BEFORE the write
     * in the same round and quoted Drew's old GBP 3,250. Calls sent together
     * cannot depend on each other's results, so the order is free to fix.
     */
    const writesFirst = (list) => {
      const writes = (name) => Boolean(context.tools.find((t) => t.name === name)?.writes);
      return [...list.filter((c) => writes(c?.function?.name)), ...list.filter((c) => !writes(c?.function?.name))];
    };
    // MORE_TOOLS: she asked for the full set. Hand it over and go again.
    if ((choice.tool_calls ?? []).some((c) => c.function?.name === MORE_TOOLS.function.name)) {
      roundTools = openAITools;
      widened = true;
      logger.info({ context: context.key, round }, 'diane: asked for more tools');
      messages.push(choice);
      for (const c of choice.tool_calls) {
        messages.push({
          role: 'tool',
          tool_call_id: c.id,
          content: c.function?.name === MORE_TOOLS.function.name
            ? 'Every tool is available now. Carry on with what they asked.'
            : 'Not run: ask again now that every tool is available.',
        });
      }
      continue;
    }
    const calls = writesFirst(coalesceBreakdownCalls(choice.tool_calls ?? []));
    if (calls.length === 0) {
      /**
       * THE TOOL'S OWN WORDING IS NEVER READ OUT. confirmFirst tells her not
       * to repeat "NOTHING HAS BEEN CHANGED YET..." or "This would stop this
       * deal, touching 1 deal. WHAT SURVIVES:", and she still did, under her
       * own sentence that already said it. Cut in code. 2026-10-04.
       */
      if (choice.content) {
        choice.content = choice.content
          .replace(/\s*NOTHING HAS BEEN CHANGED YET,? and nothing will be until (?:you|they) say yes\.?/gi, '')
          .replace(/\s*This would [^.\n]*?, touching \d+ [a-z ]+?\.(?:\s*WHAT SURVIVES:[^\n]*)?(?=\s*(?:\n|$))/g, (m, offset, all) => (
            // Only when her own words already said it: alone, it IS the preview.
            all.slice(0, offset).trim().length > 20 ? '' : m))
          .replace(/\n{3,}/g, '\n\n');
      }
      let raw = choice.content?.trim();

      // The budget ran out. Two ways that shows, and only the first was
      // ever caught:
      //
      //   EMPTY    the model reasons before it writes and that reasoning is
      //            charged against max_tokens, so a hard question can spend
      //            the whole allowance and emit nothing.
      //   CUT OFF  a long answer that simply did not fit. This one is
      //            worse, because it looks like an answer: asked to relay
      //            thirty rows of changes she returned a paragraph that
      //            stopped mid-list, and the admin had no way to tell.
      //
      // A TRUNCATED REPLY IS A FAILED TURN, not a shorter answer. Retried
      // on `length` whatever came back, once, so the headroom is paid for
      // only when it is actually needed.
      if (finishReason === 'length' && !raisedBudget) {
        raisedBudget = true;
        maxTokens = RETRY_MAX_TOKENS;
        logger.warn(
          { context: context.key, round, hadContent: Boolean(raw) },
          'diane: reply hit the token cap, retrying with a larger one',
        );
        continue;
      }

      // STILL TRUNCATED AFTER THE RETRY. The rule above held for the first
      // cut and not the second: a reply that ran past 8,000 tokens was
      // handed over as though it were finished, which is the case the rule
      // exists for. Half an answer that looks whole is worse than none.
      if (finishReason === 'length' && raw) {
        logger.warn(
          { context: context.key, round, chars: raw.length },
          'diane: reply truncated even at the raised cap',
        );
        captureLog({
          source: 'agent',
          level: 'warn',
          message: 'Diane: reply truncated at the raised token cap',
          detail: { context: context.key, round, chars: raw.length, model: env.openaiModel },
        });
        return {
          reply: noDashes(stripMarkdown(
            `${raw}\n\nI ran out of room part way through, so that answer is cut off. `
            + 'Ask me for it in pieces and you will get all of it.',
          )),
          changedRowIds: [...changedRowIds],
          context: context.key,
          claims: turnState.claims,
          // Auto mode offered once, after a confirmation they actually gave.
          offer: turnState.wrote.get('__offer') ?? null,
          truncated: true,
        };
      }

      // Typed claims are checked as values before any wording based guard.
      // Empty claims fall through to the prose guards, which stay as the
      // fallback when the model omits metadata.
      if (raw && turnState.claims.length > 0) {
        const checked = checkClaims(turnState.claims, toolResults);
        if (!checked.ok) {
          const invalid = checked.invalid;
          turnState.claims = [];
          if (!claimRetry) {
            claimRetry = true;
            logger.warn(
              { context: context.key, round, invalid },
              'diane: typed claims contradict tool values, retrying',
            );
            captureLog({
              source: 'agent',
              level: 'warn',
              message: 'Diane stated typed claims the tools do not support',
              detail: { invalid, reply: raw, context: context.key },
            });
            messages.push(choice);
            messages.push({
              role: 'user',
              content: 'STOP. Your typed claims do not match the read tools. Check these claims: '
                + `${JSON.stringify(invalid)}. Call the needed read tool again, then call `
                + 'state_claims with only supported values before answering again.',
            });
            continue;
          }
        }
      }

      /**
       * ===============================
       * * A FIGURE SHE DID NOT GET FROM A TOOL
       * ===============================
       * The prompt forbids adding amounts up, quoting a remembered one and
       * contradicting the tool, and names the exact incident it came from.
       * It still happened: asked Nicola's August total she answered "owed
       * nothing" off the cards she had just shown, where the tool computes
       * 2,900.
       *
       * PROMPTING IS NOT A GUARD, so the reply is checked against what the
       * tools actually produced. Retried ONCE with the figures restated;
       * her reply is never rewritten, because silently editing money would
       * be worse than either outcome.
       */
      if (raw && !figureRetry) {
        const check = checkFigures(raw, toolResults);
        if (check.had && !check.ok) {
          figureRetry = true;
          logger.warn(
            { context: context.key, round, unsupported: check.unsupported },
            'diane: reply stated a figure no tool produced, retrying',
          );
          captureLog({
            source: 'agent',
            level: 'warn',
            message: 'Diane stated a figure no tool produced',
            detail: { unsupported: check.unsupported, reply: raw, context: context.key },
          });
          messages.push(choice);
          messages.push({
            role: 'user',
            content: 'STOP. That reply contains a figure no tool returned: '
              + `${check.unsupported.join(', ')}. Say the answer again using ONLY the figures the `
              + 'tools gave you in this turn, exactly as they gave them. '
              + (turnState.wrote.get('__pending')
                ? 'A change is waiting for their yes: quote only its lines, and no total.'
                // After a write, the result lines ARE the answer; a total there answered a question nobody asked.
                : turnState.wrote.get('__written') || appliedSummaries.length > 0
                  ? 'The change is done: say what changed using only the figures in its result lines, and no total.'
                  // An instruction wants its tool, not a total: "keep Ines going" was answered with what she is owed.
                  : isSetInstruction(lastSaid(history)) || KEEPS_REVIEW.test(lastSaid(history))
                    ? `They gave an instruction, so no total answers it.\n\n${correctionFor(lastSaid(history))}`
                    : 'If you did not call total_master_sheet, call it now before answering.'),
          });
          continue;
        }
      }

      /**
       * ===============================
       * * A ZERO IS A FIGURE CLAIM WEARING NO NUMBER
       * ===============================
       * `checkFigures` was written for the Nicola turn and could not catch
       * the repeat, because the wrong half contained no digits:
       *
       *   "owed nothing for August 2026 ... also owed nothing for
       *    September 2026. The same rows apply as for August."
       *
       * August was right. September was 2,900. She called the tool once,
       * for August, and wrote the second sentence herself. Both months are
       * stripped as dates and "3 rows" is under SMALLEST, so the figure set
       * came back EMPTY and the guard had nothing to check.
       *
       * So the months are checked too: one she makes a money claim about
       * has to be one a tool actually reported on.
       */
      if (raw && !monthRetry) {
        const check = checkMonths(raw, toolResults);
        if (check.had && !check.ok) {
          monthRetry = true;
          logger.warn(
            { context: context.key, round, uncovered: check.uncovered },
            'diane: reply answered for a month no tool computed, retrying',
          );
          captureLog({
            source: 'agent',
            level: 'warn',
            message: 'Diane answered for a month no tool computed',
            detail: { uncovered: check.uncovered, reply: raw, context: context.key },
          });
          messages.push(choice);
          messages.push({
            role: 'user',
            content: 'STOP. You gave an amount for a month no tool computed this turn: '
              + `${check.uncovered.join(', ')}. A month you did not compute is a month you `
              + 'cannot answer for, and "nothing" is an amount. Call total_master_sheet for '
              + 'EACH month you intend to mention, then answer using only what it returns. '
              + 'Never reuse one month\'s result for another month.',
          });
          continue;
        }
      }

      /**
       * ===============================
       * * A REAL FIGURE FOR THE WRONG QUESTION
       * ===============================
       * Every check above asks whether a figure is real. This asks whether
       * the answer is the right KIND. Live 2026-09-07: "did we earn more
       * than last month" got September's total twice and no comparison;
       * "who is on the most money" got the whole sheet's total.
       *
       * Neither is catchable by checking the number, because the number is
       * correct. Both are facts about what the TOOLS returned: a comparison
       * needs two months computed, a superlative needs rows to rank.
       */
      if (raw && !questionRetry) {
        const check = checkQuestion(raw, lastSaid(history), toolResults);
        if (!check.ok) {
          questionRetry = true;
          logger.warn(
            { context: context.key, round, kind: check.kind },
            'diane: answered a different shape of question, retrying',
          );
          captureLog({
            source: 'agent',
            level: 'warn',
            message: 'Diane answered a different shape of question',
            detail: { kind: check.kind, reply: raw, context: context.key },
          });
          messages.push(choice);
          messages.push({ role: 'user', content: `STOP. ${QUESTION_INSTEAD[check.kind]}` });
          continue;
        }
      }

      /**
       * ===============================
       * * A RATE SITS UNDER EVERY FIGURE CHECK THERE IS
       * ===============================
       *
       * Asked what percentage was on Gloria Difference she said there was
       * none, then said 5% when pushed. The deal's add on is 0 and the
       * person's is 5, and the two STACK.
       *
       * `checkFigures` ignores anything under 100, so no percentage in the
       * system is visible to it, and the first answer had no digits at all.
       * See checkPercents: a stated rate and a denied one are both claims.
       */
      if (raw && !percentRetry) {
        // Their own figure, echoed back while proposing it, is not invented.
        const told = isSetInstruction(lastSaid(history)) ? lastSaid(history) : '';
        const check = checkPercents(raw, toolResults, { told });
        if (check.had && !check.ok) {
          percentRetry = true;
          logger.warn(
            { context: context.key, round, unsupported: check.unsupported, denied: check.denied },
            'diane: reply stated or denied a rate the tools contradict, retrying',
          );
          captureLog({
            source: 'agent',
            level: 'warn',
            message: 'Diane stated or denied a rate the tools contradict',
            detail: {
              unsupported: check.unsupported, denied: check.denied, reply: raw, context: context.key,
            },
          });
          messages.push(choice);
          messages.push({
            role: 'user',
            content: 'STOP. Your answer about percentages does not match what the tool returned'
              + `${check.unsupported.length ? `. You said ${check.unsupported.join('%, ')}%, which no tool produced` : ''}`
              + `${check.denied.length ? `. You said "${check.denied.join('", "')}" while a rate above zero exists` : ''}`
              + '. A rate sits on the PERSON and on the DEAL and the two STACK, so check both '
              + 'before saying there is none. Read the tool result again and answer with the '
              + 'exact figures in it, saying for each which way it goes.',
          });
          continue;
        }
      }

      /**
       * ===============================
       * * AND A DAY COUNT IS A CLAIM TOO
       * ===============================
       *
       * "Changing Richard's payable days from 31 to 0" on a row holding 30.
       * The prompt requires the read-back to say what each column changes
       * FROM, nothing hands her the from, so she filled it in.
       *
       * Under checkFigures' floor of 100, like every percentage. See
       * checkDays: a value the admin typed is theirs, not a claim.
       */
      if (raw && !dayRetry) {
        const check = checkDays(raw, toolResults, lastSaid(history));
        if (check.had && !check.ok) {
          dayRetry = true;
          logger.warn(
            { context: context.key, round, unsupported: check.unsupported, known: check.known },
            'diane: reply stated a payable day count no tool produced, retrying',
          );
          captureLog({
            source: 'agent',
            level: 'warn',
            message: 'Diane stated a payable day count no tool produced',
            detail: {
              unsupported: check.unsupported, known: check.known, reply: raw, context: context.key,
            },
          });
          messages.push(choice);
          messages.push({
            role: 'user',
            content: `STOP. You said ${check.unsupported.join(', ')} payable days and no tool `
              + `returned that. The tools returned ${check.known.join(', ')}. Never work out or `
              + 'remember what a row currently holds: read it from the tool result in front of '
              + 'you, and if it is not there, look it up before you say what it is changing from.',
          });
          continue;
        }
      }

      /**
       * ===============================
       * * AND A REFUSAL SHE WAS NEVER HANDED
       * ===============================
       *
       * "There are several Richards on the sheet, which one do you mean?"
       * One Richard, one row, and every tool that turn resolved him. Two
       * turns later she drew his card and said he has one deal.
       *
       * Every other guard here watches what she CLAIMS SHE DID. This is the
       * opposite shape and the worse one: an invented ambiguity ends the
       * turn and sends the admin looking for somebody who is not there.
       */
      if (raw && !ambiguityRetry) {
        const check = checkAmbiguity(raw, toolResults);
        if (!check.ok) {
          ambiguityRetry = true;
          logger.warn(
            { context: context.key, round },
            'diane: asked which person when no tool reported one, retrying',
          );
          captureLog({
            source: 'agent',
            level: 'warn',
            message: 'Diane invented an ambiguity no tool reported',
            detail: { reply: raw, context: context.key },
          });
          messages.push(choice);
          messages.push({
            role: 'user',
            content: 'STOP. You asked which person they meant and NO TOOL SAID THE NAME WAS '
              + 'AMBIGUOUS. You cannot decide that yourself: the lookup does it, and it resolved. '
              + 'Answer with the person it found. If you are unsure, look the name up again and '
              + 'read the result, but do not invent a second person who is not on the sheet.',
          });
          continue;
        }
      }

      /**
       * ===============================
       * * AND A VALUE SHE READ OFF NOTHING
       * ===============================
       *
       * "And his role?" answered "Mid 1" on a row reading Loss lead, and
       * "and company he handles?" answered a company he is not on. No tool
       * ran on either turn. The lookup, given the same sentence, returns
       * the right answer for both.
       *
       * Text, so no figure, count or percent guard could see it. The card
       * she already drew is the evidence: see checkAgainstCard.
       */
      // A question about the data answered with no tool. See checkEmptyClaim.js.
      if (raw && !emptyRetry && answeredFromMemory(raw, { said: lastSaid(history), toolCount: toolResults.length })) {
        emptyRetry = true;
        logger.warn({ context: context.key, round }, 'diane: answered a data question with no tool, retrying');
        messages.push(choice);
        messages.push({
          role: 'user',
          // NOT THE ADMIN'S VOICE: on gpt-4.1 she thanked them "for catching that". 2026-09-28.
          content: 'INTERNAL CHECK, not from the admin: never mention it, thank anyone for it or '
            + 'apologise. Your answer used no tool, and a question about the data is answered from '
            + 'a tool. Call the one that answers their message, then answer them with only what it '
            + 'returns, as if this note never existed.',
        });
        continue;
      }

      if (raw && !cardRetry) {
        const check = checkAgainstCard(raw, lastSaid(history), toolResults, history);
        if (!check.ok) {
          cardRetry = true;
          logger.warn(
            { context: context.key, round, label: check.label },
            'diane: stated a field value that contradicts the card she showed, retrying',
          );
          captureLog({
            source: 'agent',
            level: 'warn',
            message: 'Diane stated a field value the card contradicts',
            detail: {
              label: check.label, value: check.value, reply: raw, context: context.key,
            },
          });
          messages.push(choice);
          messages.push({
            role: 'user',
            content: `STOP. You called no tool and answered from memory. ${check.who}'s `
              + `${check.label} is "${check.value}" on the card already on screen, and your answer `
              + 'does not say that. Never answer a question about a row from memory: look it up '
              + 'with find_and_show_details, naming the person, and answer with what it returns.',
          });
          continue;
        }
      }

      /**
       * ===============================
       * * AND A COUNT IS A CLAIM TOO
       * ===============================
       *
       * `checkFigures` ignores anything under 100 on purpose, because
       * "4 deals" is a count and flagging every honest sentence would be
       * worse than the fault. She walked straight into the gap:
       *
       *   tool:  3 rows, Zayn twice and Paddy once
       *   Diane: "two rows for Zayn and TWO for Paddy ... all FOUR rows"
       *
       * Paddy has one. Nothing caught it because the number was a WORD, and
       * every other guard here counts digits. A count is a promise about
       * what is on the sheet, and on forecasting it becomes "three groups"
       * and "four months", which nobody can check by eye.
       *
       * Its own retry flag: a wrong count and a wrong amount are two
       * different mistakes and each is worth one correction.
       */
      if (raw && !countRetry) {
        const counts = checkCounts(raw, toolResults);
        if (counts.had && !counts.ok) {
          countRetry = true;
          logger.warn(
            { context: context.key, round, wrong: counts.wrong },
            'diane: reply stated a count no tool produced, retrying',
          );
          captureLog({
            source: 'agent',
            level: 'warn',
            message: 'Diane stated a count no tool produced',
            detail: { wrong: counts.wrong, reply: raw, context: context.key },
          });
          messages.push(choice);
          messages.push({
            role: 'user',
            content: 'STOP. You counted something the tools did not. '
              + `${counts.wrong.map((w) => `you said ${w.said} ${w.noun}${w.said === 1 ? '' : 's'}, `
                + `and the tool said ${w.known.join(' or ')}`).join('; ')}. `
              + 'COUNT THE ROWS THE TOOL ACTUALLY RETURNED and say the answer again. Do not '
              + 'estimate, do not split a total between people unless the tool did, and do not '
              + 'round. If you are unsure, say the total the tool gave and nothing more.',
          });
          continue;
        }
      }

      /**
       * ===============================
       * * A COUNT BORROWED FROM ANOTHER GROUP
       * ===============================
       * "2 deals in MILKMAN and 2 deals in MANBAT", where MANBAT holds 3.
       * The check above cannot see it: 2 WAS produced by a tool, so as a
       * bare figure it passes. What is wrong is the group beside it.
       * See checkCounts.js.
       */
      if (raw && !countRetry) {
        const scoped = checkCountsByGroup(raw, toolResults);
        if (!scoped.ok) {
          countRetry = true;
          logger.warn(
            { context: context.key, round, wrong: scoped.wrong },
            'diane: attached a count to the wrong group, retrying',
          );
          captureLog({
            source: 'agent',
            level: 'warn',
            message: 'Diane gave a group a count from another group',
            detail: { wrong: scoped.wrong, reply: raw, context: context.key },
          });
          messages.push(choice);
          messages.push({
            role: 'user',
            content: 'STOP. A count you gave belongs to a different group. '
              + `${scoped.wrong.map((w) => `you said ${w.said} for ${w.group} and the tool `
                + `returned ${w.known}`).join('; ')}. `
              + 'COUNT EACH GROUP FROM ITS OWN ROWS. A number you have already said for one '
              + 'group is not evidence about another, and if you have not looked a group up, '
              + 'say so rather than carrying a figure across.',
          });
          continue;
        }
      }

      /**
       * ===============================
       * * NOT THE SAME SENTENCE TWICE
       * ===============================
       * Asked "are you sure that is correct?" she repeated her previous
       * line word for word. Re-running the tool and getting the same figure
       * is exactly right; saying it in the same words is what makes it read
       * as a broken machine rather than a person who has just checked.
       *
       * The FACTS must not move. Only the wording, plus a word saying she
       * looked again.
       */
      /**
       * ===============================
       * * SHE SAID SHE PAUSED IT AND CALLED NOTHING
       * ===============================
       * Real transcript. "Hold on, park that" got "the sheet is paused and
       * waiting for you" with no tool call, and the panel sat there open.
       * "Forget it, drop the export" got "it was cancelled" and it was not.
       *
       * Adding the arguments was not enough, and neither was the prompt:
       * pause reads to the model as a conversational acknowledgement rather
       * than an act. So it is checked. A claim that the screen changed,
       * with nothing sent to the screen, is the same fault as claiming to
       * uncheck a column.
       */
      const currentExport = lastExportSession(toolResults);
      if (raw && !panelRetry && currentExport && asksWrongExportStep(raw, currentExport)) {
        panelRetry = true;
        const { stagesFor } = require('./exportStages');
        const stages = currentExport.stages
          ?? stagesFor(currentExport.draft, currentExport.draft.answered ?? []);
        const step = stages.steps.find((item) => item.id === stages.next)?.label ?? stages.next;
        logger.info({ context: context.key, round, step }, 'diane: asked ahead of the export card');
        messages.push(choice);
        messages.push({
          role: 'user',
          content: `STOP. The export card is waiting for ${step}. Ask about ${step} only. `
            + 'Do not ask about a later stage until the export tool returns it as the next step.',
        });
        continue;
      }

      /**
       * ===============================
       * * SHE NAMED A GROUP THE FILE DOES NOT CONTAIN
       * ===============================
       * The guard above is skipped the moment a tool ran, so a GENUINE
       * build described with the wrong group passed everything. Live
       * 2026-09-06: an all groups bank file of 21 rows handed over as
       * "the bank sheet for Nexus with 21 deals". NEXUS has 2.
       *
       * Its own retry flag: a wrong scope and a claimed panel act are two
       * different faults and each is worth one correction.
       */
      const builtExport = lastExportSession(toolResults);
      if (raw && !scopeRetry && builtExport) {
        const groups = await knownGroupNames();
        const scoped = checkExportScope(raw, builtExport, groups);
        if (!scoped.ok) {
          scopeRetry = true;
          logger.warn(
            { context: context.key, round, named: scoped.named, scope: scoped.scope },
            'diane: named a group the export does not contain, retrying',
          );
          messages.push(choice);
          messages.push({
            role: 'user',
            content: `THE FILE IS NOT ${scoped.named.join(' or ')}'s. It is scoped to `
              + `${scoped.scope.length ? scoped.scope.join(', ') : 'EVERY group'}, and the card on their `
              + 'screen says so. Describe the file you actually built. If they asked for one group and '
              + 'the card is not scoped to it, say the card still covers every group and offer to '
              + 'narrow it. Never name a group as the scope of a file that does not have it.',
          });
          continue;
        }
      }

      if (raw && !panelRetry && !calledExport && wantsPanelAct(history, raw)) {
        panelRetry = true;
        logger.info({ context: context.key, round }, 'diane: claimed a panel act with no tool call');
        messages.push(choice);
        messages.push({
          role: 'user',
          content: 'You did NOT do that. EVERY change to the export card is a TOOL CALL, not '
            + 'something that happens because you said it. Nothing on their screen has moved, and '
            + 'they are looking at it.\n\n'
            + 'Dropping or adding a COLUMN is export_sheet with hideColumns or showColumns. A '
            + 'colour is primaryColor. Pausing is pause true and dropping it is cancel true, and '
            + 'those two are different acts: PAUSE KEEPS EVERY CHOICE, CANCEL DROPS IT. Do not '
            + 'guess between them; if you genuinely cannot tell which they meant, ask once. At '
            + 'the Groups step, "all of them" is allGroups true; the real group named "ALL '
            + 'GROUPS" is groups ["ALL GROUPS"].',
        });
        continue;
      }

      /**
       * SHE OFFERED SOMETHING SHE HAS NO TOOL FOR.
       *
       * "Now can you forecast?" got "Forecasting sounds exciting, darling!
       * What exactly do you want to forecast?" and three kinds to choose
       * from. She cannot forecast anything: no tool, and no stored month to
       * work from. An offer is a promise the next turn has to break.
       *
       * Retires itself: each entry names the tool that would make the offer
       * true, so the day it exists this stops firing. See cannotYet.js.
       */
      if (raw && !promiseRetry) {
        const promised = cannotYet(raw, context.tools);
        if (!promised.ok) {
          promiseRetry = true;
          logger.warn(
            { context: context.key, round, what: promised.missing.what },
            'diane: offered a capability she does not have',
          );
          captureLog({
            source: 'agent',
            level: 'warn',
            message: `Diane offered ${promised.missing.what}, which she cannot do`,
            detail: { what: promised.missing.what, needs: promised.missing.tool, reply: raw },
          });
          messages.push(choice);
          messages.push({
            role: 'user',
            content: `STOP. ${promised.missing.instead}`,
          });
          continue;
        }
      }

      /**
       * THEY SAID MAKE AND SHE SAID NO, AS A FACT ABOUT THE FIELD.
       *
       * "make bram a special case deal" came back "Bram Oakhurst's special
       * case: No." One in three phrasings routed to the lookup instead of
       * the write. The lookup is fine; ending the turn on it is not.
       */
      if (raw && !setRetry
        && answeredWithoutWriting(lastSaid(history), wroteThisTurn, toolResults)) {
        setRetry = true;
        logger.warn({ context: context.key, round }, 'diane: looked a field up instead of setting it');
        captureLog({
          source: 'agent',
          level: 'warn',
          message: 'Diane answered an instruction with a lookup',
          detail: { said: lastSaid(history), reply: raw },
        });
        messages.push(choice);
        messages.push({ role: 'user', content: correctionFor(lastSaid(history)) });
        continue;
      }

      /**
       * A DEAL MISSING FROM THE LIST SHE WAS ASKED TO RELAY.
       *
       * `confirmFirst` sends the lines when a count cannot be judged by,
       * and told to relay them she writes her own sentence. Dropping one
       * is agreement to something never shown. See checkRelayed.js.
       */
      /**
       * SHE PROMISED A TOOL THAT IS TURNED OFF.
       *
       * Refused an export she answered "say go or build it and I'll start
       * it", one turn after being told nothing was done and nothing is on
       * screen. See disabledTools.js.
       */
      /**
       * SHE READ THE TOOL'S STAGE DIRECTIONS OUT.
       *
       * "List them and ask which ONE, giving their names EXACTLY as
       * written above. Change nothing yet." All of that is resolvePerson
       * talking to her. See checkLeak.js.
       */
      if (raw && !leakRetry) {
        const leak = checkLeak(raw);
        if (!leak.ok) {
          leakRetry = true;
          logger.warn(
            { context: context.key, round, leaked: leak.leaked },
            'diane: read a tool instruction out to the admin',
          );
          messages.push(choice);
          messages.push({
            role: 'user',
            content: `STOP. ${leak.leaked} is an instruction to YOU, not something to say to `
              + 'them. Everything a tool hands back is either a FIGURE to quote or an order '
              + 'about how to answer, and the orders stay backstage.\n\n'
              + 'Say the same thing in your own words, as one short line to a person who cannot '
              + 'see any of this.'
              // The retry dropped the "No." it was handed. 2026-09-25.
              + verdictsIn(toolResults).map((v) => `\n\nStill open with: ${v.line}`).join(''),
          });
          continue;
        }
      }

      if (raw && !directionRetry) {
        const direction = checkRateDirection(raw, toolResults);
        if (!direction.ok) {
          directionRetry = true;
          logger.warn({ context: context.key, round }, 'diane: said a rate moved the wrong way');
          messages.push(choice);
          messages.push({
            role: 'user',
            content: `STOP. "${direction.wrong}" moves the wrong rate, or moves it the wrong way. `
              + 'The lines you were given say exactly which rate goes from what to what: say it as '
              + 'they do. A fee going up is a new or bigger fee, never "reduced".',
          });
          continue;
        }
      }

      if (raw && !pointRetry) {
        const pointed = checkPointed(raw, toolResults);
        if (!pointed.ok) {
          pointRetry = true;
          logger.warn(
            { context: context.key, round, tool: pointed.tool },
            'diane: answered a turned off tool without pointing at the button',
          );
          captureLog({
            source: 'agent',
            level: 'warn',
            message: `Diane described ${pointed.tool} as possible after it refused`,
            detail: { tool: pointed.tool, reply: raw },
          });
          messages.push(choice);
          messages.push({
            role: 'user',
            content: `STOP. That is TURNED OFF. Nothing was done, nothing is on screen, and `
              + 'there is nothing for them to say "go" to. Do not describe it as started, '
              + 'pending, ready or waiting on them.\n\n'
              + `Send them to the ${pointed.button} button on the Master sheet page, name it, `
              + 'and say nothing else about it.',
          });
          continue;
        }
      }

      if (raw && !unbackedRetry && unbackedAsk(raw, {
        said: lastSaid(history),
        pending: Boolean(turnState.wrote.get('__pending')),
        applied: appliedSummaries.length > 0,
      })) {
        unbackedRetry = true;
        logger.warn({ context: context.key, round }, 'diane: asked for a yes with nothing pending');
        messages.push(choice);
        messages.push({
          role: 'user',
          content: 'NOTHING IS WAITING FOR THEIR YES, so a yes now would change nothing. They gave an '
            + 'instruction: call the tool that makes it NOW. One that asks first comes back pending with '
            + 'the lines to show; one that does not just does it. If a tool refused, say what it refused '
            + 'and ask only what it told you to ask.'
            + (KEEPS_REVIEW.test(lastSaid(history)) ? `\n\n${correctionFor(lastSaid(history))}` : ''),
        });
        continue;
      }

      if (raw && !wroteClaimRetry
        && claimedWrite(raw, { said: lastSaid(history), wrote: Boolean(turnState.wrote.get('__written')) })) {
        wroteClaimRetry = true;
        logger.warn({ context: context.key, round }, 'diane: said a change was made and nothing was written');
        messages.push(choice);
        messages.push({
          role: 'user',
          content: 'NOTHING WAS WRITTEN THIS TURN, so nothing changed now. If that change was already '
            + 'made on an earlier turn, say so and ask what else they need. If it was never made, '
            + 'call the tool that makes it: it comes back pending, and you show them what it would do.',
        });
        continue;
      }

      /**
       * TOLD TO ASK WHO, SO SHE ASKS. Live 2026-10-03: "whats glorai owed
       * and also how many deals does drew have?" — the total refused
       * "glorai" and said to ask Gloria or Gloria difference; she answered
       * "Gloria is owed nothing this month", a figure for a person nobody
       * had picked. Gloria is owed GBP 2,000. An answer with no question in
       * it, on a turn a tool could not tell who, goes back once.
       */
      if (raw && !askWhoRetry && turnState.askedWho && !/\?/.test(raw)) {
        askWhoRetry = true;
        logger.warn({ context: context.key, round }, 'diane: a tool asked who, and she answered instead');
        messages.push(choice);
        messages.push({
          role: 'user',
          content: 'A TOOL COULD NOT TELL WHICH PERSON THEY MEANT, and you answered anyway. Give NO '
            + 'figure for that person. Ask which one they meant, with the names exactly as the tool '
            + 'gave them. Anything else they asked that a tool did answer, keep.',
        });
        continue;
      }

      /**
       * A PHONE OR ACCOUNT NUMBER IS READ, NEVER REMEMBERED. Live 2026-10-03:
       * "what's drew's phone number?" called nothing and was answered with
       * NATHAN's number from the previous answer. Drew's is different. A long
       * digit string in her reply that no tool returned THIS turn goes back.
       */
      const digitsIn = (text) => (String(text ?? '').match(/\+?\d[\d\s-]{7,}\d/g) ?? [])
        .map((d) => d.replace(/[\s-]/g, ''));
      const stated = raw ? digitsIn(raw) : [];
      if (stated.length > 0 && !contactRetry) {
        const seen = JSON.stringify(toolResults);
        const unbacked = stated.filter((d) => !seen.replace(/[\s-]/g, '').includes(d.replace(/^\+/, '')));
        if (unbacked.length > 0) {
          contactRetry = true;
          logger.warn({ context: context.key, round }, 'diane: stated a number no tool returned this turn');
          messages.push(choice);
          messages.push({
            role: 'user',
            content: `NOTHING THIS TURN RETURNED ${unbacked.join(', ')}. Never repeat a phone, account or `
              + 'sort code from memory or from another person. Look the person up now with '
              + 'find_and_show_details and say only what it returns.',
          });
          continue;
        }
      }

      if (raw && !stopClaimRetry && claimedStop(raw, {
        wrote: Boolean(turnState.wrote.get('__written')), stopped: Boolean(turnState.wrote.get('__stopped')),
      })) {
        stopClaimRetry = true;
        logger.warn({ context: context.key, round }, 'diane: said a deal was stopped and nothing stopped it');
        messages.push(choice);
        messages.push({
          role: 'user',
          content: 'NO DEAL WAS STOPPED THIS TURN. Nothing moved to the Archive. Say only what the tool '
            + 'that ran actually did, in its own words. If they want the deal ended, call stop_deal.',
        });
        continue;
      }

      if (raw && !verdictRetry) {
        const verdict = checkVerdict(raw, toolResults, { said: lastSaid(history) });
        if (!verdict.ok) {
          verdictRetry = true;
          logger.warn({ context: context.key, round }, 'diane: answered a yes or no without the yes or no');
          messages.push(choice);
          messages.push({
            role: 'user',
            content: verdict.noTool
              ? 'THEY ASKED A YES OR NO ABOUT A RATE and nothing worked the answer out. Call '
                + 'check_rates for that person now and open with the sentence it gives you.'
              : 'THEY ASKED A YES OR NO QUESTION and your answer never says which. Open with '
                + `exactly this, then add anything useful:\n\n${verdict.missing.join('\n')}`,
          });
          continue;
        }
      }

      /**
       * ===============================
       * * DEALS AND COMPANIES NOBODY LOOKED UP
       * ===============================
       * Random conversation 2026-10-04: "wait which one?" was answered with
       * NO tool call: "Mara Quill has two deals! One at Northstar Care ...
       * and another at Silverline Services". She has one, at Pinecrest. The
       * figure guard checks numbers; this checks NAMES. With no tool in the
       * turn, a company or a deal count she states must already be on
       * screen in this conversation, or she looks it up first. Once.
       */
      // AND WITH TOOLS TOO: after a lookup that returned Byron's two real
      // deals, she answered "Northstar Care and Relia PA". Northstar Care is
      // a PLACEHOLDER from her own prompt (promptPlaceholders.js), and so are
      // the "Example" people; one of those in a reply is never real. A name
      // is supported if this turn's tools or the conversation showed it.
      if (raw && !unseenRetry) {
        const seen = fold(`${history.map((m) => `${m.content ?? ''} ${JSON.stringify(m.list ?? m.card ?? m.check ?? '')}`).join(' ')} ${JSON.stringify(toolResults)}`);
        // ONE LINE: across a break, "in NEXUS\nDewell" read as a company called
        // that, and a relayed preview list was refused. Clone 2026-10-05.
        const named = [...raw.matchAll(/\b(?:at|with|on|in)[ \t]+([A-Z][\w&'-]+(?:[ \t]+[A-Z][\w&'-]+)*)/g)]
          // "at Ironleaf's" is Ironleaf: the possessive was a false alarm.
          .map((m) => m[1].replace(/['’]s$/i, ''))
          .filter((n) => !/^(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|GBP|USD|AED|EUR|EURO|Euros?|Dollars?|Dirhams?|Pounds?|Sterling|Cash|Crypto|Bank|I|Diane|The|This|That|Archive|Master Sheet|USD\s.*)$/.test(n));
        const placeholder = [...PROMPT_PLACEHOLDERS.people, ...PROMPT_PLACEHOLDERS.companies]
          .filter((n) => raw.includes(n) && !seen.includes(fold(n)));
        const counted = toolResults.length === 0 && /\bha(?:s|ve)\s+(?:\d+|one|two|three|four|five|six|several)\s+deals?\b/i.test(raw);
        const unseen = [...new Set([...named.filter((n) => !seen.includes(fold(n))), ...placeholder])];
        if (unseen.length > 0 || (counted && !/\bdeals?\b/i.test(history.map((m) => m.content ?? '').join(' ')))) {
          unseenRetry = true;
          logger.warn({ context: context.key, round, unseen }, 'diane: named deals or companies no tool showed, retrying');
          messages.push(choice);
          messages.push({
            role: 'user',
            content: `STOP. You stated deals or companies that nothing in this conversation showed you${unseen.length ? ` (${unseen.join(', ')})` : ''}. `
              + 'Look the person up with find_and_show_details and answer ONLY from what it returns.',
          });
          continue;
        }
      }

      /**
       * A SECOND QUESTION'S COMPUTED ANSWER IS NEVER DROPPED. "how many deals
       * in baker and whos owed most there": the ranking was worked out in
       * code with SAY EXACTLY THIS, and she answered the count alone, every
       * run. gpt-4.1 core suite, 2026-10-06. When they asked two things and a
       * line she was told to say is missing, it goes out as written.
       */
      if (raw && /\band\b|\balso\b|,/i.test(lastSaid(history))) {
        const owedFacts = facts(raw);
        const missingSay = toolResults
          .filter((r) => !r?.pending)
          .map((r) => /SAY EXACTLY THIS[^\n]*\n"([^"]+)"/.exec(String(r?.summary ?? ''))?.[1]
            ?? (r?.computedReply && typeof r.reply === 'string' && /\d/.test(r.reply) ? r.reply : null))
          .filter(Boolean)
          .filter((line) => [...facts(line)].some((f) => /\d/.test(f) && !owedFacts.has(f)));
        if (missingSay.length > 0) raw = `${raw.trim()}\n${missingSay.join('\n')}`;
      }
      /**
       * ===============================
       * * EVERY PERSON THEY NAMED IS IN THE PREVIEW
       * ===============================
       * gpt-4.1 messy sweep, 2026-10-06: "felix orr monthly 1400 and juno
       * park monthly 650" was previewed for Felix alone and the yes saved
       * Felix alone; Juno was never mentioned again. A person named in the
       * order and missing from every pending change this turn gets one
       * retry, and if still missing is said out loud, never dropped.
       */
      if (raw && isSetInstruction(lastSaid(history))) {
        const pendingText = toolResults.filter((r) => r?.pending)
          .map((r) => `${r.confirming ?? ''}\n${(r.lines ?? []).join('\n')}\n${r.summary ?? ''}`).join('\n');
        if (pendingText.trim()) {
          const everyone = (await require('../repos/people.repo').filterOptions().catch(() => null))?.people ?? [];
          const said = lastSaid(history);
          const named = [...new Set(everyone.map((p) => p.name))].filter((n) => personMentionedIn(said, n));
          const left = named.filter((n) => !personMentionedIn(pendingText, n));
          if (named.length > 1 && left.length > 0 && !namedRetry) {
            namedRetry = true;
            forceNextTool = 'bulk_update_master_sheet';
            logger.warn({ context: context.key, round, left }, 'diane: left a named person out of the change');
            messages.push(choice);
            messages.push({
              role: 'user',
              content: `YOU LEFT ${left.join(', ').toUpperCase()} OUT. They named ${named.join(', ')} in one order. `
                + 'Call bulk_update_master_sheet ONCE with perPerson, one entry per person with exactly what they '
                + 'said for that person, so ONE preview covers everyone. Do not drop anybody.',
            });
            continue;
          }
          if (named.length > 1 && left.length > 0) raw = `${raw.trim()}\n\n(Not included yet: ${left.join(', ')}.)`;
        }
      }
      /**
       * AND AFTER THE ONE RETRY, THE LINES GO OUT ANYWAY. A list she still
       * drops lines from is never sent short: the missing ones are added
       * word for word, because a yes applies every held change whether or
       * not she read it out. 2026-10-06.
       */
      if (raw && relayRetry) {
        const still = checkRelayed(raw, toolResults);
        if (!still.ok) raw = `${raw.trim()}\n\nAlso:\n${still.missing.join('\n')}`;
      }
      if (raw && !relayRetry) {
        const relayed = checkRelayed(raw, toolResults);
        if (!relayed.ok) {
          relayRetry = true;
          logger.warn(
            { context: context.key, round, missing: relayed.missing.length },
            'diane: left deals out of the list she was asked to relay',
          );
          captureLog({
            source: 'agent',
            level: 'warn',
            message: `Diane left ${relayed.missing.length} line(s) out of a confirmation list`,
            detail: { missing: relayed.missing, reply: raw },
          });
          messages.push(choice);
          messages.push({
            role: 'user',
            content: 'YOU LEFT SOMETHING OUT, and they are about to agree to a list they cannot '
              + `see. Missing:\n\n${relayed.missing.join('\n')}\n\n`
              + 'Say it again with EVERY line, one per line, each naming the deal and what it '
              + 'would get. You may use your own words; you may not drop a line, merge two, or '
              + 'round a figure.',
          });
          continue;
        }
      }

      // A FRESH PREVIEW IS NEVER A REPEAT. An undo of the change just made
      // carries the same figures back the other way, was read as her saying
      // it again, and she was told not to ask: she answered "you already
      // answered" and the yes undid nothing. gpt-4.1 core suite, 2026-10-06.
      if (raw && !repeatRetry && !toolResults.some((r) => r?.pending) && saidAlready(raw, history)) {
        repeatRetry = true;
        logger.info({ context: context.key, round }, 'diane: repeated herself, asking again');
        messages.push(choice);
        messages.push({
          role: 'user',
          // ASKING TWICE IS THE FAULT, not the wording. Told only to
          // rephrase, she asked the same question in fresh words and the
          // loop carried on looking new. Their reply IS the answer: act on
          // it, or say what is actually stopping you.
          content: 'You have already said that. If you were ANSWERING, say it again in different '
            + 'words, with every figure, date and name unchanged.\n\n'
            /**
             * THIS LINE TAUGHT HER TO CLAIM A CHECK NOBODY ASKED FOR.
             *
             * It used to end "if they asked whether you are sure, say
             * plainly that you checked and it has not moved", with the
             * condition left to her. Asked "convert it to usd" she opened
             * "I double-checked and the numbers are steady as ever ...
             * Nothing has shifted!" for a question that was not a doubt.
             * Three replies in one session did it.
             *
             * The condition is knowable, so it is decided here.
             */
            + (askedToCheck(lastSaid(history))
              ? 'They DID ask whether you are sure, so say plainly that you checked and it has '
                + 'not moved.\n\n'
              : 'They did NOT ask whether you were sure, and they did not doubt you. Do NOT say '
                + 'you double-checked, that nothing has changed, that the figures are steady, or '
                + 'that it is the same as before. They asked something NEW. Answer THAT, and let '
                + 'the figures repeat quietly if they happen to be the same.\n\n')
            + 'If you were ASKING THEM SOMETHING, you have now asked twice and been answered '
            + 'twice. Do not ask a third time. Their reply is the choice: take it and act. If it '
            + 'genuinely does not resolve, say in one sentence what you still cannot tell apart '
            + 'and what would settle it. Warmly, dear, and never the same question again.',
        });
        continue;
      }

      // An empty reply used to be reported to the admin as "I didn't catch
      // that", which blames THEM for a model-side failure and gives nobody
      // anything to act on.
      if (!raw) {
        logger.warn(
          { finishReason, context: context.key, round, raisedBudget },
          'diane: model returned no content and no tool calls',
        );
        captureLog({
          source: 'agent',
          level: 'warn',
          message: 'Diane: empty reply from the model',
          detail: { finishReason, context: context.key, round, raisedBudget, model: env.openaiModel },
        });
      }

      const emptyReply = finishReason === 'length'
        ? "That one's too big for me to work through in one go, dear. Could you split it in two?"
        : "I lost my train of thought there, lovely. Could you say that again?";

      return {
        // The prompt already says "no markdown" — this is the same
        // belt-and-suspenders whatbot's own noDashes.js is for elsewhere
        // in this project: asked-for behaviour is mostly obeyed, and
        // "mostly" still leaves literal asterisks in a chat bubble.
        reply: dealWords(withExportReminder(
          easeOffPetNames(raw
            ? dropUnaskedApology(noDashes(stripMarkdown(withVerdict(raw, toolResults, { said: lastSaid(history) }))), lastSaid(history))
            : emptyReply, history),
          history,
          calledExport,
        )),
        changedRowIds: [...changedRowIds],
        context: context.key,
        claims: turnState.claims,
        // Auto mode offered once, after a confirmation they actually gave.
        offer: turnState.wrote.get('__offer') ?? null,
      };
    }

    messages.push(choice);

    // A tool may return `reply`, meaning "this output IS the answer".
    // Collected rather than returned mid-loop so every call in this round
    // still runs — a round can legitimately contain a read and a write.
    let terminalReply = null;
    let terminalComputed = false;
    // Two tools each handed back a finished answer, so neither is THE
    // answer: see the block that sets it.
    let terminalPartial = false;
    // Whether the tool that produced the terminal reply WRITES. A lookup
    // cannot speak for a turn that changed something.
    let terminalWrote = false;

    // Interim lines she chose to say mid-turn. Counted so the terminal
    // shortcut below can tell "one real tool" from "one real tool plus a
    // remark", which would otherwise stop being a single-tool round and
    // cost an extra model call to say what the tool already said.
    let interimCount = 0;

    /**
     * ===============================
     * * THE SAME CALL, TWICE, IN ONE ROUND
     * ===============================
     * Seen in two audits: `filter_master_sheet` emitted twice with
     * IDENTICAL arguments in one message. It is waste rather than a wrong
     * answer, but it is seconds of the admin's time and a second chance for
     * a guard to fire on the same thing.
     *
     * WITHIN ONE ROUND ONLY, and that is the whole safety of it. The model
     * issues these together, so nothing can have changed between them and
     * no tool gains from running twice on the same arguments, a write least
     * of all. ACROSS rounds is a different question and is left alone: an
     * update followed by a re-read must not be served the reading from
     * before the write.
     *
     * No list of which tools are reads. A list like that is one more thing
     * to keep current, and the one that drifted would be the one that let a
     * write through.
     */
    const seenThisRound = new Map();

    // An interim line covers work happening beside it. Whether there IS any
    // has to be known before the first call runs, because the answer
    // changes what the model is told about its own line.
    const roundHasWork = workBesideInterim(calls, context.tools);

    /**
     * ===============================
     * * A HELD TOOL IS ANNOUNCED, never absent
     * ===============================
     * She knows every tool exists, because her capability block is built
     * from all of them. So reaching for a held one is her being right, and
     * the only honest answer is to hand it over rather than to refuse.
     *
     * NOTHING IS REFUSED AND NOTHING IS GUESSED AT. The turn widens, she
     * calls it again next round with her own arguments, and the whole cost
     * is one round on the turns that actually need a bulk or a delete.
     *
     * The alternative was letting it fall through to "No such tool here",
     * which is exactly the false limitation this session spent all day
     * fixing: she would have told him the CRM cannot do a thing it can.
     */
    if (!widened) {
      const wanted = calls
        .filter((c) => c.type === 'function' && HELD_UNTIL_NEEDED.includes(c.function?.name))
        .map((c) => c.function.name);
      /**
       * THE ROUTED TOOL RUNS, it is not announced. Live 2026-10-03: "actually
       * scrap that" was routed to the undo, she called it, the turn widened
       * instead of running it, and she answered "ready to undo, confirm?" in
       * prose with nothing previewed, so the yes undid nothing. The route
       * already chose this tool for this message; it carries its own preview.
       */
      if (wanted.length > 0 && wanted.every((n) => n === routedTool)) {
        widened = true;
        roundTools = openAITools;
      }
      if (wanted.length > 0 && !widened) {
        widened = true;
        roundTools = openAITools;
        logger.info({ context: context.key, round, tools: wanted }, 'diane: turn widened');
        for (const call of calls) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: HELD_UNTIL_NEEDED.includes(call.function?.name)
              ? `${call.function.name} IS AVAILABLE NOW. Nothing was done and nothing was `
                + 'refused: it reaches many rows or ends something, so it is handed over only '
                + 'once you ask for it. Call it again with the same arguments.'
              : 'Not run: another call in this round needed a tool that has just been handed '
                + 'over. Call this again if you still need it.',
          });
        }
        // eslint-disable-next-line no-continue
        continue;
      }
    }

    for (const call of calls) {
      if (call.type !== 'function') continue;
      if (call.function.name === 'export_sheet') calledExport = true;
      // A FACT ABOUT THE CALL, never about her prose: did anything that
      // CHANGES DATA run at all? The flag is on the tool. See setIntent.js.
      if (context.tools.find((t) => t.name === call.function.name)?.writes) {
        if (totalledBeforeWrite || owedAskWaiting) staleTotalPending = true;
        wroteThisTurn = true;
      }
      if (call.function.name === 'total_master_sheet' && !wroteThisTurn) totalledBeforeWrite = true;

      const fingerprint = `${call.function.name}(${call.function.arguments ?? ''})`;
      if (seenThisRound.has(fingerprint)) {
        logger.info(
          { context: context.key, round, tool: call.function.name },
          'diane: same call twice in one round, serving the first result',
        );
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: seenThisRound.get(fingerprint),
        });
        continue;
      }
      if (call.function.name !== 'state_claims') {
        onEvent?.({ type: 'tool', name: call.function.name, confirmed: isConfirmed(call.function.arguments) });
      }
      const result = await invokeTool(context.tools, call.function.name, call.function.arguments, history, onEvent, turnState);
      // WHAT THE TOOL SAID, for anything watching. The browser ignores it;
      // scripts/dianeChat.js prints it, because a transcript showing only
      // tool NAMES cannot tell a quoted figure from an invented one.
      if (!result.typedClaims) onEvent?.({ type: 'tool-result', name: call.function.name, result });
      if (!result.typedClaims) toolResults.push(result);
      for (const r of result.rows ?? []) changedRowIds.add(r.id);
      // A REFUSED INTERIM CANNOT BE REPORTED AS DELIVERED. `say`'s own
      // summary tells her the admin has already heard it; left in place on
      // a line nobody saw, she leaves it out of the reply too and the
      // answer goes missing. See interimLine.js.
      const held = result.said ? interimHolds(result.said, roundHasWork) : null;
      const content = held && !held.ok ? held.summary : result.summary;
      messages.push({ role: 'tool', tool_call_id: call.id, content });
      seenThisRound.set(fingerprint, content);
      // A RESULT THAT SENDS HER TO A HELD TOOL hands it over. "Use
      // bulk_update_master_sheet with people" with that tool not in the
      // list read to her as "cannot", and she said so. 2026-09-29.
      if (!widened && HELD_UNTIL_NEEDED.some((h) => String(content ?? '').includes(h))) {
        widened = true;
        roundTools = openAITools;
      }
      for (const id of call.combinedToolCallIds ?? []) {
        messages.push({
          role: 'tool',
          tool_call_id: id,
          content: 'Combined into the breakdown result returned by the first reporting call.',
        });
      }

      /**
       * SENT STRAIGHT OUT, not collected into the final reply.
       *
       * The browser renders it as its own finished bubble and speaks it
       * while the rest of the turn is still running, which is the whole
       * point: the four seconds a lookup takes stop being silent.
       *
       * Cleaned the same way every other line is — she is as capable of
       * putting an asterisk in a two-word remark as in a paragraph.
       */
      if (result.said) {
        if (held.ok) {
          interimCount += 1;
          onEvent?.({ type: 'message', text: noDashes(stripMarkdown(result.said)) });
        } else {
          logger.info(
            { context: context.key, round, reason: held.summary.slice(0, 40) },
            'diane: interim line held back',
          );
        }
        continue;
      }

      /**
       * A FORM, rendered as inputs in the conversation.
       *
       * Sent as its own event for the same reason `say` is: the browser
       * can draw it, and the model cannot accidentally turn it back into
       * prose. The tool's `summary` is what stops her listing the same
       * twenty fields underneath the thing that already shows them.
       *
       * NOT counted as interim. A form IS the answer to "I want to add a
       * deal", so the round should still end on the tool rather than
       * spending another model call to say "there you go".
       */
      if (result.form) {
        onEvent?.({ type: 'form', form: result.form });
      }

      // Dictated values typed into the form already on screen. Not counted
      // as interim: filling a form IS the work of that turn, and the round
      // should still end on it rather than buying another model call.
      if (result.formFill) {
        onEvent?.({ type: 'form-fill', values: result.formFill });
      }

      /**
       * One card per row, drawn by the browser.
       *
       * These replaced a thirty-one line `label: value` dump that used to
       * be returned as the whole answer. It ended the turn in one round,
       * which was fast, and it also meant she never said anything of her
       * own about the row. Now the card appears immediately and she spends
       * one more round saying the single thing worth hearing — which is
       * also the only part that gets spoken.
       */
      /**
       * ONLY WHEN THEY ASKED TO SEE IT. His rule, said twice (2026-10-03 and
       * 2026-10-04): "add 500 to zayn in milkman" drew Zayn's whole card
       * under a one-line answer. A change, a total or a lookup of one detail
       * is answered in words; a card is drawn when the message asks to SEE
       * a deal (show, details, card, open, full, pull up, view).
       */
      if (CARD_ASKED.test(lastSaid(history) ?? '')) {
        for (const card of unseenCards(result.cards, shownCardIds)) {
          onEvent?.({ type: 'card', card });
        }
      }

      /**
       * THE EXPORT PANEL, which is a session rather than an answer.
       *
       * It carries the resolved draft, the live count and the warnings.
       * It deliberately does NOT carry the template, column, design or
       * colour lists: the panel fetches those itself, so the model never
       * holds a list it could get wrong and the panel can never draw a
       * stale one. See docs/plans/diane-export.md.
       */
      if (result.exportSession) {
        onEvent?.({ type: 'export-session', session: result.exportSession });
      }

      // PAUSE AND CANCEL carry no draft: one keeps what is already on
      // screen and the other removes it, so resending the panel would be
      // the opposite of the point.
      if (result.exportPause) onEvent?.({ type: 'export-pause' });
      if (result.exportCancel) onEvent?.({ type: 'export-cancel' });

      // Too many to show as cards, so one line each. Same event shape, a
      // different component draws it.
      //
      // NOT IF IT IS THE ONE SHE JUST DREW. "Are you sure that's 30?" made
      // her reprint all thirty rows to say yes. Re-running the tool is
      // right; redrawing the answer is not.
      if (result.list) {
        /**
         * ===============================
         * * AND NOT TWICE IN ONE ANSWER EITHER
         * ===============================
         * `drawnAlready` compares against the PREVIOUS TURN, so two calls
         * in ONE turn that return the same rows drew the same panel twice.
         * Live 2026-09-24: the 2 deal MILKMAN list appeared twice in one
         * answer, which reads as two different findings that happen to
         * match.
         *
         * Same signature, so the two checks cannot disagree about what
         * "the same list" is.
         */
        const sig = listSignature(result.list?.rows);
        if (drawnAlready(result.list, history) || (sig && shownLists.has(sig))) {
          result.summary = `${result.summary ?? ''}\n\n${SAY_IT_INSTEAD}`.trim();
        } else {
          if (sig) shownLists.add(sig);
          onEvent?.({ type: 'list', list: result.list });
        }
      }

      /**
       * THE SHEET CHECK IS DRAWN, the same way a list is.
       *
       * Its own event rather than a card: the report is one structure with
       * six sections in cost order, and rendering it is the whole point.
       * She says one line about it and stops; reading a drawn report back
       * out loud is the wall it replaced. See shared/sheetCheck.helper.js.
       */
      // ONCE A TURN: the same report drawn twice in a row, live 2026-10-05.
      if (result?.check && !turnState.wrote.get('__check')) {
        turnState.wrote.set('__check', true);
        onEvent?.({ type: 'check', check: result.check });
      }

      /**
       * ===============================
       * * THE FIRST REPLY CANNOT SPEAK FOR THE WHOLE SCREEN
       * ===============================
       * Live 2026-09-18. "Show both" ran `find_and_show_details` twice, one
       * per person. BOTH cards were drawn and the FIRST call's sentence
       * became the turn's whole answer:
       *
       *   "James McCamley has one deal. The full details are on screen."
       *
       * Two people on screen, a sentence about one. The tool was right
       * about its own rows; nothing was right about the turn.
       *
       * So a SECOND terminal reply in one round disqualifies the shortcut
       * rather than being ignored. Neither describes everything that was
       * drawn, so the round costs a model call and she writes a sentence
       * that covers the lot. The shortcut is a speed optimisation and this
       * is the case where it was buying speed with a false answer.
       */
      // A CALL WITH NO FINISHED SENTENCE (a refusal, an instruction) cannot be
      // spoken for by another call's: "keep B running, C final" wrote B, refused C,
      // and B's sentence ended the turn as if both were done. 2026-09-28.
      if (!result.reply) terminalPartial = true;
      if (result.reply) {
        if (terminalReply && result.reply !== terminalReply) terminalPartial = true;
        else if (!terminalReply) {
          terminalReply = result.reply;
          terminalComputed = Boolean(result.computedReply);
          // WHICH TOOL SAID IT. A lookup's sentence may not stand as the
          // answer to a turn that WROTE something. See below.
          terminalWrote = Boolean(
            context.tools.find((t) => t.name === call.function.name)?.writes,
          );

        }
      }
    }

    /**
     * End the turn on the tool's own output, skipping the round that would
     * otherwise exist only to retype it.
     *
     * Measured: "show me Zane's details" spent ~12 seconds on a model call
     * whose entire job was to reproduce a block the tool had already
     * formatted — and which kept reintroducing the double spacing and
     * bullet points that stripMarkdown then had to remove again.
     *
     * Only when this round asked for ONE REAL tool. Two or more means she
     * was doing something composite (look up two people, or read then
     * write), and the model still has to tie those together into one
     * answer.
     *
     * Interim remarks do not count. "Say hang on, then show me Zane" is
     * still one lookup, and counting the remark would lose the shortcut
     * and spend a whole extra model call retyping the block the tool had
     * already formatted — which is the exact 12 seconds this shortcut was
     * measured to save.
     */
    /**
     * ===============================
     * * AND IT CANNOT ANSWER AN INSTRUCTION WITH A LOOKUP
     * ===============================
     * "make corin ashby a special deal" drew his card, and the card tool's
     * own finished sentence ("Corin Ashby has one deal. The full details
     * are on screen.") became the whole turn. Every reply guard below is
     * on the model's prose, and this path returns without ever writing
     * any, so the correction could not see it: the fix looked right and
     * changed nothing for two runs.
     *
     * The shortcut exists to skip a round that would only retype the
     * tool's block. Here that round is the one that does the work.
     */
    const dodgedTheInstruction = answeredWithoutWriting(
      lastSaid(history), wroteThisTurn, toolResults,
    );
    /**
     * ===============================
     * * AND A WRITE IS THE NEWS, NOT THE LOOKUP AFTER IT
     * ===============================
     * Live 2026-09-24. "Undo that" undid it, then drew the row's card, and
     * the CARD's sentence became the whole answer: "Odile Prang has one
     * deal. The full details are on screen." The undo had happened and
     * nothing said so.
     *
     * A lookup's finished sentence describes the lookup. It cannot speak
     * for a turn that also changed something, so the round is spent and
     * she says what moved.
     */
    const lookupSpokeForAWrite = wroteThisTurn && terminalReply && !terminalWrote;
    /**
     * TWO ASKS, ONE TOOL SO FAR. Live 2026-09-30: "make drew's monthly 1300
     * and also whats gab owed" wrote Drew, and that sentence ended the turn:
     * "I did not get a total for Gab". A second request after the first is
     * given its round.
     */
    const secondAskOpen = calls.length === 1 && SECOND_ASK.test(lastSaid(history));

    if (terminalReply && !terminalPartial && !dodgedTheInstruction && !lookupSpokeForAWrite && !secondAskOpen
      && !(staleTotalPending && !staleTotalNudged)
      && (terminalComputed || calls.length - interimCount === 1)) {
      /**
       * ===============================
       * * A COMPUTED REPLY SKIPPED THE REPEAT GUARD
       * ===============================
       * `saidAlready` runs on the model's prose, and this path returns the
       * TOOL's text without a model round, so it never reached it. Asked
       * "are those accurate?" she replayed the whole block word for word.
       *
       * The facts must not move, so the block is not reworded: a computed
       * reply is the tool's own finished sentence. It gains a line saying
       * she looked again, which is TRUE by construction here, because this
       * path only exists when a tool actually ran this turn.
       */
      // A QUESTION ASKED AGAIN is still a question, never "it has not
      // moved". Clone run 2026-10-05: "which group is it?" repeated came
      // back as "I ran it again and it has not moved." over the question.
      // NOR A WRITE: "make it 13700" saved, and read as a repeat of the 13600
      // line it was told "it has not moved". Clone 2026-10-05.
      const checked = terminalComputed && !terminalWrote && saidAlready(terminalReply, history) && !/\?\s*$/.test(terminalReply)
        ? `${LOOKED_AGAIN}\n${terminalReply}`
        : terminalReply;
      return {
        reply: easeOffPetNames(dealWords(noDashes(stripMarkdown(checked))), history),
          changedRowIds: [...changedRowIds],
          context: context.key,
          claims: turnState.claims,
          // Auto mode offered once, after a confirmation they actually gave.
          offer: turnState.wrote.get('__offer') ?? null,
        };
    }
  }

  // Ran the full round budget without settling on an answer. Usually a
  // loop — the same search repeated because a result didn't satisfy her —
  // and invisible from the outside, so it's logged with the tools she
  // actually called.
  logger.warn({ context: context.key, rounds: MAX_TOOL_ROUNDS }, 'diane: exhausted tool rounds');
  captureLog({
    source: 'agent',
    level: 'warn',
    message: 'Diane: ran out of tool rounds without finishing',
    detail: {
      context: context.key,
      rounds: MAX_TOOL_ROUNDS,
      toolsCalled: messages
        .flatMap((m) => m.tool_calls ?? [])
        .map((c) => c.function?.name)
        .filter(Boolean),
    },
  });

  /**
   * WHAT WAS SAVED IS SAID, even when she ran out of rounds. Five deals were
   * added, she kept re-checking them, and the admin was told she "got lost"
   * about work that had all landed. The tools' own lines, nothing composed.
   * 2026-09-30.
   */
  const saved = toolResults
    .map((r) => String(r?.summary ?? ''))
    .filter((s) => /^Added #\d+: /.test(s))
    .map((s) => s.replace(/^Added #\d+: /, '').split(/ THEY ASKED FOR SEVERAL| It is on /)[0].trim());
  if (saved.length > 0) {
    return {
      reply: `${saved.join('\n')}\n\nAll ${saved.length} of those are saved.`,
      changedRowIds: [...changedRowIds],
      context: context.key,
      claims: turnState.claims,
      offer: turnState.wrote.get('__offer') ?? null,
    };
  }

  return {
    reply: "I got a bit lost going round in circles on that one, dear. Could you break it into smaller steps for me?",
    changedRowIds: [...changedRowIds],
    context: context.key,
    claims: turnState.claims,
    // Auto mode offered once, after a confirmation they actually gave.
    offer: turnState.wrote.get('__offer') ?? null,
  };
}

// streamCompletion is exported for its own sake: reassembling deltas into
// a whole message is the one piece here that can be checked without
// spending a model call, and getting tool-call accumulation wrong breaks
// every write Diane makes.
// getClient is exported so the summariser uses the SAME client rather
// than opening a second one against the same key.
/**
 * ONE TURN, and what it drew is read out. Every card, list and sheet check
 * sent to the screen is recorded as it goes, and `spoken` is built from
 * that same data: she reads what is shown, all of it. See screenReading.js.
 */
async function runAgent(history, contextName, onEvent) {
  const shown = [];
  const result = await runAgentTurn(history, contextName, (e) => {
    if (e?.type === 'card' || e?.type === 'list' || e?.type === 'check') shown.push(e);
    onEvent?.(e);
  });
  if (!result || shown.length === 0) return result;
  const { reply, spoken } = screenReading(result.reply, shown);
  return { ...result, reply, spoken };
}

module.exports = {
  runAgent, lightTurn, streamCompletion, getClient, withExportReminder, turnsSinceReminder, REMINDER_GAP,
  // Exported so the claim detectors can be pinned directly rather than
  // through a live model call.
  wantsPanelAct, asksWrongExportStep,
  explicitExportRequest, exportContinuation, exportToolAllowed,
  coalesceBreakdownCalls,
  // The runtime's own rules about a write, pinned without a model.
  invokeTool,
};
