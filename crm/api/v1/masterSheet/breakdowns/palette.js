/**
 * THE FIVE COLOURS A BREAKDOWN MAY BE PRINTED IN.
 *
 * Five, not a colour wheel. A picker that can produce any hex can produce
 * white text on yellow, or a total nobody can read, on a document people
 * are paid from. These five are chosen so that EVERY combination works.
 *
 * They are Excel's own accent tints (roughly the 40% and 80% steps of its
 * standard theme), which matters for two reasons nobody thinks about until
 * a file is printed: they are what a spreadsheet already looks like, so a
 * generated file does not announce itself as generated, and they are safe
 * on a monochrome printer, where a saturated fill turns into a grey block
 * with the figures lost inside it.
 *
 * EACH COLOUR IS A PAIR, and the pair is the whole trick. `strong` is a
 * heading or a band; `soft` is a total or a supporting line; `faint` is the
 * grouping rows. Because the admin picks a NAMED colour rather than two
 * arbitrary values, primary and secondary can never combine into something
 * unreadable: whatever they pick, the secondary is still a pale tint with
 * black text and the primary is still dark enough for white.
 *
 * `edge` is the gridline, a mid tone of the same hue, so a block reads as
 * one object rather than a table with a coloured row.
 *
 * ===============================
 * * `strong` IS DARK, AND WHITE TYPE SITS ON IT
 * ===============================
 * It was a PALE tint (`FFF4AF82`) carrying black type, which left no shade
 * in the palette a header band could use. So the bands were a hardcoded
 * BLACK: a sheet picked in green printed a black bar over green headers,
 * and the picker promised a colour the file did not keep.
 *
 * `strong` is now Excel's own darker 50% step of the same accent, and every
 * header and band takes it with white bold type. The document is then the
 * picked colour in three weights with nothing outside the pair.
 */
const PALETTE = [
  /**
   * ===============================
   * * MAROON, AND IT REPLACED ORANGE. His call 2026-09-23.
   * ===============================
   * First in the list, dark ground, white type. A saved link naming the
   * old `orange` resolves to the default rather than erroring, which is
   * `colorFor`'s own fallback and not a special case for this swap.
   */
  {
    id: 'maroon',
    label: 'Maroon',
    strong: 'FF800000',
    soft: 'FFF6E3E3',
    faint: 'FFFBF2F2',
    edge: 'FFD9A8A8',
  },
  {
    id: 'blue',
    label: 'Blue',
    strong: 'FF1F4E79',
    soft: 'FFDEEBF7',
    faint: 'FFF2F7FC',
    edge: 'FFA9C4DE',
  },
  {
    id: 'green',
    label: 'Green',
    strong: 'FF375623',
    soft: 'FFE2EFDA',
    faint: 'FFF3F8F0',
    edge: 'FFAFC9A0',
  },
  /**
   * LIGHT, his call 2026-09-23, once he had seen `blue-white`. Excel's
   * Gold Accent 4 Lighter 80%, the same step of the same theme that made
   * #DDEBF7, so the two sit beside each other as one family rather than as
   * two people's ideas of pale.
   *
   * IT REPLACED THE DARK GOLD rather than joining it. Six colours is the
   * whole palette and a seventh would be a row of swatches nobody scans;
   * three dark and three light is a choice somebody can actually make.
   */
  {
    id: 'gold',
    label: 'Gold',
    strong: 'FFFFF2CC',
    soft: 'FFFFF9E6',
    faint: 'FFFFFDF5',
    edge: 'FFFFD966',
    headText: 'FF000000',
  },
  /**
   * ===============================
   * * THE LIGHT ONE, AND THE ONLY HEADER THAT CARRIES BLACK TYPE
   * ===============================
   * Sampled from his own screenshot 2026-09-23, pixel for pixel: the
   * header band is #DDEBF7 with BLACK bold type and the body is white.
   * That is Excel's Blue, Accent 1, Lighter 80%, which is what a finance
   * table looks like by default in every office in the world, and it is
   * the "light, professional, corporate" he asked for.
   *
   * IT BROKE THE PALETTE'S ONE ASSUMPTION, that `strong` is dark and the
   * header takes white type. So `headText` moved from a single constant
   * to a per colour value: a light band with white type is invisible, and
   * this is the first colour to need the other answer.
   *
   * IT WAS A GRADIENT FIRST, and it printed as a WHITE band. exceljs
   * writes a gradientFill Excel accepts and does not paint here, so the
   * one visible thing the colour was for did not happen. A gradient is not
   * worth a header that might not render; a flat tint always does.
   */
  {
    id: 'blue-white',
    label: 'Blue white',
    // The band, and it is the SOFT weight by design. Named `strong`
    // because that is the slot the header reads, not because it is dark.
    strong: 'FFDDEBF7',
    soft: 'FFF2F8FD',
    faint: 'FFFAFCFE',
    // A visible rule between cells, as in his screenshot. The other
    // colours' edges are a mid tone of a dark band; this one is a mid tone
    // against white.
    edge: 'FF9DC3E6',
    // BLACK, BOLD, ON A PALE GROUND. The palette's default is white.
    headText: 'FF000000',
  },
  {
    id: 'grey',
    label: 'Grey',
    // LIGHT TOO, same call. White Background 1 Darker 15%, which is the
    // grey a spreadsheet header is by default.
    //
    // `soft`, `faint` and `edge` ARE UNTOUCHED, and that is deliberate
    // rather than laziness: grey is DEFAULT_SECONDARY, so those three are
    // what almost every export's totals and grouping rows are painted
    // with. Only `strong` and the type on it change, and those are read
    // only when grey is the PRIMARY. Nobody's existing file moves.
    strong: 'FFD9D9D9',
    soft: 'FFF2F2F2',
    faint: 'FFF9F9F9',
    edge: 'FFBFBFBF',
    headText: 'FF000000',
  },
];

