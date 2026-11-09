/**
 * CURRENT PLAY on the Winding down page (migration 092, his call 2026-11-04):
 * the boss's sheet's Wait / Chase / Leave, and Do not contact. A mirror of
 * PLAYS in api/v1/repos/liquidations.repo.js. `badge` is the literal class
 * (index.css), so Tailwind's scan sees it.
 */
export const PLAYS = Object.freeze([
  { value: 'wait', label: 'Wait', badge: 'badge badge-play_wait' },
  { value: 'chase', label: 'Chase', badge: 'badge badge-play_chase' },
  { value: 'leave', label: 'Leave', badge: 'badge badge-play_leave' },
  { value: 'do_not_contact', label: 'Do not contact', badge: 'badge badge-play_do_not_contact' },
]);

const BY_VALUE = new Map(PLAYS.map((p) => [p.value, p]));
export const playOf = (value) => BY_VALUE.get(value) ?? null;
export const PLAY_OPTIONS = Object.freeze(PLAYS.map(({ value, label }) => ({ value, label })));

/** Joint liquidators are one a line. */
export const liquidatorsOf = (text) => String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);

/** "Chloe Fletcher · Insolvency Examiner" */
export const partyText = (p) => [p.name, p.position].filter(Boolean).join(' · ');
