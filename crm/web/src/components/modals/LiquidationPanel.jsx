import { useMemo, useState } from 'react';
import Modal from './Modal';
import Button from '../buttons/Button';
import FloatingField from '../forms/FloatingField';
import SelectAll from '../forms/SelectAll';
import { formatMoney } from '../../helpers/formatMoney';
import { MONEY_INPUT, nonNegative } from '../../helpers/numberInput';

/**
 * ***************************************************
 * * Winding a company down, in one pass
 * ***************************************************
 *
 * LIQUIDATION IS A PERIOD, NOT AN INSTANT. A negotiation lands at, say,
 * 50%: 2,000 becomes 1,000, and that 1,000 is distributed to SELECTED
 * PEOPLE ONLY. Some deals go to zero, some stay exactly as they were, some
 * halve, some land on a number nobody could derive.
 *
 * SO THERE IS NO FACTOR ANYWHERE IN HERE. A multiplier cannot express a
 * director going to zero while a mid stays at 750. The settlement is a
 * NUMBER TO COMPARE AGAINST, never a rule that computes an amount.
 *
 * ONE SCREEN, ONE PASS. Not a flag per row scattered across the master
 * sheet: the decision is one negotiation, and chasing eight warnings
 * across a table is the mess this avoids.
 *
 * The old amounts are not lost. tb_mastersheet_changes records every edit
 * with its previous value, so "what was Nicola on before" is a History
 * question, which is where it belongs.
 */

// A percent typed into the header is a CONVENIENCE for filling the
// settlement box, never a rule applied to any row. It fills one field.
const PERCENTS = [25, 50, 75];

