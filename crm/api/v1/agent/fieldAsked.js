/**
 * ***************************************************
 * * They asked for ONE FIELD. Answer that field.
 * ***************************************************
 *
 * Live 2026-09-17. "okay whats richard payable days" drew his card and
 * replied "Richard is owed GBP 500 for September 2026". A real figure, for
 * a different question, and the number he asked for was on the screen the
 * whole time. Asked again, she said it again.
 *
 * Two faults in one turn and this is the first: every details answer ended
 * "The full details are on screen", whatever was asked, and that sentence
 * is handed back as the FINAL reply, so the question was never answered by
 * anybody. See `detailsCardReply`.
 *
 * ===============================
 * * THE LABELS COME FROM THE CARD, so there is no second list
 * ===============================
 * The card already names every field the admin can see, in their own words
 * ("Payable days", "Sort code"). A list of column names written here would
 * be a fourth vocabulary and the one that drifted. Hand it the card.
 */

const fold = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which labels are about MONEY. Only used to decide whether a money
 * flavoured answer was the wrong shape, so it lives beside the matching
 * rather than in the guard that asks.
 */
const MONEY_LABELS = ['Monthly', 'Payable'];
const isMoneyLabel = (label) => MONEY_LABELS.some((m) => fold(m) === fold(label));

/**
 * Every fact on a card, flattened, in the order the card reads.
 *
 * ===============================
 * * THE SWITCHES AND THE SHEET'S OWN WORDS COUNT TOO
 * ===============================
 * They are not cells, so "has Gloria been paid" matched nothing and fell
 * through to drawing the whole card. They are on the card already, in their
 * own shapes, and adding duplicate cells for them would print each fact
 * twice on screen to fix a question nobody could answer.
 *
 * TWO FACTS, NEVER MERGED. `sheetSays` is the boss's free text and the
 * switches are the admin's decision, so they keep different labels here.
 */
function cellsOf(card) {
  const cells = (card?.groups ?? []).flatMap((group) => group?.cells ?? []);

  // An untouched override is NULL, a real third state, and the card carries
  // what it resolves to. "Nobody has decided" is the honest answer.
  for (const sw of card?.switches ?? []) {
    const decided = sw?.value === null || sw?.value === undefined
      ? `not decided, defaults to ${sw?.fallback ? 'yes' : 'no'}`
      : (sw.value ? 'yes' : 'no');
    cells.push({ label: sw?.label, value: decided, editField: sw?.editField });
  }

  const says = card?.sheetSays;
  if (says) {
    cells.push({ label: 'Should be paid on the sheet', value: says.shouldBePaid, editField: null });
    cells.push({ label: 'Paid on the sheet', value: says.paid, editField: null });
  }
  return cells;
}

/** How many times `needle` appears in `hay`, without overlapping itself. */
function occurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0;
  let at = hay.indexOf(needle);
  while (at !== -1) { n += 1; at = hay.indexOf(needle, at + needle.length); }
  return n;
}

/**
 * ===============================
 * * A LABEL IS MATCHED BY ITS WORDS, never as one folded run
 * ===============================
 * Folding "Accepting postals" into "acceptingpostals" and looking for it in
 * the sentence needs the admin to say the label back verbatim. They do not:
 *
 *   "does gloria accept postals"     accept, not accepting
 *   "should gloria be paid"          a name sits inside the label
 *   "what does the sheet say about
 *    should be paid"                 the words are there, the run is not
 *
 * All three matched nothing and drew the whole card. So every significant
 * word of the label has to appear, in any order, with anything between.
 *
 * AND A WORD IS A WHOLE WORD. A folded substring test put `End` inside
 * "send", "spend" and "weekend", `Role` inside "payroll" and `Paid` inside
 * "unpaid". Same rule `personMentionedIn` applies to short NAMES in
 * resolvePerson.js, for the same reason.
 */

// "on the sheet" is how a label reads, not what makes it that label. A
// label of nothing but these keeps its own words: see wordsOf.
const NOISE = new Set(['the', 'on', 'of', 'a', 'an', 'in', 'at', 'to', 'and', 'be', 'is', 'are']);

const wordsIn = (text) => String(text ?? '').split(/[^A-Za-z0-9]+/).map(fold).filter(Boolean);

function wordsOf(label) {
  const all = wordsIn(label);
  const meaningful = all.filter((w) => w.length >= 3 && !NOISE.has(w));
  // A label that is ALL noise would match every sentence ever typed.
  return meaningful.length > 0 ? meaningful : all;
}

/**
 * Near enough to be the same word: the exact word, its plural, the same
 * STEM, or a longer form of it.
 *
 * THE STEM IS WHY. "Where is he LOCATED" missed the Location cell and drew
 * the whole card: neither word is a prefix of the other, so nothing but a
 * stem catches the pair. Same for "is he ACCEPTING postals" against a
 * question that says "accept".
 *
 * "add" must never reach "address", so a bare prefix has to be this long.
 *
 * SIX, not five. At five, "this MONTH" reached the MONTHLY amount cell, so
 * "why is he not payable this month" answered with his rate. The stem rule
 * above already covers the inflections a prefix was there for, which
 * leaves the prefix doing little except finding collisions like that one.
 */
