import { useCallback } from 'react';
import { apiService } from '../configs/api.config';
import useBulkActions, { DEAL_TOUCHES, bulkMessage, patchQueries, mapCachedRows, rollbackAll } from './useBulkActions';
import { countOf } from '../helpers/pluralNoun';

/**
 * ===============================
 * * SHOULD BE PAID AND PAID ARE THE PERSON'S
 * ===============================
 * His call 2026-10-08. Set per person on People and on a person's page,
 * stored on every LIVE deal they hold: the People pages are a summary of
 * the deals, so the switch writes the deals and the summary follows.
 *
 * A stopped deal is skipped, by the server as well as here: it is owed
 * nothing, so deciding its pay means nothing.
 */
export const PAY_SWITCHES = {
  overrideShouldBePaid: {
    label: 'Should be paid', state: 'should_be_paid_state', column: 'override_should_be_paid',
    verb: (on) => (on ? 'marked should be paid' : 'marked not to be paid'),
  },
  overridePaid: {
    label: 'Paid', state: 'paid_state', column: 'override_paid',
    verb: (on) => (on ? 'marked paid' : 'marked unpaid'),
  },
};

/** "2 yes · 1 mixed" over the ticked people, the line above Yes / No. */
export function payHint(people, state) {
  const n = { yes: 0, no: 0, mixed: 0 };
  for (const p of people) if (n[p[state]] !== undefined) n[p[state]] += 1;
  return Object.entries(n).filter(([, c]) => c).map(([k, c]) => `${c} ${k}`).join(' · ') || undefined;
}

/**
 * `setPay(people, field, on)`. Each person is `{ person_id, live_deal_ids }`.
 * The People rows and every cached person page change on the click; the
 * write runs behind it, with Undo on the toast.
 */
export default function usePersonPay() {
  const { run } = useBulkActions();

  return useCallback((people, field, on) => {
    const sw = PAY_SWITCHES[field];
    const ids = new Set(people.map((p) => String(p.person_id)));
    const dealIds = people.flatMap((p) => p.live_deal_ids ?? []);
    const shown = on ? 'yes' : 'no';

    run({
      call: () => (dealIds.length
        ? apiService.masterSheet.bulkUpdate(dealIds, { [field]: on }, { skipStopped: true })
        : Promise.resolve({ updated: [], skipped: {}, batchId: null })),
      optimistic: (qc) => rollbackAll(
        patchQueries(qc, [['people']], (data) => mapCachedRows(data, (row) => (
          ids.has(String(row.person_id)) && row[sw.state] ? { ...row, [sw.state]: shown } : row
        ))),
        patchQueries(qc, [['person']], (data, key) => {
          if (!ids.has(String(key[1])) || !data?.person) return data;
          const { person } = data;
          return {
            ...data,
            person: {
              ...person,
              [sw.state]: person[sw.state] ? shown : person[sw.state],
              deals: (person.deals ?? []).map((d) => (d.stopped_on ? d : { ...d, [sw.column]: on })),
            },
          };
        }),
      ),
      invalidates: DEAL_TOUCHES,
      toast: bulkMessage(sw.verb(on), people.length, 'person'),
      report: (d) => bulkMessage(sw.verb(on), d.updated.length, 'deal', [
        [d.skipped?.same ?? 0, 'already set'],
        [d.skipped?.stopped ?? 0, 'stopped, skipped'],
        [d.skipped?.gone ?? 0, 'gone since'],
      ]),
      undoBatch: (d) => d.batchId,
      failure: `Couldn't change ${sw.label.toLowerCase()} for ${countOf(people.length, 'person')}`,
    });
  }, [run]);
}
