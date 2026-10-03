// ***************************************************
// * A number field that cannot go negative
// ***************************************************
//
// ON THE KEY so the character never lands, and on the CHANGE so a paste
// cannot get past it. A negative rate flips the sign of every figure it
// converts, and a negative amount is not a spend.
//
// `step: 'any'`, NEVER a tiny step. `step="0.00000001"` on an 8dp rate
// makes the browser's spinner count in hundred millionths and render the
// value as `4e-8`, which is unreadable and is not what anybody typed.

export const NUMBER_INPUT = {
  type: 'number',
  min: 0,
  step: 'any',
  inputMode: 'decimal',
  onKeyDown: (event) => {
    if (event.key === '-' || event.key === 'Subtract') event.preventDefault();
  },
};

/** Money counts in pence, so its spinner should too. */
export const MONEY_INPUT = { ...NUMBER_INPUT, step: '0.01' };

export const nonNegative = (next) => next === '' || Number(next) >= 0;
