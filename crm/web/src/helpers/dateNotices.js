import { suggestDates, mismatchedDates } from './suggestDates.js';
import { PAYMENT_START_OFFSET_DAYS, forcesFullMonth } from './fromAppointment.js';
import { daysInMonthOf } from './payable.js';
import { monthLabel } from './monthLabel.js';
import { GOING_CONCERN, REVIEWED_MONTHLY } from '../configs/sheetValues.js';
import { COMPANY_STATUS_LABEL } from '../configs/companyStatus.js';
import { endedBeforeMonth } from './paymentStartState.js';
import { formatDate } from './formatDate.js';
import { formatMoney } from './formatMoney.js';
import { popup } from '../configs/popups.config.js';

// ***************************************************
// * Which of the three date cells has something to say
// ***************************************************

/**
 * Same shape as reviewFields.js `flaggedColumns`: a column name maps to
 * what that column's marker should say. The master sheet reads it per row
 * and hands each entry to forms/CellSuggestion.
 *
 * ONLY THESE THREE COLUMNS. An empty cell is not a fault anywhere else in
 * the CRM, and the twelve `Ongoing` rows carrying none of the three are
 * CORRECT as they stand: suggestDates returns null for them, so they get
 * nothing.
 */

/** The camelCase field a patch carries -> the column and the words for it. */
export const DATE_FIELD_LABEL = {
  assignedOn: 'Appointment',
  paymentStartOn: 'Payment start',
  endOn: 'End date',
};

const DATE_FIELD_COLUMN = {
  assignedOn: 'assigned_on',
  paymentStartOn: 'payment_start_on',
  endOn: 'end_on',
};

// His two formulas said in words, one definition. The 90 is read off the
// constant so the sentence cannot disagree with the arithmetic.
const FORMULA_TEXT = {
  paymentStartOn: `appointment + ${PAYMENT_START_OFFSET_DAYS} days`,
  endOn: 'appointment + 1 year',
};

/** "the end date", or "the payment start and the end date". */
function listOf(labels) {
  const words = labels.map((l) => l.toLowerCase());
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and the ${words.at(-1)}` : words[0];
}

/** What the toast calls this write. One patch can move two cells. */
function saveLabelFor(fields) {
  const keys = Object.keys(fields);
  return keys.length > 1 ? 'dates' : DATE_FIELD_LABEL[keys[0]].toLowerCase();
}

/**
 * @param {object} row snake_case, as the cache holds it
 * @returns {Record<string, {tone, label, body, accept?, fields?}>}
 *   column -> the marker. `fields` present means it can be accepted, and it
 *   is the WHOLE patch: filling one of these fills everything it implies.
 */
export function dateNoticesFor(row, { useEndDate = false } = {}) {
  const out = {};
  const suggestion = suggestDates(row);

  if (suggestion?.direction === 'forward') {
    // An icon on EACH empty cell the formula fills, and both accept the
    // same patch, because accepting either one fills both.
    const fields = Object.keys(suggestion.fields);
    for (const field of fields) {
      const others = fields.filter((f) => f !== field).map((f) => DATE_FIELD_LABEL[f]);
      out[DATE_FIELD_COLUMN[field]] = {
        ...popup.dateFromAppointment({
          label: DATE_FIELD_LABEL[field],
          value: formatDate(suggestion.fields[field]),
          formula: FORMULA_TEXT[field],
          also: others.length ? listOf(others) : null,
        }),
        accept: others.length ? 'Fill both' : 'Fill it in',
        fields: suggestion.fields,
        saveLabel: saveLabelFor(suggestion.fields),
      };
    }
  } else if (suggestion?.direction === 'backward') {
    // ONE MARKER, on the appointment, and it is the only one. The other
    // empty cells here are worked out from a date the CRM invented, so an
    // ordinary grey "this follows the formula" on them would be a lie
    // about where the number came from.
    const others = Object.keys(suggestion.fields)
      .filter((f) => f !== 'assignedOn')
      .map((f) => DATE_FIELD_LABEL[f]);
    out.assigned_on = {
      ...popup.appointmentGuessed({
        value: formatDate(suggestion.fields.assignedOn),
        from: suggestion.from,
        also: others.length ? listOf(others) : null,
      }),
      accept: 'Accept this date',
      fields: suggestion.fields,
      saveLabel: saveLabelFor(suggestion.fields),
    };
  }

  // A stored date that disagrees with the formula. No `fields`, so no
  // button: this is reported and never corrected.
  for (const off of mismatchedDates(row) ?? []) {
    out[DATE_FIELD_COLUMN[off.field]] = popup.dateSetByHand({
      label: DATE_FIELD_LABEL[off.field],
      is: formatDate(off.is),
      formula: formatDate(off.formula),
    });
  }

  /**
   * THE ONE ROW WHERE THE DAY COUNT DOES NOT FOLLOW THE START DATE.
   *
   * On the PAYABLE DAYS cell, not a date cell, because that is the number
   * that looks wrong: 31 beside a start of 30 October. The three date
   * cells above are all correct and need no marker.
   *
   * Month 3 only. From month 4 the stored start sits before the month and
   * the ordinary formula returns a full month on its own, so there is
   * nothing left to explain.
   */
  if (forcesFullMonth(row?.assigned_on, row?.preset_on)) {
    out.payable_days = popup.firstWeekFullMonth({
      month: monthLabel(String(row.preset_on).slice(0, 7), true),
      days: daysInMonthOf(row.preset_on),
      paidOn: formatDate(row.payment_start_on),
    });
  }

  // ===============================
  // * A PASSED END DATE IS A REVIEW, and it WINS the cell
  // ===============================
  // The sheet's appointment plus one year ran out. It ends nothing: the
  // deal is in the Review list until somebody answers it.
  //
  // Only while the setting is OFF. With it on the row already reads Ended,
  // its start cell is red and its amount is OUT of the total, so the
  // popup's "still in the total" would be false. The queue holds it either
  // way. See backlog 29: the setting is going.
  if (!useEndDate && endedBeforeMonth(row?.end_on, row?.preset_on)) {
    out.end_on = popup.endDatePassed({
      endOn: formatDate(row.end_on),
      amount: Number(row.payable_amount) > 0
        ? formatMoney(row.payable_amount, row.currency)
        : null,
    });
  }

  /**
   * ===============================
   * * WORDS IN THE END DATE COLUMN, and why the cell is blank
   * ===============================
   * LAST, so it beats everything else claiming this cell. A cell holding a
   * sentence has no date to suggest, check against a formula, or call
   * passed, so any marker above would be answering a question nobody asked.
   *
   * THE DEAL'S OWN NOTE WINS OVER ITS COMPANY'S STATUS, and Workforce is
   * why: it carries 19 "Going concern" deals, 2 "Reviewed monthly" and 2
   * with a real date, all at once. One company status cannot say that, so
   * the more specific source is read first.
   */
  if (row?.end_note) {
    const status = COMPANY_STATUS_LABEL[row.company_status] ?? row.company_status ?? null;
    if (row.end_note === REVIEWED_MONTHLY) {
      out.end_on = popup.reviewedMonthly({
        companyStatus: status,
        answered: row.review_answer ?? null,
      });
    } else if (row.end_note === GOING_CONCERN) {
      out.end_on = popup.goingConcern({ companyStatus: status });
    } else {
      out.end_on = popup.endNoteUnknown({ note: row.end_note });
    }
  }

  return out;
}
