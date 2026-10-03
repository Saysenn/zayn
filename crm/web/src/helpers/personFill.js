// ***************************************************
// * Which of a donor deal's details would fill THIS form
// ***************************************************
//
// His call 2026-09-23. A handler's phone, address and bank details are
// facts about the PERSON, so a deal can fill its blanks from one they
// already hold.
//
// IN A HELPER, NOT IN THE COMPONENT. It was a function inside
// CopyPersonDetails.jsx, and its test could not import a .jsx module, so
// the test restated the rule instead: breaking the component left the
// test green on both of the two things it claimed to pin. Pure logic goes
// where a test can reach it.

/**
 * A SENTINEL IS A VALUE, NOT A GAP.
 *
 * `Will never be bank` and `Handled internally` are the sheet's way of
 * saying the fact is not held, which is an answer. So this asks only
 * whether anything is there at all, and a sentinel is copied into an empty
 * cell and never overwritten in a filled one.
 */
export const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * The donor's fields that would actually fill a blank on this form.
 *
 * BLANKS ONLY. Nothing already typed is touched, so accepting an offer is
 * never something to undo. An offer that could overwrite would have to be
 * read before it was accepted, and then it saves nobody anything.
 *
 * WHICH COLUMNS COUNT IS THE SERVER'S, `PERSON_FILL_COLUMNS`. This offers
 * back whatever it was handed rather than keeping a second list, which
 * would be a second answer to "what is a person fact".
 *
 * @param {object|null} candidate `{ fields: { camelCaseKey: value } }`
 * @param {object} form the form as it stands
 * @returns {object} the subset to merge, empty when there is nothing to do
 */
export function fillableFrom(candidate, form) {
  if (!candidate?.fields) return {};
  return Object.fromEntries(
    Object.entries(candidate.fields)
      .filter(([key, value]) => !isBlank(value) && isBlank(form?.[key])),
  );
}
