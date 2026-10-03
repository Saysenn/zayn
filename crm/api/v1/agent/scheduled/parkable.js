/**
 * ***************************************************
 * * WHAT MAY BE PARKED, and why the list is this short
 * ***************************************************
 *
 * A parked call is replayed months later with nobody watching, possibly
 * more than once. So the only tools on this list are the ones where
 * applying it twice equals applying it once.
 *
 * THAT PROPERTY IS NOT A PROMISE, IT IS A FACT ABOUT THE WRITE. An absolute
 * field set is idempotent because masterSheetRows.repo.js compares before
 * and after per field and logs nothing when they match — so a second run
 * changes no data AND writes no history. Nothing has to be remembered for
 * that to hold.
 *
 * `stop_deal` is on the list ONLY through `stopIfLive`. The plain repo
 * `stop()` is an unconditional UPDATE of `stopped_on`, so replaying it
 * MOVES a stop date — and a stop date decides whether a month was paid.
 * That is the one way this feature could rewrite money that was already
 * settled.
 *
 * AN ALLOW LIST, like autoConfirm's and for the same reason: a tool added
 * next month is unparkable until somebody puts it here on purpose. The
 * failure of forgetting has to be "she says she cannot park that".
 */

// Tool name -> how to read its arguments.
//   idField  which argument names the single row it writes
//   setOnly  every other argument is an absolute value to set
const PARKABLE = Object.freeze({
  update_master_sheet_row: { idField: 'id', setOnly: true, noun: 'deal' },
  update_person: { idField: 'person', setOnly: true, noun: 'person' },
  stop_deal: { idField: 'deal', setOnly: false, noun: 'deal', terminal: true },
});

/**
 * ===============================
 * * A RELATIVE ARGUMENT IS THE COMPOUNDING BUG
 * ===============================
 * "Add 5% for the next 3 months" is three rows. If each row said "+5" the
 * three would compound to +15.76% on a live wage, three months after
 * anybody could object. Each row must carry the FINISHED value.
 *
 * Caught on the value rather than on her wording: '+5', '-2', '5%' as a
 * delta and so on. She resolves the arithmetic while the admin is here to
 * see the answer, which is the only moment it can be checked.
 */
const RELATIVE = /^\s*[+-]/;

function isRelative(value) {
  if (typeof value === 'number') return false;
  return typeof value === 'string' && RELATIVE.test(value);
}

// Arguments that are machinery, not values to set.
const NOT_A_VALUE = new Set(['confirmed', 'said', 'turn', 'id', 'person', 'deal']);

/**
 * @returns {{ok: true, spec: object} | {ok: false, why: string}}
 */
function checkParkable(tool, args = {}) {
  const spec = PARKABLE[tool];
  if (!spec) {
    return {
      ok: false,
      why: `${tool} cannot be parked for a later month. Only a change to one deal or one person `
        + 'can be, because those are the ones that replay safely. Say that plainly and offer to '
        + 'do it now instead.',
    };
  }

  if (args[spec.idField] === undefined || args[spec.idField] === null || args[spec.idField] === '') {
    return {
      ok: false,
      why: `A parked change has to name the exact ${spec.noun} now, not a filter to run later. `
        + 'Find it first, then park it.',
    };
  }

  for (const [key, value] of Object.entries(args)) {
    if (NOT_A_VALUE.has(key)) continue;
    if (isRelative(value)) {
      return {
        ok: false,
        why: `"${key}: ${value}" is a change RELATIVE to whatever the value is on the day. `
          + 'Parked for several months that compounds. Work out the final figure now and park '
          + 'that instead.',
      };
    }
  }

  return { ok: true, spec };
}

/** The fields this call would set, for the precondition snapshot. */
function fieldsOf(tool, args = {}) {
  return Object.keys(args).filter((k) => !NOT_A_VALUE.has(k));
}

module.exports = {
  PARKABLE, checkParkable, fieldsOf, isRelative, NOT_A_VALUE,
};