const BY_ID = new Map(PALETTE.map((c) => [c.id, c]));

// THE DEFAULT type on `strong`, for the colours whose band is dark. A
// colour may override it with its own `headText`, and exactly one does:
// a light band needs black or there is nothing to read. Still one decision
// per colour rather than per call site, which is what stopped a header
// taking the dark fill and keeping black type in four places at once.
const HEAD_TEXT = 'FFFFFFFF';

/**
 * ===============================
 * * THE LIGHT ONE, HIS CALL 2026-09-23
 * ===============================
 * It was ORANGE, because his own sheet is orange and an export nobody
 * touches then looks like the document it replaces. He has seen both and
 * picked this: #DDEBF7 with black type, sampled from a table he sent.
 *
 * ONE DEFINITION. The modal used to type 'orange' as well, so this value
 * and the one the picker opened on were two facts that could disagree.
 * It is served with the palette now and the browser reads it, the same
 * arrangement the breakdown design already uses.
 */
const DEFAULT_PRIMARY = 'blue-white';
// Grey by default: a secondary in a SECOND hue is decoration, and two
// competing colours is exactly the "learn a key" problem the three-weight
// rule exists to avoid. Grey supports the primary instead of arguing with
// it. Anyone who wants two colours can still pick two.
const DEFAULT_SECONDARY = 'grey';

/** Metadata for the picker. Hex included: the preview has to draw them. */
function listPaletteColors() {
  return PALETTE.map(({ id, label, strong, soft, headText }) => ({
    id,
    label,
    // The type that will sit on the band, so the swatch can draw a pale
    // colour as what it is rather than as an empty disc.
    headText: `#${(headText ?? HEAD_TEXT).slice(2)}`,
    // Stripped of the alpha byte, because the browser wants #RRGGBB and
    // converting in the component would be the same mapping written twice.
    strong: `#${strong.slice(2)}`,
    soft: `#${soft.slice(2)}`,
  }));
}

function colorFor(id, fallbackId) {
  return BY_ID.get(id) ?? BY_ID.get(fallbackId) ?? PALETTE[0];
}

/**
 * The fills a design actually writes, from a chosen pair.
 *
 * PRIMARY OWNS THE HEADINGS, SECONDARY OWNS THE TOTALS, and the faint band
 * comes from the secondary too so the two supporting weights stay in one
 * family. Resolved here rather than in the design, so every design that
 * ever takes a colour takes the same one.
 */
function fillsFor(primaryId, secondaryId) {
  const primary = colorFor(primaryId, DEFAULT_PRIMARY);
  const secondary = colorFor(secondaryId, DEFAULT_SECONDARY);
  const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  return {
    head: solid(primary.strong),
    // THE TYPE COMES WITH THE BAND, always. The two are one decision, and
    // they travel together so no call site can pair a fill with the wrong
    // colour of text.
    headText: { argb: primary.headText ?? HEAD_TEXT },
    // The rule between header cells, from the colour's own edge.
    headBorder: { style: 'thin', color: { argb: primary.edge } },
    soft: solid(secondary.soft),
    faint: solid(secondary.faint),
    // ===============================
    // * THE MARK ON A CELL, from the SECONDARY. His call 2026-09-23.
    // ===============================
    // Every "this cell is out of the figure" tint, on the workbook and on
    // the payout files. It was a typed beige in two places, so a document
    // picked in maroon still marked its amounts in the old colour. The
    // fixed signals are NOT here: the payment start three, the gap tint
    // and the tag yellow say a thing rather than style it.
    tint: solid(secondary.soft),
    edge: { style: 'thin', color: { argb: primary.edge } },
    // The block somebody signs: the secondary's pale ground inside the
    // primary's own line. Both were hardcoded green, so a sheet picked in
    // orange still printed a green Grand Total.
    grandFill: solid(secondary.soft),
    grandBorder: { style: 'thin', color: { argb: primary.strong } },
  };
}

module.exports = {
  listPaletteColors, fillsFor, DEFAULT_PRIMARY, DEFAULT_SECONDARY,
};
