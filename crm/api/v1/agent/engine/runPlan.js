const { randomUUID } = require('crypto');
const env = require('../../../configs/env');
const logger = require('../../../configs/logger');
const db = require('../../../configs/db');
const rowsRepo = require('../../repos/masterSheetRows.repo');
const { getClient } = require('../chatClient');
const { resolvePerson, fold, within } = require('../tools/resolvePerson');
const { recomputePayable } = require('../../shared/recomputePayable.helper');
const { currentMonth } = require('../../shared/presetMonth.helper');
const {
  FIELDS, ACTIONS, readReply, changeLine, callsFor, planCard, valueFor,
} = require('./planSteps');

/**
 * ***************************************************
 * * THE PLAN: understood once, checked, shown, done in one go
 * ***************************************************
 * See planSteps.js for the why. This is the half with side effects: one
 * model call that reads the request into steps, the database read that
 * checks every step against the real deals, and the run that does them
 * through the same tools she would call, with one batch for one undo.
 */

const STEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['steps'],
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'person', 'group', 'company', 'allDeals', 'changes', 'when', 'newName', 'source'],
        properties: {
          action: { type: 'string', enum: ACTIONS },
          person: { type: 'string' },
          group: { type: 'string' },
          company: { type: 'string' },
          allDeals: { type: 'boolean' },
          changes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['field', 'mode', 'value'],
              properties: {
                field: { type: 'string', enum: Object.keys(FIELDS) },
                mode: { type: 'string', enum: ['set', 'add'] },
                value: { type: 'string' },
              },
            },
          },
          when: { type: 'string' },
          newName: { type: 'string' },
          source: { type: 'string' },
        },
      },
    },
  },
};

function planPrompt(groups) {
  return [
    'You turn an admin\'s request to a payroll CRM into numbered steps. Output JSON only.',
    'One step = one action on one person (or one company for rename_company). Keep their order.',
    'Actions: update (change fields on their deal), stop (end a deal), resume (bring a stopped deal back),',
    'add_deal (a brand new deal: person, group, company, and changes for roleLabel, monthlyAmount and anything else given),',
    'rate (a person\'s own add on % or fee %, on all their deals), rename_company (company -> newName).',
    'changes: mode "add" when they move a figure BY an amount (add, deduct = negative, plus, minus, raise by),',
    'mode "set" when they give the new value (to N, make it N). "add/deduct N" with no field named is monthlyAmount.',
    '"N days" is payableDays. Paid/unpaid is overridePaid "true"/"false". Dates as YYYY-MM-DD. Money as plain numbers.',
    'THIS MONTH ONLY ("only for this month", "just this month", "one-off", "he already got some cash", "not his monthly")',
    'is payableAmount (this month\'s payable), NEVER monthlyAmount. When they correct a step that way, move it to payableAmount.',
    'group: only if they named one. Known groups: ' + groups.join(', ') + '.',
    'allDeals: true only if they said all/both/every of that person\'s deals.',
    'A WHOLE GROUP ("every MANBAT deal", "everyone in Indigo", "all of milkman"): ONE update step with person "*",',
    'group = that group, allDeals true. "Everyone" with no group named: person "*", group "".',
    'when: "YYYY-MM" ONLY if they said a later month ("from next month", "in november"); this month is ' + currentMonth() + '. Otherwise "".',
    'source: the exact words of their message this step came from.',
    'Never invent a person, a value or a step they did not ask for. If a value is missing, leave value "".',
    'Use "" for anything not given.',
  ].join('\n');
}

/** ONE model call: their words into steps. */
async function readSteps(text, { groups, previous = null }) {
  const openai = getClient();
  if (!openai) throw new Error('no AI key');
  const messages = [{ role: 'system', content: planPrompt(groups) }];
  if (previous) {
    messages.push({
      role: 'user',
      content: `The steps so far, as JSON:\n${JSON.stringify(previous.steps.map(({ n, action, person, group, company, allDeals, changes, when, newName, source, question }) => ({
        n, action, person, group, company, allDeals, changes, when, newName, source, question,
      })))}\n\nTheir original request: "${previous.request}"\n\nThey now say: "${text}"\n\n`
        + 'Return the FULL corrected list of steps: answer the questions with what they said, apply any change, '
        + 'drop a step they no longer want, add one they asked for. Keep everything else exactly as it was.',
    });
  } else {
    messages.push({ role: 'user', content: text });
  }
  const res = await openai.chat.completions.create({
    model: env.openaiModel,
    temperature: 0,
    messages,
    response_format: { type: 'json_schema', json_schema: { name: 'plan', strict: true, schema: STEP_SCHEMA } },
  });
  const parsed = JSON.parse(res.choices?.[0]?.message?.content ?? '{"steps":[]}');
  return (parsed.steps ?? []).map((s, i) => ({ ...s, n: i + 1 }));
}

const NOT_GIVEN = (v) => v == null || String(v).trim() === '';

/** One slip on a group name, as everywhere else. */
function groupFrom(name, groups) {
  if (NOT_GIVEN(name)) return null;
  const want = fold(name);
  return groups.find((g) => fold(g) === want) ?? groups.find((g) => want.length >= 4 && within(want, fold(g), 1)) ?? '';
}

/**
 * EVERY STEP AGAINST THE REAL DEALS. Each one ends with its deal ids and
 * its before → after lines, or ONE question saying what is unclear.
 */
