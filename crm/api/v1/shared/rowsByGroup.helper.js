/**
 * Deal rows split into one bucket per group.
 *
 * ONE FILE PER GROUP, instead of one file with a tab per group. The boss
 * forwards a group's sheet to that group; out of a tabbed workbook that
 * means opening it, deleting four tabs and saving a copy, once per group,
 * every month, and a slip there sends INDIGO's numbers to NEXUS.
 *
 * '(no group)' rather than dropping the ungrouped rows, and rather than
 * folding them into one of the real groups. A row with no group is a
 * flagged row (see dealKey.js: the group is part of a deal's identity), and
 * quietly leaving it out of a payout run is how somebody does not get paid.
 *
 * Sorted, so the same selection produces the same archive twice running.
 *
 * @param {object[]} rows tb_mastersheet rows
 * @returns {Map<string, object[]>} group name -> its rows, alphabetical
 */
function rowsByGroup(rows) {
  const out = new Map();
  for (const r of rows) {
    const key = r.group_name || '(no group)';
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r);
  }
  return new Map(
    [...out.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

module.exports = { rowsByGroup };
