import { formatNumber } from '../../helpers/formatMoney';

/**
 * WHAT EACH BREAKDOWN DESIGN LOOKS LIKE, drawn as the sheet draws it.
 *
 * One fake group, used by every preview, so switching designs changes the
 * LAYOUT and keeps the underlying arithmetic consistent. The plain USD design
 * shows net detail; the explicit tabled design keeps gross detail and names
 * the adjustments that reconcile it.
 *
 * The figures are chosen so the reader can check the design themselves:
 * GBP cash 3,000 splits into 1,000 local (Abu Dhabi) and 2,000 away, and
 * the summary's UK and other add back to the cash total. A preview whose
 * own arithmetic does not tie teaches somebody to distrust the real one.
 *
 * Keyed by the DESIGN ID the api serves, so a design without a preview
 * renders nothing rather than the wrong one.
 */
// The xlsx's own fills, so the preview is the file rather than an
// impression of it. Kept in step with breakdowns/withUsd.js by hand:
// two codebases, no shared import.
// The DEFAULT pair only. The real ones arrive as a prop from the picker,
// because a preview that ignores the colour picked beside it is worse
// than no preview: it teaches you not to trust it.
//
// `head` IS THE DARK STEP and carries white type, matching palette.js. It
// was the pale tint with black type while the file wrote a black band, so
// the preview showed a document the export has never produced.
const DEFAULT_FILLS = { head: '#833C0C', soft: '#FBE3D5', faint: '#FDF5F0' };
// The type that sits on `head`. One value, mirroring the api's HEAD_TEXT.
const HEAD_TEXT = '#FFFFFF';

const RATE = 1.362553;
const AED_PER_USD = 3.6725;
// One formatter, shared with every page. The preview used its own copy.
const usd = (n) => `$${formatNumber(n)}`;
const num = (n, digits = 2) => formatNumber(n, digits);

// The sample group: cash in two places and one transfer, in two
// currencies, which is the shape four of the five live groups have.
const SAMPLE = {
  bankGbp: 2500,
  cashLocalGbp: 1000,
  cashLocalAed: 3675,
  cashAwayGbp: 2000,
  cryptoEur: 1000,
  // THE THIRD RAIL, IN GBP, for the two designs that do not convert.
  //
  // Not `cryptoEur`: `standard` switches to a currency-first layout the
  // moment a group is paid in more than one, so a sample showing method
  // first with a EURO row beside a GBP one would be a document the export
  // never writes. The converting design has its own EURO figure above.
  cryptoGbp: 900,
};

// The sample's bank deal carries the adjustments so the two designs can show
// the same arithmetic with different levels of detail. The plain USD design
// shows its net amount; the tabled design shows the gross amount here and
// names the adjustments in its dedicated blocks below.
const ADJUSTMENT = { label: 'A. Person: 5%', value: 25 };
const CRYPTO = { label: 'B. Person - 1%', value: 10 };
const DEDUCTION = { label: 'C. Person - 10%', value: 100 };
const bankGbpNet = SAMPLE.bankGbp + ADJUSTMENT.value - DEDUCTION.value;
const totalGbpNet = bankGbpNet + SAMPLE.cashLocalGbp + SAMPLE.cashAwayGbp;
const cashGbp = SAMPLE.cashLocalGbp + SAMPLE.cashAwayGbp;
// Stage 1 prints one net figure per location, so its grand total is the
// sum of exactly the lines the sample draws. Computed, never typed: a
// literal here is how a sample starts disagreeing with itself.
const simpleGrand = bankGbpNet + cashGbp + SAMPLE.cryptoGbp;
const bankUsd = bankGbpNet * RATE;
const localUsd = SAMPLE.cashLocalGbp * RATE + SAMPLE.cashLocalAed / AED_PER_USD;
const awayUsd = SAMPLE.cashAwayGbp * RATE;
const cashUsd = localUsd + awayUsd;
const cryptoEurNet = SAMPLE.cryptoEur + CRYPTO.value;
const cryptoUsd = cryptoEurNet / 0.856908;
const totalGbpUsd = totalGbpNet * RATE;

/**
 * FILL IS PER CELL, not per row, because the sheet's is.
 *
 * "UK send in GBP" wears the dark fill on its LABEL and the pale one on
 * its figure, which is what marks it out as the one line in pounds among
 * a column of dollars. A row-level tint cannot say that.
 */
