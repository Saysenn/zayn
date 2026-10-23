// ***************************************************
// * WHAT COMES NEXT ON THE WINDING DOWN PAGE (his ask 2026-10-21)
// ***************************************************
//
// "Check the documents per company and tell us the next step." Code does
// the sure parts so Diane never works them out herself:
//   - the road ahead from a stage (his flowchart, migration 090)
//   - the usual UK process at that stage, in a few plain lines
//   - every date a document gives, with how near it is
//   - when the documents read further along than the page's stage
// She words the answer from these; she never invents a date or a step.
// Pure: no database, so the tests need nothing.

const { stageText } = require('./liquidationStages');

/** Where each stage can go next (his flowchart, migration 090). */
const ROADS = Object.freeze({
  none: [['active_proposal', null], ['liquidation', null]],
  active: [['active_proposal', null], ['liquidation', null]],
  active_proposal: [['dissolved', 'struck_off'], ['strike_off_suspended', null]],
  strike_off_suspended: [['dissolved', 'struck_off'], ['strike_off_rejected', null]],
  strike_off_rejected: [['active_proposal', null], ['liquidation', null]],
  liquidation: [['own_liq', null], ['hmrc_liq', null]],
  own_liq: [['dissolved', 'after_liquidation']],
  hmrc_liq: [['dissolved', 'after_liquidation']],
  dissolved: [],
});

/**
 * THE USUAL PROCESS at a stage, general UK steps. The page's own deadline,
 * next action and the company's documents win over these.
 */
const GUIDE = Object.freeze({
  none: 'No stage set yet. Decide the road: strike off (no debts left: we apply with a DS01) or liquidation '
    + '(debts: a CVL through an insolvency practitioner; solvent with assets: an MVL). Then set the stage.',
  active: 'Still active. Decide the road: strike off (DS01) if it owes nothing, else liquidation through an '
    + 'insolvency practitioner. Then set the stage.',
  'active_proposal:compulsory': 'Companies House proposes to strike it off (First Gazette notice), usually for '
    + 'overdue accounts or confirmation statement. It is struck off no sooner than 2 months after that notice '
    + 'unless someone objects. To keep it: file what is overdue and ask Companies House to suspend it. To let it '
    + 'go: nothing, and it ends Dissolved (struck off).',
  'active_proposal:voluntary': 'We applied to strike it off (DS01). Within 7 days of applying a copy must go to '
    + 'every creditor, employee, shareholder and director, and HMRC. It is struck off no sooner than 2 months '
    + 'after the First Gazette notice unless someone objects. If it trades again or a creditor turns up, withdraw '
    + 'it with a DS02.',
  active_proposal: 'A strike off is proposed (First Gazette notice): struck off no sooner than 2 months after the '
    + 'notice unless someone objects. Set whether it is compulsory (Companies House) or voluntary (our DS01).',
  strike_off_suspended: 'Someone objected (often HMRC or a creditor owed money), so the strike off is on hold. '
    + 'Find who objected and settle what they want; then it goes ahead (Dissolved) or is cancelled.',
  strike_off_rejected: 'The strike off will not go ahead and the company stays on the register. Bring its filings '
    + 'up to date and apply again, or take the liquidation road.',
  liquidation: 'Liquidation, kind not set yet: our own (an MVL if it can pay its debts in full, a CVL if not) or '
    + 'HMRC\'s (a winding up petition). Appoint a licensed insolvency practitioner and set which.',
  'own_liq:mvl': 'Members\' voluntary liquidation: the directors swear a declaration of solvency (within the 5 weeks '
    + 'before the members\' resolution), the liquidator collects the assets, pays every creditor in full and files '
    + 'a final account; it is dissolved about 3 months after.',
  'own_liq:cvl': 'Creditors\' voluntary liquidation: the liquidator needs the statement of affairs, bank statements '
    + 'and books; the creditors decide on the liquidator; the liquidator reports on the directors\' conduct and files '
    + 'a final account; it is dissolved about 3 months after.',
  own_liq: 'Our own liquidation: set whether it is an MVL (can pay its debts in full) or a CVL (cannot).',
  'hmrc_liq:petition': 'HMRC filed a winding up petition. Before the hearing: pay the debt in full or agree terms '
    + 'with HMRC and have them withdraw it, or put it into our own liquidation. Once the petition is in the Gazette '
    + 'the bank usually freezes the account. If nothing changes, the court makes a winding up order at the hearing.',
  'hmrc_liq:winding_up_order': 'The court ordered it wound up and the Official Receiver takes control. The directors '
    + 'give the Official Receiver a statement of affairs and the company\'s records and must cooperate. It ends '
    + 'Dissolved (after liquidation).',
  hmrc_liq: 'HMRC\'s liquidation: set whether the petition is filed or the court has made the winding up order.',
  dissolved: 'Finished: the company is dissolved and its deals stopped. Nothing more, unless it has to be restored '
    + '(possible within 6 years).',
});

