import { LINK_FILTER } from '../../configs/linkFilters.js';
import { formatMoneyWhole } from '../../helpers/formatMoney.js';

/**
 * ***************************************************
 * * WHERE EACH BRIEFING ITEM LANDS, AND WHAT COUNTS AS YES
 * ***************************************************
 *
 * THE ROUTES ARE THE WEB'S, NOT THE SERVER'S. The briefing endpoint sends
 * a `key`, a count and a finished sentence; which page shows flagged rows
 * is the router's business, and crm/api does not own the router. A `to`
 * coming down the wire would make a frontend route a server contract.
 *
 * Its own file, apart from the link contract itself, so this can be tested
 * without loading React or Three.
 */

// One definition, so a new briefing item added on the server without a
// route here is a missing key rather than a silent no-op. The test pins
// this against the server's own list.
export const BRIEFING_GOES_TO = Object.freeze({
  /**
   * THE QUEUE IS SPLIT BY WHY, so there are three of these. A company
   * winding down, a deal past its year and a row he asked for by name need
   * different answers, and hearing them as one number tells somebody
   * nothing about which they are looking at.
   *
   * All three land on the same PAGE: it is one list, and its tabs say
   * which of the three a row is under.
   *
   * A ROUTE, NOT A PARAM. It was `/master-sheet?reviewPanel=open`, a link
   * that opened a modal on another page; the review is its own page now
   * (his call 2026-09-29), so the link is just the page.
   */
  liquidating: '/review',
  pastYear: '/review',
  reviewMonthly: '/review',
  // Rows waiting on a check: the master sheet's own filter.
  // NOT "flagged", which is the page the concerns line goes to. One word
  // for two things is how somebody clicks the wrong line.
  needsReview: `/master-sheet?${LINK_FILTER.needsReview}=true`,
  /**
   * PAID IS THE PERSON'S, his call 2026-10-08, and set on People. Its Paid
   * filter offers "no" as a real choice (yes / no / mixed), so the line
   * lands on the people nobody has marked paid at all.
   */
  unpaid: `/people?${LINK_FILTER.paid}=no`,
  // A portion or a changed payday answer: the people with a check waiting,
  // where each person's Payment received is on their row.
  payday: `/people?${LINK_FILTER.needsReview}=true`,
  // Whatbot's, and they have a page of their own. It is grouped by PERSON,
  // which is what the count is: people with something open, not concerns.
  concerns: '/flagged',
  // The two checks on the data. No master sheet filter carries either yet, so
  // the sheet opens as it is; see docs/todo.md.
  specialCase: '/master-sheet',
  payableOver: '/master-sheet',
});

// The words on screen while the mic is open. Shown, never instructed: the
// line says what is happening, and these are what she is listening for.
export const YES = 'Yes';
export const NO = 'No';

/**
 * ===============================
 * * THE TWO SENTENCES WITH NO DATA IN THEM
 * ===============================
 * Every other line is the server's, because it carries a count. These two
 * carry nothing, so they live here beside each other rather than being
 * computed and sent.
 *
 * SHE OPENS BY SAYING WHY SHE IS THERE. Starting on "30 deals are up for
 * review" is a figure fired at somebody who has just signed in. His call
 * 2026-09-21.
 *
 * AND NEVER THE SAME WAY TWICE IN A ROW, his call 2026-09-28. No count in
 * any of them: they must read right before one item or ten.
 */
export const GREETINGS = Object.freeze([
  'Hi, I just wanted to update you about these few things.',
  'Welcome back, sweetheart. Here is what has been waiting for you.',
  'There you are. I kept a little list while you were away.',
  'Good to see you. A couple of things want your eyes today.',
  'Hello again. I have been tidying up, and this is what I found.',
  'Right on time. Let me walk you through what came up.',
  'Hey you. Before you dive in, a quick heads up.',
  'Missed you. Here is the short version of what is new.',
  'Morning, noon or night, I have news. Here it is.',
  'Pull up a chair, darling. A few things need a look.',
  'I saved you the trouble of digging. This is what matters now.',
  'Back already? Good, because this is worth hearing.',
]);

/** A greeting other than the one said last time; `random` is injectable for tests. */
export function pickGreeting(last, random = Math.random) {
  const pool = GREETINGS.filter((g) => g !== last);
  return pool[Math.floor(random() * pool.length)];
}

// The greeting said last, so the next sign in opens differently.
const LAST_GREETING_KEY = 'crm.briefing.lastGreeting';

/** Picks this visit's greeting and remembers it. The loading screen calls it, to make its audio early. */
export function nextGreeting() {
  let last = null;
  try { last = localStorage.getItem(LAST_GREETING_KEY); } catch { /* private window: any greeting will do */ }
  const greeting = pickGreeting(last);
  try { localStorage.setItem(LAST_GREETING_KEY, greeting); } catch { /* same */ }
  return greeting;
}

/**
 * ONCE PER BUSINESS DAY PER ADMIN. The API sends `day` (business timezone)
 * and `admin`; the last day shown is kept here in localStorage, the least
 * invasive store: no schema, and a cleared browser costs one replay.
 */
