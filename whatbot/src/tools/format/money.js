const SYMBOLS = { GBP: "£", EUR: "€", USD: "$" };

export const money = (n, currency = "GBP") => {
  const amount = n.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const symbol = SYMBOLS[currency];
  return symbol ? `${symbol}${amount}` : `${currency} ${amount}`;
};

const LABELS = { kp: "KP", loss_lead: "Loss lead" };
export const label = (k) =>
  LABELS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * Add up money, keeping each currency separate.
 *
 * Adding £ to AED gives you a number that means absolutely nothing, and it
 * would look completely normal sitting on a payroll summary. We hold no
 * exchange rates, so totals always come out per currency.
 */
export function totalsByCurrency(rows, pickValue = (a) => a.payableAmount) {
  const totals = new Map();
  for (const a of rows) {
    totals.set(a.currency, (totals.get(a.currency) ?? 0) + pickValue(a));
  }
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cur, amount]) => money(amount, cur))
    .join(" + ");
}

/** what a row with no company is called on a message */
export const NO_COMPANY = "Not tied to a company";

/**
 * Split assignments by company, A-Z.
 *
 * The All Books and Takeoff rows carry no company — they are paid against the
 * group itself. Those are real payments, so they get their own bucket instead
 * of being dropped.
 */
export function byCompany(rows) {
  const out = new Map();
  for (const a of rows) {
    const key = a.company ?? NO_COMPANY;
    out.set(key, [...(out.get(key) ?? []), a]);
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/** "1 company" not "1 companys". Small, but it looks amateur on a payslip. */
export const plural = (n, one, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** "Milkman" reads like a name. "MILKMAN" reads like a system shouting. */
export const groupName = (g) =>
  g.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** "A, B and C" — the way a person writes a list, not "A, B, C". */
export function list(items) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * How many are owed nothing this month, phrased as a person would say it.
 *
 * For a reply that LISTS the assignments. "3 of them" leans on the list
 * directly above it to say what "them" is.
 */
export function nothingOwedNote(rows) {
  const idle = rows.filter((a) => a.payableAmount === 0).length;
  if (idle === 0) return null;
  if (idle === rows.length)
    return "Everything you're on is at 0 days this month, so nothing is owed.";
  return `${idle} of them ${idle === 1 ? "is" : "are"} on 0 days, so nothing from ${idle === 1 ? "that one" : "those"}.`;
}

/**
 * The same fact, for a reply that lists nothing.
 *
 * Two rewrites got here. First it said "3 of them are on 0 days" — three of
 * WHAT, under a reply that printed no list. Then it said "1 of your 4
 * assignments", which was true but spoke a unit nobody ever sees: the
 * breakdown says 3 COMPANIES, because one of them is held twice.
 *
 * So it names the company. That is the word used everywhere else, and a name
 * answers the real question — which one, and why is it not in my total.
 */
export function nothingOwedCount(rows) {
  if (rows.every((a) => a.payableAmount > 0)) return null;

  /**
   * Only a company paying nothing AT ALL counts.
   *
   * One held twice, once at 31 days and once at 0, still pays. Listing it here
   * would contradict the breakdown, which shows it paying.
   */
  const byName = new Map();
  for (const a of rows) {
    const key = a.company ?? NO_COMPANY;
    byName.set(key, (byName.get(key) ?? 0) + a.payableAmount);
  }
  const idle = [...byName]
    .filter(([, paid]) => paid === 0)
    .map(([name]) => name);
  if (idle.length === 0) return null;

  if (idle.length === byName.size) {
    return byName.size === 1
      ? `${idle[0] === NO_COMPANY ? "What you hold here" : idle[0]} is on 0 days this month, so nothing is owed.`
      : "Everything you hold here is on 0 days this month, so nothing is owed.";
  }

  const named = idle.map((n) =>
    n === NO_COMPANY ? "the payment not tied to a company" : n,
  );
  return `Nothing from ${list(named)} this month, ${idle.length === 1 ? "it is" : "they are"} on 0 days.`;
}

/**
 * A menu they can answer with a single digit.
 *
 * Emoji numerals rather than "1." — they are unmissable in a WhatsApp thread,
 * and they make the reply feel like something you use rather than something you
 * read. Capped at three: a longer list is a form, not a chat.
 */
const NUMERALS = ["1.", "2.", "3."];

/**
 * How to recognise a menu in a message we already sent.
 *
 * Used to avoid showing the same one twice in a row, which is the thing that
 * makes a thread read like a machine rather than a person.
 *
 * Plain "1." rather than a keycap emoji. Keycaps render at wildly different
 * sizes across phones and desktop WhatsApp, and three of them stacked look like
 * a poll rather than a person listing options. It also matches the payday
 * message, which has always used plain numbers.
 */
export const FIRST_NUMERAL = NUMERALS[0];

export function choicesBlock(prompt, labels) {
  const shown = labels.slice(0, NUMERALS.length);
  return [prompt, ...shown.map((l, i) => `${NUMERALS[i]} ${l}`)].join("\n");
}
