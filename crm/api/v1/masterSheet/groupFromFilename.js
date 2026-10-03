/**
 * The group a file is for, when the file forgot to say so in a column.
 *
 * "August send for nexus Unpaid.xlsx" is six Nexus deals with no Group
 * column and a tab called Sheet1. Everything the parser normally uses to
 * find a group had nothing to work with, so all six imported as UNKNOWN —
 * and the group is part of a deal's identity, so none of them matched the
 * six NEXUS rows that were the same deals. Six duplicates, and £4,750 in
 * the payout twice.
 *
 * The filename said "nexus" the whole time.
 *
 * THREE RULES, and they are what keeps this from being a guess:
 *
 *   1. Only a group the CRM ALREADY HAS can be matched. This never invents
 *      one. A new group has to arrive through a sheet that names it, the
 *      same as always, or the first typo in a filename becomes a group.
 *
 *   2. Whole words only. "MID" must not match "midlands", and a group
 *      called "ALL GROUPS" needs both words in order.
 *
 *   3. Two matches means no match. A file named for two groups is a
 *      question for a human, not a coin toss.
 *
 * Never silent either way: the upload result says which group it took and
 * where it took it from, or that it could not tell.
 */

/** "August send for nexus Unpaid.xlsx" -> "august send for nexus unpaid" */
function words(v) {
  return String(v ?? '')
    .replace(/\.[a-z0-9]+$/i, '') // the extension is not a word
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * @param {string} filename as uploaded
 * @param {string[]} knownGroups group_name values already in tb_mastersheet
 * @returns {{ group: string|null, reason: string }}
 *   `reason` is for the upload result, so a human can see what happened
 *   rather than wondering why rows landed where they did.
 */
function groupFromFilename(filename, knownGroups = []) {
  const haystack = words(filename);
  if (!haystack) return { group: null, reason: 'the file has no usable name' };

  const matched = [];
  for (const group of knownGroups) {
    const needle = words(group);
    if (!needle) continue;
    // \b on both ends of the whole phrase, so "mid" does not match
    // "midlands" and "all groups" only matches those two words together.
    const pattern = new RegExp(`\\b${needle.replace(/ /g, '\\s+')}\\b`);
    if (pattern.test(haystack)) matched.push(group);
  }

  if (matched.length === 1) {
    return { group: matched[0], reason: `the file name says "${matched[0]}"` };
  }
  if (matched.length > 1) {
    return { group: null, reason: `the file name names ${matched.length} groups (${matched.join(', ')})` };
  }
  return { group: null, reason: 'no group in the file, the tab name or the file name' };
}

module.exports = { groupFromFilename, words };
