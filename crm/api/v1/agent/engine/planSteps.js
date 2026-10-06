const { fold } = require('../tools/resolvePerson');

/**
 * ***************************************************
 * * A REQUEST OF SEVERAL CHANGES IS A PLAN, READ ONCE
 * ***************************************************
 *
 * The admin's call 2026-10-06: "add this, then update this, remove this,
 * and make sure that and that are updated too" should be understood whole,
 * cleaned into numbered steps, asked back only where it is unclear, shown
 * once, and done in one go with one undo. Like a person would.
 *
 * This file is the PURE half: what a plan looks like, which messages are
 * one, how a reply to it is read, and the call each step becomes. No model,
 * no database. See runPlan.js for the half that talks to both.
 */

// What a step may change on a deal, and how it is shown.
const FIELDS = Object.freeze({
  monthlyAmount: { label: 'monthly', column: 'monthly_amount', number: true, money: true },
  payableAmount: { label: 'payable', column: 'payable_amount', number: true, money: true },
  payableDays: { label: 'payable days', column: 'payable_days', number: true },
  notes: { label: 'notes', column: 'notes' },
  label: { label: 'label', column: 'label' },
  currency: { label: 'currency', column: 'currency' },
  paymentMethod: { label: 'payment method', column: 'payment_method' },
  presetOn: { label: 'preset', column: 'preset_on', date: true },
  endOn: { label: 'end date', column: 'end_on', date: true },
  assignedOn: { label: 'appointment', column: 'assigned_on', date: true },
  paymentStartOn: { label: 'payment start', column: 'payment_start_on', date: true },
  roleLabel: { label: 'role', column: 'role_label' },
  company: { label: 'company', column: 'company' },
  groupName: { label: 'group', column: 'group_name' },
  phone: { label: 'phone', column: 'phone' },
  bankDetails: { label: 'bank', column: 'bank_details' },
  accountNumber: { label: 'account number', column: 'account_number' },
  sortCode: { label: 'sort code', column: 'sort_code' },
  postcode: { label: 'postcode', column: 'postcode' },
  location: { label: 'location', column: 'location' },
  email: { label: 'email', column: 'email' },
  tier: { label: 'tier', column: 'tier' },
  status: { label: 'status', column: 'status' },
  oldGroup: { label: 'old group', column: 'old_group' },
  overridePaid: { label: 'paid', column: 'override_paid', bool: true },
  addonPercent: { label: 'add on %', column: 'addon_percent', number: true },
  feePercent: { label: 'fee %', column: 'fee_percent', number: true },
});

const ACTIONS = ['update', 'stop', 'resume', 'add_deal', 'rate', 'rename_company', 'person', 'company'];

/**
 * TWO OR MORE CHANGES IN ONE MESSAGE. Counted by the verbs that change
 * something, with something joining them. One verb over several people
 * ("add 100 to craig and dean") is one change and stays where it was.
 */
const CHANGE_VERBS = /\b(?:add|deduct|minus|subtract|set|change|update|make|stop|end|remove|resume|reopen|rename|move|give|raise|increase|reduce|lower|put|mark|create|bump|cut|take)\b/gi;
function looksMultiStep(said) {
  const text = String(said ?? '');
  if (!text.trim() || /\b(?:undo|revert)\b/i.test(text)) return false;
  // "add a deal for X, role .., group .." is one change with commas in it.
  const verbs = (text.match(CHANGE_VERBS) ?? []).filter((v, i, all) => !(/^add$/i.test(v) && /\badd\s+(?:a|an|new)\s+deal\b/i.test(text) && i > 0));
  if (verbs.length < 2) return false;
  return /\b(?:and|then|also|plus|after that|as well)\b|[,;\n]/i.test(text);
}

/** The number in "4,600", "4.6k", "4600 aed". Null otherwise. */
function figureIn(text) {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i.exec(String(text ?? ''));
  if (!m) return null;
  return Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
}

const NUMS = (s) => [...String(s).matchAll(/\d+/g)].map((m) => Number(m[0]));

