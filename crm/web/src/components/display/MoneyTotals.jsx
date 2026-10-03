import CellInfo from './CellInfo';
import { totalsList } from '../../helpers/formatMoney';

// ***************************************************
// * Several currencies, one line
// ***************************************************
//
// Money is summed per currency and NEVER blended, so a company paid three
// ways has three figures and no single total. Printed inline they came out
// "AED 54,335 · £23,000 · 2,500 EURO", which is wider than the card it sat
// on: a RecordCard's lead is `shrink-0 whitespace-nowrap`, so it took the
// whole header row and the company's own NAME truncated to nothing.
//
// One figure stays visible and the rest go behind a CellInfo icon, which is
// the CRM's rule for extra information in a cell. The count is printed
// beside it because an icon on its own does not say there is more MONEY
// behind it, and a reader would take the visible figure for the total.
//
// NOT A TOTAL, and it must never read as one: `+2` is what stops that.

export default function MoneyTotals({ totals, label = 'Every currency' }) {
  const list = totalsList(totals);
  if (list.length === 0) return <span className="text-text-faint">—</span>;

  const [first, ...rest] = list;
  return (
    <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
      <span className="tabular-nums">{first.text}</span>
      {rest.length > 0 && (
        <>
          <span className="text-[11px] font-semibold tabular-nums text-text-faint">+{rest.length}</span>
          <CellInfo label={label}>
            <span className="block font-semibold">Paid in {list.length} currencies</span>
            <span className="mt-1 block">
              {list.map((entry) => (
                <span key={entry.currency} className="flex items-baseline justify-between gap-4 tabular-nums">
                  <span className="text-text-muted">{entry.currency}</span>
                  <span className="font-semibold">{entry.text}</span>
                </span>
              ))}
            </span>
            {/* The reason there is no fourth line adding them up. */}
            <span className="mt-1.5 block text-text-faint">Never added together.</span>
          </CellInfo>
        </>
      )}
    </span>
  );
}
