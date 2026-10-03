// ***************************************************
// * "ADD 3%" WAS WRITTEN AS "SET TO 3"
// ***************************************************
//
// THE INCIDENT, 2026-09-24, live. Zayn carried a 5% add on.
//
//   admin  "add 3% on Zayn's add-on, on the Master Sheet add-on column"
//   Diane   update_person({ addonPercent: 3 })
//           "Zayn's add-on percentage is now 3%."
//
// His September total fell from AED 8,400 to AED 8,240 and nothing said
// so. Three faults in one write, and each is separately enough:
//
//   1  "ADD 3%" AND "SET TO 3" ARE THE SAME CALL. The field is absolute
//      and there is no other, so an increment can only be expressed by
//      arithmetic she does in her head against a value she remembered.
//   2  THE LEVEL WAS WRONG. They said the MASTER SHEET column, which is
//      the deal; she wrote the PROFILE, which is every deal they hold.
//   3  NO FROM VALUE AND NO CONFIRM. "is now 3%" never said it had been
//      5%, so the one sentence that could have caught it did not exist.
//
// Two turns later she said "Zayn already has a 5% add-on", reading the
// value she had just overwritten. Same root: a remembered number.
//
// ===============================
// * THE CONFIRM IS THE FIX; THE DELTA IS WHAT MAKES IT ANSWERABLE
// ===============================
// Rates now take the two call shape, like `specialCaseDeal`, and the
// preview names the LEVEL, the FROM and the TO. That alone would have
// stopped this: "change Zayn's PROFILE add on from 5% to 3%" is a
// sentence the admin refuses.
//
// The delta argument exists so that "add another 3%" has somewhere to go
// once she has been stopped. Without it the only way to comply is the
// mental arithmetic that caused the incident.

const RATE_FIELDS = Object.freeze({
  addonPercent: { label: 'add on', column: 'addon_percent', direction: 'added' },
  feePercent: { label: 'fee', column: 'fee_percent', direction: 'deducted' },
});

/**
 * Did they ask for MORE, rather than for a value?
 *
 * "add another 3%", "add 3% on top", "3% more", "increase it by 3", "bump
 * it 3". Deliberately narrow: a phrase that fires when it is not meant
 * turns a plain "set the add on to 3" into a refusal, and being refused
 * for saying it correctly is worse than the guard is worth.
 *
 * "ADD 3% ON X" IS THE AMBIGUOUS ONE and it is the sentence from the
 * incident. It reads as an increment to a person and as an assignment to
 * a model, so it counts here: the cost of asking is one question, and the
 * cost of guessing was a silent 160 AED.
 */
const WANTS_MORE = new RegExp(
  '\\b(?:'
  + 'add(?:ing)?\\s+(?:another\\s+|an?\\s+)?\\d+(?:\\.\\d+)?\\s*%?'
  + '|another\\s+\\d+(?:\\.\\d+)?\\s*%'
  + '|\\d+(?:\\.\\d+)?\\s*%?\\s+more'
  + '|(?:increase|raise|bump|up)\\s+(?:it|them|the\\s+\\w+)?\\s*(?:by\\s+)?\\d+(?:\\.\\d+)?\\s*%?'
  + '|on\\s+top\\s+of'
  + ')\\b',
  'i',
);

const asksForMore = (said) => WANTS_MORE.test(String(said ?? ''));

/** Every number written as a percentage in their sentence. */
function percentsIn(said) {
  const out = [];
  for (const m of String(said ?? '').matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent)/gi)) {
    out.push(Number(m[1]));
  }
  return out;
}

/**
 * ===============================
 * * AN INCREMENT WRITTEN AS THE INCREMENT ITSELF
 * ===============================
 * The exact shape of the incident: they said "add 3", the row holds 5,
 * and the call carries 3. As an absolute that is a CUT, and it is the one
 * value that proves she did not add.
 *
 * Only when the current value is a real, different, non zero number. From
 * zero, "add 3" and "set 3" are the same write and refusing it would be
 * noise.
 *
 * @returns {string|null} the refusal, or null to carry on
 */