/**
 * THEIR REPLY TO A SHOWN PLAN, read without a model when it is one of the
 * plain answers. Anything else is `revise`, and the model rewrites the plan.
 *
 * @returns {{ kind: 'all'|'cancel'|'skip'|'value'|'revise', steps?: number[], run?: boolean, step?: number, value?: number }}
 */
function readReply(said, plan) {
  const text = String(said ?? '').trim().toLowerCase();
  const steps = plan?.steps ?? [];
  if (/^(?:no|nope|cancel|stop|never ?mind|forget (?:it|that)|scrap (?:it|that)|don'?t|leave it)[.!\s]*$/.test(text)) {
    return { kind: 'cancel' };
  }
  const agreed = /^(?:y|ya|yes|yep|yeah|yup|ok|okay|sure|go|go ahead|do it|do all|do them|confirm\w*|proceed|all good|looks good)\b/.test(text);
  const skipWords = /\b(?:skip|except|but not|but|without|leave out|don'?t do|not)\b/;
  if (skipWords.test(text)) {
    let skip = [];
    const listed = /\b(?:steps?|number|no\.?|#)?\s*(\d+(?:\s*(?:,|and|&)\s*\d+)*)\s*$/.exec(text.split(skipWords).pop() ?? '');
    if (listed) skip = NUMS(listed[1]);
    if (skip.length === 0) {
      // "skip the stop", "except the removal", "not paddy"
      const after = text.split(skipWords).pop() ?? '';
      skip = steps.filter((s) => (/\b(?:stop|remov|end|delet)\w*/.test(after) && s.action === 'stop')
        || (s.person && after.includes(String(s.person).toLowerCase().split(/\s+/)[0])))
        .map((s) => s.n);
    }
    skip = skip.filter((n) => steps.some((s) => s.n === n));
    if (skip.length > 0) return { kind: 'skip', steps: skip, run: agreed || /\b(?:rest|others|the remaining)\b/.test(text) };
  }
  if (agreed && !/\b(?:but|change|make|instead|actually)\b/.test(text)) return { kind: 'all' };
  const edit = /\b(?:make|change|set|put)?\s*(?:step\s*|number\s*|#)?(\d+)\s+(?:to\s+|=\s*|as\s+)?(\d[\d,]*(?:\.\d+)?k?)\b/.exec(text);
  if (edit && /\b(?:step|number|#|make|change)\b/.test(text)) {
    const n = Number(edit[1]);
    const step = steps.find((s) => s.n === n);
    if (step && step.changes?.length === 1 && FIELDS[step.changes[0].field]?.number) {
      return { kind: 'value', step: n, value: figureIn(edit[2]) };
    }
  }
  return { kind: 'revise' };
}

const money = (n) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 });

/** "monthly AED 4,000 → 4,100" for one change on one row. */
function changeLine(row, change, after) {
  const meta = FIELDS[change.field] ?? { label: change.field };
  const raw = row?.[meta.column];
  const before = raw == null || raw === '' ? 'none' : (meta.date ? String(raw).slice(0, 10) : raw);
  const cur = meta.money ? `${row?.currency ?? 'GBP'} ` : '';
  const show = (v) => (meta.number && v !== 'none' && Number.isFinite(Number(v)) ? `${cur}${money(v)}` : String(v));
  return `${meta.label} ${show(before)} → ${show(after)}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (ym) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym ?? ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(ym);
};

/** The value a change writes, as the tool wants it. */
function valueFor(field, value) {
  const meta = FIELDS[field];
  if (meta?.number) return Number(String(value).replace(/,/g, ''));
  if (meta?.bool) return /^(?:true|yes|paid|1)$/i.test(String(value));
  return value;
}

/**
 * THE CALLS ONE STEP BECOMES, every one confirmed: the plan WAS the preview.
 * A later month is parked whatever the action, so nothing lands early.
 */
function callsFor(step) {
  const park = (tool, args) => (step.when
    ? { name: 'park_for_month', args: { tool, args, months: [step.when], confirmed: true } }
    : { name: tool, args: { ...args, confirmed: true } });
  const set = {};
  const add = {};
  for (const c of step.changes ?? []) {
    if (c.mode === 'add') add[c.field] = valueFor(c.field, c.value);
    else set[c.field] = valueFor(c.field, c.value);
  }
  switch (step.action) {
    case 'update':
      return (step.ids ?? []).map((id) => park('update_master_sheet_row', {
        id, ...set, ...(Object.keys(add).length ? { add } : {}),
      }));
    case 'stop':
      return (step.deals ?? []).map((d) => park('stop_deal', { person: d.person, company: d.company, group: d.group }));
    case 'resume':
      return (step.deals ?? []).map((d) => ({ name: 'resume_deal', args: { person: d.person, company: d.company, group: d.group } }));
    case 'rate':
      return [park('update_person', { person: step.person, ...set, ...Object.fromEntries(Object.entries(add).map(([k, v]) => [`${k}Delta`, v])) })];
    case 'add_deal':
      return [{ name: 'add_deal', args: { ...set, personName: step.person, groupName: step.group, company: step.company, confirmed: true } }];
    case 'rename_company':
      return [{ name: 'rename_company', args: { name: step.company, newName: step.newName, confirmed: true } }];
    // A PERSON'S OWN profile and a COMPANY's record, through their own tools.
    case 'person':
      return [{ name: 'update_person', args: { person: step.person, ...set, confirmed: true } }];
    case 'company':
      return [{ name: 'update_company', args: { name: step.company, ...set, confirmed: true } }];
    default:
      return [];
  }
}

/** The card the plan is drawn as, with the plan itself carried inside it. */
function planCard(plan) {
  const icon = { stop: '⛔', resume: '↩︎', add_deal: '➕', rename_company: '✎', rate: '%', update: '' };
  const verb = {
    update: 'Change', stop: 'Stop', resume: 'Resume', add_deal: 'New deal', rate: 'Rate', rename_company: 'Rename company', person: 'Person', company: 'Company',
  };
  const done = plan.status === 'done';
  return {
    kind: 'plan',
    title: done
      ? `Done: ${plan.steps.filter((s) => s.result?.ok).length} of ${plan.steps.filter((s) => !s.skipped).length}`
        + `${plan.steps.some((s) => s.skipped) ? `, ${plan.steps.filter((s) => s.skipped).length} skipped` : ''}`
      : plan.status === 'cancelled' ? 'Cancelled, nothing changed'
        : plan.status === 'clean' ? `Checked ${plan.checked} rows: everything matches`
          : plan.status === 'nothing' ? `Checked ${plan.checked} rows: nothing to change for that`
          : `${plan.checked ? `Checked ${plan.checked} rows · ` : ''}${plan.steps.length} ${plan.steps.length === 1 ? 'change' : 'changes'}`,
    note: done ? '' : plan.status === 'asking' ? 'A few things to check first' : 'Nothing has changed yet',
    sections: [...plan.steps.map((s) => ({
      label: `${s.n} · ${icon[s.action] ? `${icon[s.action]} ` : ''}${verb[s.action] ?? s.action}${s.when ? ` · 📅 from ${monthLabel(s.when)}` : ''}`
        + `${s.skipped ? ' · skipped' : ''}${s.result ? (s.result.ok ? ' · ✅ done' : ' · ❌ not done') : ''}`,
      rows: (s.lines?.length ? s.lines : [{ name: s.person ?? s.company ?? '', detail: s.question ?? '' }]).map((l) => ({
        id: l.id, name: l.name, where: l.where, detail: s.result && !s.result.ok ? `${l.detail} · ${s.result.why}` : l.detail,
      })),
    })),
    // WHAT COULD NOT BE A STEP, listed under the plan so nothing is hidden.
    ...(plan.notes ?? [])],
    plan,
  };
}

/** The plan still waiting on them, from the card drawn last, if any. */
function pendingPlan(history = []) {
  let lastUser = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'user') { lastUser = i; break; }
  }
  for (let i = lastUser - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m?.role === 'user') return null;
    const plan = m?.list?.kind === 'plan' ? m.list.plan : null;
    if (plan) return ['preview', 'asking'].includes(plan.status) ? plan : null;
  }
  return null;
}

module.exports = {
  FIELDS, ACTIONS, looksMultiStep, readReply, changeLine, callsFor, planCard, pendingPlan, monthLabel, valueFor, fold,
};