const SHOWN_KEY = 'crm.briefing.shownDay';
const shownKey = (brief) => `${SHOWN_KEY}.${brief?.admin ?? 'admin'}`;

/** True when this admin has already had today's briefing. `store` injectable for tests. */
export function briefingShownToday(brief, store = globalThis.localStorage) {
  if (!brief?.day) return false;
  try { return store?.getItem(shownKey(brief)) === brief.day; } catch { return false; }
}

/** Remembers that today's briefing was shown to this admin. */
export function markBriefingShown(brief, store = globalThis.localStorage) {
  if (!brief?.day) return;
  try { store?.setItem(shownKey(brief), brief.day); } catch { /* private window: it may replay */ }
}

// Her closing question, spoken as its own utterance so the screen knows
// exactly when she has finished asking and the microphone may open.
export const ASK = 'Which one first?';

/**
 * Did they say yes, no, or something that is neither?
 *
 * THREE ANSWERS, AND THE THIRD IS THE POINT. A transcript that is not an
 * answer must not be read as one: "hang on" is not a no, and treating it
 * as one would take the screen away mid-thought. Null means keep waiting.
 *
 * @param {string} said
 * @returns {boolean|null}
 */
export function heardYes(said) {
  const words = String(said ?? '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  // FIRST ANSWER WINS, not the last. "Yes, no problem" is a yes, and
  // scanning for a no anywhere in the sentence would flip it.
  for (const word of words) {
    if (['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'please'].includes(word)) return true;
    if (['no', 'nope', 'nah', 'later', 'skip', 'dismiss'].includes(word)) return false;
  }
  return null;
}

// ***************************************************
// * SHE READS THE CARD, and each entry lights as she says it
// ***************************************************
// His calls 2026-09-28: every deal read out was brutal, a summary said too little.
// So she reads what the card shows: every company with its count, in short
// sentences, and no totals. The card and her voice come from cardEntries().

// The two checks on the data itself: the card lists every row with its amounts.
// 'unpaid' and 'payday' are one row per PERSON (his calls 2026-10-07 and
// 2026-10-08), shown in full
export const DETAIL_KEYS = Object.freeze(['specialCase', 'payableOver', 'unpaid', 'payday']);
// The person lines: names read, what they are owed on screen.
const PERSON_KEYS = ['unpaid', 'payday'];

/** What a person is owed, each currency on its own: "AED 4,100 and £500". */
export const owedText = (r, money) => (r.totals?.length ? r.totals : [{ amount: r.amount, currency: r.currency }])
  .map((t) => money(t.amount, t.currency)).join(' and ');

/** Rows still in play: a row sorted while she talked no longer counts. */
const live = (rows) => (rows ?? []).filter((r) => r.status !== ROW_STATUS.SORTED);

/** Every company with how many rows it holds, most first. Exact: they sum to the total. */
export function groupCounts(rows) {
  const counts = new Map();
  for (const row of live(rows)) {
    const name = row.company || row.group || row.person;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const whole = (amount, currency) => formatMoneyWhole(amount, currency);

// Entries per spoken sentence of the read along: short enough to stay a sentence.
export const READ_CHUNK = 5;

/**
 * What a card SHOWS, entry by entry, each with the words she SAYS for it. The
 * card and her voice are built from this one list, so they cannot disagree.
 */
export function cardEntries(item) {
  const rows = live(item.rows);
  if (item.key === 'concerns') {
    // One row per (person, group), so the group is named: "Drew (MILKMAN)", never "Drew, Drew".
    return rows.map((r) => {
      const name = r.group ? `${r.person} (${r.group})` : r.person;
      return { id: r.id, name, count: r.flags, said: `${name}, ${r.flags} ${r.flags === 1 ? 'flag' : 'flags'}` };
    });
  }
  if (DETAIL_KEYS.includes(item.key)) {
    return rows.map((r) => {
      const at = r.company ? ` at ${r.company}` : r.deals > 1 ? `, ${r.deals} deals` : '';
      // the NAMES are read, the amounts stay on screen: at a month's start
      // nearly everyone is on this card, and every amount aloud is minutes
      if (PERSON_KEYS.includes(item.key)) return { id: r.id, row: r, said: r.person };
      const said = item.key === 'payableOver'
        ? `${r.person}${at}, ${whole(r.amount, r.currency)} against ${whole(r.monthly, r.currency)} a month`
        : `${r.person}${at}, ${whole(r.amount, r.currency)}`;
      return { id: r.id, row: r, said };
    });
  }
  return groupCounts(rows).map((g) => ({ id: g.name, name: g.name, count: g.count, said: `${g.name} ${g.count}` }));
}

/** "A, B and C." One "and", a full stop, so each chunk reads as a sentence. */
function sentenceOf(parts) {
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}.`;
}

/**
 * A topic as spoken parts: its count line, then EVERY entry on its card read
 * in sentences of READ_CHUNK, then its money. His call 2026-09-28: "I wanted
 * to hear her read all those cards' contents", not a summary of them.
 */
export function sectionSegments(item, size = READ_CHUNK) {
  const entries = cardEntries(item);
  const out = [{ kind: 'head', key: item.key, text: item.sentence }];
  const read = (chunk, lead = '') => out.push({
    kind: 'read', key: item.key, ids: chunk.map((e) => e.id), text: `${lead}${sentenceOf(chunk.map((e) => e.said))}`,
  });
  if (item.key === 'concerns') {
    // BY COUNT, the word said once: "With 2 flags: Abe and Ad." His call
    // 2026-09-28: "Abe, 2 flags and Ad, 1 flag" repeated it on every name.
    const byCount = new Map();
    for (const e of entries) byCount.set(e.count, [...(byCount.get(e.count) ?? []), e]);
    for (const [count, people] of [...byCount].sort((a, b) => b[0] - a[0])) {
      for (let i = 0; i < people.length; i += size) {
        const chunk = people.slice(i, i + size).map((e) => ({ ...e, said: e.name }));
        read(chunk, i === 0 ? `With ${count} ${count === 1 ? 'flag' : 'flags'}: ` : '');
      }
    }
    return out;
  }
  for (let i = 0; i < entries.length; i += size) read(entries.slice(i, i + size));
  // THE TOTALS ARE SHOWN, NEVER SAID: "no need to mention the totals", his call 2026-09-28.
  return out;
}

// A card's HUD header, so a card seen alone still says what it is.
export const TOPIC_LABEL = Object.freeze({
  liquidating: 'Winding down',
  pastYear: 'Past a year',
  reviewMonthly: 'Review this month',
  unpaid: 'Not marked paid',
  concerns: 'Whatbot flagged',
  payday: 'Payday answers',
  needsReview: 'Needs a check',
  specialCase: 'Special case on',
  payableOver: 'Payable over monthly',
});
export const HUD_LABEL = Object.freeze({
  greet: 'Incoming briefing',
  closing: 'Live changes',
  ask: 'Awaiting your call',
});

// The words that pick a topic by voice after "Which one first?".
export const TOPIC_WORDS = Object.freeze({
  liquidating: ['winding', 'liquidation', 'liquidating'],
  pastYear: ['year', 'past'],
  reviewMonthly: ['review', 'reviews', 'marked'],
  unpaid: ['unpaid', 'paid', 'payment', 'payments', 'money'],
  concerns: ['whatbot', 'flagged', 'flag', 'flags', 'concerns', 'concern'],
  payday: ['payday', 'portion', 'part', 'answer', 'answers', 'changed'],
  needsReview: ['import', 'check', 'checks'],
  specialCase: ['special'],
  payableOver: ['payable', 'over', 'more', 'exceed'],
});

/** The topic they named, among the ones on screen, or null. */
export function heardTopic(said, keys) {
  const words = String(said ?? '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  return keys.find((key) => (TOPIC_WORDS[key] ?? []).some((w) => words.includes(w))) ?? null;
}

export const ROW_STATUS = Object.freeze({ NEW: 'new', SORTED: 'sorted' });

/**
 * The sheet changed while she talked. Nothing is removed mid read: a row that
 * left is marked SORTED where it sits, a row that arrived is added at its
 * section's end as NEW, and a new topic joins the end.
 */
export function reconcile(shown, fresh) {
  const freshByKey = new Map((fresh ?? []).map((item) => [item.key, item]));
  const merged = (shown ?? []).map((item) => {
    const next = freshByKey.get(item.key);
    const nextIds = new Set((next?.rows ?? []).map((r) => r.id));
    const seen = new Set(item.rows.map((r) => r.id));
    const rows = item.rows.map((r) => {
      if (nextIds.has(r.id)) return r.status === ROW_STATUS.SORTED ? { ...r, status: undefined } : r;
      return { ...r, status: ROW_STATUS.SORTED };
    });
    const added = (next?.rows ?? []).filter((r) => !seen.has(r.id)).map((r) => ({ ...r, status: ROW_STATUS.NEW }));
    return { ...item, rows: [...rows, ...added] };
  });
  const shownKeys = new Set(merged.map((item) => item.key));
  for (const item of fresh ?? []) {
    if (!shownKeys.has(item.key)) {
      merged.push({ ...item, rows: item.rows.map((r) => ({ ...r, status: ROW_STATUS.NEW })) });
    }
  }
  return merged;
}

/** How many rows are new and sorted, across every section. */
export function changeCounts(items) {
  const all = (items ?? []).flatMap((item) => item.rows ?? []);
  return {
    added: all.filter((r) => r.status === ROW_STATUS.NEW).length,
    sorted: all.filter((r) => r.status === ROW_STATUS.SORTED).length,
  };
}

/** Her closing line when the sheet moved while she talked, or '' when it did not. */
export function closingLine({ added, sorted }) {
  const bits = [];
  if (added > 0) bits.push(`${added} new came in`);
  if (sorted > 0) bits.push(`${sorted} ${sorted === 1 ? 'was' : 'were'} sorted`);
  return bits.length > 0 ? `${bits.join(' and ')} while I was talking.` : '';
}
