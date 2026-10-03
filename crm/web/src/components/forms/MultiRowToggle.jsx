import Toggle from './Toggle';
import CellInfo from '../display/CellInfo';
import { popup } from '../../configs/popups.config';

/**
 * "Several of these: several rows, or one row?"
 *
 * The two meanings a multi-select cannot tell apart, made an explicit
 * choice instead of a guess.
 *
 *   ON   one row each. The amount entered is what is earned PER item.
 *
 *   OFF  one row whose cell reads "A, B, C". One arrangement spanning
 *        several things, which is how the real sheet writes
 *        "SG, CKA, CKU, Umbrella co", and the amount is the TOTAL.
 *
 * ON by default: several rows is the common case and the one an admin
 * means when nothing says otherwise. Off is the exception the boss's sheet
 * uses three times out of ninety-six.
 *
 * `risky` marks the case where OFF has real consequences beyond the label.
 * On HANDLERS, person_id is derived from the name, so a joined
 * "Drew, Nathan, Abe" becomes one person called that: none of the three
 * get the deal, People groups them under a name that is not anyone, and
 * whatbot cannot identify any of them when they message in. It is still
 * offered, because the admin may genuinely want that cell to read that
 * way, but the consequence is stated where the switch is rather than
 * hidden behind an icon.
 */
export default function MultiRowToggle({
  checked,
  onChange,
  count = 0,
  noun = 'company',
  risky = false,
  // What OFF actually costs, in this noun's terms. The handlers wording is
  // the default because it was the first case; a group's consequences are
  // different ones and saying "the name cell" there would be wrong.
  warning,
}) {
  const plural = noun === 'company' ? 'companies' : `${noun}s`;

  return (
    <div className="space-y-2 py-1">
      <div className="flex items-center gap-2.5">
        <Toggle checked={checked} onChange={onChange} label="A row for each" />
        <span className="text-sm">
          {checked ? (
            <>
              <span className="font-semibold">A row for each</span>
              <span className="text-text-muted">
                {count > 1 ? ` — ${count} rows, ` : ' — '}
                the amount is what they earn per {noun}
              </span>
            </>
          ) : (
            <>
              <span className="font-semibold">One row for all of them</span>
              <span className="text-text-muted">
                {' '}— the amount is the total for the whole arrangement
              </span>
            </>
          )}
        </span>
        <CellInfo {...popup.multiRow({ noun, plural, count })} />
      </div>

      {/* Said out loud, and only when it is actually about to happen. The
          admin may want exactly this, but not by accident. */}
      {risky && !checked && (
        <p className="bg-warning-tint px-3 py-2 text-sm">
          {warning ?? (
            <>
              This writes one row with all of them in the name cell, so the system treats it as a
              single person called that. The individuals will not appear on this company, and
              whatbot will not recognise any of them when they message in. Use it only when the
              sheet is meant to read that way.
            </>
          )}
        </p>
      )}
    </div>
  );
}
