const logger = require('../../configs/logger');
const { fold, oneTypo } = require('./tools/resolvePerson');

// ***************************************************
// * A READ'S FILTERS COME FROM THEIR WORDS, OR NOT AT ALL
// ***************************************************
//
// His call 2026-10-07. A write goes through the router, the plan and code
// checks; a READ ("show me…", "how many…", "total for…") went straight to
// the model's own choice of filters, and nothing checked them. Live:
// "show me cash paid deals in mlkman" came back filtered to cash AND marked
// paid, found none, and told him MILKMAN had no cash deals (it has 24).
//
// So before filter_master_sheet, summarize_deals or total_master_sheet
// reads anything:
//   1. every filter the model set must have its word in what they said
//      (this message or the one before, for a follow up), or it is dropped;
//      a value list keeps only the values they named (cash, not bank);
//   2. a word that can mean ONE thing adds its filter when the model left
//      it out ("unpaid", "cash", "in AED");
//   3. whatever was dropped or added is said in the reply, and logged.
// Group, sorting and free text are left alone: none has misread yet, and a
// dropped group would quietly widen the answer to every group.

// and the other reads that take any of the same filters (compare months,
// breakdowns): the guard only ever touches a filter that was set
const GUARDED_TOOLS = new Set(['filter_master_sheet', 'summarize_deals', 'total_master_sheet', 'compare_months', 'breakdown_master_sheet']);