async function checkSteps(steps, { groups, said }) {
  const out = [];
  for (const raw of steps) {
    const step = {
      ...raw,
      changes: (raw.changes ?? []).filter((c) => FIELDS[c.field]),
      group: NOT_GIVEN(raw.group) ? null : raw.group,
      company: NOT_GIVEN(raw.company) ? null : raw.company,
      when: /^\d{4}-\d{2}$/.test(String(raw.when ?? '')) && raw.when > currentMonth() ? raw.when : null,
      lines: [],
      question: null,
    };
    const ask = (q) => { step.question = q; };
    const missing = step.changes.filter((c) => NOT_GIVEN(c.value));
    const group = step.group ? groupFrom(step.group, groups) : null;
    if (step.group && !group) ask(`${step.group} is not a group on the sheet. Which group: ${groups.join(', ')}?`);

    if (step.action === 'rename_company') {
      if (NOT_GIVEN(step.company) || NOT_GIVEN(step.newName)) ask('which company, and what should it be called?');
      else step.lines = [{ name: step.company, detail: `rename to ${step.newName}` }];
      out.push(step);
      continue;
    }
    if (NOT_GIVEN(step.person)) { ask('who is this for?'); out.push(step); continue; }

    /**
     * A WHOLE GROUP, as one step over every live deal in it, shown deal by
     * deal like any other. Only update: stopping or adding a whole group is
     * not something one sentence should do.
     */
    if (step.person === '*') {
      if (step.action !== 'update') { ask('I can only change figures or details for a whole group, not stop or add one. Name the people instead.'); out.push(step); continue; }
      if (!group) { ask(`which group: ${groups.join(', ')}?`); out.push(step); continue; }
      /**
       * A WHOLE GROUP ONLY WHEN THEY SAID SO. "put both back to 31", then
       * "indigo and milkman", became every INDIGO and MILKMAN monthly set
       * to 31; only the preview stopped it (test sweep 2026-10-07).
       */
      const wholeSaid = /\b(?:every|all|whole|each|everyone|everybody|entire)\b/i.test(String(said ?? '').replace(/\ball\s+groups?\b/gi, ' '));
      if (!wholeSaid) {
        ask(`do you mean EVERY ${group} deal? If so, say "every ${group} deal". If you meant someone's deal, name them.`);
        out.push(step);
        continue;
      }
      if (missing.length || !step.changes.length) { ask(`what should change for every ${group} deal?`); out.push(step); continue; }
      // eslint-disable-next-line no-await-in-loop
      const all = ((await rowsRepo.findAll({ page: 1, pageSize: 5000 }))?.rows ?? []).filter((r) => !r.stopped_on && r.group_name === group);
      if (!all.length) { ask(`${group} has no live deals.`); out.push(step); continue; }
      step.group = group;
      step.person = `every ${group} deal`;
      step.groupWide = true;
      step.ids = all.map((r) => r.id);
      step.before = Object.fromEntries(all.map((r) => [r.id, Object.fromEntries(step.changes.map((c) => [c.field, r[FIELDS[c.field].column] ?? null]))]));
      step.deals = all.map((r) => ({ id: r.id, person: r.person_name, company: r.company, group: r.group_name }));
      step.lines = all.map((r) => {
        const fields = {};
        const bits = step.changes.map((c) => {
          const meta = FIELDS[c.field];
          const after = c.mode === 'add' ? Math.round(((Number(r[meta.column]) || 0) + valueFor(c.field, c.value)) * 100) / 100 : valueFor(c.field, c.value);
          fields[c.field] = after;
          return changeLine(r, c, after);
        });
        if (fields.payableAmount === undefined) {
          const probe = { ...fields };
          recomputePayable(r, probe);
          if (probe.payableAmount !== undefined && Number(probe.payableAmount) !== Number(r.payable_amount)) bits.push(changeLine(r, { field: 'payableAmount' }, probe.payableAmount));
        }
        return { id: r.id, name: r.person_name, where: `${r.group_name} · ${r.company ?? ''}`, detail: bits.join(' · ') };
      });
      out.push(step);
      continue;
    }

    if (step.action === 'add_deal') {
      const need = ['roleLabel', 'monthlyAmount'].filter((f) => !step.changes.some((c) => c.field === f && !NOT_GIVEN(c.value)));
      if (!group) need.unshift('group');
      if (!step.company) need.push('company');
      if (need.length) ask(`for the new deal for ${step.person} I still need: ${need.join(', ')}.`);
      else {
        step.group = group;
        step.lines = [{
          name: step.person,
          where: `${group} · ${step.company}`,
          detail: step.changes.map((c) => `${FIELDS[c.field].label} ${c.value}`).join(' · '),
        }];
      }
      out.push(step);
      continue;
    }

    // ON THE SHEET: who, and which of their deals.
    const stopped = step.action === 'resume';
    const found = await rowsRepo.searchFuzzy({ q: step.person, stopped, limit: 50 }).catch(() => []);
    const who = resolvePerson(found ?? [], step.person, said);
    let rows = (who.rows ?? []).filter((r) => (stopped ? r.stopped_on : !r.stopped_on));
    if (!who.matched || who.ambiguous || rows.length === 0) {
      const names = [...new Set((who.rows ?? []).map((r) => r.person_name))];
      ask(names.length > 1 ? `which ${step.person}: ${names.join(', ')}?`
        : `I can't find ${stopped ? 'a stopped deal for' : 'a live deal for'} ${step.person} on the sheet. Who did you mean?`);
      out.push(step);
      continue;
    }
    step.person = rows[0].person_name;
    if (group) rows = rows.filter((r) => fold(r.group_name) === fold(group));
    if (step.company) {
      const byCompany = rows.filter((r) => fold(r.company).includes(fold(step.company)));
      if (byCompany.length) rows = byCompany;
    }
    if (rows.length === 0) {
      ask(`${step.person} has no deal in ${group ?? step.company}.`);
    } else if (rows.length > 1 && !step.allDeals && step.action !== 'rate') {
      ask(`${step.person} has ${rows.length} deals (${rows.map((r) => r.group_name).join(', ')}). Which one, or all of them?`);
    } else if (missing.length && step.action !== 'stop' && step.action !== 'resume') {
      ask(`what should ${missing.map((c) => FIELDS[c.field].label).join(' and ')} be for ${step.person}?`);
    } else if (step.action === 'update' && step.changes.length === 0) {
      ask(`what should change for ${step.person}?`);
    }
    if (!step.question) {
      step.ids = rows.map((r) => r.id);
      step.before = Object.fromEntries(rows.map((r) => [r.id, Object.fromEntries(step.changes
        .filter((c) => FIELDS[c.field]).map((c) => [c.field, r[FIELDS[c.field].column] ?? null]))]));
      step.deals = rows.map((r) => ({ id: r.id, person: r.person_name, company: r.company, group: r.group_name }));
      step.lines = rows.map((r) => {
        const where = `${r.group_name ?? ''} · ${r.company ?? ''}`;
        if (step.action === 'stop') return { id: r.id, name: r.person_name, where, detail: 'stop this deal (it moves to the Archive)' };
        if (step.action === 'resume') return { id: r.id, name: r.person_name, where, detail: 'bring this deal back' };
        const fields = {};
        const bits = step.changes.map((c) => {
          const meta = FIELDS[c.field];
          const after = c.mode === 'add'
            ? Math.round(((Number(r[meta.column]) || 0) + valueFor(c.field, c.value)) * 100) / 100
            : valueFor(c.field, c.value);
          if (step.action === 'update') fields[c.field] = after;
          return changeLine(r, c, after);
        });
        // The payable as the sheet will work it out, shown with the rest.
        if (step.action === 'update' && fields.payableAmount === undefined) {
          const probe = { ...fields };
          recomputePayable(r, probe);
          if (probe.payableAmount !== undefined && Number(probe.payableAmount) !== Number(r.payable_amount)) {
            bits.push(changeLine(r, { field: 'payableAmount' }, probe.payableAmount));
          }
        }
        return { id: r.id, name: r.person_name, where, detail: bits.join(' · ') };
      });
    }
    out.push(step);
  }
  return out;
}

