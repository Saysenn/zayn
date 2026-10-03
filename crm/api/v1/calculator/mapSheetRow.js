/**
 * Maps a row scanned from the boss's real master sheet into the shape
 * buildBreakdowns.js needs. Column names confirmed against the actual
 * reference files in docs/boss/ (MASTER SHEET.xlsx — the sheet in current
 * live use — and Master sheet for tech-2.xlsx — the boss's own furthest-
 * along draft of the newer, fuller template). Header matching is
 * normalized (lowercase, strip whitespace/`:_.-`) so trailing-space and
 * punctuation drift between those two doesn't need two separate mappers —
 * same idea whatbot's own parseSheet.js COLUMN_MAP uses.
 */

const { payableDaysFor, payableAmountFor } = require('./computePayable');
const { startFromAppointment, endFromAppointment } = require('../shared/fromAppointment.helper');
const { readPaymentStart } = require('./paymentStartText');
const { readEndNote } = require('../shared/endNote.helper');

function normalizeHeader(h) {
  return String(h ?? '')
    .toLowerCase()
    .replace(/[\s:_.-]+/g, '');
}

// normalized header -> canonical field name
const HEADER_ALIASES = {
  group: 'group',
  role: 'role',
  nameofindividual: 'personName',
  name: 'personName',
  companyinquestion: 'company',
  company: 'company',
  appointmentdate: 'appointmentOn',
  paymentstartdate: 'paymentStartOn',
  presetdate: 'presetOn',
  // The end date column, under every spelling it has been seen or is
  // likely to be typed. It matters more than most: an unrecognised header
  // here used to mean every end date in the CRM was overwritten with
  // nothing, silently, on the next upload.
  enddate: 'endOn',
  provisionalpaymentenddate: 'endOn',
  paymentenddate: 'endOn',
  paymentend: 'endOn',
  provisionalenddate: 'endOn',
  provisionalpaymentend: 'endOn',
  end: 'endOn',
  finalpaymentdate: 'endOn',
  payabledaysthismonth: 'payableDays',
  payabledays: 'payableDays',
  methodofpayment: 'paymentMethodRaw',
  monthlyamount: 'monthlyAmount',
  payableamount: 'payableAmount',
  currency: 'currency',
  location: 'location',
  postcode: 'postcode',
  phonenumber: 'phone',
  phone: 'phone',
  label: 'label',
  // the sheet's own header has a typo ("shoukd") — matched as typed. Also
  // aliasing the correctly-spelled form in case the boss's sheet fixes it.
  shoukdbepaidornot: 'shouldBePaid',
  shouldbepaidornot: 'shouldBePaid',
  paid: 'paid',
  notes: 'notes',
  bankdetailsofindividual: 'bankDetails',
  // Four columns the sheet has always carried and this mapper never read,
  // so they were dropped on every single upload. master.xlsx fills them on
  // 88-91 of its 97 rows, and account number + sort code are how a person
  // actually gets paid. All four stay TEXT downstream — the real values
  // include "Will never be bank", "In person meet" and "20 - 82 - 23".
  doornumber: 'doorNumber',
  acceptingpostals: 'acceptingPostals',
  accountnumber: 'accountNumber',
  sortcode: 'sortCode',
};

// "Bank Transfer" / "Cash" / "Crypto" as the sheet writes them -> the
// lowercase values the rest of the pipeline (and payment_status in
// Postgres) already uses. Anything unrecognized stays null rather than
// guessing "cash" — this feeds real payment breakdowns, a wrong default
// here would misroute a real payment onto the wrong sheet.
function normalizePaymentMethod(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith('bank')) return 'bank';
  if (v.startsWith('crypto')) return 'crypto';
  if (v.startsWith('cash') || v === 'c') return 'cash';
  return null;
}

// the sheet's own Location column carries "Bank Transfer" on director rows
// (the payment-method text leaks one column across) — whatbot's own
// parseSheet.js already strips this; matching that here so a real payment
// doesn't print "Location: Bank Transfer" on an expensing sheet.
const PAYMENT_WORDS = /^(bank transfer|bank|cash|crypto)$/i;

function toNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function toDate(v) {
  if (v instanceof Date) return v;
  return null; // strings like "tbc"/"Ongoing" are deliberately not dates
}

/**
 * Excel handed us a formula's CACHED RESULT and the cache is rubbish.
 *
 * 78 of the 96 payment-start cells and 73 of the end cells in the live file
 * carry a real formula with a cached result of the unix epoch — Excel saved
 * without recalculating. The value is a valid Date object, so nothing
 * upstream rejects it, and it lands in the database as 1969-12-31 and
 * prints on a payout PDF as "ended 31 Dec 1969".
 *
 * Worse than ugly: payableDaysFor sees a start date decades ago, concludes
 * the deal was already running, and awards a FULL MONTH to every one of
 * those rows.
 *
 * Anything before 1990 is this. The business did not exist, and no real
 * appointment, payment or end date on this sheet is near it.
 */
const REAL_DATE_FLOOR = Date.UTC(1990, 0, 1);

function isBrokenCache(d) {
  return d instanceof Date && !Number.isNaN(d.getTime()) && d.getTime() < REAL_DATE_FLOOR;
}

/**
 * The sheet's own two formulas, applied when its cache cannot be trusted.
 *
 * Both are written into the cells themselves and both derive from the
 * APPOINTMENT date, which is a plain stored date and valid on every
 * affected row:
 *
 *   payment start  =E{row}+90                                  appointment + 90 days
 *   end            =DATE(YEAR(E{row})+1,MONTH(E{row}),DAY(E{row}))   appointment + 1 year
 *
 * So this is the boss's rule re-run, not a rule we invented. A BLANK cell
 * is left blank — that is a long-standing arrangement with no recorded
 * start, and it means "full month", which is a different fact from a
 * formula that failed to save.
 */
// The two derivations live in shared/fromAppointment.helper.js now: the
// cascade on an edit needs the same arithmetic this parser does, and a
// second copy of "+90" is how the offset ends up disagreeing with itself.
function repairFromAppointment(value, appointmentOn, kind, { force = false } = {}) {
  if (!force && !isBrokenCache(value)) return value;
  if (force && value) return value;
  // No appointment either: we genuinely cannot know. Null, not a guess —
  // and reviewReasonFor will flag the row for a human.
  if (!(appointmentOn instanceof Date) || Number.isNaN(appointmentOn.getTime())) return null;
  if (isBrokenCache(appointmentOn)) return null;
  return kind === 'start'
    ? startFromAppointment(appointmentOn)
    : endFromAppointment(appointmentOn);
}

// The boss's own files spell the same group differently across them
// ("INDIGO" vs "Indigo") — normalizing to the all-caps form already used
// everywhere else in the system (NEXUS/INDIGO/MILKMAN/MANBAT/TAKEOFF/ALL
// BOOKS) so grouped output doesn't silently split one group into two tabs.
//
/**
 * Group names come from the sheet, uppercased, and are not renamed.
 *
 * There used to be a synonym table here that rewrote "All groups" to
 * "ALL BOOKS". The sheet has never contained "ALL BOOKS" — master.xlsx's
 * six groups are Indigo, Milkman, Nexus, Manbat, Takeoff and All groups —
 * so the CRM was showing a group that exists nowhere in the source, which
 * is worse than showing an awkward one. If a group needs renaming, that
 * is an edit somebody makes and can see, not a rewrite hidden in the
 * importer.
 *
 * Uppercased because a group is matched exactly and "Indigo"/"INDIGO"
 * being two groups is a bug, not a spelling preference.
 */
function normalizeGroupName(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.toUpperCase();
}

/**
 * Collapse whitespace and trim, nothing more.
 *
 * The boss's sheet types the same value several ways: "Relia PA" vs
 * "Relia Pa", "Reliapay back runner " with a trailing space, "Abu Dhabi"
 * vs "Abu dhabi". Those are one value typed twice, not two values, and
 * left alone they fork a filter dropdown into near-duplicate entries.
 *
 * Casing is deliberately NOT forced here — "LEE CROFT" and "Nikisha
 * Bunting Rowe" are how those names are written, and upper/lower-casing
 * everything would make the page look wrong to the person reading it.
 * Case-insensitivity is handled where it matters instead: the company
 * table's unique index is on lower(name) (migration 026).
 */
