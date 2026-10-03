// ***************************************************
// * What the Special Case switch is called
// ***************************************************
//
// A DELIBERATE MIRROR of `api/v1/shared/specialCase.js`, which is where
// Diane reads the same words from. The two codebases share no file, so
// this is the contract written twice: each side pins its own half.
//
// It matters that they agree. Diane's tool description names the switch so
// that "make Mayah a special case" reaches `specialCaseDeal` and not
// `overrideShouldBePaid`, which carries no month and drops the row out of
// a payout instead. If this label drifts from hers, the admin says what
// the screen calls it and she reaches for the wrong field.
//
// The column was `pay_this_month` until migration 065 and the switch read
// "Pay this deal for September 2026". Both are gone.

// THE MONTH IS NOT IN IT. The panel this hangs in already says which month
// is owed nothing, and repeating it made the switch the longest line there.
export const SPECIAL_CASE_SWITCH = 'Make this deal Special Case';
