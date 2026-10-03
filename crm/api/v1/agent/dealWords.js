/** Keep the database's "row" vocabulary inside the system. To the admin,
 * every master-sheet record is a deal. */
function dealWords(text) {
  return String(text ?? '')
    .replace(/\bRows(?=\s+(?:#|\d))/g, 'Deals')
    .replace(/\bRow(?=\s*#)/g, 'Deal')
    .replace(/\brows\b/g, 'deals')
    .replace(/\brow\b/g, 'deal');
}

module.exports = { dealWords };
