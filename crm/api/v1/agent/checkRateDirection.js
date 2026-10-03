// ***************************************************
// * A RATE CHANGE SAID THE WRONG WAY ROUND
// ***************************************************
//
// 2026-09-25. The preview read "fee 0% to 1%" and she said "Suki's add on
// would be reduced by 1%", then "her fee was reduced by 1%". The line was
// right and her sentence moved the wrong rate the wrong way.

// "add on 0% to 5%", "fee 2% to 3%", as every rate line writes it (rateChange.js).
const LINE = /\b(add on|fee)\s+(\d+(?:\.\d+)?)%\s+to\s+(\d+(?:\.\d+)?)%/gi;

// Verbs of direction. "Taken off" is left out: a fee IS money taken off.
const DOWN = /\b(?:reduc\w*|lower\w*|decreas\w*|cut|dropp?\w*)\b/i;
const UP = /\b(?:increas\w*|rais\w*|higher|bump\w*)\b/i;

const LABEL = { 'add on': /\badd[\s-]?ons?\b/i, fee: /\bfees?\b/i };

/** Each rate this turn's tools moved, and which way. */
function movesIn(toolResults = []) {
  const out = new Map();
  for (const r of toolResults) {
    for (const m of String(r?.summary ?? '').matchAll(LINE)) {
      const label = m[1].toLowerCase();
      const from = Number(m[2]);
      const to = Number(m[3]);
      if (from !== to) out.set(label, to > from ? 'up' : 'down');
    }
  }
  return out;
}

/**
 * @returns {{ ok: boolean, wrong: string|null }} the sentence that says a
 *   rate moved the other way, or moved at all when it did not
 */
function checkRateDirection(reply, toolResults = []) {
  const moves = movesIn(toolResults);
  if (moves.size === 0) return { ok: true, wrong: null };
  for (const sentence of String(reply ?? '').split(/(?<=[.!?])\s+/)) {
    const down = DOWN.test(sentence);
    const up = UP.test(sentence);
    if (!down && !up) continue;
    for (const [label, test] of Object.entries(LABEL)) {
      if (!test.test(sentence)) continue;
      const way = moves.get(label);
      // Only one rate named, and it is one that did not move: the wrong rate.
      const other = Object.entries(LABEL).some(([l, t]) => l !== label && t.test(sentence));
      if (!way && !other) return { ok: false, wrong: sentence };
      if ((way === 'up' && down && !up) || (way === 'down' && up && !down)) return { ok: false, wrong: sentence };
    }
  }
  return { ok: true, wrong: null };
}

module.exports = { checkRateDirection };
