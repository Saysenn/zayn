import { money, totalsByCurrency, daysInPresetMonth, shortDate, endedOn } from './shared';
import PayBox from './PayBox';

/**
 * A month's sheet, nested three deep: GROUP, then each person in it, then
 * each company they handle.
 *
 *   INDIGO
 *     Zayn
 *       phone · method · bank · account · sort code
 *       Workforce ........................... 3,675 AED
 *         Tech · 3,675 AED ÷ 31 days × 31
 *       Total, Zayn ......................... 3,675 AED
 *     Tyrone
 *       Churchill knight .................... £1,000
 *         Mid 1 · £1,000 ÷ 31 days × 31 · ended 06 Jul 2026, not counted
 *       Total, Tyrone ....... nothing this month, ended 06 Jul 2026
 *     …
 *     Total for INDIGO, August 2026 ....... £30,000
 *     4 deals not counted, payment period ended: £4,000
 *
 * AN ENDED PERIOD IS PRINTED BUT NOT COUNTED, with the date it ended said
 * on the line rather than left for the reader to find. The excluded sum is
 * stated under the group total so counted plus excluded reconciles to the
 * figures above it.
 *
 * WHY GROUP FIRST. A payment run is signed off a group at a time — that is
 * how the sheet is laid out and how the money is released. Breakdown.jsx
 * sorts by person because it answers "what am I owed"; this answers "what
 * does this group cost this month", which is a different document even
 * though it is the same rows.
 *
 * A person appearing in two groups appears under both, with a total under
 * each. That is correct: they are being paid for both, and a single
 * combined figure would not match either group's total.
 *
 * The month is stated on every group total rather than only in the title,
 * because a single group's page gets torn off and passed on by itself.
 *
 * BOTH TOTALS ARE OPTIONAL and off unless asked for, the same two switches
 * the spreadsheet has and read from the same query params (see
 * layoutOptions in v1/export.js). The point of sharing them is that the
 * printed page and the spreadsheet can never be handed different
 * instructions for one link.
 */

/** What is actually being paid: totals per currency, ended deals left out. */
const liveTotals = (rows) => totalsByCurrency(rows, { skipEnded: true });

/** Several currencies on ONE line. Separated, never added together. */
const joinMoney = (totals) => totals.map(([c, t]) => money(t, c)).join('  ·  ');

// Sentence case, from the YYYY-MM the roll wrote onto every row.
function monthLabel(month) {
  if (!month) return null;
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) return null;
  return new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default function MonthlySheet({ people, layout = {} }) {
  // THIS DOCUMENT STAYS PERSON SHAPED, unlike the xlsx month sheet, which is
  // now laid out one company at a time. They are different documents: this
  // one explains a person's figure, so it heads each block with their name
  // and prints their bank details once. It reads the renamed switch, and the
  // old name too, so a saved link still works. Whether one switch should
  // drive two differently shaped documents is unresolved and logged; PDF is
  // disabled on every mode today, so nothing renders this yet.
  const { companyTotals, personTotals, groupTotals = false } = layout;
  const subtotals = companyTotals ?? personTotals ?? false;
  const rows = people.flat();
  const month = monthLabel(rows[0]?.rolled_to);

  // group -> person -> their deals. Insertion order is the sort order the
  // API already applied, so groups and names stay in the sheet's own
  // sequence rather than being re-sorted into a different one here.
  const byGroup = new Map();
  for (const r of rows) {
    const g = r.group_name || '(no group)';
    if (!byGroup.has(g)) byGroup.set(g, new Map());
    const who = r.person_name ?? '(no handler)';
    const persons = byGroup.get(g);
    if (!persons.has(who)) persons.set(who, []);
    persons.get(who).push(r);
  }

  return [...byGroup.entries()].map(([groupName, persons]) => {
    const groupRows = [...persons.values()].flat();

    return (
      <section className="group" key={groupName}>
        <h2>{groupName}</h2>

        {[...persons.entries()].map(([who, deals]) => (
          <div className="person" key={`${groupName}-${who}`}>
            <h3>{who}</h3>

            {/* How to pay them, once per person per group. See PayBox. */}
            <PayBox deals={deals} />

            {deals.map((d) => (
              <div key={d.id} className={`entry ${d.period_ended || d.needs_review ? 'flagged' : ''}`}>
                <div className="line">
                  <span className="name">{d.company ?? '(no company)'}</span>
                  <span className="dots" />
                  <span className="amt">{money(d.payable_amount, d.currency)}</span>
                </div>
                <p className="workings">
                  {d.role_label}
                  <span className="sep">·</span>
                  {money(d.monthly_amount, d.currency)} ÷ {daysInPresetMonth(d.preset_on)} days × {d.payable_days}
                  {/* In words, so it survives a black-and-white printer.
                      The tint is a convenience, never the only signal. */}
                  {d.period_ended && (
                    <><span className="sep">·</span>ended {shortDate(d.end_on) ?? "date unknown"}, not counted</>
                  )}
                  {d.needs_review && <><span className="sep">·</span>needs a check</>}
                </p>
              </div>
            ))}

            {/* ONE line, however many currencies. Printing "Total, Zayn"
                once per currency read as a fault in the export rather than
                as three currencies. Still never SUMMED across them. */}
            {subtotals && liveTotals(deals).length > 0 && (
              <div className="subtotal">
                <span className="name">Total, {who}</span>
                <span className="amt">{joinMoney(liveTotals(deals))}</span>
              </div>
            )}

            {/* Somebody whose every deal has ended gets a line saying so
                rather than no line at all. A person printed with companies
                and money above them and nothing underneath reads as a
                layout fault, not as a decision. */}
            {subtotals && deals.every((d) => d.period_ended) && (
              <div className="subtotal">
                <span className="name">Total, {who}</span>
                <span className="amt none">nothing this month, ended {endedOn(deals)}</span>
              </div>
            )}
          </div>
        ))}

        {/* One line. Listed per currency, never summed across them —
            INDIGO alone runs GBP, EURO and AED and one blended figure
            would mean nothing. */}
        {groupTotals && liveTotals(groupRows).length > 0 && (
          <div className="group-total">
            <span className="name">
              Total for {groupName}{month ? `, ${month}` : ''}
            </span>
            <span className="amt">{joinMoney(liveTotals(groupRows))}</span>
          </div>
        )}

        {/* A group with nothing live still gets a total line. NEXUS is
            currently six ended deals, and printing six figures with no
            total under them looks like the export failed. */}
        {groupTotals && groupRows.every((d) => d.period_ended) && (
          <div className="group-total">
            <span className="name">
              Total for {groupName}{month ? `, ${month}` : ''}
            </span>
            <span className="amt none">nothing due, every period ended</span>
          </div>
        )}

        {/* NO "WHAT WAS LEFT OUT" LINE. The spreadsheet dropped its own,
            and a figure printed here that the .xlsx of the same export does
            not carry is exactly the disagreement these two files exist to
            avoid. Each ended deal still says "ended 06 Jul 2026, not
            counted" on its own workings line, which is where a reader looks
            when a total is short. */}
      </section>
    );
  });
}
