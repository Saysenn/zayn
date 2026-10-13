/**
 * ***************************************************
 * * THE LIQUIDATION TRACKER'S STAGES (his call 2026-10-13)
 * ***************************************************
 *
 * The wind down's own word, NOT the company status that pays the deals.
 * A DELIBERATE MIRROR of STAGE in api/v1/repos/liquidations.repo.js.
 *
 * `badge` is the literal class, so Tailwind's scan sees it (badgeKinds.js):
 * HMRC's own liquidation and a rejected strike off are red, they are being
 * done TO us; our own liquidation amber; a strike off waiting is the accent;
 * dissolved grey, it is over; active green.
 *
 * A STAGE NEVER MOVES THE COMPANY STATUS (his call 2026-10-13): the page
 * lists a company because its status is liquidation; the stage is the
 * step its liquidation is at, and starts unset.
 */
export const LIQ_STAGES = Object.freeze([
  { value: 'own_liq', label: 'Own liq', badge: 'badge badge-liquidation' },
  { value: 'hmrc_liq', label: 'HMRC liq', badge: 'badge badge-open' },
  { value: 'strike_off', label: 'Strike off', badge: 'badge badge-settle_late' },
  { value: 'strike_off_rejected', label: 'Strike off rejected', badge: 'badge badge-settle_overdue' },
  { value: 'dissolved', label: 'Dissolved', badge: 'badge badge-dissolved' },
  { value: 'active', label: 'Active', badge: 'badge badge-active' },
]);

// A company that has just gone into liquidation: nobody has said which kind yet.
export const NOT_SET = Object.freeze({ value: '', label: 'Not set', badge: 'badge badge-closed' });

const BY_VALUE = new Map(LIQ_STAGES.map((s) => [s.value, s]));
export const stageOf = (value) => BY_VALUE.get(value) ?? NOT_SET;

// A deadline this close is amber; a passed one red.
export const DEADLINE_SOON_DAYS = 7;
const DAY_MS = 86_400_000;

/** Today, as YYYY-MM-DD in the browser's own day. */
export function todayIso(now = new Date()) {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 10);
}

/**
 * How urgent a deadline is: 'passed', 'soon' (within DEADLINE_SOON_DAYS),
 * or null. Dissolved is done, so its deadline no longer presses.
 */
export function deadlineTone(deadline, stage, today = todayIso()) {
  if (!deadline || stage === 'dissolved') return null;
  const days = Math.round((Date.parse(String(deadline).slice(0, 10)) - Date.parse(today)) / DAY_MS);
  if (days < 0) return 'passed';
  if (days <= DEADLINE_SOON_DAYS) return 'soon';
  return null;
}

/** "30 Nov 2026", or the dash. */
export function shortDate(value) {
  if (!value) return '—';
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
