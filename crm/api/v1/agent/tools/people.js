// ***************************************************
// * Diane on PEOPLE: who is paid, and one person's pay state
// ***************************************************
// His call 2026-10-08. Should be paid and Paid are set PER PERSON on the
// People page and written to every live deal they hold; Payment received is
// what they answered on payday, summed over those same deals. The deal tools
// answer per deal, so "who isn't paid" or "show me Zayn" had no person level
// answer at all. Read only. The states come from people.repo, never worked
// out a second time here (see shared/personPayState.helper.js).

const peopleRepo = require('../../repos/people.repo');
const { fold } = require('./resolvePerson');

// Names read out in full up to this many; past it the count and the first ones.
const NAMES_SHOWN = 15;
const LIST_PAGE = 500;

// "MIXED" IS SAID IN WORDS: it means some of their deals one way, some the other.
const SHOULD_WORDS = {
  yes: 'should be paid',
  no: 'not to be paid',
  mixed: 'should be paid on some of their deals, not on others',
};
const PAID_WORDS = {
  yes: 'paid',
  no: 'not paid',
  mixed: 'paid on some of their deals, not on others',
};
const RECEIVED_WORDS = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  portion: 'Portion (only part of it arrived, flagged for an admin to mark which deals)',
  awaiting: 'Awaiting their answer',
};
const receivedWord = (v) => RECEIVED_WORDS[v] ?? 'never asked';

/** A filter given as a word, a list, or the deal tools' true/false. */
function valuesOf(raw, allowed) {
  if (raw === undefined || raw === null || raw === '') return [];
  if (raw === true) return ['yes'];
  if (raw === false) return ['no', 'mixed'];
  const list = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v).trim().toLowerCase());
  return [...new Set(list.filter((v) => allowed.includes(v)))];
}

/** One person's three states, in words. */
function payStateLine(p) {
  return `Should be paid: ${SHOULD_WORDS[p.should_be_paid_state] ?? 'no live deal'}. `
    + `Paid: ${PAID_WORDS[p.paid_state] ?? 'no live deal'}. `
    + `Payment received: ${receivedWord(p.payment_received)}.`;
}

/**
 * The person by name: exact first, so "Gloria" never asks about Gloria
 * difference, whose deals are listed under Gloria anyway.
 */
async function personNamed(name) {
  const { rows } = await peopleRepo.findAll({ q: name, page: 1, pageSize: 50 });
  const exact = rows.filter((r) => fold(r.display_name) === fold(name));
  return exact.length > 0 ? exact : rows;
}

/**
 * THE LINE "SHOW ME ZAYN" ENDS ON. The card shows deals; this is the
 * person's own three answers, so the reply carries them. Null when the name
 * is not one person.
 */
async function personPayLine(name) {
  const hits = await personNamed(name).catch(() => []);
  if (hits.length !== 1) return null;
  return payStateLine(hits[0]);
}