const PREFIX_MIN = 6;

// Longest first, or "ions" would be cut to "ion". The remainder has to be
// long enough to still be a word: cutting "days" to "day" is the plural
// rule's job, and cutting "ends" to "end" must not make "end" reach "ends
// of the month".
const SUFFIXES = ['ations', 'ation', 'ions', 'ion', 'ings', 'ing', 'ers', 'er', 'ed', 'es'];
const STEM_MIN = 4;

function stem(word) {
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= STEM_MIN) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

function prefixes(a, b) {
  const short = a.length < b.length ? a : b;
  const long = short === a ? b : a;
  return short.length >= PREFIX_MIN && long.startsWith(short);
}

function sameWord(said, wanted) {
  if (said === wanted) return true;
  if (`${said}s` === wanted || `${wanted}s` === said) return true;
  if (stem(said) === stem(wanted)) return true;
  // ON THE STEMS TOO. "liquidating" and "liquidation" are the same length,
  // so neither prefixes the other, and their suffixes are cut to different
  // lengths ("liquidat" and "liquid"). Comparing what is left catches it.
  return prefixes(said, wanted) || prefixes(stem(said), stem(wanted));
}

/** How many times the label's rarest word appears, or 0 if any is absent. */
function mentions(label, said) {
  const wanted = wordsOf(label);
  if (wanted.length === 0) return 0;

  const heard = wordsIn(said);
  let fewest = Infinity;
  for (const word of wanted) {
    const hits = heard.filter((w) => sameWord(w, word)).length;
    if (hits === 0) return 0;
    fewest = Math.min(fewest, hits);
  }
  return fewest;
}

/**
 * ===============================
 * * THE MOST SPECIFIC LABEL THEY SAID WINS
 * ===============================
 * "Payable" is a subset of "Payable days", so a question about the day
 * count matches both and answering with the amount would be the exact fault
 * this file exists for. The longer label takes the mention, and the shorter
 * one only survives if its word was said MORE times than the longer label
 * used up: "his payable and his payable days" is still two questions.
 *
 * Same rule `peopleIn` uses in tools/resolvePerson.js to settle "Gloria"
 * against "Gloria difference".
 */
const isSubsetOf = (small, big) => small.every((w) => big.includes(w));

/**
 * ===============================
 * * A CELL IS ALSO NAMED BY THE VOCABULARY OF ITS VALUES
 * ===============================
 * "Is Richard's company LIQUIDATING" names no label. `Company status` needs
 * the word "status", and `liquidation` is one of the values that cell can
 * hold, not the value it holds today. So the sentence matched the plain
 * `Company` cell and she answered with the company's NAME, which is not
 * what was asked.
 *
 * A cell may declare the closed set it comes from, and any word in that set
 * names the cell. The set is the repo's own, so there is no list of
 * synonyms to keep current: a new company status is answerable the day it
 * is added.
 */
function optionsOf(cells, label) {
  const found = cells.find((c) => fold(c?.label) === fold(label));
  return Array.isArray(found?.options) ? found.options : [];
}

/** How many of this label's own words were said. */
function labelHits(label, said) {
  const heard = wordsIn(said);
  return wordsOf(label).filter((w) => heard.some((h) => sameWord(h, w))).length;
}

/**
 * The strength of this cell's claim on the sentence.
 *
 * A VOCABULARY WORD NEVER QUALIFIES A CELL ON ITS OWN, it only strengthens
 * one the label already reached. "Is he active" names no part of "Company
 * status", and `active` being one of that cell's possible values must not
 * make it the answer to a question about the DEAL's status. It only breaks
 * the tie in "is his COMPANY LIQUIDATING", where `company` is half the
 * label and `liquidating` is the other half of the meaning.
 */
function cellMentions(cells, label, said) {
  const whole = mentions(label, said);
  if (whole > 0) return whole;

  const partial = labelHits(label, said);
  if (partial === 0) return 0;
  const named = optionsOf(cells, label).some((option) => mentions(option, said) > 0);
  return named ? partial + 1 : 0;
}

function labelsIn(cells, said) {
  if (!fold(said)) return [];

  const labels = [...new Set(cells.map((c) => String(c?.label ?? '').trim()).filter(Boolean))]
    // Most words first, then longest: "Should be paid on the sheet" has to
    // be considered before "Paid" can claim the mention.
    .sort((a, b) => wordsOf(b).length - wordsOf(a).length || fold(b).length - fold(a).length);

  const kept = [];
  for (const label of labels) {
    const mine = cellMentions(cells, label, said);
    if (mine === 0) continue;
    const mineWords = wordsOf(label);
    const used = kept.reduce(
      (sum, k) => sum + (isSubsetOf(mineWords, wordsOf(k)) ? cellMentions(cells, k, said) : 0),
      0,
    );
    if (mine > used) kept.push(label);
  }
  return kept;
}