/** A plan from their words, checked. */
async function makePlan(text, { groups, said, previous = null }) {
  const steps = await readSteps(text, { groups, previous });
  const checked = await checkSteps(steps, { groups, said });
  const asking = checked.some((s) => s.question);
  return {
    id: previous?.id ?? randomUUID(),
    request: previous?.request ?? text,
    status: checked.length === 0 ? 'empty' : asking ? 'asking' : 'preview',
    steps: checked,
  };
}

// A LONG LIST OF QUESTIONS stays in the card: the chat names the first few.
const fewOf = (list) => (list.length <= 5 ? list.join('\n')
  : `${list.slice(0, 5).join('\n')}\n…and ${list.length - 5} more, at the top of the card.`);

function previewReply(plan) {
  if (plan.status === 'empty') return null;
  if (plan.status === 'asking') {
    const qs = plan.steps.filter((s) => s.question).map((s) => `${s.n}. ${s.question}`);
    return `Got it, ${plan.steps.length} ${plan.steps.length === 1 ? 'change' : 'changes'}. `
      + `${qs.length === 1 ? 'One thing' : `${qs.length} things`} to check first:\n${fewOf(qs)}`;
  }
  const stops = plan.steps.filter((s) => s.action === 'stop' && !s.skipped).length;
  const live = plan.steps.filter((s) => !s.skipped).length;
  // The hint uses THIS plan's numbers: "skip 2" on a one-step plan was wrong.
  const last = plan.steps.filter((s) => !s.skipped).at(-1)?.n;
  return `Here's the plan, ${live} ${live === 1 ? 'change' : 'changes'}${stops ? `, ${stops} of them ending a deal` : ''}. `
    + `Nothing has changed yet. Shall I do it?${live > 1 && last ? ` Say "skip ${last}" to leave one out.` : ''}`;
}

/**
 * WHAT THEY ASKED FOR DECIDES WHAT IS OFFERED. Their call 2026-10-06: "only
 * add the new ones", "don't stop anyone"; and live the same day, "crosscheck
 * this if there are new deals" was answered with all 96 differences. A
 * question about the new ones, the missing ones or the moved ones is
 * answered with those. What is left out is said, never silently dropped.
 */
function narrowPlan(plan, said) {
  const words = String(said ?? '').toLowerCase();
  const only = (re) => new RegExp(`\\b(?:only|just)\\b[^.]*${re}`).test(words);
  const everything = /\b(?:all|every|everything|full)\b/.test(words);
  const asksNew = /\bnew (?:deals?|ones|people|rows|entries|hires?|joiners?|starters?)\b|\bany(?:one|body)? new\b|\bwho'?s new\b|\b(?:joined|joiners?|newcomers?|starters?)\b|\bnot (?:yet )?(?:in|on) (?:the |our )?(?:crm|sheet|system)\b/.test(words);
  const asksMissing = /\bmissing\b|\bnot in (?:the |my |this |that )?(?:file|sheet)\b|\b(?:who|which|anyone|anybody)\b[^.]*\b(?:left|gone|leaving|dropped|removed)\b|\bleavers?\b|\bwho'?s gone\b/.test(words);
  const asksMoved = /\bmoved?\b|\bchanged groups?\b/.test(words);
  let keep = null;
  if (only('\\b(?:add|new)') || (asksNew && !everything)) keep = ['add_deal'];
  else if (only('\\b(?:update|change|fix)')) keep = ['update', 'move_deal'];
  else if (only('\\brenam')) keep = ['rename_group'];
  else if (asksMissing && !everything) keep = ['stop'];
  else if (asksMoved && !everything) keep = ['move_deal'];
  const noStops = /\b(?:don'?t|do not|never|no)\s+(?:stop|remove|end|delete)\w*/.test(words) || only('\\b(?:add|update|change|fix|renam)');
  const kindOf = (x) => (['rename_group', 'move_deal'].includes(x.kind) ? x.kind : x.action);
  const before = plan.steps.length;
  plan.steps = plan.steps.filter((x) => (keep ? keep.includes(kindOf(x)) : true) && !(noStops && x.action === 'stop'))
    .map((x, i) => ({ ...x, n: i + 1, question: x.question ? x.question.replace(/^Step \d+/, `Step ${i + 1}`) : null }));
  const left = before - plan.steps.length;
  if (left > 0) {
    plan.notes = [...(plan.notes ?? []).filter((x) => x.label !== 'Left out, as you asked'),
      { label: 'Left out, as you asked', rows: [{ name: `${left} other ${left === 1 ? 'change' : 'changes'}`, detail: 'found but not offered: ask for "all of them" to see everything' }] }];
  }
  return left;
}

const ANSWERS = {
  type: 'object',
  additionalProperties: false,
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['step', 'field', 'value'],
        properties: {
          step: { type: 'integer' },
          field: { type: 'string', enum: ['group', 'company', 'roleLabel', 'monthlyAmount', 'currency', 'paymentMethod'] },
          value: { type: 'string' },
        },
      },
    },
  },
};