const listPeople = {
  name: 'list_people',
  description: 'PEOPLE, not deals, by their pay state across all their LIVE deals, as the People page shows '
    + 'it. Use for "who isn\'t paid", "who should not be paid", "who said portion", "who hasn\'t confirmed '
    + 'payment", "which people in ALPHA are unpaid". shouldBePaid and paid are the two switches, set per '
    + 'person: yes, no, or mixed (some of their deals yes, some no). paymentReceived is what they ANSWERED '
    + 'on payday, never the Paid switch: paid, unpaid, portion, awaiting. "Hasn\'t confirmed payment" is '
    + 'paymentReceived unpaid and awaiting. Pass every value in one array. For one person use show_person.',
  parameters: {
    type: 'object',
    properties: {
      shouldBePaid: { type: 'array', items: { type: 'string', enum: ['yes', 'no', 'mixed'] }, description: 'The should be paid switch, over their live deals' },
      paid: { type: 'array', items: { type: 'string', enum: ['yes', 'no', 'mixed'] }, description: 'The Paid switch, over their live deals. "Not paid" is no and mixed.' },
      paymentReceived: { type: 'array', items: { type: 'string', enum: ['paid', 'unpaid', 'portion', 'awaiting'] }, description: 'What they answered on payday' },
      group: { type: 'string', description: 'Only people with a deal in this group' },
      company: { type: 'string', description: 'Only people with a deal on this company' },
      role: { type: 'string', description: 'A role as the sheet writes it' },
      q: { type: 'string', description: 'A name or phone' },
      needsReview: { type: 'boolean', description: 'Only people with a deal flagged for a check' },
    },
  },
  async handler(args = {}) {
    const should = valuesOf(args.shouldBePaid, ['yes', 'no', 'mixed']);
    const paid = valuesOf(args.paid, ['yes', 'no', 'mixed']);
    const received = valuesOf(args.paymentReceived, ['paid', 'unpaid', 'portion', 'awaiting']);
    const base = {
      group: args.group || undefined,
      company: args.company || undefined,
      role: args.role || undefined,
      q: args.q || undefined,
      needsReview: args.needsReview === true ? true : undefined,
      page: 1,
      pageSize: LIST_PAGE,
    };
    // ONE QUERY PER COMBINATION: the repo takes one value per state, and
    // "not paid" is two of them (no, mixed). Merged by person, never added up.
    const combos = [];
    for (const s of should.length ? should : [undefined]) {
      for (const p of paid.length ? paid : [undefined]) {
        for (const r of received.length ? received : [undefined]) combos.push({ shouldBePaid: s, paid: p, paymentReceived: r });
      }
    }
    const byPerson = new Map();
    for (const combo of combos) {
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await peopleRepo.findAll({ ...base, ...combo });
      for (const r of rows) byPerson.set(r.person_id, r);
    }
    const people = [...byPerson.values()].sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));

    const scope = [
      should.length ? `should be paid ${should.map((v) => SHOULD_WORDS[v]).join(' or ')}` : '',
      paid.length ? `Paid ${paid.map((v) => PAID_WORDS[v]).join(' or ')}` : '',
      received.length ? `payment received ${received.map(receivedWord).join(' or ')}` : '',
      args.group ? `in ${args.group}` : '',
      args.company ? `at ${args.company}` : '',
      args.role ? `as ${args.role}` : '',
      args.q ? `matching "${args.q}"` : '',
      args.needsReview ? 'flagged for a check' : '',
    ].filter(Boolean).join(', ');

    if (people.length === 0) {
      const reply = `Nobody${scope ? ` (${scope})` : ''}.`;
      return { summary: `${reply} Say exactly that, and nothing wider.`, reply, computedReply: true };
    }
    const lines = people.slice(0, NAMES_SHOWN).map((p) => `${p.display_name}: ${payStateLine(p)}`);
    const more = people.length > lines.length ? `\n…and ${people.length - lines.length} more.` : '';
    const reply = `${people.length} ${people.length === 1 ? 'person' : 'people'}${scope ? ` (${scope})` : ''}:\n`
      + `${lines.join('\n')}${more}`;
    return {
      summary: `${reply}\n\nPEOPLE, not deals: each line is the person over every live deal they hold. `
        + 'Say it as written. Should be paid and Paid are set per person on the People page.',
      reply,
      computedReply: true,
    };
  },
};

const showPerson = {
  name: 'show_person',
  description: 'ONE person as the People page shows them: their live deals in short, and their Should be paid, '
    + 'Paid and Payment received over all of them. Use for "is Alex Example paid", "has Alex Example confirmed payment", '
    + '"should Blake Example be paid", "Alex Example\'s pay state". For a deal\'s full card use find_and_show_details.',
  parameters: {
    type: 'object',
    properties: { person: { type: 'string', description: 'Their name, as the admin said it' } },
    required: ['person'],
  },
  async handler(args = {}) {
    const hits = await personNamed(args.person);
    if (hits.length === 0) {
      return { summary: `Nobody called "${args.person}" is on the People page. Say so and ask who they meant.` };
    }
    if (hits.length > 1) {
      return {
        summary: `"${args.person}" could be ${hits.map((r) => r.display_name).join(', ')}. Ask which one. Nothing else yet.`,
        ambiguous: true,
      };
    }
    const p = await peopleRepo.findById(hits[0].person_id);
    if (!p) return { summary: `${hits[0].display_name} is no longer on the People page. Say so.` };
    const live = (p.deals ?? []).filter((d) => !d.stopped_on);
    const dealLines = live.map((d) => `  ${d.company || 'no company'} · ${d.group_name} · ${d.role_label || 'no role'}: `
      + `monthly ${d.currency || 'GBP'} ${Number(d.monthly_amount ?? 0).toLocaleString('en-GB')}`
      + `${d.needs_review && /payday/i.test(d.review_reason ?? '') ? ' (flagged: payday answer to check)' : ''}`);
    // NO TOTAL HERE: the repo's sum is before rates, and a figure she quotes
    // has to be the rated one. total_master_sheet owns that.
    const reply = `${p.display_name}: ${live.length} live ${live.length === 1 ? 'deal' : 'deals'}. ${payStateLine(p)}`;
    return {
      summary: `${reply}\n${dealLines.join('\n')}\n\nSay the first line as written, then the deals if they asked `
        + 'for them. "Some of their deals" means exactly that: the switch is not the same on all of them.',
      reply,
      computedReply: true,
    };
  },
};

module.exports = { peopleTools: [listPeople, showPerson], personPayLine };
