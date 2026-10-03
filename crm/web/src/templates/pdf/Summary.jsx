import { money, totalsByCurrency } from './shared';

/**
 * One block per group: who is in it, what each is owed, and the group's
 * total. No bank details, no workings.
 *
 * The counterpart to Breakdown, not a shorter version of it. Breakdown is
 * handed to the person being paid and has to justify a figure; this is
 * handed to whoever signs it off and has to fit the whole run on a page or
 * two. That is why the columns differ rather than being a subset.
 *
 * Deliberately omits bank details. A sign-off copy gets read across a desk
 * and left on one, and account numbers have no business being on it.
 */
export default function Summary({ people }) {
  // Regroup by GROUP. `people` arrives grouped by person, which is the
  // breakdown's axis, not this one. One person in two groups is counted
  // under each, which is correct: they are paid for both.
  const byGroup = new Map();
  for (const deals of people) {
    for (const d of deals) {
      const g = d.group_name || '(no group)';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(d);
    }
  }

  return [...byGroup.entries()].map(([groupName, rows]) => {
    // Within a group, one line per person rather than per deal: somebody
    // on three companies is one payment, and this is the sign-off view.
    const byPerson = new Map();
    for (const r of rows) {
      const key = r.person_id ?? r.person_name ?? '(no handler)';
      if (!byPerson.has(key)) byPerson.set(key, []);
      byPerson.get(key).push(r);
    }

    return (
      <section className="person" key={groupName}>
        <h2>{groupName}</h2>

        {[...byPerson.values()].map((deals) => {
          const person = deals[0];
          const needsCheck = deals.some((d) => d.needs_review);
          return (
            <div key={person.person_id ?? person.person_name} className={`entry ${needsCheck ? 'flagged' : ''}`}>
              <div className="line">
                <span className="name">{person.person_name ?? '(no handler)'}</span>
                <span className="dots" />
                <span className="amt">
                  {totalsByCurrency(deals).map(([c, t]) => money(t, c)).join(' · ')}
                </span>
              </div>
              <p className="workings">
                {deals.length} {deals.length === 1 ? 'company' : 'companies'}
                <span className="sep">·</span>
                {[...new Set(deals.map((d) => d.role_label).filter(Boolean))].join(', ') || '—'}
                {needsCheck && <><span className="sep">·</span>needs a check</>}
              </p>
            </div>
          );
        })}

        {totalsByCurrency(rows).map(([currency, total]) => (
          <div className="total" key={currency}>
            <span className="name">Total for {groupName}</span>
            <span className="amt">{money(total, currency)}</span>
          </div>
        ))}
      </section>
    );
  });
}