function tidyText(v) {
  if (typeof v !== 'string') return v ?? null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

// Currency is the one field where casing IS forced: "Euro" and "EURO" are
// the same currency, it's a code rather than a name, and every consumer
// (totals, the xlsx output, Intl.NumberFormat) needs them to match.
function normalizeCurrency(v) {
  const s = tidyText(v);
  return s ? s.toUpperCase() : null;
}

/**
 * The headers on this table that HEADER_ALIASES has no entry for.
 *
 * normalizeRow silently drops anything unmapped, which is correct at the
 * row level and disastrous as the only behaviour: four columns the sheet
 * had always carried (door number, accepting postals, account number, sort
 * code) were thrown away on every upload for months, and nothing said so.
 * Naming them at parse time is what makes the next one a five-minute fix
 * instead of a discovery.
 *
 * Blank headers are not reported. Real sheets carry spacer columns with no
 * label and calling those "unrecognised" would cry wolf on every upload.
 *
 * @returns {string[]} the headers as the sheet spells them, deduped
 */
function unknownHeaders(headers) {
  const seen = new Set();
  const out = [];
  for (const h of headers ?? []) {
    const label = String(h ?? '').trim();
    if (!label) continue;
    const key = normalizeHeader(label);
    if (!key || HEADER_ALIASES[key]) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/**
 * The opposite question: which fields does this sheet actually CARRY?
 *
 * A column the file does not have is not the same fact as a column whose
 * cells are empty, and until this existed the parser could not tell them
 * apart. It filled every field for every row and the upsert wrote all of
 * them, so a sheet missing "Provisional payment end date" set `end_on` to
 * nothing on every row it touched.
 *
 * @returns {Set<string>} canonical field names, e.g. 'endOn', 'personName'
 */
function mappedFields(headers) {
  const fields = new Set();
  for (const h of headers ?? []) {
    const field = HEADER_ALIASES[normalizeHeader(h)];
    if (field) fields.add(field);
  }
  return fields;
}

function normalizeRow(rawRow) {
  const out = {};
  for (const [header, value] of Object.entries(rawRow)) {
    const field = HEADER_ALIASES[normalizeHeader(header)];
    if (field) out[field] = value;
  }
  return out;
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// Only "Director"/"Mid" (with an optional seat number — "Mid 1",
// "Director 2") are tied to a real client company. Everything else
// (Admin, Tech, Closer, Visa, KP, Sales, Support, Holding, Loss lead,
// Graphics, Accounts, Maid...) is the recurring internal/overhead roster,
// almost always under "Workforce" — user's own rule: "staff are those
// other than mid, managers, directors." A blank role isn't a real
// assignment either way, but defaults to staff rather than assumed to be
// a real worker, since "unknown" shouldn't silently join the payable-
// worker camp.
const CLIENT_FACING_ROLES = /^(director|mid)(\s+\d+)?$/i;
function isStaffRole(roleLabel) {
  if (!roleLabel) return true;
  return !CLIENT_FACING_ROLES.test(String(roleLabel).trim());
}

/**
 * Fills a blank Group cell with the last non-blank one seen earlier in the
 * same table — a normal thing for a human filling in the sheet by hand:
 * write the group once, leave it blank for the rest of that block because
 * it's "obviously still the same group." Seen for real in
 * docs/boss/Master sheet for tech-4.xlsx's "All groups" block (11 of its
 * 12 rows have a blank Group cell). Without this, those rows have no group
 * at all and silently fall into an "UNKNOWN" tab instead of their real one.
 *
 * Takes one table's rows at a time (not a whole file) — resets naturally
 * per table, so a group is never carried across an actual table boundary.
 */
function carryForwardGroups(rawRows) {
  const groupKey = rawRows
    .flatMap((row) => Object.keys(row))
    .find((h) => normalizeHeader(h) === 'group');
  if (!groupKey) return rawRows;

  let last = null;
  return rawRows.map((row) => {
    if (!isBlank(row[groupKey])) {
      last = row[groupKey];
      return row;
    }
    return last !== null ? { ...row, [groupKey]: last } : row;
  });
}

/**
 * Returns null for rows that aren't a real person (blank placeholder rows
 * like a group tab started with no data yet). Rows with a name but no
 * usable amount (the sheet's "TBC" placeholders, in-progress deals) still
 * come through, flagged `needsReview`, so they're visible on the Expensing
 * sheet — the boss's own "put the deal into the calculator immediately"
 * rule means an incomplete deal should still show up, not vanish — but are
 * excluded from Cash/Bank since there's nothing payable to act on yet.
 */
/**
 * @param {object} rawRow one row as the sheet gave it
 * @param {object} [fills] canonical field -> value, for what the file does
 *   not say. Applied to the NORMALIZED row, before anything is computed,
 *   so a filled-in preset date or monthly amount recomputes the pro-rata
 *   rather than sitting in a column beside a figure worked out without it.
 *   A value on the row itself is never overwritten.
 */
function mapSheetRow(rawRow, fills) {
  const r = normalizeRow(rawRow);
  // A VALUE THE ADMIN TYPED WINS, INCLUDING OVER THE FILE'S OWN CELL.
  //
  // It used to only fill a BLANK: "the file is the record, a default is for
  // what the file does not say". That reading made the diff unable to
  // correct anything the sheet got wrong — the commonest case being a
  // preset still set to last month on every row, where the fix is one value
  // applied to all of them and the file is exactly what is wrong.
  //
  // Changed on the user's instruction, twice asked. The safety is not in
  // refusing the edit, it is in the diff: a typed value shows as an
  // ordinary per-row change that has to be accepted before anything is
  // written.
  if (fills) {
    for (const [field, value] of Object.entries(fills)) {
      if (!isBlank(value)) r[field] = value;
    }
  }
  const personName = typeof r.personName === 'string' ? r.personName.replace(/\s+/g, ' ').trim() : '';
  if (!personName) return null;

  const monthlyAmount = toNumber(r.monthlyAmount);
  const paymentMethod = normalizePaymentMethod(r.paymentMethodRaw);
  const presetOn = toDate(r.presetOn);

  // Repaired from the appointment date when Excel's cached formula result
  // is the epoch. See repairFromAppointment: the sheet's own formula, re-run
  // — never a guess, and a blank cell stays blank.
  const appointmentOn = toDate(r.appointmentOn);
  /**
   * ===============================
   * * WORDS IN THE END DATE COLUMN, and they are not all the same word
   * ===============================
   * 31 of his 92 September rows hold prose here and every one was dropped
   * in silence. "Going concern" means no end date, which a null already
   * says. "Reviewed monthly" means decided month by month, and a null said
   * the OPPOSITE: the review queue asks whether the end date has passed,
   * so it kept those 12 out of the screen meant to ask about them.
   *
   * The words are kept either way and the cell's tag reads them. The
   * appointment never rescues this cell: unlike the payment start, an end
   * date he replaced with a sentence is a statement, not a broken formula.
   */
  const endNote = readEndNote(r.endOn);
  const endOn = endNote ? null : repairFromAppointment(toDate(r.endOn), appointmentOn, 'end');
  const datesRepaired =
    isBrokenCache(toDate(r.paymentStartOn)) || isBrokenCache(toDate(r.endOn));

  // THE PAYMENT START COLUMN, WHICH IS OFTEN WORDS (paymentStartText.js).
  //
  //   "Ongoing"          no recorded start, which is what a blank means:
  //                      full month, nothing to flag.
  //   anything else      a human note over the top of the column's own
  //                      formula. The formula is the answer, so it is
  //                      re-run: APPOINTMENT + 90 DAYS, exactly what
  //                      `force` makes repairFromAppointment do for a cell
  //                      whose cached result never saved.
  //
  // NOTHING IS READ OUT OF THE WORDS THEMSELVES. "AUGUST END FULL" was once
  // taken to mean a start of 31 August and a standing instruction to pay a
  // whole month; the boss's own August drafts give 2026-08-03 and 29 days
  // for that row, and 2026-11-03 and nothing for the "OCTOBER END FULL"
  // pair. Both are appointment plus 90. See migration 038.
  const startWords = readPaymentStart(r.paymentStartOn);
  const paymentStartOn = startWords === 'ongoing'
    ? null
    : repairFromAppointment(
      toDate(r.paymentStartOn), appointmentOn, 'start', { force: startWords === 'prose' },
    );
  // Only when the words were there AND the appointment could not rescue
  // them. Then the start really is unknown, and a guess would pro-rate
  // somebody's pay against a date nobody wrote.
  const startUnknown = startWords === 'prose' && paymentStartOn === null;

  // ===============================
  // * HIS WORDS ARE KEPT EVEN WHEN THE APPOINTMENT RESCUED THE DATE
  // ===============================
  // This read `startUnknown`, so the note survived only on a row nothing
  // could compute. On all six `END FULL` rows the appointment DID rescue
  // the date, so the words were dropped and the guess went out silently.
  //
  // It is a guess, not a rule: his own August sends resolved the same
  // phrase two ways, MILKMAN at appointment + 90 and INDIGO at the whole
  // month, 1,613 apart on two rows. So the figure stands and the words go
  // with it. See docs/state.md.
  const paymentStartNote = startWords === 'prose' ? tidyText(r.paymentStartOn) : null;

  // Computed, never read off the sheet — see computePayable.js. The
  // sheet's own two columns resolve on only 58 and 67 of 96 real rows,
  // so reading them means a third of the roster silently shows nothing.
  // `appointmentOn` travels because a first week appointment is owed the
  // WHOLE of month 3, whatever its stored start says. See
  // fromAppointment.helper.js.
  const payableDays = payableDaysFor(paymentStartOn, presetOn, { startUnknown, appointmentOn });
  const payableAmount = payableAmountFor({
    monthlyAmount, paymentStartOn, presetOn, startUnknown, appointmentOn,
  });

  // A rescued prose cell counts too: the figure is a reading of his words,
  // and a reading somebody should confirm. parseImport's reviewReasonFor
  // says the same thing in words, for the upload path.
  // A PHRASE NOBODY HAS TAUGHT IT YET is flagged, and only that one. The
  // two he already uses are understood, so flagging them would put 31 of
  // 92 rows on the review list every month and nobody would read it.
  const unknownEndNote = Boolean(endNote && !endNote.known);
  const needsReview = payableAmount === null || paymentMethod === null
    || paymentStartNote !== null || unknownEndNote;

  return {
    group: normalizeGroupName(r.group),
    role: tidyText(r.role),
    staff: isStaffRole(r.role),
    personName,
    company: tidyText(r.company),
    appointmentOn,
    paymentStartOn,
    paymentStartNote,
    // The RULE behind the day count, carried so the month roll can re-derive
    presetOn,
    // Repaired above when the cached formula result was the epoch. Prose
    // is NULL here and kept in `endNote` instead, so nothing downstream
    // has to decide whether a date column is holding a sentence.
    endOn,
    endNote: endNote?.note ?? null,
    reviewMonthly: endNote?.reviewMonthly ?? false,
    // Carried so the upload can say WHICH note it did not understand,
    // rather than only that the row needs a look.
    endNoteKnown: endNote ? endNote.known : null,
    payableDays,
    paymentMethod,
    monthlyAmount,
    payableAmount,
    currency: normalizeCurrency(r.currency),
    location: typeof r.location === 'string' && PAYMENT_WORDS.test(r.location.trim()) ? null : tidyText(r.location),
    postcode: tidyText(r.postcode),
    phone: tidyText(r.phone),
    label: tidyText(r.label),
    shouldBePaid: tidyText(r.shouldBePaid),
    paid: tidyText(r.paid),
    notes: tidyText(r.notes),
    bankDetails: tidyText(r.bankDetails),
    doorNumber: tidyText(r.doorNumber),
    acceptingPostals: tidyText(r.acceptingPostals),
    accountNumber: tidyText(r.accountNumber),
    sortCode: tidyText(r.sortCode),
    needsReview,
  };
}

module.exports = {
  mapSheetRow,
  unknownHeaders,
  mappedFields,
  normalizePaymentMethod,
  normalizeHeader,
  carryForwardGroups,
  isStaffRole,
  tidyText,
  normalizeCurrency,
};