/** "1k", "1,500", "£2.5k", "two thousand" is not attempted. */
function numbersIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|grand|thousand)?\b/gi)) {
    const n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

const words = (text) => String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** A name is "said" when a word of it (4+ letters) is in their words, or one slip from one. */
function named(value, said) {
  const heard = words(said);
  const whole = fold(said);
  if (fold(value) && whole.includes(fold(value))) return true;
  return words(value).filter((w) => w.length >= 4).some((w) => heard.some((h) => h === w || (h.length >= 4 && oneTypo(h, w))));
}

// each filter: the words that must be there for it to stand
const EVIDENCE = {
  shouldBePaid: /\bshould\b|\bto be paid\b|\bon hold\b|\bhold\b|\bswitch|\bpay(?:ing)? them\b|\bpaused?\b/i,
  needsReview: /\breview|\bcheck|\bflag/i,
  missingPerson: /\bmissing\b|\bno (?:person|handler|one)\b|\bwithout\b|\borphan|\bnobody\b|\bdeleted\b/i,
  missingCompany: /\bmissing\b|\bno company\b|\bwithout\b|\borphan|\bdeleted\b/i,
  missingPhone: /\bphone|\bnumber|\bcontact|\bmobile/i,
  missingBank: /\bbank|\baccount|\bsort ?code|\bdetails/i,
  status: /\bactive|\bcurrent|\blive\b|\bowed|\bpaying|\bgetting paid|\bstill\b|\bend(?:ed|ing|s)?\b|\bfinish|\bstopp|\bover\b|\bleft\b|\bgone\b|\bstart|\bnot yet\b|\bupcoming|\bbegin|\bthis month\b|\bstatus/i,
  endWhen: /\bend|\bfinish|\bexpir|\bstop|\buntil\b|\bleav|\bsoon\b|\bno end/i,
  paymentStartWhen: /\bstart|\bbegin|\bkick|\bnot yet\b|\bfirst pay/i,
  appointmentWhen: /\bappoint|\bjoin|\bhired?\b|\btook on|\btaken on|\bonboard|\bnew (?:deals?|people|starters?)\b|\bstarted (?:in|on|last|this)\b/i,
  presetWhen: /\bpreset|\bmarked|\bold\b|\bfuture\b|\bnext month|\blast month|\bthis month|\bother month/i,
  payableVsMonthly: /\bpayable|\bmonthly|\bpro.?rat|\bpartial|\bfull (?:month|amount)/i,
  companyStatus: /\bliquidat|\bdissolv|\bclosed\b|\bgoing concern|\breview|\bcompany status|\bcompan(?:y|ies)\b/i,
  dealStatus: /\bgoing concern|\breviewed|\breview|\bdeal status|\bactive\b/i,
  specialCaseDeal: /\bspecial/i,
  acceptingPostals: /\bpost/i,
  paymentOutcome: /\bconfirm|\bpartial|\breceived|\bdidn'?t (?:get|receive)|\bsent\b|\bno (?:response|reply)|\brespond|\brepl|\bwhatsapp|\bsaid\b|\banswer|\bportion|\bunpaid\b|\bpayment received|\bawait/i,
  paydayFlagged: /\bpayday|\bflag|\bportion|\bchanged?\b|\breview/i,
  sheetShouldBePaid: /\bsheet|\bcolumn|\bboss|\bsays?\b/i,
  sheetPaid: /\bsheet|\bcolumn|\bboss|\bsays?\b/i,
  source: /\bsync|\bimport|\bmanual|\bby hand|\bourselves\b|\bupload|\badded\b/i,
};

// a value list keeps only the values named
const VALUE_WORDS = {
  paymentMethod: { cash: /\bcash\b/i, bank: /\bbank|\btransfer|\bwire/i, crypto: /\bcrypto|\busdt\b|\bbtc\b|\bcoin/i },
  currency: { GBP: /\bgbp\b|\bpounds?\b|£|\bsterling\b/i, AED: /\baed\b|\bdirhams?\b/i, EURO: /\beuros?\b|\beur\b|€/i, EUR: /\beuros?\b|\beur\b|€/i, USD: /\busd\b|\bdollars?\b|\$/i },
};

// "cash paid" / "paid by bank" is HOW they are paid; "already paid",
// "unpaid", "not paid" is WHETHER
const METHOD_PAID = /\b(?:cash|bank|crypto|transfer)[\s-]+paid\b|\bpaid\s+(?:in|by|via|with|through)\s+(?:cash|bank|crypto|transfer)/i;
const PAID_OUT = /\b(?:already|marked|been|got|were|was|not|un|still|have|has|is|are)[\s-]*paid\b|\bunpaid\b|\bpaid (?:this|last) month\b|\bpaid yet\b|\boutstanding\b|\bsettled\b/i;
const PAID_WORD = /\bpaid\b|\bunpaid\b|\boutstanding\b|\bsettled\b|\bowe[sd]?\b/i;

const list = (v) => (Array.isArray(v) ? v : [v]);

// ***************************************************
// * PAYMENT RECEIVED IS WHAT THEY ANSWERED, NOT THE PAID SWITCH
// ***************************************************
// His call 2026-10-08. The column is payment_outcome; the words on screen
// are Paid, Unpaid, Portion and Awaiting. A portion is Unpaid on the deal
// until an admin marks it, so Unpaid reaches it too.
const RECEIVED_OUTCOMES = Object.freeze({
  paid: ['confirmed'],
  unpaid: ['not_received', 'partial'],
  portion: ['partial'],
  awaiting: ['sent', 'no_response'],
});
const OUTCOME_CODES = ['confirmed', 'partial', 'not_received', 'sent', 'no_response'];

/** The words, or the codes, as the codes the column holds. */
function outcomeCodes(raw) {
  const out = list(raw).flatMap((v) => {
    const key = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    return RECEIVED_OUTCOMES[key] ?? (OUTCOME_CODES.includes(key) ? [key] : []);
  });
  return [...new Set(out)];
}

// "who hasn't confirmed payment", "who said portion", "payment received unpaid"
// "who has not answered the payday check" too: library 2026-10-08.
const ASKS_RECEIVED = /\b(?:confirm\w*|received?)\s+(?:the\s+|their\s+|his\s+|her\s+)?payment\b|\bpayment\s+(?:received|confirm\w*)\b|\bportion\b|\bawaiting\b|\bsaid\s+(?:un)?paid\b|\b(?:answer\w*|repl\w*|respond\w*)\b[^.?!]*\bpayday\b|\bpayday\b[^.?!]*\b(?:answer\w*|repl\w*|respond\w*)\b/i;

/** Which answers their words ask for. "Hasn't confirmed" is unpaid AND awaiting. */
// `people` is the same ask in the People page's own words (list_people).
function receivedAsked(text) {
  const t = String(text ?? '');
  if (/\bportion\b|\bpart(?:ial(?:ly)?)?\b/i.test(t)) return { codes: RECEIVED_OUTCOMES.portion, word: 'Portion', people: ['portion'] };
  if (/\bawaiting\b|\bno (?:answer|reply|response)\b|\bnot (?:yet )?(?:answered|replied)\b/i.test(t)) return { codes: RECEIVED_OUTCOMES.awaiting, word: 'Awaiting', people: ['awaiting'] };
  if (/\bunpaid\b/i.test(t)) return { codes: RECEIVED_OUTCOMES.unpaid, word: 'Unpaid', people: ['unpaid'] };
  if (/\b(?:has|have|did|does|do|is|are|was|were)n'?t\b|\bnot\b|\bnever\b|\bunconfirmed\b|\byet to\b/i.test(t)) {
    return { codes: [...RECEIVED_OUTCOMES.unpaid, ...RECEIVED_OUTCOMES.awaiting], word: 'Unpaid or Awaiting', people: ['unpaid', 'awaiting'] };
  }
  return { codes: RECEIVED_OUTCOMES.paid, word: 'Paid', people: ['paid'] };
}

/**
 * @param {object} args the model's arguments, with `said` and `saidRecent` injected
 * @returns {{ args: object, dropped: string[], added: string[] }}
 */
function guardFilters(args = {}) {
  const said = [args.saidRecent, args.said].filter(Boolean).join('\n');
  // a plan step was read and agreed already (runAgent clears its words)
  if (!String(args.said ?? '').trim()) return { args, dropped: [], added: [] };
  const out = { ...args };
  const dropped = [];
  const added = [];
  const drop = (key, why) => { delete out[key]; dropped.push(why ?? key); };

  // ---- PAID: whether, never how
  if (out.paid !== undefined && out.paid !== null) {
    if (!PAID_WORD.test(said) || (METHOD_PAID.test(args.said) && !PAID_OUT.test(args.said))) drop('paid', 'paid status');
  }
  // ---- the rest of the yes/no and when filters: their word, or gone
  for (const [key, evidence] of Object.entries(EVIDENCE)) {
    if (out[key] === undefined || out[key] === null) continue;
    // "counted this month" is what a total means anyway: never a misread
    if (key === 'presetWhen' && list(out[key]).every((v) => v === 'current')) continue;
    if (!evidence.test(said)) drop(key, key.replace(/([A-Z])/g, ' $1').toLowerCase());
  }
  // ---- amounts: the number itself must be in what they said
  const heard = numbersIn(said);
  for (const key of ['amountMin', 'amountMax']) {
    if (out[key] === undefined || out[key] === null) continue;
    const n = Number(out[key]);
    // "over 1000" read as amountMin 1000.01 still counts as said
    if (![...heard].some((h) => Math.abs(h - n) <= 1)) drop(key, key === 'amountMin' ? 'a lowest amount' : 'a highest amount');
  }
  // ---- value lists: only the values named
  for (const [key, map] of Object.entries(VALUE_WORDS)) {
    if (out[key] === undefined || out[key] === null) continue;
    const kept = list(out[key]).filter((v) => (map[String(v).toUpperCase()] ?? map[String(v).toLowerCase()])?.test(said) ?? named(v, said));
    if (kept.length === list(out[key]).length) continue;
    if (kept.length) { out[key] = Array.isArray(out[key]) ? kept : kept[0]; dropped.push(`${key === 'paymentMethod' ? 'method' : key} ${list(args[key]).filter((v) => !kept.includes(v)).join(', ')}`); } else drop(key, key === 'paymentMethod' ? 'payment method' : key);
  }
  for (const key of ['company', 'roleLabel', 'tier', 'label', 'oldGroup']) {
    if (out[key] === undefined || out[key] === null) continue;
    const kept = list(out[key]).filter((v) => named(v, said) || (key === 'roleLabel' && /\brole|\bdirector|\bmid\b|\bkp\b|\badmin|\btech|\bcloser|\bsupport/i.test(said)) || (key === 'tier' && /\btier/i.test(said)));
    if (kept.length === list(out[key]).length) continue;
    if (kept.length) out[key] = Array.isArray(out[key]) ? kept : kept[0]; else drop(key, key === 'roleLabel' ? 'role' : key === 'oldGroup' ? 'old group' : key);
  }

  // ---- words with one meaning the model left out
  const now = String(args.said);
  // "WHO HASN'T CONFIRMED PAYMENT" IS PAYMENT RECEIVED, never the Paid
  // switch. His call 2026-10-08: the switch is the admin's, the answer theirs.
  const receivedWords = ASKS_RECEIVED.test(now);
  if (receivedWords) {
    if (out.paid !== undefined && out.paid !== null && !/\b(?:marked|switch)\b/i.test(now)) {
      delete out.paid; dropped.push('paid status (that is the Paid switch, not what they answered)');
    }
    if (out.paymentOutcome === undefined || out.paymentOutcome === null) {
      const asked = receivedAsked(now);
      out.paymentOutcome = asked.codes; added.push(`payment received ${asked.word}`);
    }
  }
  if (!receivedWords && (out.paid === undefined || out.paid === null) && /\bunpaid\b|\bnot (?:been )?paid\b|\bhaven'?t been paid\b|\bstill owed\b/i.test(now) && !METHOD_PAID.test(now)) {
    out.paid = false; added.push('unpaid');
  }
  if (out.paymentMethod === undefined || out.paymentMethod === null) {
    const methods = Object.entries(VALUE_WORDS.paymentMethod).filter(([, re]) => re.test(now)).map(([m]) => m);
    // "cash" said, and not as part of "bank details"
    if (methods.length && !(methods.length === 1 && methods[0] === 'bank' && /\bbank details|\baccount number|\bsort code/i.test(now))) {
      out.paymentMethod = methods; added.push(methods.join(' or '));
    }
  }
  if (out.currency === undefined || out.currency === null) {
    // "paid in AED" / "in euros", never "is on GBP right?", which is a
    // question about everyone, not a filter (denominator.test.js)
    // AND NEVER "OWED ... IN USD": with an amount asked, a bare "in USD" is
    // the currency to SHOW it in. "whats the whole sheet owed in usd" was
    // filtered to deals paid in USD and answered "owed nothing". Suite
    // 2026-10-08. Only "paid in" / "earn in" narrows an amount question.
    const asksAmount = /\b(?:owed?|owing|total|how much|worth|comes? to|sum)\b/i.test(now);
    const lead = asksAmount ? '(?:paid |earn\\w* |gets? paid )' : '(?:paid |earn\\w* |gets? paid )?';
    const codes = ['GBP', 'AED', 'EURO', 'USD'].filter((c) => new RegExp(`\\b${lead}in\\s+(?:${VALUE_WORDS.currency[c].source})`, 'i').test(now));
    if (codes.length) { out.currency = codes; added.push(codes.join(' or ')); }
  }
  // NOTHING LEFT TO NARROW: their words asked for something, the model's
  // filter did not match it, and dropping it would list everything. Live
  // clone 2026-10-07: "who's on hold in milkman" listed all 27.
  // only the filter settings themselves: the app adds keys of its own
  const FILTERS = [...Object.keys(EVIDENCE), ...Object.keys(VALUE_WORDS), 'paid', 'amountMin', 'amountMax', 'company', 'roleLabel', 'tier', 'label', 'oldGroup', 'q'];
  const narrows = (a) => FILTERS.some((k) => a[k] !== undefined && a[k] !== null
    && !(Array.isArray(a[k]) && !a[k].length) && !(k === 'presetWhen' && list(a[k]).every((v) => v === 'current')));
  const emptied = dropped.length > 0 && narrows(args) && !narrows(out);
  return { args: out, dropped, added, emptied };
}

/** The wrapped tool: guarded arguments, and the reply says what changed. */
function guarded(tool) {
  if (!GUARDED_TOOLS.has(tool.name)) return tool;
  return {
    ...tool,
    async handler(rawArgs = {}, ...rest) {
      const { args, dropped, added, emptied } = guardFilters(rawArgs);
      // "Paid", "Unpaid", "Portion", "Awaiting" as the column's own codes.
      if (args.paymentOutcome !== undefined && args.paymentOutcome !== null) args.paymentOutcome = outcomeCodes(args.paymentOutcome);
      if (dropped.length || added.length) {
        logger.info({ tool: tool.name, said: rawArgs.said, dropped, added, emptied }, 'diane: read guard corrected the filters');
      }
      if (emptied) {
        return {
          summary: `NOTHING WAS READ. The filter you chose (${dropped.join(', ')}) is not what they said: "${rawArgs.said}". `
            + 'Choose the filter that matches THEIR words and call again. If no filter means what they said, ask them one short question about what they mean. Do not list every deal.',
        };
      }
      const result = await tool.handler(args, ...rest);
      if (!result || (!dropped.length && !added.length)) return result;
      const note = [
        dropped.length ? `left out ${dropped.join(', ')} (not in what you asked)` : '',
        added.length ? `added ${added.join(', ')} (from your words)` : '',
      ].filter(Boolean).join('; ');
      return {
        ...result,
        summary: `${result.summary ?? ''}\n\nFILTERS CHECKED AGAINST THEIR WORDS: ${note}. Mention this in a few words, and NEVER describe the rows by a filter that was left out (they are not "marked paid" if paid status was left out).`.trim(),
        // HER SENTENCE WRITTEN IN CODE when a filter was dropped: live, she
        // still called the rows "marked as paid" after paid was left out
        ...(result.computedReply && result.reply ? { reply: `${result.reply} _(I ${note}.)_` }
          : result.list?.title ? {
            reply: `${result.list.title}${result.list.subtitle ? `, ${result.list.subtitle}` : ''}. _(I ${note}.)_`, computedReply: true,
          } : {}),
      };
    },
  };
}

module.exports = {
  guardFilters, guarded, GUARDED_TOOLS, numbersIn, outcomeCodes, RECEIVED_OUTCOMES, ASKS_RECEIVED, receivedAsked,
};