function overwroteAnIncrement({ field, value, current, said }) {
  const rate = RATE_FIELDS[field];
  if (!rate) return null;
  if (!asksForMore(said)) return null;

  const now = Number(current);
  if (!Number.isFinite(now) || now === 0) return null;
  if (!percentsIn(said).includes(Number(value))) return null;
  if (Number(value) === now) return null;

  const wanted = now + Number(value);
  return `THAT WOULD OVERWRITE, NOT ADD. They asked to add ${value}% and this call SETS the `
    + `${rate.label} to ${value}%. It is ${now}% now, so that is a CUT of ${now - Number(value)}%, `
    + `not an increase.\n\n`
    + `If they meant ${now}% plus ${value}%, send ${field}Delta: ${value} and the tool does the `
    + `arithmetic. If they meant exactly ${value}%, say it is ${now}% now and ask them to confirm `
    + `the drop before you send it again. NEVER work the new total out yourself from a figure you `
    + `remember: it is ${wanted}% or it is a question, and only the row knows which.`;
}

/**
 * ===============================
 * * THE SAME FAULT FOR MONEY, 2026-09-25
 * ===============================
 * "add 500 on Suki's payable amount" was written as payable SET to 500 on
 * a deal paying 3,000. An amount they said to ADD may not arrive as a set.
 *
 * @param {{ field, label, value, current, said }} p
 * @returns {string|null} the refusal, or null to carry on
 */
function overwroteAnAmount({
  field, label, value, current, said,
}) {
  if (!asksForMore(said)) return null;
  const now = Number(current) || 0;
  const n = Number(value);
  if (now === 0 || n === now) return null;
  const saidNumbers = [...String(said ?? '').matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number(m[0].replace(/,/g, '')));
  // The figure itself, or her own sum of it: both belong to `add`, where the
  // tool does the arithmetic and every person named travels in one call.
  const hers = saidNumbers.some((x) => x === n || x === n - now);
  if (!hers) return null;
  // THEIR figure, never hers: the add is what they said.
  const added = saidNumbers.includes(n) ? n : n - now;
  return `THAT WOULD OVERWRITE, NOT ADD. They asked to add ${added} and this SETS the ${label} to `
    + `${n}. It is ${now} now. Send it as an amount ADDED, so the tool does the sum: `
    + `bulk_update_master_sheet with perPerson, add: { ${field}: ${added} }, one entry for every `
    + 'person they named, with the company if they hold several deals. NOTHING HAS BEEN CHANGED.';
}

/**
 * ===============================
 * * "BACK TO 5%" ON A LEVEL THAT WAS NEVER 5%
 * ===============================
 * Live 2026-09-24. Zayn's PROFILE was 8% and both his DEALS were 0%.
 *
 *   admin  "make Zayn's deal back to 5%"
 *   Diane  "Zayn at Workforce's DEAL: add on 0% to 5%"
 *   admin  "no no no I want you to change the rate on that person"
 *
 * "Back to" means a value that WAS there. 0% to 5% is not going back to
 * anything, and the only level that had ever been 5% was the person's.
 *
 * SO IT ASKS RATHER THAN PICKING. The level this call would write holds
 * nothing, the other level holds something else, and which one they mean
 * is a question with a cheap answer and an expensive guess.
 */
const GOING_BACK = /\b(?:back to|revert(?:ed)?\s+(?:it|them|that)?\s*to|return\s+(?:it|them|that)?\s*to|put\s+(?:it|them|that)?\s*back)\b/i;

const goingBack = (said) => GOING_BACK.test(String(said ?? ''));

/**
 * @param {object} p
 * @param {string} p.said
 * @param {number} p.value  what this call would write
 * @param {number} p.current this level's value now
 * @param {number} p.other   the OTHER level's value now
 * @param {string} p.level   'profile' or 'deal'
 * @returns {string|null}
 */