/** The values they gave for the steps that asked, read by the light model. */
async function fillAnswers(said, asking, client = null) {
  const openai = client ?? getClient();
  if (!openai) return [];
  const res = await openai.chat.completions.create({
    model: process.env.AI_MODEL_LIGHT && process.env.AI_MODEL_LIGHT !== 'off' ? process.env.AI_MODEL_LIGHT : 'gpt-4.1-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: 'These steps of a plan are waiting on missing details. Read ONLY the values the admin gives for them. '
          + 'Never invent one; a step they do not mention gets nothing. Money as a plain number.\n'
          + asking.map((x) => `Step ${x.n}: new deal for ${x.person}, missing ${x.need.join(', ')}`).join('\n'),
      },
      { role: 'user', content: String(said) },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'answers', strict: true, schema: ANSWERS } },
  });
  return (JSON.parse(res.choices?.[0]?.message?.content ?? '{"answers":[]}').answers ?? []).filter((a) => String(a.value).trim());
}

/** One step with the answers given for it, and what it still lacks. */
function applyAnswers(step, answers) {
  if (!answers.length) return step;
  const next = { ...step, changes: [...(step.changes ?? [])] };
  for (const a of answers) {
    if (a.field === 'group') next.group = a.value;
    else if (a.field === 'company') next.company = a.value;
    else {
      next.changes = next.changes.filter((c) => c.field !== a.field);
      next.changes.push({ field: a.field, mode: 'set', value: a.value });
    }
  }
  const has = (f) => (f === 'group' ? next.group : f === 'company' ? next.company : next.changes.some((c) => c.field === f && String(c.value).trim()));
  next.need = ['group', 'company', 'roleLabel', 'monthlyAmount'].filter((f) => !has(f));
  next.question = next.need.length ? `New deal for ${next.person}${next.line ? ` (line ${next.line})` : ''} still needs: ${next.need.join(', ')}.` : null;
  next.lines = [{
    name: next.person,
    where: [next.group, next.company].filter(Boolean).join(' · '),
    detail: next.changes.map((c) => `${FIELDS[c.field]?.label ?? c.field} ${c.value}`).join(' · ') || 'new deal',
  }];
  return next;
}

/** Every deal of a group onto its new name, all or none. */
async function renameGroup({ ids, to, from }) {
  const done = [];
  try {
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      done.push(await rowsRepo.update(id, { groupName: to }, 'diane'));
    }
    return { summary: `Renamed the group on ${done.length} deals.` };
  } catch (err) {
    // Half a group renamed is put straight back.
    for (const row of done.filter(Boolean)) {
      // eslint-disable-next-line no-await-in-loop
      await rowsRepo.update(row.id, { groupName: from }, 'diane').catch(() => {});
    }
    throw err;
  }
}

const sameValue = (a, b) => {
  if (a == null || a === '') return b == null || b === '';
  const n = Number(a);
  if (Number.isFinite(n) && Number.isFinite(Number(b))) return Math.abs(n - Number(b)) < 0.005;
  const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
  if (/^\d{4}-\d{2}-\d{2}/.test(String(a)) || a instanceof Date) return day(a) === day(b);
  return fold(a) === fold(b ?? '');
};
/** Why a step's deals are no longer as shown, or null when they are. */
async function changedSince(step) {
  for (const [id, fields] of Object.entries(step.before ?? {})) {
    // eslint-disable-next-line no-await-in-loop
    const row = await rowsRepo.findById(Number(id)).catch(() => null);
    if (!row) return 'that deal is no longer on the sheet';
    for (const [field, was] of Object.entries(fields)) {
      const column = field === 'groupName' ? 'group_name' : FIELDS[field]?.column;
      if (column && !sameValue(was, row[column])) {
        return `${FIELDS[field]?.label ?? field} changed to ${row[column] ?? 'nothing'} since you saw this, so it was left alone`;
      }
    }
  }
  return null;
}

