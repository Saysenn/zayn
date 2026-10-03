// ***************************************************
// * A figure that carries its rates. Take them back off.
// ***************************************************

/**
 * ===============================
 * * ONLY WHEN THE FILE SAYS IT CARRIES THEM
 * ===============================
 * WITHOUT THIS AT ALL, every re-import of OUR OWN export compounds,
 * silently. The export writes Maid's Monthly as 4,935: her 4,700 wage with
 * her 5% already inside it. Import that back and the CRM stores 4,935 as
 * the WAGE, so the next export reads 5,181.75, and the one after 5,440.84.
 * Nothing on screen would say why.
 *
 * WITH IT ON EVERY FILE, his own sheet was shaved instead. He writes Zayn
 * at 4,000 and the Maid at 4,700, raw, and those were stored as 3,809.52
 * and 4,476.19. Read back with the 5% added they came to his own numbers
 * again, so the round trip looked clean while the wage underneath was 5%
 * light. He asked for "8,000 for Zayn plus 5%" and the CRM held 7,619.04.
 * Found 2026-09-22.
 *
 * SO THE FILE DECIDES, per person, and `declaredRates.js` is what reads
 * it: our export prints "Maid: 5% add on" under an "Add ons" heading, and
 * his sheet has no such block anywhere in it.
 *
 * THE DIVISOR IS THE DECLARED RATE, not the CRM's rate today. What was
 * baked into a figure is whatever was true when the file was written, and
 * a rate changed since would otherwise unwind it to the wrong wage. Still
 * not inferred from a number: it is a sentence we wrote ourselves.
 *
 * A PERSON THE FILE DECLARES NOTHING FOR IS NOT TOUCHED. Nothing was added
 * to them, so there is nothing to take off, and dividing anyway is what
 * quietly cut his wages.
 *
 * THE ORDER IS THE ARITHMETIC, REVERSED. `withRates` does
 *   net = (raw + raw*a + raw*c) * (1 - f)
 * so raw = net / ((1 + a + c) * (1 - f)). One expression, because unwinding
 * the three steps separately reintroduces the rounding the multiply removed.
 */
function factorFor({ addon = 0, crypto = 0, fee = 0 }) {
  return (1 + (addon / 100) + (crypto / 100)) * (1 - (fee / 100));
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {object[]} rows parsed rows, camelCase, as the diff and the commit
 *   both see them
 * @param {Map<string, {addon, crypto, fee}>} declared what the FILE says it
 *   has already applied, keyed by person id. From `declaredRatesIn`.
 * @returns {object[]} the same rows with any declared rate taken back off
 */
function reverseRates(rows, declared = null) {
  // NO MAP MEANS NOTHING WAS DECLARED, and therefore nothing is reversed.
  // The default is the safe direction on purpose: a caller that forgets to
  // pass it stores his figures exactly as he wrote them, which is a
  // no-op, rather than shaving 5% off everybody.
  if (!declared || declared.size === 0) return rows ?? [];

  return (rows ?? []).map((r) => {
    const id = r.personId ?? r.person_id;
    const percent = declared.get(id);
    if (!percent) return r;
    if (!(percent.addon > 0 || percent.crypto > 0 || percent.fee > 0)) return r;

    const factor = factorFor(percent);
    // A 100% fee would divide by zero. It cannot be unwound because every
    // wage maps to the same net, so the figure is left exactly as it came.
    if (!(factor > 0)) return r;

    const out = { ...r };
    for (const key of ['monthlyAmount', 'payableAmount']) {
      const value = Number(r[key]);
      if (Number.isFinite(value) && value !== 0) out[key] = round(value / factor);
    }
    return out;
  });
}

module.exports = { reverseRates, factorFor };
