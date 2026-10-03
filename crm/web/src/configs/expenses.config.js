// ***************************************************
// * The expenses page's own fixed values
// ***************************************************
//
// ONE DEFINITION EACH, because the page and the add modal both need them
// and a seed list that differs between the filter and the form is two
// answers to one question.

// Converting a currency to itself has exactly one right answer.
export const AED = 'AED';

// The FLOOR, never a closed set. `unionOptions` puts whatever the ledger
// already carries on top. EUR, not EURO: the CRM reads the sheet's EURO as
// EUR, and two spellings are two currencies.
export const SEED_CURRENCIES = [AED, 'USD', 'GBP', 'EUR', 'PHP'];

// A suggested rate older than this stops reassuring and starts warning.
export const STALE_RATE_DAYS = 30;

export const PAGE_SIZE = 50;

// One upload at a time, and the diff travels out and back like the master
// sheet's, so the body limit is what caps this.
export const IMPORT_MAX_ROWS = 2000;

// What the AED amount filter can be pointed at. Mirrors AMOUNT_COLUMNS in
// the repo, which is the authority.
export const AMOUNT_FIELDS = [
  { value: 'aedAmount', label: 'AED amount' },
  { value: 'rawAmount', label: 'Raw amount' },
  { value: 'exchangeRate', label: 'Exchange rate' },
];
