const peopleRepo = require('../repos/people.repo');
const settingsRepo = require('../repos/settings.repo');
const { withRates } = require('./rates.helper');

// ***************************************************
// * Rows straight from a repo, with every rate on them
// ***************************************************
// The person's rates live on tb_people and the crypto charge in settings, so a
// raw row cannot rate itself. Every reader that prints money calls this once.

/** @returns {Promise<object[]>} the same rows, rated. See rates.helper withRates. */
async function ratedRows(rows) {
  if (!rows?.length) return rows ?? [];
  const [rates, settings] = await Promise.all([peopleRepo.rateMap(), settingsRepo.get()]);
  const cryptoPercent = Number(settings?.crypto_percent) || 0;
  return rows.map((row) => withRates(row, rates, { cryptoPercent }));
}

module.exports = { ratedRows };