/**
 * The cells of ONE card that the sentence named.
 *
 * ONE CARD ONLY. A person holding four deals has four payable day counts
 * and no single answer, so the caller falls back to showing the cards.
 *
 * @returns {{label: string, value: string, money: boolean}[]}
 */
/**
 * ===============================
 * * THEY SAID THE VALUE, NOT THE LABEL
 * ===============================
 * "Is he active" names no label: the cell is called Status and `Active` is
 * what is IN it. So nothing matched, the whole card was drawn, and the
 * model answered beside it out of its own head.
 *
 * The value is already on the card, so this needs no synonym list: a word
 * the admin said that IS one of a cell's values names that cell.
 *
 * A FALLBACK ONLY, after every label has failed. "Show me his company"
 * must answer the Company cell, never whichever cell happens to hold the
 * word "company" as a value.
 *
 * Numbers are out. "500" is a value of three cells and of no question, and
 * a figure in the sentence is the admin naming an amount, not a column.
 */
const VALUE_WORD_MIN = 4;

/**
 * THE DEAL KEY'S OWN PARTS ARE HOW A ROW IS NARROWED, never a question.
 *
 * "Show me Nicola at Ackerman Pearce payroll" names a company to say WHICH
 * deal, and value matching read it as a question about the company cell:
 * it answered "Nicola's company: Ackerman Pearce payroll", which is the
 * sentence read back rather than the card asked for.
 *
 * Their LABELS still match, so "show me his company" is unaffected. See
 * `dealKey.js`: group, company and role are the identity.
 */
const IDENTITY_LABELS = ['Group', 'Company', 'Role'];
const isIdentityLabel = (label) => IDENTITY_LABELS.some((l) => fold(l) === fold(label));

function valueNamed(cell, said) {
  if (isIdentityLabel(cell?.label)) return false;
  const value = cell?.value;
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'number') return false;

  const words = wordsIn(value).filter((w) => w.length >= VALUE_WORD_MIN && !/^\d+$/.test(w));
  if (words.length === 0) return false;

  const heard = wordsIn(said);
  return words.every((w) => heard.some((h) => sameWord(h, w)));
}

/**
 * A MONEY CELL SAID AS MONEY: "GBP 1,450", never a bare "1450". Library
 * 2026-10-08: "what's felix orr's monthly" came back "1450", no currency.
 * The currency is the card's own cell, so the figure and the code agree.
 */
function asMoney(cells, value) {
  const n = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || String(value).trim() === '') return String(value);
  const cur = cells.find((c) => fold(c?.label) === 'currency')?.value || 'GBP';
  return `${cur} ${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
}

function fieldsAsked(card, said) {
  const cells = cellsOf(card);
  const wanted = labelsIn(cells, said);
  if (wanted.length === 0) {
    const byValue = cells.filter((c) => valueNamed(c, said));

    /**
     * THE UNQUALIFIED CELL WINS AN UNQUALIFIED WORD.
     *
     * "Is he active" matched both `Status` and `Company status`, which hold
     * the same word, and bailing left the question unanswered. They said
     * "active" and nothing else, so they meant the plain one: a longer
     * label names a more qualified thing they did not ask for.
     */
    const fewest = Math.min(...byValue.map((c) => wordsOf(c.label).length));
    const plainest = byValue.filter((c) => wordsOf(c.label).length === fewest);

    // Still more than one, and now it IS a guess. Guessing is the fault
    // this file exists to remove.
    return plainest.length === 1
      ? plainest.map((c) => ({
        label: String(c.label),
        value: isMoneyLabel(c.label) ? asMoney(cells, c.value) : String(c.value),
        money: isMoneyLabel(c.label),
      }))
      : [];
  }

  // Card order, not the order they were said: it reads the way the card
  // reads, and the money cells stay together.
  return cells
    .filter((c) => wanted.some((label) => fold(label) === fold(c?.label)))
    .map((c) => ({
      label: String(c.label),
      // A null cell is a field nobody has filled in, and saying "not set" is
      // the answer. Saying nothing reads as though the lookup failed.
      value: c.value === null || c.value === undefined || c.value === ''
        ? 'not set'
        : isMoneyLabel(c.label) ? asMoney(cells, c.value) : String(c.value),
      money: isMoneyLabel(c.label),
    }));
}

/**
 * The finished sentence, because a tool that computes an answer hands back
 * the answer rather than the parts of one.
 */
function fieldAnswer(name, fields) {
  if (fields.length === 0) return null;
  const who = String(name ?? '').trim();
  if (fields.length === 1) {
    const [only] = fields;
    return `${who}'s ${only.label.toLowerCase()}: ${only.value}.`;
  }
  return `${who}: ${fields.map((f) => `${f.label.toLowerCase()} ${f.value}`).join(', ')}.`;
}

module.exports = {
  fieldsAsked, fieldAnswer, labelsIn, cellsOf, isMoneyLabel, MONEY_LABELS,
};