/** What a step can move, counted, so "done" is checked rather than claimed. */
async function footprint() {
  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM tb_mastersheet_changes)::int AS changes,
            (SELECT count(*) FROM tb_scheduled_actions)::int AS parked,
            (SELECT count(*) FROM tb_mastersheet)::int AS deals,
            (SELECT count(*) FROM tb_mastersheet WHERE stopped_on IS NOT NULL)::int AS stopped`,
  );
  return rows[0];
}

/**
 * DOES IT, step by step, through the same tools and guards. One batch id is
 * stamped on every change it wrote, so one undo puts the whole plan back.
 */
async function runSteps(plan, invoke) {
  /**
   * CHECKED FIRST, WRITTEN AFTER, ALL OR NOTHING. Every step is checked
   * against the sheet as it is now before a single write: one deal that moved
   * since the preview stops the whole plan, so a "yes" never leaves it half
   * done for that reason. They are told which, and can skip it.
   */
  const stale = [];
  for (const step of plan.steps) {
    if (step.skipped) continue;
    // eslint-disable-next-line no-await-in-loop
    const why = await changedSince(step);
    if (why) stale.push({ n: step.n, why });
  }
  if (stale.length) {
    return {
      ...plan,
      status: 'preview',
      stale,
      steps: plan.steps.map((x) => {
        const hit = stale.find((t) => t.n === x.n);
        return hit ? { ...x, lines: (x.lines ?? []).map((l) => ({ ...l, detail: `${l.detail} · ⚠ ${hit.why.replace(/, so it was left alone$/, '')}` })) } : x;
      }),
    };
  }
  const before = Number((await db.query('SELECT coalesce(max(id), 0) AS id FROM tb_mastersheet_changes')).rows[0]?.id ?? 0);
  const steps = [];
  for (const step of plan.steps) {
    if (step.skipped) { steps.push(step); continue; }
    const reasons = [];
    let ok = true;
    /**
     * NOT ON A DEAL THAT MOVED SINCE THEY LOOKED. A plan shown at ten and
     * agreed at three would otherwise write ten o'clock's values over
     * whatever changed in between. Each deal is read again; a field that is
     * no longer what the plan showed leaves the step alone, and says so.
     */
    // eslint-disable-next-line no-await-in-loop
    const moved = await changedSince(step);
    if (moved) {
      steps.push({ ...step, result: { ok: false, why: moved } });
      continue;
    }
    // A group rename and a deal moved to another group are the same act: the
    // group on those deals, and their sync keys, in one go.
    const calls = ['rename_group', 'move_deal'].includes(step.kind)
      ? [{ name: '__rename_group', args: { ids: step.ids, to: step.to, from: step.from } }] : callsFor(step);
    for (const call of calls) {
      // DONE IS WHAT THE DATABASE SAYS, not what the tool said. A "which
      // deal?" read as success once and the plan reported a write that never
      // happened. Clone 2026-10-06.
      // eslint-disable-next-line no-await-in-loop
      const was = await footprint();
      // eslint-disable-next-line no-await-in-loop
      // A GROUP RENAME IS ONE ACT OVER ALL ITS DEALS, written here: the one
      // deal tool refuses the second move as "changing identity", and half a
      // group renamed is worse than none. Clone 2026-10-06.
      const result = call.name === '__rename_group'
        ? await renameGroup(call.args).catch((err) => ({ summary: `NOTHING HAS BEEN CHANGED. ${err.message}` }))
        : await invoke(call.name, call.args).catch((err) => ({ summary: `NOTHING HAS BEEN CHANGED. ${err.message}` }));
      // eslint-disable-next-line no-await-in-loop
      const now = await footprint();
      const moved = now.changes > was.changes || now.parked > was.parked || now.deals !== was.deals || now.stopped !== was.stopped
        || (call.name === 'rename_company' && !result?.pending && !/^NOTHING\b/i.test(String(result?.summary ?? '')));
      if (!moved) {
        ok = false;
        // IN WORDS FOR THEM: her finished sentence if the tool gave one, never
        // a guard's own capitals ("THAT WOULD OVERWRITE, NOT ADD").
        const first = String(result?.summary ?? '').replace(/^NOTHING[^.]*\.\s*/i, '').split(/(?<=[.?])\s/)[0];
        const why = result?.reply ? String(result.reply)
          : first && first !== first.toUpperCase() ? first : 'a safety check stopped it, so nothing was changed';
        reasons.push(why.slice(0, 140));
      }
    }
    steps.push({ ...step, result: { ok, why: reasons.join('; ') } });
  }
  const batchId = randomUUID();
  await db.query(
    `UPDATE tb_mastersheet_changes SET batch_id = $1
      WHERE id > $2 AND changed_via = 'diane' AND reverted_at IS NULL AND changed_at > now() - interval '10 minutes'`,
    [batchId, before],
  ).catch((err) => logger.warn({ err: err.message }, 'diane: plan batch not stamped'));
  return { ...plan, status: 'done', steps };
}

function staleReply(plan) {
  const list = plan.stale.map((t) => `${t.n}. ${plan.steps.find((x) => x.n === t.n)?.person ?? ''}: ${t.why.replace(/, so it was left alone$/, '')}`);
  return `Nothing was done: ${plan.stale.length === 1 ? 'one deal has' : `${plan.stale.length} deals have`} changed since you saw this plan.\n`
    + `${list.join('\n')}\n\nSay "skip ${plan.stale.map((t) => t.n).join(' and ')}" to go ahead without ${plan.stale.length === 1 ? 'it' : 'them'}, `
    + `or ${plan.source === 'sheet' ? 'send the file again to check afresh' : 'ask again with the new figures'}.`;
}

function doneReply(plan) {
  const ran = plan.steps.filter((s) => !s.skipped);
  const good = ran.filter((s) => s.result?.ok);
  const bad = ran.filter((s) => !s.result?.ok);
  const parked = good.some((s) => s.when);
  let reply = bad.length === 0
    ? `Done, all ${good.length} ${good.length === 1 ? 'change' : 'changes'}.`
    : `Done ${good.length} of ${ran.length}. Not done: ${bad.map((s) => `step ${s.n} (${s.result.why})`).join('; ')}.`;
  if (plan.steps.some((s) => s.skipped)) reply += ` Skipped: step ${plan.steps.filter((s) => s.skipped).map((s) => s.n).join(', ')}.`;
  if (good.length) reply += ' "Undo that" puts it all back.';
  if (parked) reply += ' The later month ones are saved, nothing changed for them yet.';
  return reply;
}

/**
 * THE TURN. A new request becomes a plan; a reply to a plan is read, and
 * either runs it, changes it, or asks again.
 *
 * @returns {Promise<null|{ reply: string, card: object }>} null to hand back to her
 */
async function planTurn({ said, pending, groups, invoke }) {
  if (pending) {
    const answer = readReply(said, pending);
    logger.info({ plan: pending.id, answer: answer.kind }, 'diane: a reply to a plan');
    if (answer.kind === 'cancel') {
      const plan = { ...pending, status: 'cancelled' };
      return { reply: 'Okay, cancelled. Nothing changed.', card: planCard(plan) };
    }
    if (pending.status === 'preview' && answer.kind === 'all') {
      const plan = await runSteps(pending, invoke);
      return { reply: plan.stale ? staleReply(plan) : doneReply(plan), card: planCard(plan) };
    }
    if (pending.status === 'preview' && answer.kind === 'skip') {
      const plan = { ...pending, steps: pending.steps.map((s) => (answer.steps.includes(s.n) ? { ...s, skipped: true } : s)) };
      if (answer.run) {
        const ran = await runSteps(plan, invoke);
        return { reply: ran.stale ? staleReply(ran) : doneReply(ran), card: planCard(ran) };
      }
      return { reply: previewReply(plan), card: planCard(plan) };
    }
    if (answer.kind === 'view') {
      // The same plan, shown again, still waiting. Steps for anyone they named lead the reply.
      const words = String(said).toLowerCase();
      const about = pending.steps.filter((x) => (x.person || x.company) && words.includes(String(x.person || x.company).toLowerCase().split(/\s+/)[0]));
      const live = pending.steps.filter((x) => !x.skipped).length;
      const reply = about.length
        ? `${about.map((x) => `${x.n}. ${x.person || x.company}: ${x.question ?? x.lines?.map((l) => l.detail).join('; ')}`).join('\n')}\nNothing has changed; the plan is still waiting.`
        : `Here ${live === 1 ? 'is the 1 change' : `are all ${live} changes`} again. Nothing has changed: say "yes"${live > 1 ? `, "skip ${pending.steps.filter((x) => !x.skipped).at(-1)?.n}"` : ''} or "cancel".`;
      return { reply, card: planCard(pending) };
    }
    if (pending.status === 'preview' && answer.kind === 'value') {
      const steps = pending.steps.map((s) => (s.n === answer.step
        ? { ...s, changes: [{ ...s.changes[0], value: String(answer.value) }] } : s));
      // A STEP ALREADY TIED TO ITS DEAL keeps it: only the figure changes.
      if (steps.every((x) => x.ids?.length || x.action === 'add_deal' || x.question)) {
        const plan = {
          ...pending,
          steps: steps.map((x) => (x.n === answer.step ? { ...x, lines: x.lines.map((l) => ({ ...l, detail: `${FIELDS[x.changes[0].field]?.label ?? x.changes[0].field} → ${answer.value} (changed by you)` })) } : x)),
        };
        return { reply: previewReply(plan), card: planCard(plan) };
      }
      const checked = await checkSteps(steps, { groups, said: pending.request });
      const plan = { ...pending, steps: checked, status: checked.some((s) => s.question) ? 'asking' : 'preview' };
      return { reply: previewReply(plan), card: planCard(plan) };
    }
    /**
     * A FILE CHECK IS NEVER REWRITTEN BY THE MODEL: its steps are tied to
     * exact deals, and a rewrite of 96 of them lost every one. What they ask
     * is applied in code ("only the new ones", "don't stop anyone"), or they
     * are told what can be said.
     */
    // A FILE PLAN, including one made before files were marked as such.
    if (pending.source === 'sheet' || pending.checked) {
      const plan = { ...pending, steps: [...pending.steps], notes: [...(pending.notes ?? [])] };
      /**
       * "RESUME LOUIS" (or "resume them") brings back a stopped deal that is
       * still in their file: the card offers it, so the plan must take it.
       */
      const resumeAsk = /\b(?:resume|bring (?:back|\w+ back)|reopen|restart|reactivate)\b/i.test(said);
      if (resumeAsk && plan.stoppedHere?.length) {
        const words = String(said).toLowerCase();
        const all = /\b(?:all|them|those|every|both)\b/.test(words);
        const picked = plan.stoppedHere.filter((d) => all || words.includes(String(d.person).toLowerCase().split(/\s+/)[0]));
        const already = new Set(plan.steps.filter((x) => x.action === 'resume').map((x) => x.deals?.[0]?.id));
        const fresh = picked.filter((d) => !already.has(d.id));
        if (fresh.length) {
          plan.steps = [...plan.steps, ...fresh.map((d, i) => ({
            n: plan.steps.length + i + 1, action: 'resume', person: d.person, deals: [d], ids: [d.id], changes: [],
            lines: [{ id: d.id, name: d.person, where: `${d.group} · ${d.company}`, detail: 'bring this stopped deal back' }],
          }))];
          plan.stoppedHere = plan.stoppedHere.filter((d) => !fresh.includes(d));
          plan.notes = plan.notes.map((x) => (/^Stopped here, still in your file/.test(x.label)
            ? { ...x, label: x.label.replace(/· \d+$/, `· ${plan.stoppedHere.length}`), rows: x.rows.filter((r) => !fresh.some((d) => d.id === r.id)) } : x))
            .filter((x) => !/^Stopped here, still in your file/.test(x.label) || x.rows.length);
          plan.status = plan.steps.some((x) => x.question) ? 'asking' : 'preview';
          return { reply: `Added ${fresh.map((d) => d.person).join(', ')} to bring back.\n\n${previewReply(plan)}`, card: planCard(plan) };
        }
      }
      // THEIR ANSWERS TO HER QUESTIONS fill those gaps and nothing else: a
      // small call reads the values, code puts them on the steps that asked.
      if (plan.steps.some((x) => x.need?.length)) {
        const filled = await fillAnswers(said, plan.steps.filter((x) => x.need?.length)).catch(() => []);
        if (filled.length) {
          plan.steps = plan.steps.map((x) => applyAnswers(x, filled.filter((a) => a.step === x.n)));
          plan.status = plan.steps.some((x) => x.question) ? 'asking' : 'preview';
          const left = plan.steps.filter((x) => x.question).map((x) => `${x.n}. ${x.question}`);
          return {
            reply: left.length ? `Got it. Still to check:\n${fewOf(left)}` : previewReply(plan),
            card: planCard(plan),
          };
        }
      }
      if (narrowPlan(plan, said) > 0 && plan.steps.length) {
        plan.status = plan.steps.some((x) => x.question) ? 'asking' : 'preview';
        return { reply: previewReply(plan), card: planCard(plan) };
      }
      return {
        reply: `I can do all of it ("yes"), leave some out ("skip ${pending.steps.at(-1)?.n ?? 1}", "only the new ones", "don't stop anyone"), or "cancel". Nothing has changed.`,
        card: planCard(pending),
      };
    }
    const plan = await makePlan(said, { groups, said: `${pending.request}\n${said}`, previous: pending });
    if (plan.status === 'empty') return { reply: 'Okay, nothing left to do. Nothing changed.', card: planCard({ ...pending, status: 'cancelled' }) };
    return { reply: previewReply(plan), card: planCard(plan) };
  }
  const plan = await makePlan(said, { groups, said });
  logger.info({ plan: plan.id, steps: plan.steps.length, status: plan.status }, 'diane: a request read as a plan');
  if (plan.status === 'empty') return null;
  return { reply: previewReply(plan), card: planCard(plan) };
}

/**
 * A SHEET THEY PASTED OR DROPPED IN: read, compared, and offered as a plan.
 * See sheetCheck.js. Nothing changes until they say yes to it.
 */
async function sheetTurn({
  text = '', tables = null, said, groups, onEvent = null, client = null, deals: givenDeals = null,
  profiles: givenProfiles = null, companies: givenCompanies = null,
}) {
  // eslint-disable-next-line global-require
  const sheet = require('./sheetCheck');
  // eslint-disable-next-line global-require
  const { intake } = require('./intake');
  // eslint-disable-next-line global-require
  const { understand } = require('./layout');
  // SAID AS IT GOES: a silent minute read as a dead server. Live 2026-10-06.
  const step = (label, done) => onEvent?.({ type: 'progress', label, done, total: 4 });

  /**
   * ANY FILE, ANY LAYOUT. Their call 2026-10-06: not a reader built for one
   * sheet. The file is cut into its tables (intake.js), the model says what
   * each table and column MEANS from a few rows (layout.js), and code reads
   * every row by that. Text that is not a table is read by the model, with
   * every line accounted for.
   */
  step('Reading your file', 0);
  const got = tables ? { tables, text } : await intake({ text });
  step('Working out what each column means', 1);
  const layouts = await understand(got.tables, { groups, client });
  const { byKind, readout, skipped } = sheet.fromLayout(got.tables, layouts);
  /**
   * A FILE ABOUT ANOTHER AREA is said to be one. An expenses sheet sent in
   * the master sheet area has no deals in it, and checking it as deals would
   * find every row "new". The admin's contexts: one area at a time.
   */
  const mine = ['deals', 'people', 'companies'].some((k) => byKind[k]?.rows.length);
  const elsewhere = Object.entries(byKind).filter(([k, v]) => !['deals', 'people', 'companies'].includes(k) && v.rows.length);
  if (!mine && elsewhere.length && !(got.text && got.text.trim())) {
    const what = elsewhere.map(([k, v]) => `${v.rows.length} rows of ${k}`).join(' and ');
    return {
      reply: `This file looks like ${what}, not master sheet deals, so I haven't checked it against the master sheet. `
        + 'Nothing has changed. Checking that kind of file belongs to its own area, which is coming soon.',
      card: { kind: 'report', title: `Read ${what}`, note: 'Not checked here', sections: [], footer: sheet.readoutLines(readout).join('\n') },
    };
  }
  const read = byKind.deals ?? { rows: [], unread: [], headerLines: [] };
  if (got.text && got.text.trim()) {
    const messy = await sheet.readMessy(got.text, groups, (n, of) => step(`Reading your text (${n} of ${of})`, 1), client);
    read.rows.push(...messy.rows);
    read.unread.push(...messy.unread);
  }
  read.unread.push(...skipped.filter((x) => x.why !== 'a total row').map((x) => ({ ...x, text: x.sheet ?? '' })));

  step('Comparing with the master sheet', 2);
  // THE ARCHIVE TOO, so a stopped deal in their file is not taken for a new one.
  const deals = givenDeals ?? [
    ...((await rowsRepo.findAll({ page: 1, pageSize: 5000 }))?.rows ?? []),
    ...((await db.query('SELECT * FROM tb_mastersheet WHERE stopped_on IS NOT NULL').catch(() => ({ rows: [] }))).rows ?? []),
  ].filter((d, i, all) => all.findIndex((x) => x.id === d.id) === i);
  // The export's charges, so its own figures are not read as changes.
  const cryptoPercent = Number((await require('../../repos/settings.repo').get().catch(() => null))?.crypto_percent ?? 0);
  const found = sheet.compare(read, deals, groups, { cryptoPercent });
  const how = sheet.readoutLines(readout);

  /**
   * A QUESTION ABOUT THE FILE IS ANSWERED, not turned into a fix list.
   * Asked to check, update or fix, it goes straight to the plan below with
   * no extra call; anything else is read as a question and answered by code
   * (answer.js) over every row and the same comparison.
   */
  // "Anyone joined?", "who left?", "what moved?" are the check, narrowed.
  const focused = narrowPlan({ steps: [{ action: 'add_deal' }, { action: 'stop' }, { action: 'update', kind: 'move_deal' }, { action: 'update' }] }, said) > 0;
  const wantsCheck = focused || /\b(?:check|cross ?check|compare|wrong|issues?|problems?|discrepanc\w*|updat\w*|sync\w*|fix\w*|match\w*|import\w*|apply|differ\w*|correct\w*)\b/i.test(said ?? '');
  if (!wantsCheck && String(said ?? '').trim()) {
    // eslint-disable-next-line global-require
    const { readQuestion, answer } = require('./answer');
    const fields = [...new Set(read.rows.flatMap((r) => Object.keys(r)).filter((k) => !['line', 'text', 'sheet'].includes(k)))];
    const query = await readQuestion(said, fields, client);
    if (query.kind === 'question') {
      const got2 = answer(query, { rows: read.rows, found });
      logger.info({ query }, 'diane: a question about their file, answered in code');
      return {
        reply: got2.reply,
        card: {
          kind: 'report',
          title: got2.reply.slice(0, 80),
          note: `From ${found.read} rows of your file`,
          sections: got2.sections,
          footer: how.join('\n'),
        },
      };
    }
  }

  step('Working out the fixes', 3);
  const plan = sheet.toPlan(found, said);
  plan.source = 'sheet';
  // HOW IT READ THE FILE, first on the card, so a misread is seen before anything is done.
  // HOW IT WAS READ goes under the card in small print, not among the changes.
  plan.readout = how;
  const totals = skipped.filter((x) => x.why === 'a total row').length;
  if (totals) plan.notes.push({ label: 'Total rows', rows: [{ name: `${totals} total ${totals === 1 ? 'row' : 'rows'} skipped`, detail: 'they add up rows already checked' }] });
  /**
   * PEOPLE AND COMPANIES IN THE FILE are checked too, and their fixes join
   * the same plan. See entities.js. Anything else read (expenses, payments)
   * is listed as read: changing those is not hers in this context.
   */
  if (byKind.people?.rows.length || byKind.companies?.rows.length) {
    // eslint-disable-next-line global-require
    const { comparePeople, compareCompanies, entitySteps } = require('./entities');
    const profiles = givenProfiles ?? (byKind.people?.rows.length ? (await db.query('SELECT * FROM tb_people')).rows : []);
    const companyRows = givenCompanies ?? (byKind.companies?.rows.length ? (await db.query('SELECT * FROM tb_companies')).rows : []);
    const people = comparePeople(byKind.people?.rows ?? [], deals, profiles);
    const companies = compareCompanies(byKind.companies?.rows ?? [], companyRows);
    plan.steps.push(...entitySteps(people, companies, plan.steps.length));
    const unclear = [...people.unmatched, ...companies.unmatched];
    if (unclear.length) plan.notes.push({ label: `Could not match for sure · ${unclear.length}`, rows: unclear.map((u) => ({ name: u.person ?? u.company, where: u.line ? `line ${u.line}` : '', detail: u.why })) });
    found.read += (byKind.people?.rows.length ?? 0) + (byKind.companies?.rows.length ?? 0);
    found.others = people.changed.length + companies.changed.length;
    if (plan.steps.length && plan.status === 'clean') plan.status = 'preview';
  }
  const others = Object.entries(byKind).filter(([k, v]) => !['deals', 'people', 'companies'].includes(k) && v.rows.length);
  if (others.length) {
    plan.notes.push({ label: 'Read, not changed here', rows: others.map(([k, v]) => ({ name: `${v.rows.length} rows of ${k}`, detail: 'checking these belongs to their own area' })) });
  }
  const before = plan.steps.length;
  narrowPlan(plan, said);
  if (plan.steps.length === 0 && plan.status !== 'clean') plan.status = 'nothing';
  else if (plan.status !== 'clean') plan.status = plan.steps.some((x) => x.question) ? 'asking' : 'preview';
  logger.info({ plan: plan.id, read: found.read, steps: plan.steps.length, unread: found.unread.length }, 'diane: a sheet checked');
  /**
   * A REPLY THEY CAN READ AT A GLANCE. Their call 2026-10-06: one sentence
   * of names in brackets and semicolons was hard to read. What they asked
   * about first, one per line; the rest of what was found, one per line; the
   * month note on its own; the question last.
   */
  const narrowed = plan.steps.length < before || focused;
  const where = (x) => (x.lines?.[0]?.where ? ` · ${x.lines[0].where}` : '');
  const bullets = (list) => list.slice(0, 10).map((x) => `• ${x.person || x.company || x.group}${where(x)}`).join('\n')
    + (list.length > 10 ? `\n…and ${list.length - 10} more in the card` : '');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const found2 = [
    found.mismatched.length && plural(found.mismatched.length, 'deal different from ours', 'deals different from ours'),
    found.moved?.length && plural(found.moved.length, 'deal moved to another group', 'deals moved to another group'),
    found.renamed.length && plural(found.renamed.length, 'group renamed', 'groups renamed'),
    found.notOnSheet.length && plural(found.notOnSheet.length, 'new deal', 'new deals'),
    found.stoppedHere?.length && plural(found.stoppedHere.length, 'stopped here but still in your file', 'stopped here but still in your file'),
    found.missing.length && plural(found.missing.length, 'of ours not in your file', 'of ours not in your file'),
    found.others && plural(found.others, 'person or company to update', 'people or companies to update'),
    found.unmatched.length && plural(found.unmatched.length, 'row I could not match for sure', 'rows I could not match for sure'),
    found.unread.length && plural(found.unread.length, 'line I could not read', 'lines I could not read'),
  ].filter(Boolean);
  const monthNote = found.month
    ? `\nNote: your file is ${sheet.monthName(found.month.file)}'s sheet and the CRM is on ${sheet.monthName(found.month.crm)}, so preset dates, payable days and payable amounts were not compared.`
    : '';
  let body;
  if (narrowed && plan.steps.length) {
    const kind = plan.steps[0].action === 'add_deal' ? plural(plan.steps.length, 'new deal', 'new deals')
      : plan.steps[0].action === 'stop' ? plural(plan.steps.length, 'deal of ours is not in your file', 'deals of ours are not in your file')
        : plural(plan.steps.length, 'change', 'changes');
    const rest = found2.filter((l) => !(plan.steps[0].action === 'add_deal' && /new deal/.test(l)) && !(plan.steps[0].action === 'stop' && /not in your file/.test(l)));
    body = `${kind}:\n${bullets(plan.steps)}${rest.length ? `\n\nAlso in the file (not shown): ${rest.join(', ')}.` : ''}`;
  } else {
    body = `Checked ${plural(found.read, 'row', 'rows')}.${found2.length ? `\n${found2.map((l) => `• ${l}`).join('\n')}` : ''}`;
  }
  body += monthNote;
  const ask = narrowed ? 'Do these?' : 'Make ours match?';
  if (plan.status === 'clean') {
    return { reply: `${body}\n\nEverything I could read matches ours.`, card: planCard(plan) };
  }
  if (plan.status === 'nothing') {
    return { reply: `${body}\n\nWith what you asked for, there is nothing to change.`, card: planCard(plan) };
  }
  if (plan.status === 'asking') {
    const qs = plan.steps.filter((x) => x.question).map((x) => `${x.n}. ${x.question}`);
    return { reply: `${body}\n\nFirst I need:\n${fewOf(qs)}`, card: planCard(plan) };
  }
  return {
    reply: `${body}\n\nNothing has changed yet. ${ask} Reply "yes"${plan.steps.length > 1 ? `, or "skip ${plan.steps.at(-1).n}" to leave one out` : ''}.`,
    card: planCard(plan),
  };
}


module.exports = {
  planTurn, sheetTurn, makePlan, checkSteps, runSteps, doneReply, previewReply, applyAnswers,
};
