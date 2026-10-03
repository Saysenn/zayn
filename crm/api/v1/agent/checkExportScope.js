const { groupsMentionedIn } = require('./tools/notAGroup');

/**
 * ***************************************************
 * * SHE NAMED A GROUP THE FILE DOES NOT CONTAIN
 * ***************************************************
 *
 * Live transcript 2026-09-06. The admin asked for "the bank sheet for
 * Nexus". The card never rescoped, and she built and handed over every
 * group's 21 bank rows with:
 *
 *   "The bank sheet for Nexus, September 2026, with 21 deals and 18
 *    people is built and downloading now."
 *
 * NEXUS has 2 bank rows. The admin gets a file for the whole book with a
 * sentence telling them it is one group's.
 *
 * WHY NOTHING ELSE CATCHES IT. `wantsPanelAct` is the guard for claiming
 * the card moved, and it is skipped the moment a tool ran. Here a tool DID
 * run and the card IS real: the lie is in the DESCRIPTION of a genuine
 * build, which no guard was looking at. Same shape as `checkFigures`, one
 * level up: compare what she said against what the tool actually produced.
 *
 * A MENTION IS NOT A SCOPE CLAIM. An all-groups file really does contain
 * NEXUS rows, so "this includes Nexus" is true and must pass. Only a scope
 * word in front of the name makes it a claim about what the file IS.
 */

// "for NEXUS", "just MILKMAN", "only the INDIGO deals". The words that turn
// naming a group into a claim about the file's scope.
const SCOPED = /\b(?:for|just|only|limited to|restricted to)\s+(?:the\s+)?$/i;
const LOOKBEHIND = 24;

const upper = (value) => String(value ?? '').trim().toUpperCase();

/**
 * Is this group named as the file's SCOPE, rather than mentioned?
 *
 * Checked against the short run of text immediately before the name, so
 * "for Nexus" counts and "18 people in Nexus and Milkman" does not.
 */
function claimedAsScope(reply, group) {
  const text = String(reply ?? '');
  // A trailing plural is optional, because the one group whose name is a
  // plural is said both ways: `ALL GROUPS` is "all group" as often as
  // "all groups", and notAGroup already accepts both when it finds it.
  const body = group
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')
    .replace(/s$/i, 's?');
  const pattern = new RegExp(`(^|[^a-z0-9])${body}(?=$|[^a-z0-9])`, 'gi');
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(Math.max(0, match.index - LOOKBEHIND), match.index + match[1].length);
    if (SCOPED.test(before)) return true;
  }
  return false;
}

/**
 * @param {string} reply her finished words this turn
 * @param {object} session the export session the tool returned
 * @param {string[]} knownGroups every real group name
 * @returns {{ok: boolean, named: string[], scope: string[]}}
 */
function checkExportScope(reply, session, knownGroups = []) {
  const ok = { ok: true, named: [], scope: [] };
  const draft = session?.draft;
  if (!draft || !reply) return ok;

  const named = groupsMentionedIn(reply, knownGroups);
  if (named.length === 0) return ok;

  const scope = (draft.groups ?? []).map(upper);

  // A file scoped to nothing is scoped to EVERYTHING, so naming a group is
  // only wrong when she presents it as what the file is limited to.
  // A file scoped to something is wrong the moment she names anything else,
  // preposition or not: that group's rows are not in it at all.
  const wrong = named.filter((group) => (
    scope.length === 0
      ? claimedAsScope(reply, group)
      : !scope.includes(upper(group))
  ));

  if (wrong.length === 0) return ok;
  return { ok: false, named: wrong, scope };
}

module.exports = { checkExportScope, claimedAsScope };
