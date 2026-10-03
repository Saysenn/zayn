/**
 * WHAT A DOWNLOADED EXPORT IS CALLED.
 *
 *   NEXUS - BANK - 2026-08-24.xlsx
 *   BANK - 2026-08-24.xlsx                 (no single group)
 *   INDIGO - MONTH SHEET - 2026-09.xlsx
 *
 * THE DOCUMENT IS ALWAYS NAMED. The name used to be the group, falling back
 * to the preset only when no single group was picked, so a Bank run for one
 * group came down as "NEXUS-2026-08-24.xlsx" and the Cash and Expensing runs
 * for the same group came down as the identical name. Three payment
 * documents, one filename, whichever landed last winning in the folder.
 *
 * NAMED AFTER THE TEMPLATE, NOT THE PRESET. The template is the shape, which
 * is what the reader has in front of them. The preset would call the master
 * sheet "EXPENSING", because that is the preset it rides on.
 *
 * ONE GROUP NAMES THE FILE, several do not: "INDIGO,MILKMAN,NEXUS - BANK -
 * 2026-08.xlsx" is not a filename anybody wants in a folder, so the caller
 * passes null and the run is named by its shape alone.
 *
 * @param {string|null} scope  one person or one group, null for neither
 * @param {string} label       the template's own file label, e.g. 'BANK'
 * @param {string} stamp       the month rolled to, else today
 */
/**
 * WHO OR WHAT THE RUN WAS NARROWED TO, in one word for the filename.
 *
 *   ['gary'], []             -> 'gary'
 *   [nine ids], []           -> '9 people'
 *   [], ['NEXUS']            -> 'NEXUS'
 *   [], ['NEXUS','INDIGO']   -> null, named by its shape alone
 *
 * PEOPLE BEAT GROUPS. Picking three people out of NEXUS makes the people the
 * narrower fact, and a file called "NEXUS - BANK" holding three of its
 * nineteen rows is a file that lies about itself.
 *
 * A COUNT WHEN THERE ARE SEVERAL, never a list. Nine slugs joined together
 * is not a filename, and leaving the scope off entirely would let a slice
 * and the whole run land on the same name: the exact collision the labels
 * were added to stop.
 */
function exportScope(personIds = [], groups = []) {
  if (personIds.length === 1) return personIds[0];
  if (personIds.length > 1) return `${personIds.length} people`;
  if (groups.length === 1) return groups[0];
  return null;
}

function exportFileName(scope, label, stamp) {
  return [scope, label, stamp]
    .filter(Boolean)
    .join(' - ')
    // Windows and the Content-Disposition header both choke on these. A
    // space, not a removal: a company called "SG/CKA" should not come back
    // as "SGCKA".
    .replace(/[\\/:*?"<>|]/g, ' ');
}

module.exports = { exportFileName, exportScope };