function wrongLevelForRevert({
  said, value, current, other, level, label,
}) {
  if (!goingBack(said)) return null;
  const now = Number(current) || 0;
  const theirs = Number(other) || 0;
  // It already holds it, or it holds something, so "back to" is plausible
  // here and this is not the guard for it.
  if (now !== 0 || Number(value) === now) return null;
  // Nothing anywhere else either, so there is no better candidate to name.
  if (theirs === 0 || theirs === Number(value)) return null;

  const mine = level === 'profile' ? 'their PROFILE' : 'this DEAL';
  const yours = level === 'profile' ? 'the DEAL' : 'their PROFILE';
  return `"BACK TO" MEANS IT WAS THERE BEFORE, and ${mine} ${label} is 0%, so ${value}% would `
    + `not be going back to anything. ${yours} carries ${theirs}%.\n\n`
    + `Ask which one they mean: ${mine} at 0%, or ${yours} at ${theirs}%. Name both figures so `
    + 'they can answer in one word, and write nothing until they do.';
}

/**
 * ===============================
 * * "TAKE 5% OFF BRAM" IS A FEE, NEVER A LOWER RATE
 * ===============================
 * 2026-09-25: read as lowering his fee by 5, which went below zero, so she
 * offered to set it to 0 and "yes" wrote nothing he asked for. With a rate
 * named ("take 1% off his fee") it IS a lower rate, and passes.
 */
const TAKE_OFF = /\b(?:take|knock|deduct)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)\s+off\b(?![^.?!]*\b(?:fees?|add[\s-]?ons?|rates?)\b)/i;

/** The N in "take N% off <person>", or null. */
function takeOffPercent(said) {
  const hit = TAKE_OFF.exec(String(said ?? ''));
  return hit ? Number(hit[1]) : null;
}

function misreadTakeOff({
  field, value, current, said,
}) {
  const hit = TAKE_OFF.exec(String(said ?? ''));
  if (!hit) return null;
  // Their own figure as the fee is what they said, even over a higher one.
  if (field === 'feePercent' && Number(value) === Number(hit[1])) return null;
  const lowers = Number(value) < (Number(current) || 0);
  if (!lowers && field !== 'addonPercent') return null;
  return `"TAKE ${hit[1]}% OFF" IS A FEE OF ${hit[1]}%: money taken off what they are owed. It never `
    + `lowers a rate and never touches the add on. Send feePercent ${hit[1]}; if they already carry `
    + `a fee, ask whether ${hit[1]}% replaces it or goes on top. Nothing has been changed.`;
}

/**
 * ***************************************************
 * * A NUMBER WITH NO UNIT IS NOT A PERCENTAGE
 * ***************************************************
 *
 * Live 2026-09-29: "deduct 100 to zayn milkman" became a fee delta of
 * -100 and came back "I can't deduct 100% from Zayn Milkman's fee because
 * that would go below zero". Nobody said percent. On a 4,000 deal, 100 of
 * a currency is the likelier reading of the two and she picked the other
 * one without asking.
 *
 * `applyDelta` caught it, which is why nothing was written, but it caught
 * it as ARITHMETIC: the refusal argued about zero instead of saying the
 * unit was never given. That is the guard reporting the wrong fault, and
 * the admin then has to work out what she misread.
 *
 * ---- when this is NOT a guess ----
 *
 * A percent sign, the word, or a RATE NAMED. "take 5 off his fee" says
 * which field, so the unit follows from it; "deduct 100" says neither and
 * could be either. Naming the field is how somebody is precise about this,
 * so it must keep working.
 *
 * THE NUMBER HAS TO BE THEIRS. A figure she worked out herself is some
 * other guard's business, and refusing on it would block every computed
 * rate change.
 */
const PERCENT_FIELDS = new Set(['feePercent', 'addonPercent', 'personFeePercent', 'personAddonPercent']);
const SAYS_PERCENT = /%|\bpercent|\bpercentage|\bpc\b|\bpoints?\b/i;
const SAYS_RATE = /\bfees?\b|\badd[\s-]?ons?\b|\brates?\b/i;

/**
 * "1000" as somebody in a hurry writes it, or null when there is no short
 * form. 1000 is "1k", 4500 is "4.5k", 100000 is "100k". 1234 is nothing:
 * a shorthand with three decimals is not shorthand, and reading one would
 * be the guessing this file exists to refuse.
 */
function shorthandFor(n) {
  if (n < 1000) return null;
  const k = n / 1000;
  return Math.round(k * 100) === k * 100 ? `${k}k` : null;
}

