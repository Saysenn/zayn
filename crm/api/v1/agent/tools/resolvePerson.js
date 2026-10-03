/**
 * ***************************************************
 * * Which PERSON did they mean, and the way out of the question
 * ***************************************************
 *
 * ONE FUNCTION, because it was written out four times and the fourth copy
 * forgot half of it. `check_rates` had the ambiguity check without the
 * exact-match exit, so "Gloria" matched "Gloria difference" too, and
 * answering "Gloria" re-ran the same fuzzy search and asked again, forever.
 *
 * THE EXIT IS THE POINT. A question with no answer that resolves it is
 * worse than the dead end it replaced.
 *
 * TWO RULES, and they are not the same rule:
 *   1. An EXACT name typed wins outright, even with fuzzier neighbours
 *      beside it. Loosening the threshold so "Zine" finds "Zayn" also made
 *      "Zane" match "Zayn"; asking which, when they typed one exactly, is
 *      the bug.
 *   2. Ambiguity is about WHICH PERSON, never how many rows. One person on
 *      four companies is four rows and no question at all. Two DIFFERENT
 *      people still stops it dead: showing the wrong person's pay is worse
 *      than asking once.
 *
 * NEVER hand this to the model to decide. She cannot guess, structurally,
 * and a name is exactly where guessing costs somebody else's money.
 *
 * ITS OWN FILE since the export tool arrived. It was inside masterSheet.js,
 * which is where every other tool lives; a second tools file importing from
 * that one would make a 2,600 line module a dependency of everything.
 */
const personKey = (r) => String(r.person_id ?? r.person_name ?? '').trim().toLowerCase();

/**
 * PUNCTUATION AND SPACING ARE NOT THE NAME.
 *
 * "Gloria difference", "gloria-difference", "Gloria  Difference" and
 * "GLORIA DIFFERENCE" are one person typed four ways, and a byte
 * comparison called three of them a miss and asked which of two they meant.
 */
const fold = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * How many single character edits apart, giving up once past `max`.
 *
 * Only ever used to break a tie that is ALREADY down to one candidate, so
 * it can never pick between two people. "gloria - diference" is one letter
 * from "Gloria difference" and nothing else.
 */
function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], row[j - 1]);
    }
    if (Math.min(...row) > max) return false;
    prev = row;
  }
  return prev[b.length] <= max;
}

// One letter for a short name, two once it is long enough that a typo is
// likelier than a different person. "Zane" must never reach "Zayn".
const TYPO_LIMIT = (folded) => (folded.length >= 12 ? 2 : 0);

/**
 * IS THIS NAME ACTUALLY IN WHAT THEY SAID, typos allowed?
 *
 * Slides the name along the folded sentence rather than looking for it
 * whole, so one wrong letter anywhere still lands.
 */
function mentionedIn(said, name) {
  if (!said || !name) return false;
  if (said.includes(name)) return true;
  const slack = TYPO_LIMIT(name);
  if (slack === 0) return false;
  for (let len = name.length - slack; len <= name.length + slack; len += 1) {
    for (let i = 0; i + len <= said.length; i += 1) {
      if (within(said.slice(i, i + len), name, slack)) return true;
    }
  }
  return false;
}

/**
 * Short names need real word boundaries. Folding "Nicola details" into
 * "nicoladetails" creates the letters "ad" across the space, which used
 * to make the person Ad appear to have been named beside Nicola.
 */
function personMentionedIn(said, name) {
  const wanted = fold(name);
  if (!wanted) return false;
  if (wanted.length <= 3) {
    return String(said ?? '')
      .split(/[^A-Za-z0-9]+/)
      .some((word) => fold(word) === wanted);
  }
  return mentionedIn(fold(said), wanted);
}

