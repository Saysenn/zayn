const {
  startFromAppointment, endFromAppointment, PAYMENT_START_OFFSET_DAYS, forcesFullMonth,
  isWeekOneAppointment,
} = require('../shared/fromAppointment.helper');
const { payableDaysFor, payableFromDays, isRealDate } = require('../calculator/computePayable');

// ***************************************************
// * The exported master sheet computes itself, the way his does
// ***************************************************

/**
 * HIS SHEET IS LIVE AND OURS WAS DEAD. Four of his columns are formulas, so
 * he types one appointment date and four cells move. Our export wrote the
 * answers as flat numbers: a sheet he can read, not one he can work in.
 * These put the formulas back.
 *
 * ===============================
 * * THE FORMULA IS THE CRM'S RULE, NEVER THE ONE IN HIS FILE
 * ===============================
 * Decided 2026-09-09. His own file is wrong three ways and
 * `calculator/computePayable.js` already corrects all three on import:
 *
 *   1. Rows 74-85 divide by the month the contract ENDS in rather than the
 *      preset month. A copy-paste slip, up to £160 a head across 17 people.
 *   2. Nothing is rounded, so a payable amount carries twelve decimals.
 *   3. A preset of "NA" gives #VALUE! on 12 rows, where his own Payable
 *      amount column pays the full month on every one of them.
 *
 * Writing his version would be WORSE THAN WRITING NONE. The export already
 * puts the correct figure in the cell, so his formula would recalculate on
 * open and silently change 12 rows to a number the CRM says is wrong. A
 * file that contradicts itself the moment you open it is the one outcome
 * worth avoiding.
 *
 * ===============================
 * * EVERY DERIVED CELL, INCLUDING ONES A HUMAN TYPED OVER
 * ===============================
 * His call, 2026-09-09: "we are systemising their wrongdoing, so we stick
 * with formula". A cell overridden in the CRM still leaves as a formula and
 * still recalculates, so the file and the CRM disagree on exactly that one
 * class of cell. THE STORED VALUE IS UNTOUCHED; this is the FILE's answer.
 *
 * The shape of that disagreement, from the INDIGO pair: appointment
 * 2026-05-28 gives a payment start of 2026-08-26, where his own August send
 * paid a whole month from the 1st. 31 days against 6, on monthlies of 1200
 * and 800, is £1,612.90 for the pair. (Not a live row: that cell holds the
 * prose `AUGUST END FULL`, which the CRM already reads as appointment + 90,
 * so the two currently agree there.)
 *
 * The cached result follows the same chain for the same reason, so the file
 * reads identically before and after Excel recalculates it.
 *
 * ===============================
 * * THE THREE INPUT COLUMNS STAY LITERAL
 * ===============================
 * Appointment date and Preset date are what he edits, and a cell holding a
 * formula is a cell he cannot type into. Monthly amount stays literal too:
 * his three formula cells there (`=(7000*1.05)/2`) are notes on single
 * rows, not a column rule, so there is nothing to reproduce.
 *
 * SINGLE-TAB EXPORT ONLY. The month tabs write their totals as flat values
 * in column C, computed by `totalsByCurrency` through `countsTowardTotal`,
 * which reads the colour setting. No Excel formula can reach a settings
 * row, so live deal rows above a static total would drift apart on the
 * first edit. See docs/state.md.
 */

/** The four derived columns, in the order they depend on each other. */
const FORMULA_COLUMNS = ['payment_start_on', 'end_on', 'payable_days', 'payable_amount'];

/**
 * WHICH CELLS EACH FORMULA POINTS AT.
 *
 * The column selector can drop any non-required column, and a formula
 * pointing at a column that is not in the file is `#REF!` in a document
 * about money. A missing dependency leaves that cell the flat value it
 * carries today, which is the safe half of the feature.
 */
const NEEDS = {
  payment_start_on: ['assigned_on'],
  end_on: ['assigned_on'],
  payable_days: ['payment_start_on', 'preset_on'],
  payable_amount: ['monthly_amount', 'preset_on', 'payable_days'],
};

/**
 * `at(key)` yields this row's cell reference for a column, e.g. 'E7'.
 *
 * ISNUMBER GUARDS EVERY ONE. His date columns hold `Ongoing` and his preset
 * column holds `NA`, both text. Unguarded, `=E7+90` on a blank prints 30
 * March 1900 and EOMONTH on text gives #VALUE! — which is exactly the state
 * his own file is in.
 */
