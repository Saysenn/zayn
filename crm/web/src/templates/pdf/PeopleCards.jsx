import { money, amount, distinct, daysInPresetMonth, totalsByCurrency, METHOD_LABELS } from './shared';
import { periodLabel } from '../../helpers/paymentPeriod';

/**
 * The People page's export: every person as a bordered card, two to a row,
 * under the group they are paid by.
 *
 * The same facts as Breakdown, laid out as a grid instead of a stack. A
 * stacked list of 96 people runs to thirty pages of mostly empty right
 * margin; a card each puts two people on the width of one, and the border
 * is what tells you where one person's figures stop.
 *
 * GROUPED, because the money is. Somebody handling companies for INDIGO
 * and MILKMAN is paid by each, so they get a card under each showing only
 * that group's work, and their pay details repeat on both. Merging them
 * into one card would produce a figure nobody pays and would leave the
 * group totals unable to add up.
 *
 * WHY ITS OWN STYLES, when the registry says the page owns the CSS: the
 * page's rules govern every template, and Breakdown is what a person's own
 * Export button renders. Widening those rules to suit a half-width column
 * would change that document too. So the grid's classes are its own and
 * collide with nothing on the page.
 *
 * WHY inline-block AND NOT flex OR grid. This is print. Flex and grid
 * items straddle page breaks in browsers rather than being pushed whole to
 * the next page; inline-block flows like text, which is the one layout
 * mode printing has always paginated correctly.
 */

// One gap, used by the card width and the gutter between the pair, so the
// two can't be edited apart and leave a row that no longer sums to 100%.
const GAP_PX = 10;

const NO_GROUP = '(no group)';

/**
 * Regroup by GROUP, then by person within it.
 *
 * `people` arrives grouped by person, which is the breakdown's axis rather
 * than this one. Somebody working for two groups appears under each, with
 * only that group's deals on each card, so a group's cards add up to the
 * group's total.
 *
 * Groups are sorted by name so two runs of the same selection produce the
 * same document; people keep the order they arrived in, which is already
 * alphabetical.
 */
function groupsOf(people) {
  const byGroup = new Map();

  people.forEach((deals, i) => {
    for (const d of deals) {
      const g = d.group_name || NO_GROUP;
      if (!byGroup.has(g)) byGroup.set(g, new Map());
      const cards = byGroup.get(g);
      // person_id is NULL on an orphaned deal, and two orphans are not one
      // person, so the key falls back to this person's position in the
      // incoming list rather than to a placeholder they would share.
      const key = d.person_id ?? `orphan-${i}`;
      if (!cards.has(key)) cards.set(key, []);
      cards.get(key).push(d);
    }
  });

  return [...byGroup.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([groupName, cards]) => [groupName, [...cards.entries()], [...cards.values()].flat()]);
}