const wordsOf = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** `needle` words appear in `hay` words, whole and in order, side by side. */
function containsRun(hay, needle) {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    if (needle.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
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
 * * EVERY PERSON ACTUALLY NAMED IN THE SENTENCE, longest first
 * ===============================
 *
 * "Combine gloria and gloria difference" names two people. The
 * longest-wins rule took Gloria difference, and she answered AED 150 while
 * calling it the total for both: Gloria's four deals, GBP 2,000, vanished
 * into a sentence that read as a confident answer.
 *
 * COUNTED, NOT MATCHED, because the short name lives inside the long one.
 * "gloria" appears twice in that sentence and "gloriadifference" once, so
 * one mention of Gloria is left over and she is a second person. In "show
 * me gloria difference" it appears once, fully covered, and is not.
 */
function peopleIn(rows, said) {
  const heard = fold(said);
  if (!heard) return [];

  const names = [...new Set(rows.map((r) => String(r.person_name ?? '').trim()))]
    .filter((n) => n && personMentionedIn(said, n))
    .sort((a, b) => fold(b).length - fold(a).length);

  const kept = [];
  for (const n of names) {
    const mine = occurrences(heard, fold(n));
    // A kept name reached through a TYPO has 0 exact occurrences and still
    // consumed one mention: "gloria - diference" is one person, not two.
    const covered = kept.reduce(
      (sum, k) => sum + (fold(k).includes(fold(n)) ? Math.max(occurrences(heard, fold(k)), 1) : 0),
      0,
    );
    // A typo match reports 0 occurrences of the exact string, and a name
    // reached that way is a real mention with nothing longer covering it.
    if (mine === 0 ? covered === 0 : mine > covered) kept.push(n);
  }
  return kept;
}

/**
 * THE LONGEST NAME THEY ACTUALLY SAID WINS.
 *
 * She kept dropping half the name. Asked to "show me gloria difference"
 * she called the tool with "Gloria", because `difference` reads as the
 * English word, and four of Gloria's deals came back instead of the one
 * belonging to Gloria difference. She then asked what they wanted to know
 * "about the difference".
 *
 * A prompt cannot fix that: it is a plausible reading of the sentence. So
 * the SENTENCE is checked. "Gloria difference" is in what they typed and
 * "Gloria" is only part of it, so the longer name is the one they meant.
 */
function fromSaid(rows, said) {
  return peopleIn(rows, said)[0] ?? null;
}

/**
 * DID THEY REACH FOR A NAME AND HALF GET IT?
 *
 * A word in their own sentence that is the START of two or more different
 * people's names, and is not anybody's whole name. "Glori" is that; it
 * reaches Gloria and Gloria difference and is neither.
 *
 * FOUR CHARACTERS MINIMUM, or ordinary words qualify: "and", "the", "her".
 * Requiring it to reach TWO people does most of the work anyway, since a
 * stray word almost never prefixes two names at once.
 *
 * @returns {string|null} the folded fragment, or null when they named
 *   nobody, which is the pronoun case and must be left alone.
 */
const FRAGMENT_MIN = 4;

function nameFragment(said, rows) {
  const names = [...new Set(rows.map((r) => fold(r.person_name)))].filter(Boolean);
  if (names.length === 0) return null;

  for (const raw of String(said ?? '').split(/[^A-Za-z0-9]+/)) {
    const word = fold(raw);
    if (word.length < FRAGMENT_MIN) continue;
    // A whole name is not a fragment: that is them being precise.
    if (names.includes(word)) continue;

    const reaches = new Set(names.filter((n) => n.startsWith(word)));
    if (reaches.size > 1) return word;
  }
  return null;
}

/**
 * @param {string} [said] the admin's own words this turn. Injected by
 *   runAgent, never passed by the model: the whole point is that it is the
 *   one version of the name she cannot have shortened.
 */
function resolvePerson(rows, typed, said = '') {
  const longer = fromSaid(rows, said);
  const wanted = fold(longer && fold(longer).length > fold(typed).length ? longer : typed);
  const nameOf = (r) => String(r.person_name ?? '').trim();

/**
 * ===============================
 * * TWO PEOPLE, ONE NAME, AND NO WAY OUT
 * ===============================
 *
 * The offer was `new Set(rows.map(nameOf))`, which DEDUPES BY NAME while
 * ambiguity counts PEOPLE. Two different `person_id`s called "James Smith"
 * made her ask "which one: James Smith?", and answering it asked again,
 * forever. Nothing in the real data hit it; renaming anybody would.
 *
 * So a label is unique PER PERSON: the name alone where it is theirs, the
 * name plus a company where it is not. `labelFold` is what answering one
 * has to match, and it is the only reason the label can be resolved at all.
 */
function labelsFor(rows) {
  const byPerson = new Map();
  for (const r of rows) {
    const key = personKey(r);
    if (!byPerson.has(key)) byPerson.set(key, { name: nameOf(r), companies: [] });
    const company = String(r.company ?? '').trim();
    const seen = byPerson.get(key).companies;
    if (company && !seen.includes(company)) seen.push(company);
  }

  const sharing = new Map();
  for (const { name } of byPerson.values()) {
    sharing.set(fold(name), (sharing.get(fold(name)) ?? 0) + 1);
  }

  const out = new Map();
  for (const [key, { name, companies }] of byPerson) {
    // Only qualified where it has to be. A bare name is what they typed.
    const shared = (sharing.get(fold(name)) ?? 0) > 1;
    out.set(key, shared && companies.length ? `${name} (${companies.join(', ')})` : name);
  }
  return out;
}

// Two people on the SAME name and the SAME companies would still collide.
// The person key ends the tie: unreadable, but it resolves, and a question
// that cannot be answered is the fault this exists to prevent.
function uniqueLabels(rows) {
  const labels = labelsFor(rows);
  const used = new Map();
  for (const [key, label] of labels) {
    used.set(fold(label), (used.get(fold(label)) ?? 0) + 1);
  }
  for (const [key, label] of labels) {
    if ((used.get(fold(label)) ?? 0) > 1) labels.set(key, `${label} [${key}]`);
  }
  return labels;
}

  /**
   * ===============================
   * * SHE CORRECTED THEIR SPELLING AND THE EXACT RULE LET HER
   * ===============================
   *
   * "What's glori on" reaches TWO people. She passed `Gloria` (her own
   * tidying of it), which matches Gloria exactly, so rule 1 below fired
   * and no question was ever asked. The exact rule is right, but it is
   * meant to protect a name the ADMIN typed, not one she smoothed over.
   *
   * NOT "ask whenever the pool holds two". That breaks the pronoun case:
   * "and her percentages?" names nobody, she supplies the name from the
   * previous turn, and asking there re-opens the loop this file exists to
   * close.
   *
   * The difference is whether THEY reached for a name at all. A fragment
   * of one, present in their sentence and not matching who she resolved to,
   * is them naming somebody imprecisely and it deserves the question.
   */
  const attempted = nameFragment(said, rows);
  if (attempted && wanted && attempted !== wanted) {
    const reach = rows.filter((r) => fold(nameOf(r)).startsWith(attempted));
    const who = new Set(reach.map(personKey));
    if (who.size > 1) {
      return {
        rows: reach,
        ambiguous: true,
        matched: false,
        fragment: attempted,
        names: [...uniqueLabels(reach).values()],
        people: [...who],
      };
    }
  }

  // WHICH PERSON THE OFFER'S LABEL NAMES, where they answered with one.
  // A bare name is its own label, so this only ever adds the qualified
  // form: "James Smith (Acqua)" when two James Smiths exist.
  const answered = wanted
    ? [...uniqueLabels(rows)].filter(([, label]) => fold(label) === wanted).map(([key]) => key)
    : [];

  // 1. THE NAME AS TYPED, punctuation and spacing ignored, or the LABEL we
  //    offered. One filter, because four copies of this is how the exit got
  //    lost the first time.
  let exact = rows.filter((r) => fold(nameOf(r)) === wanted
    || (answered.length === 1 && personKey(r) === answered[0]));

  // 1b. WHOLE WORDS OF THE NAME. "kiran" is Kiran Vale's own first name,
  //     not a guess, and refusing it said "no person matches" about
  //     someone on screen. Whole words only, so "kir" or "zane" never
  //     land; two people sharing the word keeps it a question below.
  if (exact.length === 0 && wanted) {
    const typedWords = wordsOf(longer ?? typed);
    const byWords = rows.filter((r) => containsRun(wordsOf(nameOf(r)), typedWords));
    exact = byWords;
  }

  // 2. A TYPO, but only when it lands on exactly ONE person. Two
  //    candidates within reach is not a typo, it is a real question.
  if (exact.length === 0 && wanted) {
    const near = rows.filter((r) => within(fold(nameOf(r)), wanted, TYPO_LIMIT(wanted)));
    if (new Set(near.map(personKey)).size === 1) exact = near;
  }

  /**
   * ===============================
   * * 3. ONE LETTER OUT, AND EVERYBODY ELSE FURTHER AWAY
   * ===============================
   * `TYPO_LIMIT` is 0 below twelve characters, deliberately: on a short
   * name a single letter really is a different person, and "Zine" must
   * not silently become "Zane". So a short name with one letter wrong
   * matched nothing and fell through to the whole search result.
   *
   * Live 2026-09-24: "show me Maya" asked "Mayah or Maid?". Maid is a real
   * person and clears the search's trigram floor, but it is TWO letters
   * from what was typed where Mayah is one, so it was never the question.
   *
   * A RANK GAP, NOT A WIDER LIMIT. It fires only when the best is one
   * letter out AND every other person is strictly further, so a tie still
   * asks and a name nobody is close to still asks. That is what keeps
   * "Zine" and "Zane", both one letter from "Zone", a question.
   */
  /**
   * ===============================
   * * NO RANK GAP HERE, AND THAT IS THE POINT
   * ===============================
   * Tried 2026-09-24 and backed out: "show me Maya" asking "Mayah or
   * Maid?" looks like a bug, so a rule was added picking the candidate
   * that was strictly fewer letters away.
   *
   * It broke five guards, and the one that matters is
   * `a typo may never reach a SECOND person`: "Jonathan Smithh" is one
   * letter from Smithe and two from Smythe, and a rank gap hands the
   * money to Smithe without asking.
   *
   * THE RULE IS NOT "FORGIVE A SLIP". It is that tolerance forgives a
   * slip and NEVER chooses between two people. Anything that removes the
   * question chooses, however clear the margin looks. Maid is offered
   * because the search reached it; answering with a name resolves it in
   * one word, and that is the cost of never guessing.
   */

  // DID THE NAME LAND, or did we fall back to everything? An exception
  // list needs to tell those apart: a misspelt name that quietly resolves
  // to the whole set would hold back rows nobody asked to hold back.
  const matched = exact.length > 0;
  const narrowed = matched ? exact : rows;

  const people = [...new Set(narrowed.map(personKey))];
  if (people.length <= 1) return { rows: narrowed, ambiguous: false, matched, names: [] };

  // Offered EXACTLY as written, so answering with one of them resolves.
  // One label per PERSON, never one per name: see labelsFor.
  const names = [...uniqueLabels(narrowed).values()];
  return { rows: narrowed, ambiguous: true, matched, names, people };
}

/**
 * ===============================
 * * THE SENTENCE ONLY HELPS ONE NAME
 * ===============================
 *
 * `said` recovers a name she SHORTENED, by taking the longest name in the
 * sentence. With a LIST every entry is already whole, so the sentence
 * overrode all of them with that same longest name.
 *
 * Twice now: "Gloria" and "Gloria difference" both became Gloria
 * difference, so a combined total lost GBP 2,000; then "zayn and paddy"
 * both became Paddy and she offered "2 rows: Paddy, Paddy". Fixed at one
 * call site and missed at the other, which is why it lives here.
 */
function saidFor(names, said) {
  return names.length === 1 ? (said ?? '') : '';
}

module.exports = {
  resolvePerson, personKey, fold, mentionedIn, personMentionedIn, within, peopleIn, saidFor,
};