const BUILD = {
  payment_start_on: (at, row) => {
    const e = at('assigned_on');
    /**
     * ===============================
     * * A FIRST WEEK START IS THE LAST FRIDAY OF MONTH 3, IN THE FILE TOO
     * ===============================
     * Found 2026-09-18 by building the file and reading it back: this wrote
     * `=E2+90` on every row, so a first week deal carried a CACHED 30
     * October under a formula that says 1 November. Excel recalculates on
     * open, the date flips, and a re-upload then stores the wrong one.
     *
     * The day count survived it (it reads the preset, not this cell), so
     * the money was right and the DATE was wrong, which is the harder kind
     * to notice.
     *
     * Last Friday of the month ending at EOMONTH(E,2): step back from that
     * month end to the nearest Friday. WEEKDAY's default has Friday as 6.
     */
    if (isWeekOneAppointment(asDate(row?.assigned_on))) {
      const end = `EOMONTH(${e},2)`;
      return `IF(NOT(ISNUMBER(${e})),"",${end}-MOD(WEEKDAY(${end})-6,7))`;
    }
    return `IF(NOT(ISNUMBER(${e})),"",${e}+${PAYMENT_START_OFFSET_DAYS})`;
  },

  end_on: (at) => {
    const e = at('assigned_on');
    return `IF(NOT(ISNUMBER(${e})),"",DATE(YEAR(${e})+1,MONTH(${e}),DAY(${e})))`;
  },

  /**
   * His IF chain, measured against the preset MONTH rather than the preset
   * CELL. He wrote `F<=G` and `F>G+DAY(EOMONTH(G,0))-1`, which agree with
   * the month only while every preset is the 1st. Row 4 of his file is the
   * 2nd, so his version differs by a day on that row alone. computePayable
   * has always measured the month; this matches it.
   *
   * A BLANK PAYMENT START IS A FULL MONTH, never zero. The sheet leaves it
   * empty for a standing arrangement with no recorded start.
   */
  payable_days: (at, row) => {
    const f = at('payment_start_on');
    const g = at('preset_on');
    const inMonth = `DAY(EOMONTH(${g},0))`;
    /**
     * ===============================
     * * MONTH 3 OF A FIRST WEEK DEAL IS THE WHOLE MONTH, IN THE FILE TOO
     * ===============================
     * Its payment start holds the last Friday of month 3, so the ordinary
     * chain would recalculate to two days the moment he opens the file and
     * quietly undo the rule. THIS IS HIS OWN MIDDLE BRANCH with the
     * condition dropped, not a formula of ours: `DAY(EOMONTH(G,0))` is
     * what he writes for a full month and it appears four times across his
     * two columns.
     *
     * Still live. Move the preset to a 30 day month and it says 30.
     */
    if (forcesFullMonth(asDate(row?.assigned_on), asDate(row?.preset_on))) {
      return `IF(NOT(ISNUMBER(${g})),"",${inMonth})`;
    }
    const firstOfMonth = `DATE(YEAR(${g}),MONTH(${g}),1)`;
    return `IF(NOT(ISNUMBER(${g})),"",`
      + `IF(NOT(ISNUMBER(${f})),${inMonth},`
      + `IF(${f}>EOMONTH(${g},0),0,`
      + `IF(${f}<=${firstOfMonth},${inMonth},${inMonth}-DAY(${f})+1))))`;
  },

  /**
   * No preset month is no pro-rata period, so the whole monthly amount is
   * owed. Not an assumption: his own sheet sets Payable amount equal to
   * Monthly amount on all twelve of its "NA" rows.
   *
   * THE DENOMINATOR IS ALWAYS THE PRESET MONTH. His rows 74-85 use
   * EOMONTH(H), the end date's month, which is the copy-paste error this
   * corrects. The end date feeds nothing here.
   */
  payable_amount: (at) => {
    const k = at('monthly_amount');
    const g = at('preset_on');
    const i = at('payable_days');
    return `IF(NOT(ISNUMBER(${g})),${k},`
      + `IF(NOT(ISNUMBER(${i})),"",ROUND(${k}/DAY(EOMONTH(${g},0))*${i},2)))`;
  },
};

/** pg hands dates back as Date, an upload as a string, prose as neither. */
function asDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isRealDate(d) ? d : null;
}

