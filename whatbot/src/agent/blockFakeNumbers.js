/**
 * The safety net for prose that contradicts the figures underneath it.
 *
 * The prompt tells the LLM never to write a figure or a name — we paste the
 * real ones underneath its sentence. It ignores that often enough to matter.
 *
 * Both of these actually happened while testing:
 *   - it wrote out a full list of salaries above the real list. every single
 *     number was wrong, and all of them looked completely believable.
 *   - "your cash-paid team members are: James Taylor, Priya Singh and Liam
 *     O'Connor" — three people who don't work here, printed above the three
 *     who do.
 *
 * Making up a name is worse than making up a number. A wrong number looks like
 * a mistake; a wrong name looks like a fact.
 *
 * So we don't ask nicely in the prompt. We delete it here.
 *
 * The same applies in reverse — see `contradictsDisplay`. A weak model told
 * "never state a count" resolves it by apologising instead: "I can't give the
 * count", printed directly above a heading that reads "3 companies". The
 * prompt cannot win that argument, because both instructions are ours.
 */

/** money: £1,560 · AED 1,270 · €99 · and plain grouped numbers like 19,670 */
const MONEY =
  /(?:[£€$]\s?\d|(?:AED|GBP|EUR|USD)\s?\d|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b)/i;

/**
 * Counts, written as words.
 *
 * "You are on five companies" sailed straight through the money check — no
 * symbol, no digits — and it was wrong: five assignments across three
 * companies. A spelled-out count is still a figure the model made up, and it
 * reads as more confident than a digit does.
 *
 * Only counts of the things we actually return, so "one moment" and "two ways
 * to look at it" stay allowed.
 */
const COUNT_WORD =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:compan(?:y|ies)|assignments?|roles?|payments?|groups?)\b/i;

/** a person's name — "Grace Wood", or "**Nadia Holmes**" in bold */
const NAME = /\*?\*?[A-Z][a-z'’]+(?:\s+[A-Z][a-z'’]+)+\*?\*?/g;

export function containsFigures(text) {
  return MONEY.test(text) || COUNT_WORD.test(text);
}

/**
 * Did it write out a list of people?
 *
 * We count names across the WHOLE message, not line by line. This used to be
 * per-line and the LLM's favourite trick is one name per bullet point — so
 * every line had exactly one name, nothing tripped, and the whole made-up list
 * sailed through.
 *
 * One name is fine: "here's the payslip for Grace Wood" is a normal sentence.
 * Two or more is a list, and the real list is already attached below.
 */
export function containsNameList(text) {
  const matches = text.match(NAME) ?? [];
  const distinct = new Set(matches.map((m) => m.replace(/\*/g, "")));
  return distinct.size >= 2;
}

const NEUTRAL_LEAD = "Here you go:";

/**
 * Does the sentence deny something the attached figures actually contain?
 *
 * "I can't give a total" above a line reading *Payable this month: £8,300*.
 * "I don't have a count" above a heading reading *INDIGO — 3 companies*.
 *
 * Both make the bot look broken while it is working perfectly, and both come
 * from the model trying to obey "never state a figure yourself". Only checked
 * when a tool actually produced a display — with no figures attached, "I don't
 * have that" is the honest answer and must survive.
 */
const DENIAL =
  /\b(?:can(?:'|’)?t|cannot|can not|couldn(?:'|’)?t|don(?:'|’)?t|do not|unable to|no)\b[^.!?]{0,40}\b(?:give|provide|have|show|offer|access|calculate|work out|there is|available)?[^.!?]{0,30}\b(?:total|sum|count|number of|ranking|rank|breakdown|figure)/i;

export function contradictsDisplay(prose) {
  return DENIAL.test(prose);
}

/**
 * Delete anything the LLM typed that it shouldn't have.
 *
 * This used to just drop the bad lines, which left a mess: when it wrote
 * "name — amount" pairs, the amounts got removed and a column of orphaned
 * names stayed behind, sitting right above the real table.
 *
 * So now it's blunt. If we had to remove anything, only a single clean sentence
 * is allowed to survive. Still looks like a list? Bin the lot and use a plain
 * "Here you go:" — a gutted list reads worse than no intro at all.
 */
export function stripFigures(prose) {
  const offending = (line) => containsFigures(line) || containsNameList(line);

  if (!offending(prose)) return prose;

  const lines = prose.split("\n");
  const remainder = lines
    .filter((line) => !offending(line))
    .join("\n")
    .trim();

  // more than one line left over means it was a list, not a sentence
  const stillListShaped =
    remainder.split("\n").filter((l) => l.trim()).length > 1;

  if (stillListShaped || remainder.length < 15 || offending(remainder)) {
    return NEUTRAL_LEAD;
  }

  return remainder;
}