function unitNotSaid({ field, value, said }) {
  if (!PERCENT_FIELDS.has(field)) return null;
  const text = String(said ?? '');
  if (!text || SAYS_PERCENT.test(text) || SAYS_RATE.test(text)) return null;

  const n = Math.abs(Number(value));
  if (!Number.isFinite(n) || n === 0) return null;

  /**
   * ===============================
   * * "1k" IS THE SAME FIGURE, WRITTEN SHORT
   * ===============================
   * This looked for the digits of the value in their sentence, so "deduct
   * 1k" against a value of 1000 matched nothing, the guard stayed silent,
   * and 1000 went into a percent field. The one case on the whole sweep
   * that could write a wrong figure rather than simply fail to act.
   *
   * AND A `k` IS NEVER A PERCENTAGE. Nobody writes "1k%". So the shorthand
   * does not merely let the guard SEE the number, it settles the unit
   * outright: an amount is being written to a rate, which is refused with
   * its own sentence rather than the ambiguous one below.
   */
  const shorthand = shorthandFor(n);
  if (shorthand && new RegExp(`(^|[^\\d.])${shorthand}(?![a-z0-9])`, 'i').test(text)) {
    return `THEY WROTE "${shorthand}", WHICH IS AN AMOUNT AND NOT A PERCENTAGE. Nobody writes a `
      + `rate that way. This would set ${n}% on a rate, which is not what they asked for. `
      + 'NOTHING HAS BEEN CHANGED. Ask whether they meant the payable amount or the monthly '
      + 'amount, and write nothing until they say.';
  }

  // Their own figure, written as they wrote it: not part of a longer one.
  // Comma grouping counts: "1,000" and "1000" are one number typed twice.
  const forms = [String(n), n.toLocaleString('en-US')]
    .map((f) => f.replace(/\./g, '\\.').replace(/,/g, ','));
  if (!forms.some((f) => new RegExp(`(^|[^\\d.,])${f}(?![\\d.])`).test(text))) return null;

  return `THEY SAID "${n}" AND NOTHING ELSE: no percent sign, no "percent", and no fee, add on `
    + `or rate named. ${n} in their currency and ${n}% are different amounts of somebody's money, `
    + 'and this would write the percentage. NOTHING HAS BEEN CHANGED. Ask which they meant, '
    + 'naming both readings in one short line, and write nothing until they answer.';
}

/**
 * ===============================
 * * "IS DOV ON 5%?" IS ANSWERED YES, NO OR PARTLY, IN CODE
 * ===============================
 * She read the rates out and never said no. The verdict is computed, and
 * opens her answer. `deals` carries the STACKED rate per deal.
 *
 * @param {{ name, asked: { percent, kind }, person: { addon, fee }, deals }} p
 * @returns {{ word: 'Yes'|'No'|'Partly', line: string }}
 */
const VERDICT_KIND = { addon: { key: 'addonPercent', label: 'add on' }, fee: { key: 'feePercent', label: 'fee' } };

function rateVerdict({
  name, asked, person, deals,
}) {
  const n = Number(asked.percent);
  const onDeals = (kind) => deals.map((d) => Number(d[VERDICT_KIND[kind].key]) || 0);
  // No kind named: whichever kind matches, else both are said.
  const kind = asked.kind
    ?? Object.keys(VERDICT_KIND).find((k) => onDeals(k).some((v) => v === n))
    ?? null;

  if (!kind) {
    return {
      word: 'No',
      line: `No. ${name} is on ${person.addon}% add on and ${person.fee}% fee on their profile, not ${n}%.`,
    };
  }
  const { label } = VERDICT_KIND[kind];
  const values = onDeals(kind);
  const hits = deals.filter((d, i) => values[i] === n);
  if (hits.length === deals.length && deals.length > 0) {
    return { word: 'Yes', line: `Yes. ${name} is on ${n}% ${label}${deals.length > 1 ? ' on every deal' : ''}.` };
  }
  if (hits.length > 0) {
    // BOTH FIGURES, per company: "profile alone is 2%" beside "on 2%" said nothing.
    const where = hits.map((d) => d.company).join(', ');
    const rest = deals.map((d, i) => [d, values[i]])
      .filter(([, v]) => v !== n)
      .map(([d, v]) => `${v}% at ${d.company}`);
    return {
      word: 'Partly',
      line: `Partly. ${name} is on ${n}% ${label} at ${where} but ${rest.join(' and ')}, because a `
        + `deal carries its own rate on top of the ${person[kind]}% on their profile.`,
    };
  }
  const shown = [...new Set(values)];
  return {
    word: 'No',
    line: `No. ${name} is on ${shown.length === 1 ? `${shown[0]}%` : shown.map((v) => `${v}%`).join(' or ')} `
      + `${label}, not ${n}%.`,
  };
}

