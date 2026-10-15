/**
 * ***************************************************
 * * WINDING DOWN'S STAGES (his corrected flowchart, 2026-10-14)
 * ***************************************************
 *
 * The wind down's own word, NOT the company status that pays the deals.
 * A DELIBERATE MIRROR of STAGE in api/v1/repos/liquidations.repo.js and its
 * words in api/v1/shared/liquidationStages.js; migration 090 says what
 * each one means.
 *
 * TWO ROADS FROM ACTIVE, both ending in Dissolved: a strike off
 * (Companies House) and a liquidation (a liquidator). `group` is the road,
 * shown as a heading in the picker. `kinds` are the choices a step has,
 * shown in the pane beside it.
 *
 * `badge` is the literal class, so Tailwind's scan sees it (badgeKinds.js):
 * green active, amber a step under way, red one being done TO the company,
 * grey over. `hint` is the one line under the picker.
 *
 * A STAGE NEVER MOVES THE COMPANY STATUS (his call 2026-10-13): the page
 * lists a company because its status is winding down (stored as
 * liquidation); the stage is the step it is at, and starts unset.
 */
export const LIQ_GROUPS = Object.freeze(['Start', 'Strike off', 'Liquidation', 'End']);

export const LIQ_STAGES = Object.freeze([
  { value: 'active', group: 'Start', label: 'Active', badge: 'badge badge-active', hint: 'Trading. Nothing filed against it.' },
  {
    value: 'active_proposal', group: 'Strike off', label: 'Active proposal', badge: 'badge badge-review_monthly',
    hint: 'A proposal to strike off: the First Gazette notice. Objections for at least 2 months.',
    kinds: [
      { value: 'compulsory', label: 'Compulsory', hint: 'Companies House started it, accounts overdue say.' },
      { value: 'voluntary', label: 'Voluntary', hint: 'The directors applied (DS01) and paid.' },
    ],
  },
  { value: 'strike_off_suspended', group: 'Strike off', label: 'Strike off suspended', badge: 'badge badge-open', hint: 'Somebody objected: on hold for up to 6 months.' },
  { value: 'strike_off_rejected', group: 'Strike off', label: 'Strike off rejected / cancelled', badge: 'badge badge-settle_overdue', hint: 'Not going ahead: it stays on the register.' },
  { value: 'liquidation', group: 'Liquidation', label: 'Liquidation', badge: 'badge badge-liquidation', hint: 'In liquidation, which kind not said yet.' },
  {
    value: 'own_liq', group: 'Liquidation', label: 'Own liq', badge: 'badge badge-liquidation',
    hint: 'Our own, voluntary liquidation.',
    kinds: [
      { value: 'mvl', label: 'MVL', hint: "Members' voluntary: it can pay its debts." },
      { value: 'cvl', label: 'CVL', hint: "Creditors' voluntary: it cannot pay them." },
    ],
  },
  {
    value: 'hmrc_liq', group: 'Liquidation', label: 'HMRC liq', badge: 'badge badge-open',
    hint: 'Compulsory: HMRC asked the court to wind it up.',
    kinds: [
      { value: 'petition', label: 'Petition filed', hint: 'HMRC has asked the court.' },
      { value: 'winding_up_order', label: 'Winding-up order', hint: 'The court has ordered it.' },
    ],
  },
  {
    value: 'dissolved', group: 'End', label: 'Dissolved', badge: 'badge badge-dissolved',
    hint: 'Gone from the register.',
    kinds: [
      { value: 'struck_off', label: 'Struck off', hint: 'By the strike off road.' },
      { value: 'after_liquidation', label: 'After liquidation', hint: 'By the liquidation road.' },
    ],
  },
]);

/**
 * THE ONE PICKER'S OPTIONS, for the table's cell, the company panel and the
 * filter alike (his call 2026-10-14: be consistent): the roads as headings,
 * and every step with kinds carrying them for the pane beside the list.
 * `withKinds: false` is the filter's, which picks a stage, not a kind.
 */
export function stagePickOptions({ withKinds = true } = {}) {
  return LIQ_GROUPS.flatMap((group) => [
    { heading: group },
    ...LIQ_STAGES.filter((s) => s.group === group).map((s) => (withKinds && s.kinds
      ? { value: s.value, label: s.label, sub: s.kinds }
      : { value: s.value, label: s.label })),
  ]);
}
export const STAGE_PICK_OPTIONS = Object.freeze(stagePickOptions());

/** "Own liq · CVL", or the stage alone, or "Not set". */
export const stageLabel = (stage, kind) => {
  const s = BY_VALUE.get(stage);
  if (!s) return 'Not set';
  const k = s.kinds?.find((x) => x.value === kind);
  return k ? `${s.label} · ${k.label}` : s.label;
};

// A company that has just started winding down: nobody has said which step yet.
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
