import { money, daysInPresetMonth } from './shared';
import { periodLabel } from '../../helpers/paymentPeriod';
import PayBox from './PayBox';

/**
 * A person, their companies, and how to pay them.
 *
 * EXTRACTED from ExportPrintPage rather than copied: that page renders
 * this component now, so the printed breakdown has one definition. Two
 * near-identical print layouts would drift the first time a column moved,
 * and the one you got would depend on which route you came in through.
 *
 * The print CSS still lives on the page, because it governs the sheet
 * (margins, page breaks, what the browser puts in the header) rather than
 * this block. A template decides what is on the page; the page decides
 * what a page is.
 */
export default function Breakdown({ people }) {
  return people.map((deals) => {
    const person = deals[0];
    const totals = new Map();
    for (const d of deals) {
      const c = d.currency || 'GBP';
      totals.set(c, (totals.get(c) ?? 0) + Number(d.payable_amount || 0));
    }

    return (
      <section className="person" key={person.person_id}>
        <h2>{person.person_name}</h2>

        {/* How to pay them, in its own box: the header for every company
            below it rather than the first of them. See PayBox. */}
        <PayBox deals={deals} />

        {deals.map((d) => (
          /* Name and money on one line; the arithmetic underneath. A deal
             the importer could not resolve is flagged rather than dropped,
             so nobody is left off a payout sheet by a parsing problem. */
          <div key={d.id} className={`entry ${d.needs_review ? 'flagged' : ''}`}>
            <div className="line">
              <span className="name">{d.company ?? '(no company)'}</span>
              <span className="dots" />
              <span className="amt">{money(d.payable_amount, d.currency)}</span>
            </div>
            <p className="workings">
              {d.group_name}
              <span className="sep">·</span>
              {d.role_label}
              <span className="sep">·</span>
              {money(d.monthly_amount, d.currency)} ÷ {daysInPresetMonth(d.preset_on)} days × {d.payable_days}
              <span className="sep">·</span>
              {periodLabel(d.payment_period ?? d.status)}
              {d.needs_review && <><span className="sep">·</span>needs a check</>}
            </p>
          </div>
        ))}

        {[...totals.entries()].map(([currency, total]) => (
          <div className="total" key={currency}>
            <span className="name">Total for {person.person_name}</span>
            <span className="amt">{money(total, currency)}</span>
          </div>
        ))}
      </section>
    );
  });
}