/**
 * The absolute value a delta resolves to.
 *
 * @returns {{ value: number, from: number }|{ error: string }}
 */
function applyDelta(current, delta, max) {
  const from = Number(current) || 0;
  const value = Math.round((from + Number(delta)) * 100) / 100;
  if (!Number.isFinite(value)) return { error: 'That is not a number.' };
  if (value < 0) {
    return { error: `${from}% minus ${Math.abs(delta)}% is below zero. Ask them what they meant.` };
  }
  if (value > max) {
    return { error: `${from}% plus ${delta}% is ${value}%, over the ${max}% cap. Ask them what they meant.` };
  }
  return { value, from };
}

// "all 1 of their deals" read as a count of 1 and she told the admin 3.
function profileReach(deals) {
  if (!deals) return ', which is every deal they hold';
  return deals === 1 ? ', which is their only deal' : `, which is all ${deals} of their deals`;
}

/**
 * What a rate change is about to do, in one line, naming the level.
 *
 * THE LEVEL IS THE HALF SHE GOT WRONG. A profile rate reaches every deal
 * the person holds; a deal rate reaches one row. They stack, so neither
 * replaces the other, and "3%" without saying which is not an answer.
 *
 * @param {object} p
 * @param {'profile'|'deal'} p.level
 * @param {string} p.who
 * @param {object} p.fields   the pending write, camelCase
 * @param {object} p.current  { addonPercent, feePercent } as they stand
 * @param {number} [p.deals]  how many deals a profile change reaches
 * @returns {string[]} one line per rate actually changing
 */
function rateChangeLines({ level, who, fields, current, deals }) {
  const where = level === 'profile'
    ? `${who}'s PROFILE${profileReach(deals)}`
    : `${who}'s DEAL`;

  const lines = [];
  for (const [field, rate] of Object.entries(RATE_FIELDS)) {
    if (fields[field] === undefined) continue;
    const from = Number(current?.[field]) || 0;
    const to = Number(fields[field]);
    if (from === to) continue;
    // FROM AND TO, ALWAYS. "is now 3%" is what let a 5% vanish in silence.
    lines.push(`${where}: ${rate.label} ${from}% to ${to}%`);
  }
  return lines;
}

/**
 * ===============================
 * * ONE ENTRY POINT, BOTH LEVELS
 * ===============================
 * The person tool and the deal tool have to do exactly the same four
 * things in the same order, and the incident is what a second copy of
 * this drifting would cost. Resolve the deltas, refuse a contradiction,
 * refuse an overwritten increment, then hand back the lines to confirm.
 *
 * @param {object} p
 * @param {object} p.fields   the pending write, MUTATED: deltas resolve
 *                            into absolute values and are removed
 * @param {object} p.current  { addonPercent, feePercent } as they stand
 * @param {string} p.said     the admin's own sentence
 * @param {number} p.max      the cap
 * @returns {{ error: string }|{ lines: string[] }}
 */
/**
 * "Take N% off" with no fee on them yet IS a fee of N, so the preview says so.
 * Refused, she asked her own yes first and the admin agreed twice. 2026-09-25.
 */
function takeOffAsFee(fields, current, said) {
  const n = takeOffPercent(said);
  if (n == null || (Number(current.feePercent) || 0) > 0) return null;
  const rateKeys = Object.keys(RATE_FIELDS).flatMap((f) => [f, `${f}Delta`]);
  if (!rateKeys.some((k) => fields[k] !== undefined)) return null;
  for (const field of Object.keys(RATE_FIELDS)) {
    delete fields[field];
    delete fields[`${field}Delta`];
  }
  fields.feePercent = n;
  return n;
}