function Row({ label, indent = 0, native, converted, bold, tint, sendValue, fills = DEFAULT_FILLS }) {
  const fill = tint === 'soft' ? fills.soft : tint === 'zebra' ? fills.faint : tint ? fills.head : undefined;
  const valueFill = sendValue ? fills.soft : fill;
  // WHITE COMES WITH THE DARK STEP, the same rule the xlsx follows. A cell
  // on `head` keeping the default type is a black word on a dark ground.
  const color = fill === fills.head ? HEAD_TEXT : undefined;
  const valueColor = valueFill === fills.head ? HEAD_TEXT : undefined;
  const cell = `whitespace-nowrap border border-border px-1.5 py-0.5 ${bold ? 'font-semibold' : ''}`;
  return (
    <tr>
      <td
        className={cell}
        style={{ paddingLeft: `${0.375 + indent * 0.6}rem`, background: fill, color }}
      >
        {label}
      </td>
      <td className={`${cell} text-right tabular-nums`} style={{ background: valueFill, color: valueColor }}>
        {native}
      </td>
      {converted !== undefined && (
        <td className={`${cell} text-right tabular-nums`} style={{ background: valueFill, color: valueColor }}>
          {converted}
        </td>
      )}
    </tr>
  );
}

function Head({ withUsd, fills = DEFAULT_FILLS }) {
  return (
    <thead>
      <tr style={{ background: fills.head, color: HEAD_TEXT }}>
        <th className="border border-border px-1.5 py-0.5 text-left font-semibold">Row Labels</th>
        <th className="border border-border px-1.5 py-0.5 text-right font-semibold">Sum of Payable amount:</th>
        {withUsd && (
          <th className="border border-border px-1.5 py-0.5 text-right font-semibold">Converted to USD</th>
        )}
      </tr>
    </thead>
  );
}

function Table({ children, withUsd, fills }) {
  return (
    <table className="border-collapse text-[10px] leading-tight">
      <Head withUsd={withUsd} fills={fills} />
      <tbody>{children}</tbody>
    </table>
  );
}

/**
 * Today's block: method, then location, then a Grand Total.
 *
 * Shown in its SINGLE-CURRENCY form, which is the one with the location
 * level in it and no currency rows. A group paid in more than one currency
 * gets the currency rows back, and saying so beats drawing a second table
 * nobody asked to compare.
 */
/**
 * STAGE 1. Method, location, one figure, and it adds up.
 *
 * No currency rows and no named add ons: the location figure is already
 * net of them, which is what lets the block be this short without hiding
 * anything. A DELIBERATE MIRROR of api/v1/masterSheet/breakdowns/simple.js.
 */
function SimplePreview({ fills = DEFAULT_FILLS }) {
  return (
    <Table fills={fills}>
      {/* CURRENCY FIRST, then the methods paid in it, then that currency's
          total. Two currencies are two payment runs, so each is its own
          block and there is no grand total to add across them. */}
      {/* The currency total takes the SECONDARY, because simple.js paints
          it with GRAND_FILL. It wore the primary here while the file wore
          the pale ground, which is a shape the export never writes. */}
      <Row fills={fills} label="AED" bold native="" />
      <Row fills={fills} label="Cash" indent={1} native={num(SAMPLE.cashLocalAed)} />
      <Row fills={fills} label="AED Total" bold tint="soft" native={num(SAMPLE.cashLocalAed)} />
      <Row fills={fills} label="GBP" bold native="" />
      <Row fills={fills} label="Bank" indent={1} native={num(bankGbpNet)} />
      <Row fills={fills} label="Cash" indent={1} native={num(cashGbp)} />
      <Row fills={fills} label="Crypto" indent={1} native={num(SAMPLE.cryptoGbp)} />
      <Row fills={fills} label="GBP Total" bold tint="soft" native={num(simpleGrand)} />
    </Table>
  );
}

function StandardPreview({ fills = DEFAULT_FILLS }) {
  return (
    <Table fills={fills}>
      {/* METHOD, LOCATION and a total per method. The location level is the
          point of this stage: stage 1 never says where the cash goes.
          NO CURRENCY ROW: the group is paid in one, so the location carries
          its own figure. Several currencies put the code back, under the
          location and on the totals. */}
      <Row fills={fills} label="Bank" bold native="" />
      <Row fills={fills} label="Main City" indent={1} native={num(bankGbpNet)} />
      <Row fills={fills} label="Bank Total" bold native={num(bankGbpNet)} />
      <Row fills={fills} label="Cash" bold native="" />
      <Row fills={fills} label="Abu Dhabi" indent={1} native={num(SAMPLE.cashLocalGbp)} />
      <Row fills={fills} label="Main City" indent={1} native={num(SAMPLE.cashAwayGbp)} />
      <Row fills={fills} label="Cash Total" bold native={num(cashGbp)} />
      {/* THE THIRD RAIL, reading exactly like the two above it. A sample
          showing only bank and cash says crypto produces nothing. */}
      <Row fills={fills} label="Crypto" bold native="" />
      <Row fills={fills} label="South East" indent={1} native={num(SAMPLE.cryptoGbp)} />
      <Row fills={fills} label="Crypto Total" bold native={num(SAMPLE.cryptoGbp)} />
      <Row fills={fills} label="Grand Total" bold tint native={num(simpleGrand)} />
    </Table>
  );
}