const roadKey = (stage) => (stage && ROADS[stage] ? stage : 'none');

/** The usual process at this stage, the kind's own when there is one. */
function guideFor(stage, kind) {
  return GUIDE[`${stage}:${kind}`] ?? GUIDE[roadKey(stage)] ?? GUIDE.none;
}

/** "Dissolved (Struck off) or Strike off suspended", or '' at the end of the road. */
function roadAhead(stage) {
  return ROADS[roadKey(stage)].map(([s, k]) => stageText(s, k)).join(' or ');
}

// ===============================
// * DATES A DOCUMENT GIVES
// ===============================
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)';
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?\\b`, 'gi');
const MONTH_DAY = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'gi');
// UK order, day first.
const NUMERIC = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})\b/g;
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

const iso = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
};
// No year said: this year's, unless that is long past (then next year's).
const yearFor = (m, d, today) => {
  const y = Number(today.slice(0, 4));
  const thisYear = iso(y, m, d);
  return thisYear && (Date.parse(today) - Date.parse(thisYear)) / 86_400_000 > 183 ? y + 1 : y;
};

/** The sentence around position `at`, trimmed to a readable length. */
function sentenceAt(text, at) {
  const start = Math.max(text.lastIndexOf('.', at - 1), text.lastIndexOf('\n', at - 1)) + 1;
  const stops = ['. ', '.\n', '\n'].map((s) => text.indexOf(s, at)).filter((i) => i >= 0);
  const end = stops.length ? Math.min(...stops) + 1 : text.length;
  const s = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return s.length > 220 ? `${s.slice(0, 217)}…` : s;
}

const WORD_NUMBER = { one: 1, two: 2, three: 3, four: 4, six: 6, seven: 7, fourteen: 14, twentyone: 21, twentyeight: 28 };
/** `day` moved on by n days, weeks or months (a month's end kept). */
function shift(day, n, unit) {
  const d = new Date(`${day}T00:00:00Z`);
  if (!n || Number.isNaN(d.getTime())) return null;
  if (/^day/.test(unit)) d.setUTCDate(d.getUTCDate() + n);
  else if (/^week/.test(unit)) d.setUTCDate(d.getUTCDate() + n * 7);
  else {
    const want = d.getUTCMonth() + n;
    d.setUTCMonth(want);
    if (d.getUTCMonth() !== ((want % 12) + 12) % 12) d.setUTCDate(0);
  }
  return d.toISOString().slice(0, 10);
}

/** Days from `today` to `day` (negative when passed). */
const daysTo = (day, today) => Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000);

/** "passed 3 days ago", "today", "in 12 days". */
function whenWords(day, today) {
  const n = daysTo(day, today);
  if (n < 0) return `passed ${-n} ${n === -1 ? 'day' : 'days'} ago`;
  if (n === 0) return 'today';
  return `in ${n} ${n === 1 ? 'day' : 'days'}`;
}

/**
 * Every date the text gives, once each, in date order:
 * [{ day: 'YYYY-MM-DD', when: 'in 9 days', days: 9, says: 'the sentence' }].
 */
function datesIn(text, today) {
  const src = String(text ?? '');
  const found = new Map();
  const add = (day, at) => {
    if (!day) return;
    if (!found.has(day)) found.set(day, sentenceAt(src, at));
    // "AT THE EXPIRATION OF 2 MONTHS FROM 1 October", "within 21 days of":
    // the day it lands on, worked out here, never by her.
    const before = src.slice(Math.max(0, at - 60), at).toLowerCase();
    const span = before.match(/\b(\d{1,3}|one|two|three|four|six|seven|fourteen|twenty[\s-]?one|twenty[\s-]?eight)\s+(days?|weeks?|months?)\s+(?:from|after|of|following)\s+(?:the\s+)?(?:date\s+of\s+)?$/);
    if (span) {
      const n = /^\d+$/.test(span[1]) ? Number(span[1]) : WORD_NUMBER[span[1].replace(/[\s-]/g, '')];
      const later = shift(day, n, span[2]);
      if (later && !found.has(later)) found.set(later, `${n} ${span[2]} from ${day}: ${sentenceAt(src, at)}`);
    }
  };
  for (const m of src.matchAll(DAY_MONTH)) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    const d = Number(m[1]);
    add(iso(m[3] ? Number(m[3]) : yearFor(mo, d, today), mo, d), m.index);
  }
  for (const m of src.matchAll(MONTH_DAY)) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const d = Number(m[2]);
    add(iso(m[3] ? Number(m[3]) : yearFor(mo, d, today), mo, d), m.index);
  }
  for (const m of src.matchAll(NUMERIC)) {
    const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    add(iso(y, Number(m[2]), Number(m[1])), m.index);
  }
  for (const m of src.matchAll(ISO)) add(iso(Number(m[1]), Number(m[2]), Number(m[3])), m.index);
  return [...found.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, says]) => ({ day, days: daysTo(day, today), when: whenWords(day, today), says }));
}

// ===============================
// * WHAT STAGE THE DOCUMENTS READ LIKE
// ===============================
// Most final first: a later paper names the earlier steps too ("the
// petition presented on…" is in the winding up order).
const EVIDENCE = [
  // Never "will be struck off … and dissolved": that is the First Gazette's own wording.
  // "was on 19 October 2026 struck off the register and is dissolved" (the Gazette's own wording, blind run 2026-10-22).
  [/\b(?:final|second) gazette\b|\bnotice of (?:striking[\s-]off and )?dissolution\b|\bhas been (?:struck off|dissolved)\b|\bwas (?:on [^.;]{1,40}? )?(?:struck off|dissolved)\b|\bis (?:now )?dissolved\b/i, 'dissolved', null],
  [/\bwinding[\s-]?up order\b|\b(?:ordered|order) that (?:the )?(?:company|it) be wound up\b|\bofficial receiver\b/i, 'hmrc_liq', 'winding_up_order'],
  [/\bwinding[\s-]?up petition\b|\bpetition (?:to|for) wind\b|\bpetition will be heard\b/i, 'hmrc_liq', 'petition'],
  // ANY CASE: "IN CREDITORS VOLUNTARY LIQUIDATION" in a letter heading was missed (held-out doc run 2026-10-22).
  [/\bdeclaration of solvency\b|\bmembers'? voluntary\b|\bMVL\b/i, 'own_liq', 'mvl'],
  [/\bcreditors'? voluntary\b|\bCVL\b|\bstatement of affairs\b|\bdecision procedure\b|\bcannot continue its business by reason of its liabilities\b|\bcannot pay its debts\b|\bdeemed consent\b/i, 'own_liq', 'cvl'],
  // WITHDRAWN: "the Registrar has withdrawn the strike-off action. The company will remain on the register."
  [/\b(?:withdrawn|discontinued|cancell?ed)\b[^.]{0,40}\bstrike[\s-]?off\b|\bstrike[\s-]?off\b[^.]{0,40}\b(?:withdrawn|discontinued|cancell?ed)\b|\bwill remain on the register\b/i, 'strike_off_rejected', null],
  // THE OBJECTION WITHDRAWN puts the strike off back on: a proposal again, not suspended.
  [/\bobjection\w*\b[^.]{0,60}\bwithdr[ae]w\w*|\bwithdr[ae]w\w*\b[^.]{0,30}\bobjection|\bstrike[\s-]?off (?:action )?(?:will )?(?:now )?(?:resume|proceed|go ahead)\w*/i, 'active_proposal', null],
  [/\bstrike[\s-]?off\b[^.]{0,80}\bsuspend\w*|\bsuspend\w*\b[^.]{0,80}\bstrike[\s-]?off\b|\bobjection\b[^.]{0,80}\bstrik/i, 'strike_off_suspended', null],
  [/\bfirst gazette\b|\bproposal to strike\b|\bnotice of (?:proposed |intended )?strik\w*[\s-]?off\b|\bDS01\b|\bunless cause is shown\b|\bwill be struck off\b/i, 'active_proposal', null],
];
// How far along each stage is, so "further on" can be said.
const RANK = {
  none: 0, active: 0, active_proposal: 1, liquidation: 1, strike_off_suspended: 2, own_liq: 2, hmrc_liq: 2,
  strike_off_rejected: 3, dissolved: 5,
};
const rankOf = (stage, kind) => (stage === 'hmrc_liq' && kind === 'winding_up_order' ? 3 : RANK[roadKey(stage)]);

/** The stage one document reads like, or null. */
function stageInText(text) {
  /**
   * WHAT MAY HAPPEN IS NOT WHAT HAS: a petition hearing notice says "the court
   * may make a winding-up order" and was read as the order itself (held-out run
   * 2026-10-22). A step said as a possibility, a request or a threat is taken out.
   */
  // Curly quotes are the paper's own: "Creditors’ Voluntary" was missed (fresh doc run 2026-10-22).
  const t = String(text ?? '').replace(/[\u2018\u2019\u02bc]/g, "'").replace(/\b(?:may|might|could|can|will|would|shall|seek\w*|ask\w* for|appl\w* for|apply for|for|risk\w*|avoid|prevent|face|facing|unless|before)\s+(?:\w+\s+){0,3}?(?:a\s+|an\s+|the\s+)?(?:winding[\s-]?up order|compulsory liquidation|official receiver)\b/gi, ' ');
  for (const [re, stage, kind] of EVIDENCE) {
    // An OBJECTION withdrawn puts the strike off back on: it is not the strike off withdrawn.
    if (stage === 'strike_off_rejected' && /\bobjection\w*\b[^.]{0,60}\bwithdr[ae]w\w*|\bwithdr[ae]w\w*\b[^.]{0,30}\bobjection/i.test(t) && !/\bwill remain on the register\b/i.test(t)) continue;
    if (re.test(t)) {
      // "voluntary" or "compulsory" said with the proposal.
      if (stage === 'active_proposal') {
        // Voluntary first: our DS01 notice is the registrar's too.
        const k = /\bDS01\b|\bvoluntar|\bapplication (?:has been )?made|\bapplied\b/i.test(t) ? 'voluntary' : /\bcompulsor|\bregistrar\b/i.test(t) ? 'compulsory' : null;
        return { stage, kind: k };
      }
      return { stage, kind };
    }
  }
  return null;
}

/**
 * Whether the documents read further along than the page says:
 * { stage, kind, file } for the furthest one, or null when the page is
 * as far or further. A kind the page leaves unset counts too.
 */
function aheadOfPage(docs, stage, kind) {
  let best = null;
  for (const d of docs) {
    const seen = stageInText(d.text);
    if (seen && (!best || rankOf(seen.stage, seen.kind) > rankOf(best.stage, best.kind))) best = { ...seen, file: d.file_name };
  }
  if (!best) return null;
  const page = rankOf(stage, kind);
  const docRank = rankOf(best.stage, best.kind);
  if (docRank > page) return best;
  if (best.stage === stage && !kind && best.kind) return best;
  return null;
}

module.exports = {
  ROADS, GUIDE, guideFor, roadAhead, datesIn, whenWords, daysTo, stageInText, aheadOfPage,
};
