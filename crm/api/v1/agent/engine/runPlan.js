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
    'group: only if they named one. Known groups: ' + groups.join(', ') + '.',
    'allDeals: true only if they said all/both/every of that person\'s deals.',
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
    const ask = (q) => { step.question = `Step ${step.n}: ${q}`; };
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

function previewReply(plan) {
  if (plan.status === 'empty') return null;
  if (plan.status === 'asking') {
    const qs = plan.steps.filter((s) => s.question).map((s) => s.question);
    return `Got it, ${plan.steps.length} ${plan.steps.length === 1 ? 'change' : 'changes'}. `
      + `${qs.length === 1 ? 'One thing' : `${qs.length} things`} to check first:\n${qs.join('\n')}`;
  }
  const stops = plan.steps.filter((s) => s.action === 'stop' && !s.skipped).length;
  const live = plan.steps.filter((s) => !s.skipped).length;
  return `Here's the plan, ${live} ${live === 1 ? 'change' : 'changes'}${stops ? `, ${stops} of them ending a deal` : ''}. `
    + 'Nothing has changed yet. Shall I do it? You can say "skip 2" or "make step 1 4600".';
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
  const before = Number((await db.query('SELECT coalesce(max(id), 0) AS id FROM tb_mastersheet_changes')).rows[0]?.id ?? 0);
  const steps = [];
  for (const step of plan.steps) {
    if (step.skipped) { steps.push(step); continue; }
    const reasons = [];
    let ok = true;
    const calls = step.kind === 'rename_group' ? [{ name: '__rename_group', args: { ids: step.ids, to: step.to, from: step.from } }] : callsFor(step);
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
      return { reply: doneReply(plan), card: planCard(plan) };
    }
    if (pending.status === 'preview' && answer.kind === 'skip') {
      const plan = { ...pending, steps: pending.steps.map((s) => (answer.steps.includes(s.n) ? { ...s, skipped: true } : s)) };
      if (answer.run) {
        const ran = await runSteps(plan, invoke);
        return { reply: doneReply(ran), card: planCard(ran) };
      }
      return { reply: previewReply(plan), card: planCard(plan) };
    }
    if (pending.status === 'preview' && answer.kind === 'value') {
      const steps = pending.steps.map((s) => (s.n === answer.step
        ? { ...s, changes: [{ ...s.changes[0], value: String(answer.value) }] } : s));
      const checked = await checkSteps(steps, { groups, said: pending.request });
      const plan = { ...pending, steps: checked, status: checked.some((s) => s.question) ? 'asking' : 'preview' };
      return { reply: previewReply(plan), card: planCard(plan) };
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
  const read = byKind.deals ?? { rows: [], unread: [], headerLines: [] };
  if (got.text && got.text.trim()) {
    const messy = await sheet.readMessy(got.text, groups, (n, of) => step(`Reading your text (${n} of ${of})`, 1), client);
    read.rows.push(...messy.rows);
    read.unread.push(...messy.unread);
  }
  read.unread.push(...skipped.filter((x) => x.why !== 'a total row').map((x) => ({ ...x, text: x.sheet ?? '' })));

  step('Comparing with the master sheet', 2);
  const deals = givenDeals ?? (await rowsRepo.findAll({ page: 1, pageSize: 5000 }))?.rows ?? [];
  const found = sheet.compare(read, deals, groups);
  const how = sheet.readoutLines(readout);

  /**
   * A QUESTION ABOUT THE FILE IS ANSWERED, not turned into a fix list.
   * Asked to check, update or fix, it goes straight to the plan below with
   * no extra call; anything else is read as a question and answered by code
   * (answer.js) over every row and the same comparison.
   */
  const wantsCheck = /\b(?:check|cross ?check|compare|wrong|issues?|problems?|discrepanc\w*|updat\w*|sync\w*|fix\w*|match\w*|import\w*|apply|differ\w*|correct\w*)\b/i.test(said ?? '');
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
          sections: [...got2.sections, ...(how.length ? [{ label: 'How I read your file', rows: how.map((l) => ({ name: l })) }] : [])],
        },
      };
    }
  }

  step('Working out the fixes', 3);
  const plan = sheet.toPlan(found, said);
  // HOW IT READ THE FILE, first on the card, so a misread is seen before anything is done.
  if (how.length) plan.notes = [{ label: 'How I read your file', rows: how.map((l) => ({ name: l })) }, ...(plan.notes ?? [])];
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
  /**
   * WHAT THEY TYPED WITH IT DECIDES WHAT IS OFFERED. Their call 2026-10-06:
   * the file comes with an instruction. "only add the new ones", "just
   * update", "don't stop anyone", "rename the groups only". What is left
   * out is said, never silently dropped.
   */
  const words = String(said ?? '').toLowerCase();
  const only = (re) => new RegExp(`\\b(?:only|just)\\b[^.]*${re}`).test(words);
  const keep = only('\\b(?:add|new)') ? ['add_deal'] : only('\\b(?:update|change|fix)') ? ['update'] : only('\\brenam') ? ['rename_group'] : null;
  const noStops = /\b(?:don'?t|do not|never|no)\s+(?:stop|remove|end|delete)\w*/.test(words) || only('\\b(?:add|update|change|fix|renam)');
  const before = plan.steps.length;
  plan.steps = plan.steps.filter((x) => (keep ? keep.includes(x.kind === 'rename_group' ? 'rename_group' : x.action) : true) && !(noStops && x.action === 'stop'))
    .map((x, i) => ({ ...x, n: i + 1, question: x.question ? x.question.replace(/^Step \d+/, `Step ${i + 1}`) : null }));
  if (plan.steps.length < before) {
    plan.notes = [...(plan.notes ?? []), { label: 'Left out, as you asked', rows: [{ name: `${before - plan.steps.length} ${before - plan.steps.length === 1 ? 'change' : 'changes'}`, detail: 'found but not offered' }] }];
  }
  if (plan.steps.length === 0 && plan.status !== 'clean') plan.status = 'nothing';
  else if (plan.status !== 'clean') plan.status = plan.steps.some((x) => x.question) ? 'asking' : 'preview';
  logger.info({ plan: plan.id, read: found.read, steps: plan.steps.length, unread: found.unread.length }, 'diane: a sheet checked');
  const head = `${sheet.summary(found)}.`;
  if (plan.status === 'clean') {
    return { reply: `${head} Everything I could read matches ours.`, card: planCard(plan) };
  }
  if (plan.status === 'nothing') {
    return { reply: `${head} With what you asked for, there's nothing to change; the other ${before} ${before === 1 ? 'change is' : 'changes are'} left out.`, card: planCard(plan) };
  }
  if (plan.status === 'asking') {
    const qs = plan.steps.filter((x) => x.question).map((x) => x.question);
    return { reply: `${head} To make ours match, I'd need a few things first:\n${qs.join('\n')}`, card: planCard(plan) };
  }
  return {
    reply: `${head} Nothing has changed. Want me to make ours match? Say "yes", or "skip 3" to leave one out.`,
    card: planCard(plan),
  };
}

module.exports = { planTurn, sheetTurn, makePlan, checkSteps, runSteps, doneReply, previewReply };