/**
 * What each formula works out to, so the cached result agrees with it.
 *
 * THE CHAIN IS FOLLOWED, NOT THE STORED ROW. `payable_days` is measured
 * against the payment start the FORMULA gives, never the one in the column.
 * On an overridden row those differ, and a day count left over from the
 * stored value would no longer match the cell above it: Excel would fix
 * that on open and the file would change under him.
 *
 * @returns {object} column key -> value, `null` where the formula yields ""
 */
function resultsFor(row) {
  const appointment = asDate(row?.assigned_on);
  const preset = asDate(row?.preset_on);
  const start = startFromAppointment(appointment);
  const days = payableDaysFor(start, preset, { appointmentOn: appointment });

  return {
    payment_start_on: start,
    end_on: endFromAppointment(appointment),
    payable_days: days,
    payable_amount: payableFromDays({
      monthlyAmount: row?.monthly_amount,
      presetOn: preset,
      payableDays: days,
    }),
  };
}

/**
 * Turn the four derived cells on one written row into formulas.
 *
 * @param {object} sheetRow  the exceljs row addRow() just returned
 * @param {object} row       the deal, snake_case as the repo returns it
 * @param {function} cellFor (sheetRow, key) => Cell|null, null when the
 *   column selector dropped that column
 * @returns {string[]} the columns actually converted, for the tests
 */
/**
 * @param {boolean} [opts.rawMonthly] the Monthly column holds the STORED
 *   WAGE with no rates in it. Only the working file does that, and only
 *   there does the payable formula answer the wrong question.
 */
function applyFormulas(sheetRow, row, cellFor, { rawMonthly = false } = {}) {
  const at = (key) => cellFor(sheetRow, key)?.address ?? null;
  const results = resultsFor(row);
  const written = [];

  for (const key of FORMULA_COLUMNS) {
    const target = cellFor(sheetRow, key);
    if (!target) continue;
    if (NEEDS[key].some((dep) => at(dep) === null)) continue;
    /**
     * ===============================
     * * A ROW THAT SAYS IT HAS NO END DATE DOES NOT GET ONE COMPUTED
     * ===============================
     * The end date formula is "appointment plus a year", a PROVISIONAL
     * date. "Going concern" and "Reviewed monthly" are his own words for
     * the rows that have no end date at all, so the formula contradicts
     * the very thing the cell is there to say.
     *
     * It was written anyway, on every such row that had an appointment
     * date. His 19 "Going concern" rows came back out of the CRM reading
     * 31 Dec 2025: a date he never wrote, over a word he did, in the
     * column he reads. Found in the browser 2026-09-22.
     *
     * Skipping it leaves the cell blank, which is what the tag then fills.
     */
    if (key === 'end_on' && (row.end_note || row.review_monthly)) continue;
    /**
     * ===============================
     * * AND A RATED ROW KEEPS ITS FIGURE INSTEAD OF A FORMULA OFF THE WAGE
     * ===============================
     * Payable is "Monthly over the days in the month, times the days
     * payable". On the working file the Monthly column is the STORED WAGE
     * with no rates in it, deliberately, because that file is uploaded back
     * and a rated wage returns as a raise. So on a rated row the formula
     * answers the wage question, not the money question: the Maid printed
     * 4,700 where his own sheet says 4,935.
     *
     * `rate_parts` is on the row exactly when a rate applied, put there by
     * shared/rates.helper. Skipping the formula leaves the flat rated value
     * already written, which is the figure he is owed. The upload ignores
     * this column and recomputes it, so nothing is lost on the way back.
     *
     * BOTH CONDITIONS, and `rawMonthly` is why. Every other document rates
     * the Monthly column too, so there the formula reads a rated wage and
     * lands on the same penny: skipping it on those would take the live
     * formula off the month tab for nothing.
     *
     * Rows with no rate keep the live formula, which is what that tab is
     * for.
     */
    if (key === 'payable_amount' && rawMonthly && row.rate_parts) continue;

    const result = results[key];
    target.value = {
      // The ROW travels, because one column's formula depends on the deal
      // rather than only on the cells around it: see payable_days.
      formula: BUILD[key](at, row),
      // '' rather than null. exceljs writes a null cached result as an
      // empty value Excel reads as 0, and 0 in a payable column is a
      // figure where the formula means blank.
      result: result === null || result === undefined ? '' : result,
    };
    written.push(key);
  }

  return written;
}

module.exports = {
  applyFormulas, resultsFor, FORMULA_COLUMNS, NEEDS, BUILD,
};
