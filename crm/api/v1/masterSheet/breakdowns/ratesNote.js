// ***************************************************
// * "Rates already included above": transparency, never arithmetic
// ***************************************************

const { adjustmentLabel } = require('../../shared/rates.helper');

/**
 * ===============================
 * * IT EXPLAINS THE FIGURES. IT DOES NOT REACH THEM.
 * ===============================
 * The add on, the crypto charge and the fee are inside the Monthly amount
 * now, the way his own sheet writes them, so the rows and the totals agree
 * with nothing in between. This block says WHY a row is higher than the
 * agreed wage: "Gloria is 235 up this month, and here is the 5%."
 *
 * THREE RULES, and each one exists so it cannot be mistaken for a sum:
 *
 *   BELOW THE GRAND TOTAL   above it, a reader meets it on the way to the
 *                           total and adds it. Below, the total is settled
 *                           before the explanation starts.
 *   NO SUBTOTAL             a total under a list of numbers is a promise
 *                           that they add to something.
 *   THE HEADING SAYS SO     "Add ons" alone reads as a line item.
 *                           "Rates already included above" states the
 *                           relationship in the only place a reader looks.
 *
 * Off by default, `?percentagesTable=true`. It used to be a design of its
 * own; see breakdowns/index ALIASES for the id that still resolves here.
 */
const HEADING = 'Rates already included above';

// One block per kind, in the order they are applied: added, added, taken
// off. Fees print negative for the same reason they always did.
const KINDS = [
  { kind: 'addon', label: 'Add ons' },
  { kind: 'crypto', label: 'Crypto charges' },
  { kind: 'fee', label: 'Fees' },
];

/** Every named adjustment on the breakdown, flattened, kind by kind. */
function adjustmentsOf(breakdown) {
  const found = [];
  for (const m of breakdown.methods ?? []) {
    for (const loc of m.locations ?? []) {
      for (const line of loc.lines ?? []) {
        for (const a of line.adjustments ?? []) found.push(a);
      }
    }
  }
  return found;
}

/**
 * @param {object} ctx the band-row primitives, as every design receives them
 * @param {object} breakdown what paymentBreakdown returned
 * @returns {boolean} whether anything was written
 */
function writeRatesNote(ctx, breakdown) {
  const { sheet, addBandRow, stylePlainRow, styleBandRow } = ctx;
  const all = adjustmentsOf(breakdown);
  // NOTHING TO EXPLAIN, NOTHING TO DRAW. A heading over an empty block
  // reads as a section somebody forgot to fill in.
  if (all.length === 0) return false;

  sheet.addRow({});
  styleBandRow(addBandRow(sheet, HEADING), { bold: true, heading: true });

  for (const { kind, label } of KINDS) {
    const rows = all.filter((a) => a.kind === kind);
    if (rows.length === 0) continue;
    stylePlainRow(addBandRow(sheet, label), { bold: true });
    for (const a of rows) {
      const value = a.kind === 'fee' ? -a.value : a.value;
      stylePlainRow(addBandRow(sheet, adjustmentLabel(a), value), { indent: 1 });
    }
  }
  return true;
}

module.exports = { writeRatesNote, HEADING };