export default function PeopleCards({ people }) {
  return (
    <>
      <style>{`
        /* font-size:0 swallows the whitespace between inline-block cards,
           which would otherwise count as a character and push the second
           card of every row onto its own line. Restored on the card. */
        .pcards { font-size:0; }

        .pcard { display:inline-block; vertical-align:top; box-sizing:border-box;
                 width:calc(50% - ${GAP_PX / 2}px); margin:0 0 ${GAP_PX}px;
                 border:1px solid #ccc; padding:11px 12px 10px;
                 font-size:10.5px; line-height:1.5; break-inside:avoid; }
        .pcard:nth-of-type(odd) { margin-right:${GAP_PX}px; }

        /* HAIRLINE ON ALL FOUR SIDES, no stripe and no tint. A card is
           already a boundary; colouring one edge of it says nothing the
           border has not said. */
        .pcard h2 { font-size:12px; font-weight:700; margin:0 0 7px; padding:0 0 5px;
                    border-bottom:1px solid #111; letter-spacing:.01em; }

        /* Two columns, so every value starts at the same x however long the
           label above it was. */
        .pcard-pay { display:grid; grid-template-columns:auto 1fr; gap:1px 10px;
                     margin:0 0 9px; font-size:9.5px; }
        .pcard-pay dt { color:#777; }
        .pcard-pay dd { margin:0; word-break:break-word; }

        /* NAME OVER AMOUNT, not name / leader / amount. Half a page is
           ~85mm, and "SG, CKA, CKU, Umbrella co" plus a right-aligned
           figure does not fit on one line there: the leader collapses to
           nothing and the name wraps into the money. Stacked, the name gets
           the full width of the card and the figure keeps its own line. */
        .pcard-entry { padding:4px 0 3px; break-inside:avoid; }
        .pcard-entry + .pcard-entry { border-top:1px solid #eee; }
        .pcard-name { display:block; font-weight:600; }
        .pcard-amt { display:block; font-weight:700; font-variant-numeric:tabular-nums; }
        .pcard-workings { margin:1px 0 0; color:#777; font-size:9px; }
        .pcard-workings .sep { color:#bbb; padding:0 3px; }
        /* Words, not colour: the only signal that survives a black and
           white printer. Same choice the stacked layout made. */
        .pcard-entry.flagged .pcard-workings { color:#8a6d3b; }

        /* ONE heading, then a row per currency. Repeating the whole title
           for each currency printed three identical bold headlines and
           read as a bug in the export rather than as three currencies.
           The currency has its own column, so the figure beside it is the
           number alone: "GBP £29,048.39" says GBP twice. */
        .ptotal .t { margin:0 0 3px; text-transform:uppercase; font-size:9px;
                     letter-spacing:.05em; font-weight:700; color:#555; }
        .ptotal .r { display:flex; align-items:baseline; gap:10px; font-weight:700; }
        .ptotal .r + .r { margin-top:1px; }
        .ptotal .c { flex:0 0 auto; }
        .ptotal .v { flex:1 1 auto; text-align:right; white-space:nowrap;
                     font-variant-numeric:tabular-nums; }

        .pcard-total { margin-top:7px; padding-top:6px; border-top:1.5px solid #111; }

        /* The group's HEADING runs the full width: it opens the pair of
           columns and belongs to both. */
        .pgroup { margin:0 0 24px; }
        .pgroup > h2 { font-size:13px; font-weight:700; text-transform:uppercase;
                       letter-spacing:.08em; margin:0 0 11px; padding:0 0 6px;
                       border-bottom:1.5px solid #111; }

        /* Its TOTAL does not. A total is a small block of figures, and a
           full width rule per currency gave three headlines the width of
           the page, each repeating the group's name. One card wide, boxed,
           so it reads as the last thing in the column rather than as the
           start of the next group. */
        /* The CRM's accent tint (tailwind.config.js: accent.tint,
           tint-strong, strong). A PALE green with near-black figures, not
           the solid button green: white on dark reversed out is a block of
           ink per group, and it is the first thing to go wrong on a mono
           printer. print-color-adjust because browsers drop backgrounds
           when printing unless told not to, which would have left this
           looking exactly like the plain box it replaced. */
        .pgroup-total { display:inline-block; box-sizing:border-box; margin:2px 0 0;
                        width:calc(50% - ${GAP_PX / 2}px);
                        background:#e7f3ec; border:1px solid #cfe8db;
                        padding:9px 11px; font-size:10.5px;
                        -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        .pgroup-total .t { font-size:10px; color:#145c3b; }
        .pgroup-total .c, .pgroup-total .v { color:#16201b; }

        @media print {
          .pcard { font-size:9.5px; }
          /* A card taller than the page still breaks: browsers ignore
             break-inside when honouring it would leave a page blank. That
             is the right failure, so nothing forces it. */
          .pcard h2 { break-after:avoid; }
          .pcard-total { break-before:avoid; }
          /* A heading must never be the last thing on a page, and a total
             must never be the first. */
          .pgroup > h2 { break-after:avoid; }
          .pgroup-total { break-before:avoid; }
        }
      `}</style>

      {groupsOf(people).map(([groupName, cards, rows]) => (
        <section className="pgroup" key={groupName}>
          <h2>{groupName}</h2>

          <div className="pcards">
            {cards.map(([personKey, deals]) => (
              <section className="pcard" key={personKey}>
                {/* person_name is NULL on an orphaned deal (migration 030).
                    Named as unhandled rather than dropped: the row still
                    carries money somebody has to account for. */}
                <h2>{deals[0].person_name ?? '(no handler)'}</h2>

                <dl className="pcard-pay">
                  <dt>Phone</dt><dd>{distinct(deals, 'phone')}</dd>
                  <dt>Method</dt>
                  <dd>{[...new Set(deals.map((d) => METHOD_LABELS[d.payment_method] ?? d.payment_method))].join(' · ')}</dd>
                  <dt>Bank</dt><dd>{distinct(deals, 'bank_details')}</dd>
                  <dt>Account</dt><dd>{distinct(deals, 'account_number')}</dd>
                  <dt>Sort code</dt><dd>{distinct(deals, 'sort_code')}</dd>
                </dl>

                {deals.map((d) => (
                  <div key={d.id} className={`pcard-entry ${d.needs_review ? 'flagged' : ''}`}>
                    <span className="pcard-name">{d.company ?? '(no company)'}</span>
                    <span className="pcard-amt">{money(d.payable_amount, d.currency)}</span>
                    {/* No group on this line any more: the heading above
                        already says it, and repeating it on every deal of
                        every card spends the width the name needs. */}
                    <p className="pcard-workings">
                      {d.role_label}
                      <span className="sep">·</span>
                      {money(d.monthly_amount, d.currency)} ÷ {daysInPresetMonth(d.preset_on)} days × {d.payable_days}
                      <span className="sep">·</span>
                      {periodLabel(d.payment_period ?? d.status)}
                      {d.needs_review && <><span className="sep">·</span>needs a check</>}
                    </p>
                  </div>
                ))}

                {/* Ended deals still count here, the same as the stacked
                    layout: this answers "what have I earned", not "what is
                    owed this month". The group total below counts them too,
                    so the cards above it visibly add up to it. */}
                <div className="ptotal pcard-total">
                  <p className="t">Total</p>
                  {totalsByCurrency(deals).map(([currency, total]) => (
                    <div className="r" key={currency}>
                      <span className="c">{currency}</span>
                      <span className="v">{amount(total)}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="ptotal pgroup-total">
            <p className="t">Total for {groupName}</p>
            {totalsByCurrency(rows).map(([currency, total]) => (
              <div className="r" key={currency}>
                <span className="c">{currency}</span>
                <span className="v">{amount(total)}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
