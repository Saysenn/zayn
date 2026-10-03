// ***************************************************
// * What a search box can be pointed at
// ***************************************************
//
// ONLY WHAT NO FILTER REACHES. Group, payment period, preset month and the
// three amounts all have controls in the filter panel, and a second way to
// ask one question is two things to keep in step.
//
// The seven below are free text and near unique per row: a dropdown of
// ninety postcodes is not a filter, it is a list.
//
// Mirrors SEARCH_COLUMNS in api/v1/repos/masterSheetRows.repo.js, which is
// the authority. A key this list has and the repo does not simply searches
// everything, the same way a stale amount column returns the unfiltered
// list rather than a 500.

export const SEARCH_ANY = '';

// SHORT. The placeholder is inside a box that is 16rem wide and it was
// being cut off mid word ("Search description, payee or spent b"), which
// reads as a broken field rather than a hint. The picker beside it already
// says what is being searched.
export const SEARCH_FIELDS = [
  { value: SEARCH_ANY, label: 'Anything', placeholder: 'Search here…' },
  { value: 'location', label: 'Location', placeholder: 'Search location…' },
  { value: 'postcode', label: 'Postcode', placeholder: 'Search postcode…' },
  { value: 'bankDetails', label: 'Bank details', placeholder: 'Search bank details…' },
  { value: 'accountNumber', label: 'Account number', placeholder: 'Search account number…' },
  { value: 'sortCode', label: 'Sort code', placeholder: 'Search sort code…' },
  { value: 'notes', label: 'Notes', placeholder: 'Search notes…' },
  { value: 'doorNumber', label: 'Door number', placeholder: 'Search door number…' },
];

// ===============================
// * EXPENSES
// ===============================
//
// Same rule: only what no filter reaches. Group, currency, archived, the
// date range and the AED amount all have controls in the filter panel.
//
// The two PEOPLE fields are here rather than there on purpose. They are
// free text and near unique per row, and a dropdown of every payee the
// ledger has ever carried is not a filter, it is a list.
//
// Mirrors SEARCH_COLUMNS in api/v1/repos/expenses.repo.js, the authority.

export const EXPENSE_SEARCH_FIELDS = [
  { value: SEARCH_ANY, label: 'Anything', placeholder: 'Search here…' },
  { value: 'description', label: 'Description', placeholder: 'Search description…' },
  { value: 'payee', label: 'Payee', placeholder: 'Search person…' },
  { value: 'spentBy', label: 'Spent by', placeholder: 'Search person…' },
];

// The placeholder follows the picked column. Hardcoded, it kept promising
// "name, company, role or phone" while the box was pointed at postcodes.
export function searchPlaceholder(field, fields = SEARCH_FIELDS) {
  return (fields.find((f) => f.value === field) ?? fields[0]).placeholder;
}