/**
 * "Take 1% off" someone already on a fee is two different writes. Dov on 2%
 * was proposed 2% to 3%, on top, with nobody asked. 2026-09-25.
 */
function takeOffOverAFee(fields, current, said) {
  const n = takeOffPercent(said);
  const now = Number(current.feePercent) || 0;
  if (n == null || now === 0) return null;
  const rateKeys = Object.keys(RATE_FIELDS).flatMap((f) => [f, `${f}Delta`]);
  if (!rateKeys.some((k) => fields[k] !== undefined)) return null;
  const replace = n === now ? `fee stays ${now}%, nothing changes` : `fee ${now}% to ${n}%`;
  return `"TAKE ${n}% OFF" IS A FEE OF ${n}%, and they already pay a ${now}% fee. Ask whether ${n}% `
    + `REPLACES it (${replace}) or goes ON TOP (fee ${now}% to ${now + n}%). Nothing has been changed.`;
}

function settleRates({
  fields, current, said, max, level, who, deals, other,
}) {
  const overAFee = takeOffOverAFee(fields, current, said);
  // The two options go back with the question, so the answer picks one in code.
  if (overAFee) {
    const n = takeOffPercent(said);
    return { error: overAFee, feeAsk: { replace: { feePercent: n }, onTop: { feePercentDelta: n } } };
  }
  // Returned, so the "yes" replays the FEE shown and not the minus she sent.
  const asFee = takeOffAsFee(fields, current, said);
  for (const field of Object.keys(RATE_FIELDS)) {
    const key = `${field}Delta`;
    const delta = fields[key];
    if (delta === undefined) continue;
    delete fields[key];
    // BOTH AT ONCE IS A CONTRADICTION, not something to resolve quietly.
    if (fields[field] !== undefined) {
      return {
        error: `You sent both ${field} and ${key}. One SETS and the other ADDS, so they cannot `
          + 'both be right. Send whichever they asked for and nothing else.',
      };
    }
    // BEFORE the arithmetic: "take 1% off suki" as a minus 1 answered "below
    // zero" three times and never reached the reason. 2026-09-25.
    const misread = misreadTakeOff({
      field, value: (Number(current[field]) || 0) + Number(delta), current: current[field], said,
    });
    if (misread) return { error: misread };
    // AND BEFORE THE ARITHMETIC TOO, for the same reason: "deduct 100"
    // answered "below zero", which argues about the sum instead of saying
    // the unit was never given. The delta is what they said, so it is the
    // figure to check. 2026-09-29.
    const noUnit = unitNotSaid({ field, value: delta, said });
    if (noUnit) return { error: noUnit };
    const out = applyDelta(current[field], delta, max);
    if (out.error) return { error: out.error };
    fields[field] = out.value;
  }

  for (const field of Object.keys(RATE_FIELDS)) {
    if (fields[field] === undefined) continue;
    const refusal = overwroteAnIncrement({
      field, value: fields[field], current: current[field], said,
    }) ?? misreadTakeOff({
      field, value: fields[field], current: current[field], said,
    }) ?? unitNotSaid({ field, value: fields[field], said });
    if (refusal) return { error: refusal };

    // "Back to 5%" on a level that holds nothing. See above.
    const wrongLevel = wrongLevelForRevert({
      said,
      value: fields[field],
      current: current[field],
      other: other?.[field],
      level,
      label: RATE_FIELDS[field].label,
    });
    if (wrongLevel) return { error: wrongLevel };
  }

  return { lines: rateChangeLines({ level, who, fields, current, deals }), asFee };
}

module.exports = {
  RATE_FIELDS,
  asksForMore,
  percentsIn,
  overwroteAnIncrement,
  applyDelta,
  rateChangeLines,
  settleRates,
  goingBack,
  wrongLevelForRevert,
  misreadTakeOff,
  unitNotSaid,
  takeOffPercent,
  rateVerdict,
  overwroteAnAmount,
};
