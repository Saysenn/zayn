const ExcelJS = require('exceljs');
const { parseAdjustmentLabel } = require('../shared/rates.helper');
const { personIdOf } = require('./identity');

/**
 * ***************************************************
 * * WHICH RATES DOES THIS FILE SAY ARE ALREADY INSIDE ITS FIGURES?
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-22. Every upload had its rates taken back off on
 * the way in, on the reasoning that a figure arriving for somebody we hold
 * a rate for must already contain it. That is true of OUR OWN export and
 * false of HIS OWN sheet, and the importer could not tell them apart.
 *
 * So his September sheet, which writes Zayn at 4,000 and the Maid at 4,700,
 * was stored as 3,809.52 and 4,476.19. Read back with the 5% added it came
 * to exactly his own numbers again, which is why it looked right: the
 * round trip was clean and the WAGE underneath it was 5% light. He asked
 * for "8,000 for Zayn plus 5%" and the CRM was holding 7,619.04.
 *
 * ===============================
 * * THE FILE SAYS SO, OR IT DID NOT HAPPEN
 * ===============================
 * Our export prints an "Add ons" block and a line per person, "Maid: 5%
 * add on", written by `adjustmentLabel`. His sheet has no such block: I
 * checked the September file and it holds no `%`, no "add on", no "fee"
 * and no "crypto charge" in any cell.
 *
 * So the rule is what the file DECLARES, never what the CRM happens to
 * hold today. That is not inferring a rate from a number, which would be
 * guessing at money; it is reading a sentence we wrote ourselves.
 *
 * AND IT IS SELF CORRECTING. The block exists exactly when reversing would
 * matter: an export with no rated people has no lines, and there is
 * nothing in its figures to take off either. Both roads lead to "leave it
 * alone", which is the safe one.
 */

// The export prints the kind once as a column heading and then omits it on
// each line underneath, so a bare "Maid: 5%" takes its meaning from the
// heading above it. Same three words `HEADINGS` uses in workbookSnapshot.
const HEADINGS = new Map([
  ['add ons', 'addon'],
  ['fees', 'fee'],
  ['crypto charges', 'crypto'],
]);

const fold = (value) => String(value ?? '').trim().toLocaleLowerCase('en');

// A line with no kind and no heading above it. It is an add on far more
// often than not, and the export has always printed add ons first, but
// guessing the DIRECTION of a rate is guessing whether somebody is paid
// more or less. So it is dropped, and the figure is left as it came.
const UNKNOWN_KIND = null;

/**
 * Every rate this workbook says it has already applied, by person.
 *
 * @param {Buffer} buffer the uploaded file
 * @returns {Promise<Map<string, {addon:number, crypto:number, fee:number}>>}
 *   keyed by `personIdOf(name)`, the same id the parsed rows carry, so the
 *   two match exactly rather than by a second spelling rule.
 */
async function declaredRatesIn(buffer) {
  const found = new Map();
  if (!buffer) return found;

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    // Unreadable here means unreadable everywhere, and the parser is about
    // to say so properly. An empty map is the safe answer: nothing is
    // declared, so nothing is reversed.
    return found;
  }

  for (const sheet of workbook.worksheets) {
    // Which kind the column is under, carried down the sheet from the
    // heading. Per column, because the blocks sit side by side.
    const blocks = new Map();
    for (let row = 1; row <= sheet.rowCount; row += 1) {
      for (let column = 1; column <= sheet.columnCount; column += 1) {
        const text = String(sheet.getRow(row).getCell(column).text ?? '').trim();
        if (!text) continue;

        const heading = HEADINGS.get(fold(text));
        if (heading) {
          blocks.set(column, heading);
          continue;
        }

        const line = parseAdjustmentLabel(text);
        if (!line || !line.name) continue;

        const kind = line.kind ?? blocks.get(column) ?? UNKNOWN_KIND;
        if (!kind) continue;

        const id = personIdOf(line.name);
        if (!id) continue;
        const held = found.get(id) ?? { addon: 0, crypto: 0, fee: 0 };
        // ADDED, not replaced. One person can carry a person level rate
        // and a deal level one, and the export prints both: they stacked
        // on the way out and they have to stack on the way back.
        held[kind] += line.percent;
        found.set(id, held);
      }
    }
  }

  return found;
}

module.exports = { declaredRatesIn };
