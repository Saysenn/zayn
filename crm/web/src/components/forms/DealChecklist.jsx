import SelectAll from './SelectAll';
import { formatMoney } from '../../helpers/formatMoney';

/**
 * ***************************************************
 * * WHICH OF THIS COMPANY'S DEALS
 * ***************************************************
 *
 * Three screens ask it and they must ask it the same way: the status
 * picker (which are reviewed monthly), the closure confirm (which stop)
 * and the liquidation panel's own table header. One list, one select all,
 * one way of naming a deal.
 *
 * ALL OF THEM IS THE DEFAULT, and that is the CALLER'S job, not this
 * component's. A checklist that ticked itself would fight somebody
 * unticking a row, and "none" is a real answer on at least one of the
 * three screens.
 *
 * NAMED THE SAME WAY EVERYWHERE: person, then group, then role. A deal has
 * no name of its own, and a list showing only a person cannot tell two
 * roles on one company apart.
 */
export default function DealChecklist({
  deals,
  chosen,
  onChosen,
  label = 'Deals',
  note,
  empty = 'This company has no live deals.',
  disabled = false,
}) {
  const ids = new Set(chosen ?? []);

  const toggle = (id) => {
    const next = new Set(ids);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChosen([...next]);
  };

  return (
    // WHITE, like every other panel on a light page. Sunken made a list of
    // four rows read as a shaded block sitting inside the modal.
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <SelectAll
          label={label}
          count={ids.size}
          total={deals.length}
          disabled={disabled}
          onChange={(all) => onChosen(all ? deals.map((d) => d.id) : [])}
        />
        <span className="text-[11px] text-text-faint">
          {ids.size} of {deals.length}
        </span>
      </div>

      {note && <p className="text-[11px] leading-4 text-text-faint">{note}</p>}

      {deals.length === 0 ? (
        <p className="text-[11px] text-text-faint">{empty}</p>
      ) : (
        <ul className="flex max-h-48 flex-col overflow-y-auto">
          {deals.map((deal) => (
            <li key={deal.id}>
              {/* The panel is white, so a hovered row SINKS. White on
                  white is no hover at all. */}
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-surface-sunken">
                <input
                  type="checkbox"
                  checked={ids.has(deal.id)}
                  onChange={() => toggle(deal.id)}
                  disabled={disabled}
                />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {deal.person_name ?? '(no handler)'}
                  <span className="text-text-faint">
                    {' · '}
                    {deal.group_name}
                    {deal.role_label ? ` · ${deal.role_label}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-text-muted">
                  {formatMoney(deal.monthly_amount, deal.currency)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
