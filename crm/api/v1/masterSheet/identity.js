/**
 * Identity for a master-sheet row the admin added by hand.
 *
 * A synced row arrives with whatbot's own personId/assignmentId already
 * derived from the sheet. A manually added one has no sheet behind it, so
 * the CRM derives both itself — using the SAME rules whatbot does, because
 * whatbot pulls these rows back and treats them as its own assignments. A
 * different slug rule here would mean the same human gets two identities
 * depending on who typed them in.
 *
 * Deliberately duplicated from whatbot's parseSheet.js rather than shared:
 * the two are separately deployed and never share a process (same reason
 * calculator/mapSheetRow.js re-states parseSheet.js's column map). Change
 * one, change the other.
 */

/** "Nathan Reid" -> "nathan-reid". Must match whatbot's personIdOf exactly. */
function personIdOf(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/ /g, '-');
}

// whatbot's own role vocabulary (employee/types.js ROLES). A role it
// doesn't recognise becomes 'other' rather than being rejected — an
// unrecognised role is still a real payment.
const ROLE_ALIASES = {
  director: 'director',
  mid: 'mid',
  admin: 'admin',
  'admin source': 'admin',
  tech: 'tech',
  techy: 'tech',
  closer: 'closer',
  closure: 'closer',
  visa: 'visa',
  'visa co d': 'visa',
  'visa co mid': 'visa',
  kp: 'kp',
  sales: 'sales',
  support: 'support',
  supprt: 'support',
  holding: 'holding',
  'loss lead': 'loss_lead',
  graphics: 'graphics',
  accounts: 'accounts',
  maid: 'maid',
};

/** "Mid 2" -> { role: 'mid', seat: 2 }. "Director" -> seat null. */
function parseRole(rawLabel) {
  const cleaned = String(rawLabel ?? '').trim().toLowerCase();
  const seatMatch = cleaned.match(/\s(\d+)\s*$/);
  const seat = seatMatch?.[1] ? Number(seatMatch[1]) : null;
  const base = cleaned.replace(/\s\d+\s*$/, '').trim();
  return { role: ROLE_ALIASES[base] ?? 'other', seat };
}

let counter = 0;

/**
 * The sync_key for a manually added row.
 *
 * Prefixed "manual|" so it can never collide with a whatbot assignmentId
 * (group|company|role|seat|person|rowNcolN) — which matters because the
 * month-start 'import' sync deletes synced rows by sync_key and must never
 * accidentally match one of these. Timestamp + counter rather than the
 * row's own fields: the same person can legitimately be added twice on one
 * company, and a field-derived key would collapse those into one.
 */
function manualSyncKey(personId) {
  counter += 1;
  return `manual|${personId}|${Date.now().toString(36)}${counter.toString(36)}`;
}

/**
 * Past its end date = ended. Same derivation whatbot's parseSheet.js does.
 *
 * SEEDS the stored `status` column at upload. It is not what any page
 * reads and it is not what the filter matches: both go through
 * shared/paymentPeriod.helper.js, which derives the same answer in SQL
 * against today, because this one was written once and then went stale the
 * day an end date passed. The column still has to hold something (NOT NULL
 * CHECK (status IN ('active','ended'))), and it becomes meaningful again
 * the moment a human overrides it, so it is seeded correctly rather than
 * with a constant.
 *
 * If the two ever disagree the SQL wins. Keep them saying the same thing.
 *
 * Guards an Invalid Date explicitly: the boss's real sheets contain cells
 * Excel hands over as a Date object that holds no valid time (rows where
 * the end date reads "TBC"), and .toISOString() throws "Invalid time
 * value" on those rather than returning anything. Unparseable means "no
 * known end date", which is 'active' — the same answer a blank cell gets.
 */
function statusFor(endOn) {
  if (!endOn) return 'active';
  if (endOn instanceof Date && Number.isNaN(endOn.getTime())) return 'active';
  const iso = endOn instanceof Date ? endOn.toISOString().slice(0, 10) : String(endOn).slice(0, 10);
  // The business day, the same one every other "is it over" check uses.
  return iso < require('../shared/presetMonth.helper').currentDay() ? 'ended' : 'active';
}

module.exports = { personIdOf, parseRole, manualSyncKey, statusFor };
