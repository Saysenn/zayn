import { paymentStartState, PAYMENT_START_CLASS } from '../../helpers/paymentStartState';
import { formatDate } from '../../helpers/formatDate';
import PaymentStartWhy, { paymentStartWords } from '../display/PaymentStartWhy';
import { presetFor, samplesFor, monthSpanFor } from '../../helpers/presetSamples';

/**
 * ***************************************************
 * * What colours the payment start cell, shown working.
 * ***************************************************
 *
 * A list of conditions is a specification. THIS IS A WORKED EXAMPLE: real
 * dates in real columns, coloured by the same function the sheet uses, so
 * the panel cannot describe behaviour the file does not have.
 *
 * Flip the toggle and two rows change colour: the ones the end date
 * decides. That is the whole point of the preview.
 */

// The preset and the sample dates are in helpers/presetSamples.js: pure date
// arithmetic, taking `now` as an argument so a test can run the whole table
// through twelve months. See the banner there for why nothing is pinned.

// The words and the popup are display/PaymentStartWhy, shared with the
// master sheet's own payment start cell. The preview exists to teach the
// rule the sheet applies, so two copies of the wording is two chances for
// the lesson and the thing being taught to disagree.
//
// Under the toggle OFF, three rows come out identically Green for the same
// reason, and only the warning icon tells them apart. That is not a bug, it
// is the whole lesson: with the end date out, a finished deal and a running
// one are the same colour.

export default function PaymentStartRules({ useEndDate }) {
  // COMPUTED AT RENDER, not at module load: a tab left open over midnight
  // on the last of the month would otherwise still show the old one.
  const preset = presetFor();
  const samples = samplesFor();
  const { lastDay, month } = monthSpanFor();

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">
        {`Preset ${formatDate(preset)}, so the month runs 1 to ${lastDay} ${month}.`}
      </p>

      <div className="table-wrap">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {/* THE PRESET LEADS. It is the month being asked about, so
                  the row reads "for this month, this start, this end, this
                  colour". Every row shares it, which is the point: the
                  colour is the start measured against ONE month. */}
              <th className="th">Preset</th>
              <th className="th">Payment start</th>
              <th className="th">End date</th>
              <th className="th">Colour</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((s) => {
              const state = paymentStartState(s.start, preset, s.end, useEndDate);
              const words = paymentStartWords(s.start, preset, s.end, useEndDate);
              return (
                <tr key={`${s.start}-${s.end}`} className="hover:bg-surface-sunken">
                  <td className="td whitespace-nowrap text-text-muted">
                    {formatDate(preset)}
                  </td>
                  {/* The start cell wears the colour, exactly as it does
                      on the sheet and in the file, and it carries the
                      explanation for the same reason: a flag belongs on the
                      column that caused it. On EVERY row, in both toggle
                      states, so a row without an icon never reads as a row
                      with nothing to say. */}
                  <td className={`td whitespace-nowrap ${PAYMENT_START_CLASS[state]}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span>{s.start ? formatDate(s.start) : '—'}</span>
                      <PaymentStartWhy start={s.start} preset={preset} end={s.end} useEndDate={useEndDate} />
                    </span>
                  </td>
                  <td className="td whitespace-nowrap text-text-muted">
                    {s.end ? formatDate(s.end) : '—'}
                  </td>
                  {/* WHY THIS ROW IS THIS COLOUR UNDER THIS TOGGLE, not a
                      fixed label on the sample. It read "Finished months
                      ago" beside a GREEN cell, because the sample's note
                      never moved when the toggle did. */}
                  <td className="td">
                    <span className="text-xs">
                      <span className="font-semibold">{words.word}</span>
                      <span className="text-text-muted">{` · ${words.reason}`}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-snug text-text-muted">
        {useEndDate
          ? 'The end date counts: a deal that finished shows red, and one ending this month shows amber.'
          : 'The end date is ignored, so a finished deal looks the same as a running one.'}
      </p>
    </div>
  );
}