/**
 * One line per block, so the sample shows all three rather than whichever
 * the fake figures happened to produce.
 *
 * INVENTED NAMES, DELIBERATELY. They were Gloria, Abe and Neo, who are real
 * people on the real sheet: a sample naming staff reads as their actual
 * rates. A, B, C are obviously not anybody.
 */
// Negative, as the file prints it: the column adds up down the page.

/** Attach 1: both pivots side by side, converted, and the cash split. */
function WithUsdPreview({ fills = DEFAULT_FILLS, adjustmentsInTable = false }) {
  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <Table withUsd fills={fills}>
          <Row fills={fills} label="AED" bold tint="zebra" native="" converted="" />
          <Row fills={fills} label="Cash" indent={2} native={num(SAMPLE.cashLocalAed)} converted={usd(SAMPLE.cashLocalAed / AED_PER_USD)} />
          <Row fills={fills} label="AED Total" bold tint="soft" native={num(SAMPLE.cashLocalAed)} converted={usd(SAMPLE.cashLocalAed / AED_PER_USD)} />
          <Row fills={fills} label="GBP" bold tint="zebra" native="" converted="" />
          <Row fills={fills} label="Bank" indent={2} native={num(bankGbpNet)} converted={usd(bankUsd)} />
          <Row fills={fills} label="Cash" indent={2} native={num(cashGbp)} converted={usd(cashGbp * RATE)} />
          <Row fills={fills} label="GBP Total" bold tint="soft" native={num(totalGbpNet)} converted={usd(totalGbpUsd)} />
        </Table>

        <Table withUsd fills={fills}>
          {/* Bank lists its locations plainly: a transfer has no
              notes to carry anywhere, so Away is cash only. */}
          <Row fills={fills} label="Bank" bold tint native="" converted="" />
          <Row fills={fills} label="Main City" indent={1} native="" converted="" />
          <Row fills={fills} label="GBP" indent={3} native={num(adjustmentsInTable ? SAMPLE.bankGbp : bankGbpNet)} converted={usd(adjustmentsInTable ? SAMPLE.bankGbp * RATE : bankUsd)} />
          <Row fills={fills} label="Cash" bold tint native="" converted="" />
          {/* Local needs no heading: it is the default. Away is the one
              exception worth naming, and it prints even when empty. */}
          <Row fills={fills} label="Abu Dhabi" indent={1} native="" converted="" />
          <Row fills={fills} label="AED" indent={3} native={num(SAMPLE.cashLocalAed)} converted={usd(SAMPLE.cashLocalAed / AED_PER_USD)} />
          <Row fills={fills} label="GBP" indent={3} native={num(SAMPLE.cashLocalGbp)} converted={usd(SAMPLE.cashLocalGbp * RATE)} />
          {/* The plain Converted to USD design folds add ons and fees into
              the totals. The tabled variant below is the explicit option
              for naming each adjustment. */}
          <Row fills={fills} label="Away" bold indent={1} tint="soft" native="" converted="" />
          <Row fills={fills} label="Main City" indent={2} native="" converted="" />
          <Row fills={fills} label="GBP" indent={4} native={num(SAMPLE.cashAwayGbp)} converted={usd(awayUsd)} />
        </Table>
      </div>

      {/* THREE BLOCKS, NOT ONE, with the gaps the sheet has. They were
          merged into a single four-row table, which read as one thing:
          the per-method USD totals, the rates and the answer block are
          three separate statements and the blank rows between them are
          how the sheet says so. */}
      <div className="mt-3 flex flex-wrap items-start gap-6">
        <div>
          <table className="border-collapse text-[10px] leading-tight">
            <tbody>
              {/* An empty tinted cell beside the word USD: the block's
                  header, and the only thing saying these figures are not
                  in their native currency. */}
              <tr>
                <td className="w-28 border border-border px-1.5 py-0.5" style={{ background: fills.head }} />
                <td className="border border-border px-1.5 py-0.5 font-semibold" style={{ background: fills.head, color: HEAD_TEXT }}>USD</td>
              </tr>
              <Row fills={fills} label="Bank" bold tint="soft" native={usd(bankUsd)} />
              <Row fills={fills} label="Cash" bold tint="soft" native={usd(cashUsd)} />
              {/* The crypto charge is already folded into this net method
                  total. The explicit tabled design names it in its own block
                  on the right; the plain design keeps it out of the detail. */}
              <Row fills={fills} label="Crypto" bold tint="soft" native={usd(cryptoUsd)} />
            </tbody>
          </table>

          <table className="mt-4 border-collapse text-[10px] leading-tight">
            <tbody>
              <Row fills={fills} label="Rate" bold tint="zebra" native={num(RATE, 6)} />
              <Row fills={fills} label="" tint="zebra" native={num(AED_PER_USD, 6)} />
            </tbody>
          </table>
        </div>

        <table className="border-collapse text-[10px] leading-tight">
          <tbody>
            {/* OUT of the pivot, named once, above the totals that hold it. */}
            {/* `tint` alone is the PRIMARY, the weight every other block
                heading here uses. On soft these read as uncoloured. */}
            {adjustmentsInTable && (
              <>
                <Row fills={fills} label="Add ons" bold tint native="" />
                <Row fills={fills} label={ADJUSTMENT.label} tint="zebra" native={num(ADJUSTMENT.value)} />
                {/* Its own block: an add on is what a PERSON costs, a
                    crypto charge is what the RAIL costs. Both add. */}
                <Row fills={fills} label="Crypto charges" bold tint native="" />
                <Row fills={fills} label={CRYPTO.label} tint="zebra" native={num(CRYPTO.value)} />
                <Row fills={fills} label="Fees" bold tint native="" />
                <Row fills={fills} label={DEDUCTION.label} tint="zebra" native={num(-DEDUCTION.value)} />
                <tr><td className="py-1" colSpan={2} /></tr>
              </>
            )}
            <Row fills={fills} label="Total bank" bold tint native={usd(bankUsd)} />
            <Row fills={fills} label="Total Cash" bold tint native={usd(cashUsd)} />
            {/* THE THIRD RAIL. The block above already prints "Crypto" and
                the answer block named only bank and cash, so the one place
                somebody reads before paying was short by a whole method.
                ABOVE the split on purpose: "Of which UK" and "Of which
                Other" divide the CASH total and must still sum back to it.

                This file is a hand-maintained MIRROR of `withUsd.js`. It
                went out of step the moment that row was added there, which
                is exactly the drift a mirror invites. */}
            <Row fills={fills} label="Total Crypto" bold tint native={usd(cryptoUsd)} />
            <Row fills={fills} label="Of which UK" tint="soft" native={usd(awayUsd)} />
            <Row fills={fills} label="Of which Other" tint="soft" native={usd(localUsd)} />
            {/* A blank row before the last one, as the sheet has: it is
                the only figure in pounds, and running it straight on from
                the dollar lines reads as another of them. */}
            <tr><td className="py-1" colSpan={2} /></tr>
            <Row fills={fills} label="UK send in GBP" bold tint sendValue native={`£${num(SAMPLE.cashAwayGbp)}`} />
          </tbody>
        </table>
      </div>

    </>
  );
}

/**
 * The hexes a sample paints with, from the served palette.
 *
 * ONE definition: the export modal and Diane's card both draw these
 * previews, and two copies of this mapping would drift the first time
 * either was touched. Undefined when the palette has not loaded, which the
 * previews already fall back on rather than rendering colourless.
 */
export function fillsFrom(colors = [], primary, secondary) {
  const chosen = colors.find((c) => c.id === primary);
  const support = colors.find((c) => c.id === secondary) ?? chosen;
  if (!chosen || !support) return undefined;
  // `strong` is the DARK step, the one the file's headers and bands wear,
  // and HEAD_TEXT is the white that goes on it. See palette.js.
  return { head: chosen.strong, soft: support.soft, faint: support.soft };
}

// COMPONENTS, not elements: each is rendered with the colours the picker
// currently holds, so changing a swatch repaints the sample. As elements
// they were built once at import and could never take a prop.
export const BREAKDOWN_PREVIEWS = {
  simple: SimplePreview,
  standard: StandardPreview,
  'with-usd': WithUsdPreview,
  none: null,
};
