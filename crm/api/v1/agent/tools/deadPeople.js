// ***************************************************
// * Diane on the dead list: who is on it, and one person's history
// ***************************************************
// Read only, widened on his say so 2026-09-25. A person is dead when every
// deal they held is stopped; see repos/deadPeople.repo.js.

const deadRepo = require('../../repos/deadPeople.repo');
const settingsRepo = require('../../repos/settings.repo');
const { shapeDeadPerson } = require('../../shared/deadPersonJourney.helper');
const { dayText } = require('../../shared/dayText.helper');
const { money, moneyPerCurrency } = require('../../shared/money.helper');
const { fold } = require('./resolvePerson');

// Names read out in full up to this many; past it the count and the first ones.
const NAMES_SHOWN = 15;
const LIST_PAGE = 200;

const listDeadPeople = {
  name: 'list_dead_people',
  description: 'Who is on the DEAD LIST: people who held deals before and now hold none live, every deal '
    + 'stopped and in the Archive. Use for "who is on the dead list", "how many dead people", "is X dead". '
    + 'q narrows by name or phone, group by group. For one person\'s history use dead_person_details.',
  parameters: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'A name or phone, as the admin said it' },
      group: { type: 'string', description: 'Only people who had a deal in this group' },
    },
  },
  async handler(args = {}) {
    const { rows, total } = await deadRepo.findAll({ q: args.q, group: args.group, page: 1, pageSize: LIST_PAGE });
    const scope = [args.q ? `matching "${args.q}"` : '', args.group ? `in ${args.group}` : ''].filter(Boolean).join(' ');
    if (total === 0) {
      return { summary: `Nobody${scope ? ` ${scope}` : ''} is on the dead list: everyone who had a deal still holds a live one. Say so in one sentence.` };
    }
    const lines = rows.slice(0, NAMES_SHOWN).map((r) => `  ${r.display_name}: ${r.deal_count} `
      + `${r.deal_count === 1 ? 'deal' : 'deals'} on ${r.company_count} `
      + `${r.company_count === 1 ? 'company' : 'companies'}, last stopped ${dayText(r.last_stopped)}`);
    const more = total > lines.length ? `\n  and ${total - lines.length} more` : '';
    return {
      summary: `${total} ${total === 1 ? 'person is' : 'people are'} on the dead list${scope ? ` ${scope}` : ''}:\n`
        + `${lines.join('\n')}${more}\n\nSay the count, then the names with these figures exactly. `
        + 'Their deals stay in the Archive; a deal added back under their name takes them off the list.',
    };
  },
};

const deadPersonDetails = {
  name: 'dead_person_details',
  description: 'ONE person on the dead list, in full: contacts, banks, and their deal journey company by company '
    + '(roles, when each started and stopped, what it was owed a month, and what the kept months recorded). '
    + 'person is their name as the admin said it.',
  parameters: {
    type: 'object',
    properties: { person: { type: 'string', description: 'Their name, as the admin said it' } },
    required: ['person'],
  },
  async handler(args = {}) {
    const { rows } = await deadRepo.findAll({ q: args.person, page: 1, pageSize: LIST_PAGE });
    // Exact first, so "Bram Tevish" never asks about Bram Okafor.
    const exact = rows.filter((r) => fold(r.display_name) === fold(args.person));
    const hits = exact.length > 0 ? exact : rows;
    if (hits.length === 0) {
      return { summary: `Nobody called "${args.person}" is on the dead list. They may still hold a live deal, or the name is spelled differently. Say so and ask.` };
    }
    if (hits.length > 1) {
      return {
        summary: `"${args.person}" could be ${hits.map((r) => r.display_name).join(', ')}. Ask which one. Nothing else yet.`,
        ambiguous: true,
      };
    }
    const [row, settings] = await Promise.all([deadRepo.findById(hits[0].person_id), settingsRepo.get()]);
    if (!row) return { summary: `${hits[0].display_name} is no longer on the dead list: a live deal was added back. Say so.` };
    const p = shapeDeadPerson(row, {
      useEndDate: Boolean(settings?.color_uses_end_date),
      cryptoPercent: Number(settings?.crypto_percent ?? 0),
    });
    const journey = p.companies.map((c) => `  ${c.company || 'no company'} (${c.group}), ${c.roles.join(', ') || 'no role'}: `
      + `${dayText(c.startedOn) ?? 'start unknown'} to ${dayText(c.stoppedOn)}, `
      + c.deals.map((d) => `${d.currency} ${money(d.owedMonthly)} a month over ${d.monthsActive} `
        + `${d.monthsActive === 1 ? 'month' : 'months'}`).join('; '));
    const earned = Object.keys(p.earnings.byCurrency).length > 0
      ? `The kept months (${p.earnings.months.join(', ')}) recorded ${moneyPerCurrency(p.earnings.byCurrency)} owed to them.`
      : 'No kept month recorded anything owed to them.';
    const contact = [
      p.phones?.length ? `phone ${p.phones.join(', ')}` : '',
      p.email ? `email ${p.email}` : '',
      p.bank_details?.length ? `bank ${p.bank_details.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    return {
      summary: `${p.display_name} is on the dead list: ${p.deal_count} ${p.deal_count === 1 ? 'deal' : 'deals'} on `
        + `${p.companyCount} ${p.companyCount === 1 ? 'company' : 'companies'}, `
        + `${dayText(p.firstStarted) ?? 'start unknown'} to ${dayText(p.lastStopped)}.\n${journey.join('\n')}\n`
        + `${earned}${contact ? `\nContact: ${contact}.` : ''}\n\n`
        + 'Say it company by company with these figures exactly. The page is Archive, Dead persons.',
    };
  },
};

module.exports = { deadPeopleTools: [listDeadPeople, deadPersonDetails] };