export default function LiquidationPanel({ company, deals, busy, onSave, onClose }) {
  const live = useMemo(
    () => (deals ?? []).filter((deal) => !deal.stopped_on),
    [deals],
  );
  const currency = live[0]?.currency ?? 'GBP';
  const oldTotal = live.reduce((sum, deal) => sum + Number(deal.monthly_amount ?? 0), 0);

  const [settlement, setSettlement] = useState(
    company?.liquidation_total == null ? '' : String(company.liquidation_total),
  );
  // Seeded with what each deal is on now, so saving without touching a row
  // changes nothing. A blank grid would read as "set them all to zero".
  const [amounts, setAmounts] = useState(() => Object.fromEntries(
    live.map((deal) => [deal.id, deal.monthly_amount == null ? '' : String(deal.monthly_amount)]),
  ));

  /**
   * ===============================
   * * WHICH DEALS THE SETTLEMENT IS ABOUT
   * ===============================
   * ALL OF THEM BY DEFAULT: a wind down normally covers the company. An
   * unticked deal is OUTSIDE the negotiation: its amount is not edited, it
   * is not counted in Allocated, and nothing is written for it.
   *
   * Which matters because Allocated is checked against the settlement. A
   * deal settled separately, left in the sum, makes every row look over.
   */
  const [inSettlement, setInSettlement] = useState(() => live.map((deal) => deal.id));
  const chosen = new Set(inSettlement);

  const included = live.filter((deal) => chosen.has(deal.id));
  const allocated = included.reduce((sum, deal) => sum + (Number(amounts[deal.id]) || 0), 0);
  const target = settlement === '' ? null : Number(settlement);
  const gap = target == null ? null : allocated - target;

  const changed = included.filter(
    (deal) => String(amounts[deal.id] ?? '') !== String(deal.monthly_amount ?? ''),
  );

  function save() {
    onSave({
      liquidationTotal: settlement === '' ? '' : Number(settlement),
      deals: changed.map((deal) => ({ id: deal.id, monthlyAmount: Number(amounts[deal.id]) || 0 })),
    });
  }

  return (
    <Modal
      wide
      title={`Liquidation: ${company?.name ?? 'this company'}`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Set what each person is paid while this winds down. The company keeps paying until you
          close or dissolve it.
        </p>

        <div className="flex flex-wrap items-end gap-3 border-b border-border pb-3">
          <FloatingField
            label={`Settlement (${currency})`}
            className="w-44"
            filled={settlement !== ''}
          >
            <input
              {...MONEY_INPUT}
              className="form-control"
              value={settlement}
              onChange={(e) => nonNegative(e.target.value) && setSettlement(e.target.value)}
            />
          </FloatingField>
          {/* Fills the box above from the current total. It writes one
              field and touches no row: there is no factor here. */}
          <div className="flex items-center gap-1">
            {PERCENTS.map((percent) => (
              <Button
                key={percent}
                size="xs"
                variant="quiet"
                onClick={() => setSettlement(String(Math.round(oldTotal * percent) / 100))}
              >
                {percent}% of {formatMoney(oldTotal, currency)}
              </Button>
            ))}
          </div>
        </div>

        <div className="table-wrap max-h-[50vh]">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr>
                {/* The select all sits in the header cell it governs, and
                    is the same control the closure checklist uses. */}
                <th className="th w-8">
                  <SelectAll
                    count={chosen.size}
                    total={live.length}
                    disabled={busy}
                    onChange={(all) => setInSettlement(all ? live.map((d) => d.id) : [])}
                  />
                </th>
                <th className="th">Name</th>
                <th className="th">Role</th>
                <th className="th">Now</th>
                <th className="th">New amount</th>
              </tr>
            </thead>
            <tbody>
              {live.map((deal) => {
                const inside = chosen.has(deal.id);
                return (
                  <tr
                    key={deal.id}
                    className={`border-b border-border last:border-0 ${inside ? '' : 'opacity-50'}`}
                  >
                    <td className="td">
                      <input
                        type="checkbox"
                        checked={inside}
                        disabled={busy}
                        aria-label={`Include ${deal.person_name ?? 'this deal'} in the settlement`}
                        onChange={() => setInSettlement((prev) => (inside
                          ? prev.filter((id) => id !== deal.id)
                          : [...prev, deal.id]))}
                      />
                    </td>
                    <td className="td font-semibold">{deal.person_name ?? '(no handler)'}</td>
                    <td className="td text-text-muted">{deal.role_label}</td>
                    <td className="td tabular-nums text-text-muted">
                      {formatMoney(deal.monthly_amount, deal.currency)}
                    </td>
                    <td className="td">
                      {/* Disabled, not hidden. An empty cell reads as an
                          amount of nothing; a greyed one says untouched. */}
                      <input
                        className="input-inline h-7 w-28 text-sm tabular-nums"
                        type="number"
                        {...MONEY_INPUT}
                        disabled={!inside || busy}
                        aria-label={`New monthly amount for ${deal.person_name ?? 'this deal'}`}
                        value={amounts[deal.id] ?? ''}
                        onChange={(e) => nonNegative(e.target.value) && setAmounts((prev) => ({
                          ...prev, [deal.id]: e.target.value,
                        }))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ===============================
             * WARN, NEVER REFUSE, ON BOTH SIDES
             * ===============================
             * The CRM holds the settlement SECOND HAND, typed from a phone
             * call, so refusing on a figure that may itself be wrong stops
             * real work. Legitimate mismatches exist: a rounding, a side
             * agreement, a deal outside the settlement. And a refusal
             * nobody can override gets worked around by typing a fake
             * settlement, which is worse than the warning it replaced. */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
          <span className="tabular-nums">
            Allocated {formatMoney(allocated, currency)}
            {target != null && ` of ${formatMoney(target, currency)}`}
          </span>
          {/* Said out loud, because a total that excludes rows silently is
              the figure somebody checks the settlement against. */}
          {included.length !== live.length && (
            <span className="text-text-muted">
              {live.length - included.length} left out, unchanged.
            </span>
          )}
          {gap != null && gap !== 0 && (
            <span className={gap > 0 ? 'text-warning' : 'text-text-muted'}>
              {gap > 0
                ? `${formatMoney(gap, currency)} over the settlement.`
                : `${formatMoney(-gap, currency)} still unallocated.`}
            </span>
          )}
          <span className="ml-auto flex gap-2">
            <Button variant="quiet" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : `Save ${changed.length || 'settlement'}`}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}
