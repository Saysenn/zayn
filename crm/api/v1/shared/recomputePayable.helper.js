const { payableDaysFor, payableFromDays } = require('../calculator/computePayable');
const {
  startFromAppointment, endFromAppointment, stillTheFormulasAnswer, asDateString,
} = require('./fromAppointment.helper');

/**
 * Keep `payable_amount` true to its inputs after a hand edit.
 *
 * Before this, the upload computed the figure and an edit did not: change
 * monthly from 1100 to 2000 and the row still said 461.29, so the amount
 * and the arithmetic printed beside it on the export disagreed. The sheet
 * itself has never worked that way — column L is a formula, and it
 * recalculates the moment K or I changes.
 *
 * WHAT TRIGGERS A RECOMPUTE, and what each edit means:
 *
 *   monthly amount   -> the rate changed; days stand, amount follows
 *   payable days     -> set by hand; amount follows
 *   payment start    -> days AND amount are both re-derived from it
 *   preset date      -> the month being paid for changed, so the
 *                       denominator changed; days and amount both follow
 *   FULL             -> the same: it decides whether the start pro-rates at
 *                       all, so turning it on or off moves both figures
 *
 * Editing `payable_amount` itself is left alone on purpose. That is the
 * admin overriding the formula for a deal settled off it, and the override
 * guard already records the claim.
 *
 * ===============================
 * * IT RETURNS WHAT IT DERIVED, AND THE CALLER MUST PASS THAT ON
 * ===============================
 * A derived value is not a human's claim on a column. The repo used to mark
 * every key in the patch as manually overridden, so one edit to the monthly
 * amount froze `payable_amount` against every future upload: the row then
 * kept a figure computed from inputs that had since moved. See `update`'s
 * `derived` option in masterSheetRows.repo.js.
 *
 * @param {object} current the row as stored, before the patch
 * @param {object} fields  the camelCase patch, mutated in place
 * @returns {string[]} the keys this function added, never what the caller sent
 */
const RATE_INPUTS = ['monthlyAmount', 'payableDays'];
// `assignedOn` is here because the appointment date drives the payment
// start, which drives the days, which drives the amount. His sheet has done
// that since it was written; the CRM stored the appointment and let it
// drive nothing, so editing it left four cells on their old values.
//
// `specialCaseDeal` is a DATE input because it answers the same question the
// dates do: how much of this month is owed. Flipping it forces the whole
// month on and re-derives from the start date off, so the switch is enough
// on its own and nobody has to type 30 beside it. Migration 064.
const DATE_INPUTS = ['paymentStartOn', 'presetOn', 'assignedOn', 'specialCaseDeal'];

function toDate(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ===============================
 * * THE APPOINTMENT CASCADE, AND ITS OWN GUARD
 * ===============================
 * Moving the appointment re-derives the payment start and the end date,
 * and the day count and amount then follow through the ordinary path
 * below. `stillTheFormulasAnswer` is what protects a date a human typed:
 * NOT `manually_overridden_fields`, because this function WRITES those two
 * columns, so they would be claimed by its own output and the second
 * appointment edit would be blocked by the first.
 *
 * Adds each date to `fields` only when it actually derives it, so a cell a
 * human chose is left out of the patch entirely rather than rewritten with
 * the value it already had.
 */
function cascadeFromAppointment(current, fields, derived, given) {
  const oldAppointment = toDate(current.assigned_on);
  const appointmentOn = toDate(fields.assignedOn);
  // Clearing the appointment must not null the two dates it drove. There
  // is nothing to derive from, and the stored dates are still the last
  // thing anybody knew.
  if (!appointmentOn) return;

  const pairs = [
    ['paymentStartOn', 'payment_start_on', 'start', startFromAppointment],
    ['endOn', 'end_on', 'end', endFromAppointment],
  ];
  for (const [key, column, kind, derive] of pairs) {
    // An explicit value in the same patch is the admin setting it directly.
    if (given(key)) continue;
    if (!stillTheFormulasAnswer(current[column], oldAppointment, kind)) continue;
    // A STRING, never a Date: see asDateString. A Date here reaches
    // Postgres as a local-time instant and can land a day out, and Diane
    // reads it with local getters and says the day before.
    fields[key] = asDateString(derive(appointmentOn));
    derived.push(key);
  }
}

/**
 * @param {object} current the row as stored, before the patch. `{}` on create
 * @param {object} fields  the camelCase patch, mutated in place
 * @param {object} [opts]
 * @param {boolean} [opts.onCreate] read `null` as "not given" rather than as
 *   a deliberate blank. The POST route builds a FULL field set, so every key
 *   is present and every unfilled one is null; without this the Add deal
 *   form derived nothing at all and a new row landed with four empty cells
 *   where the same data typed on the page fills them.
 */
function recomputePayable(current, fields, { onCreate = false } = {}) {
  const derived = [];
  // ON CREATE, ABSENT AND BLANK ARE THE SAME THING. On an edit they are
  // not: `null` there is the admin deliberately clearing a cell.
  const given = (key) => (onCreate ? fields[key] != null : fields[key] !== undefined);

  if (given('assignedOn')) cascadeFromAppointment(current, fields, derived, given);

  const touchedRate = RATE_INPUTS.some(given);
  const touchedDate = DATE_INPUTS.some(given);
  if (!touchedRate && !touchedDate) return derived;

  // An explicit amount in the same patch wins — that is the admin saying
  // "this figure, not the formula's".
  if (given('payableAmount')) return derived;

  // The row as it will be once this patch lands.
  const monthlyAmount = fields.monthlyAmount ?? current.monthly_amount;
  const presetOn = toDate(fields.presetOn ?? current.preset_on);
  const paymentStartOn = toDate(fields.paymentStartOn ?? current.payment_start_on);

  // A DATE moved, so the day count is no longer whatever was stored: it is
  // a function of the start against the preset month. Recompute it first,
  // then the amount from it.
  //
  // A RATE edit leaves the days alone, including a day count the admin set
  // by hand — recomputing those from the dates would silently undo it.
  let payableDays = fields.payableDays ?? current.payable_days;
  if (touchedDate && !given('payableDays')) {
    // The appointment as it will be after this patch, since moving it is
    // what can make a deal first week in the first place.
    const appointmentOn = toDate(fields.assignedOn ?? current.assigned_on);
    // The row as it will be, same rule as the three dates above it.
    const specialCaseDeal = Boolean(fields.specialCaseDeal ?? current.special_case_deal);
    const next = payableDaysFor(paymentStartOn, presetOn, { appointmentOn, specialCaseDeal });
    // COULD NOT BE WORKED OUT IS NOT A VALUE, and both columns are NOT
    // NULL. A row with no preset derives null here, and patching it threw
    // on the constraint and lost the whole edit: setting FB's appointment
    // failed with "null value in payable_days violates not-null". The
    // stored count stands instead, which is the last thing anybody knew.
    if (next != null) {
      payableDays = next;
      fields.payableDays = next;
      derived.push('payableDays');
    }
  }

  const nextAmount = payableFromDays({ monthlyAmount, presetOn, payableDays });
  if (nextAmount != null) {
    fields.payableAmount = nextAmount;
    derived.push('payableAmount');
  }
  return derived;
}

module.exports = { recomputePayable, RATE_INPUTS, DATE_INPUTS };
