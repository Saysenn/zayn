// ***************************************************
// * What an expenses file would do, before it does it
// ***************************************************
//
// APPEND ONLY. An expense is a transaction, so there is no key that says
// "this is the same spend, updated". Nothing here overwrites an existing
// row and nothing here merges two.
//
// THREE TABS, and two of them are questions:
//
//   new       nothing like it is recorded. Ticked.
//   duplicate its sync_key is already in this month. NOT ticked, both rows
//             shown, because two identical fares on one day are two real
//             expenses and only a human knows which this is.
//   noRate    the file gave no rate. Ticked, and it imports with a NULL
//             rate: there is no rate history to source one from and a June
//             expense must not wear today's number.

const TABS = ['new', 'duplicate', 'noRate'];

/**
 * @param {object[]} incoming rows from parseExpenses
 * @param {object[]} existing snake_case rows already in the month
 */
function diffExpenses(incoming = [], existing = []) {
  const seen = new Map();
  for (const row of existing) {
    const key = row.sync_key;
    if (!key) continue;
    const same = seen.get(key) ?? [];
    same.push(row);
    seen.set(key, same);
  }

  const diff = { new: [], duplicate: [], noRate: [] };

  // WITHIN THE FILE TOO. A file listing the same fare twice is the same
  // question as a file repeating one already recorded.
  const withinFile = new Map();

  for (const row of incoming) {
    const matches = seen.get(row.syncKey) ?? [];
    const twiceInFile = withinFile.get(row.syncKey) ?? 0;
    withinFile.set(row.syncKey, twiceInFile + 1);

    if (matches.length > 0 || twiceInFile > 0) {
      diff.duplicate.push({
        ...row,
        // What it looks like the same as, so the answer is not a guess.
        matches: matches.map((m) => ({
          id: m.id,
          spentOn: m.spent_on,
          description: m.description,
          payee: m.payee,
          currency: m.currency,
          rawAmount: m.raw_amount,
        })),
        alsoInFile: twiceInFile,
      });
      continue;
    }

    if (row.exchangeRate === null || row.exchangeRate === undefined) {
      diff.noRate.push(row);
      continue;
    }

    diff.new.push(row);
  }

  return {
    diff,
    counts: Object.fromEntries(TABS.map((tab) => [tab, diff[tab].length])),
    total: incoming.length,
  };
}

module.exports = { diffExpenses, TABS };
