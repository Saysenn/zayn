// ***************************************************
// * Run the suite as though it were a different month
// ***************************************************
//
// THE SUITE MUST NOT CARE WHAT MONTH IT IS. On 1 September thirteen tests
// failed and nothing had changed: their fixtures were pinned to August and
// `countsTowardTotal` falls back to the month we are in now.
//
// Fixing the fixtures is not the same as proving it cannot happen again, so
// this shifts the clock before any test loads:
//
//   SHIFT_MONTHS=12 npx node --test --require v1/testing/shiftClock.cjs "v1/**/*.test.js"
//
// `npm run test:drift` runs it at +1, +5, +12, +25 and +60 months. Anything
// that still depends on today fails there, on purpose, rather than on the
// first of some month when nobody has touched the code.
//
// TESTING ONLY. Nothing in v1/ may require this.

const N = Number(process.env.SHIFT_MONTHS || 0);
const Real = Date;
const now = new Real();

// Mid month at midday: far from both edges, so a shifted run is never
// accidentally testing a month boundary or a zone rollover as well.
const to = Real.UTC(now.getUTCFullYear(), now.getUTCMonth() + N, 15, 12, 0, 0);
const delta = to - now.getTime();

class Shifted extends Real {
  constructor(...args) {
    if (args.length === 0) super(Real.now() + delta);
    else super(...args);
  }

  static now() { return Real.now() + delta; }
}

global.Date = Shifted;
