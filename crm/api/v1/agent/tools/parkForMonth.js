const INSTEAD = /\b(?:instead|change (?:that|it)|move (?:that|it)|push (?:that|it)|actually)\b/i;
const queue = require('../../repos/scheduledActions.repo');
const rowsRepo = require('../../repos/masterSheetRows.repo');
const { currentMonth } = require('../../shared/presetMonth.helper');
const { checkParkable } = require('../scheduled/parkable');
const { confirmFirst } = require('./confirmFirst');

/**
 * ***************************************************
 * * PARK A CHANGE FOR A LATER MONTH
 * ***************************************************
 *
 * "Add 5% to Nathan for the next 3 months", said in October. Nothing
 * changes now; three rows go in the queue and the boot screen applies one
 * on the first sign in of each month.
 *
 * SHE RESOLVES IT NOW, WHILE HE IS HERE. The finished call is what gets
 * stored, never his sentence: deciding in January what a sentence from
 * October meant is a second chance to get it wrong with nobody watching.
 *
 * THE YEARS GO BACK TO HIM. After November and December 2026, "January" is
 * 2027. He said "january 2026" in his own worked example, which is exactly
 * the trap `guessedYear.helper` exists for — so the confirmation prints
 * every resolved month in full and he sees the year before it is saved.
 */

const MAX_MONTHS = 12;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** ' 2026-11' -> 'November 2026'. */
function monthLabel(month) {
  const [year, m] = String(month).split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${year}`;
}

function shift(month, by) {
  const [year, m] = String(month).split('-').map(Number);
  const d = new Date(Date.UTC(year, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v ?? ''));

/**
 * THE MONTHS THIS COVERS, absolute, in order.
 *
 * `months` when she has worked them out; otherwise `from` plus `count`,
 * which is how "the next 3 months" arrives. Either way the result is a list
 * of 'YYYY-MM' and nothing relative survives into the table.
 */
function monthsFor({ months, from, count }, now) {
  if (Array.isArray(months) && months.length > 0) return months.map(String);
  const start = isMonth(from) ? from : shift(now, 1);
  const howMany = Math.max(1, Number(count) || 1);
  return Array.from({ length: howMany }, (_, i) => shift(start, i));
}

const parkForMonth = {
  name: 'park_for_month',
  description:
    'SAVE a change to be applied automatically at the START of a later month, instead of doing it '
    + 'now. Use when the admin asks for something LATER: "park this for next month", "do it in '
    + 'November", "add 5% to Nathan for the next 3 months", "close this deal in December", "hold '
    + 'off until next month". Nothing changes now. Work the change out FULLY first (find the deal, '
    + 'settle the final figures) and pass the finished call, because it is replayed exactly as '
    + 'given with nobody watching. Figures must be FINAL VALUES, never "+5". For something to do '
    + 'NOW, call the ordinary tool instead. A month NAME that has passed this year ("july" said in October) is '
    + 'NEXT year\'s: park it there, never refuse it as past; the preview says which year.',
  parameters: {
    type: 'object',
    properties: {
      tool: {
        type: 'string',
        description: 'The tool that would do it: update_master_sheet_row, update_person or stop_deal.',
      },
      args: {
        type: 'object',
        description: 'Its arguments, fully resolved. The row id, and FINAL values — never a change '
          + 'relative to what is there on the day.',
      },
      months: {
        type: 'array',
        items: { type: 'string' },
        description: 'The months to apply it in, each YYYY-MM. Use this when you know them.',
      },
      from: { type: 'string', description: 'First month, YYYY-MM. Defaults to next month.' },
      count: { type: 'number', description: 'How many consecutive months from `from`. "The next 3 months" is 3.' },
      confirmed: { type: 'boolean', description: 'True only after the admin has agreed to the preview.' },
      afterNow: { type: 'number', description: 'Code only: the value the deal will have after a change asked for now in the same message.' },
    },
    required: ['tool', 'args'],
  },

  // IT CHANGES DATA — the queue, not the sheet. Still a write: a parked
  // row will act on its own later, and that is a thing that happened.
  writes: true,

  async handler(rawArgs = {}) {
    const now = currentMonth();
    const { tool } = rawArgs;
    let { args = {} } = rawArgs;
    // A RAISE IS THE MONTHLY AMOUNT; the payable follows from it ("ines 4200 for
    // january" was parked as payable amount, fresh park run 2026-10-22).
    if (tool === 'update_master_sheet_row' && args.payableAmount != null && args.monthlyAmount == null && !/\bpayable\b/i.test(String(rawArgs.said ?? ''))) {
      const { payableAmount, ...restArgs } = args;
      args = { ...restArgs, monthlyAmount: payableAmount };
    }
    /**
     * THE DEAL THEIR WORDS NAME, CHECKED IN CODE, before anything else. "park
     * juno at 650 for next month" was saved on Kiran Vale's Brightwell deal,
     * and "kiran's ironleaf" went round seven rounds on ids (blind park run
     * 2026-10-22). The person (and company) they said decides the deal; an id
     * naming somebody else is replaced, and several of their deals are asked about.
     */
    if (tool === 'update_master_sheet_row' && rawArgs.said) {
      const said = String(rawArgs.said);
      const given = (Array.isArray(args.ids) && args.ids.length ? args.ids : [args.id]).map(Number).filter(Number.isInteger);
      const fromWords = await dealsSaid(said);
      // SEVERAL PEOPLE NAMED: their deals, never somebody else's. "baker jones n karin
      // vole both up 100" was parked on Kiran Vale's (fresh park run 2026-10-22).
      if (fromWords.people.length > 1 && fromWords.all.length && !(given.length && given.every((id) => fromWords.all.some((r) => r.id === id)))) {
        const relative = Object.keys(args).some((k) => k.endsWith('Delta')) || (args.add && typeof args.add === 'object');
        if (!relative) {
          return { summary: `NOTHING WAS SAVED. They named ${fromWords.people.join(' and ')}, and those ids are not their deals. `
            + `Their live deals: ${fromWords.all.map((r) => `#${r.id} ${r.person_name}, ${r.company}`).join('; ')}. Park each person's own deal.` };
        }
        const { id: _id, ids: _ids, ...rest } = args;
        args = { ...rest, ids: fromWords.all.map((r) => r.id) };
      }
      if (fromWords.people.length === 1 && !(given.length && given.every((id) => fromWords.rows.some((r) => r.id === id)))) {
        const { id: _id, ids: _ids, targetPerson: _p, targetCompany: _c, targetGroup: _g, person: _pp, ...rest } = args;
        if (fromWords.rows.length === 1) args = { ...rest, id: fromWords.rows[0].id };
        else if (/\b(?:all|every|each|both)\b/i.test(said)) args = { ...rest, ids: fromWords.rows.map((r) => r.id) };
        else {
          return { summary: `NOTHING WAS SAVED. ${fromWords.people[0]} has ${fromWords.rows.length} live deals `
            + `(${fromWords.rows.map((r) => `#${r.id} ${r.company}, ${r.group_name}`).join('; ')}). Ask which one, or all of them.` };
        }
      }
    }

    const check = checkParkable(tool, args);
    if (!check.ok) return { summary: check.why };

    let months = monthsFor(rawArgs, now);
    // "FROM NOVEMBER.. WAIT NO MAKE THAT DECEMBER" was parked for November, as
    // she sent it (blind park run 2026-10-22). One month: the corrected one wins.
    const corrected = rawArgs.confirmed === true ? null : require('../../shared/when.helper').correctedMonthIn(rawArgs.said, now); // eslint-disable-line global-require
    if (corrected && months.length === 1 && months[0] !== corrected) months = [corrected];
    if (months.some((m) => !isMonth(m))) {
      return { summary: 'Every month has to be a real YYYY-MM. Ask which months they mean.' };
    }
    if (months.some((m) => m <= now)) {
      return {
        summary: `${months.filter((m) => m <= now).map(monthLabel).join(' and ')} is not in the future. `
          + 'Parked work runs at the START of a month, so a month already here cannot be parked — '
          + 'offer to do it now instead.',
      };
    }
    if (months.length > MAX_MONTHS) {
      return { summary: `That is ${months.length} months. Park at most ${MAX_MONTHS} at a time.` };
    }

    if (check.spec.companyLevel) {
      // NO DISSOLVING LATER (his call 2026-10-15): only the Winding down page dissolves.
      if (['closed', 'dissolved'].includes(args.status)) {
        return { summary: 'NOTHING HAS BEEN PARKED. A company is dissolved only on the Winding down page, by its stage, '
          + 'never on a date. Offer to put it into winding down instead.' };
      }
      const companies = [].concat(args[check.spec.idField] ?? []).map(String).filter(Boolean);
      const act = args.status === 'active' ? 'reopen' : 'close';
      const what = `${act} ${companies.join(', ')}, stopping every live deal on ${companies.length === 1 ? 'it' : 'them'}`;
      const needs = confirmFirst(rawArgs.confirmed, {
        act: `${act} ${companies.join(', ')} at the START of each month below`,
        count: months.length,
        noun: 'month',
        keeps: 'NOTHING CHANGES NOW. This month is paid in full; the deals stop on the 1st.',
        lines: months.map((m) => `  ${monthLabel(m)}: ${what}`),
      });
      if (needs) return needs;
      const saved = [];
      for (const month of months) {
        // eslint-disable-next-line no-await-in-loop
        saved.push(await queue.park({
          dueMonth: month, tool, args, expect: {}, targetIds: [], said: what, companies,
        }));
      }
      return {
        summary: `Saved: ${what} on 1 ${monthLabel(months[0])}. Nothing has changed yet; this month is `
          + 'paid in full. Say that plainly, with the month and year.',
        reply: `Saved. ${companies.join(', ')} will close on 1 ${monthLabel(months[0])}, so `
          + `${monthLabel(now)} is still paid in full. Nothing has changed yet.`,
        computedReply: true,
        parked: saved.map((e) => ({ id: e.id, month: e.due_month })),
      };
    }

    /**
     * A PERSON'S OWN RATE, for a later month. update_person was on the
     * allow list and could never be parked: the deal path read the name as a
     * row id and said "that deal is not there". Clone 2026-10-05, "add 5% to
     * kiran vale deals next month". The finished value is worked out now
     * against their profile, and it reaches every deal they hold.
     */
    if (check.spec.idField === 'person') {
      // eslint-disable-next-line global-require
      const { resolvePerson } = require('./resolvePerson');
      // eslint-disable-next-line global-require
      const peopleRepo = require('../../repos/people.repo');
      const found = await rowsRepo.searchFuzzy({ q: args.person });
      const person = resolvePerson(found, args.person, rawArgs.said);
      if (person.ambiguous || !person.matched || !person.rows?.length) {
        return { summary: `NOTHING WAS SAVED. "${args.person}" is not one person on the sheet. Ask who they mean.` };
      }
      const profile = await peopleRepo.findById(person.rows[0].person_id);
      const name = profile?.display_name ?? person.rows[0].person_name;
      const one = { ...args, person: name };
      const current = { addonPercent: Number(profile?.addon_percent ?? 0), feePercent: Number(profile?.fee_percent ?? 0) };
      for (const key of Object.keys(one)) {
        if (!key.endsWith('Delta')) continue;
        const field = key.slice(0, -'Delta'.length);
        if (field in current) one[field] = Math.round((current[field] + Number(one[key])) * 100) / 100;
        delete one[key];
      }
      const changes = Object.keys(current).filter((f) => one[f] !== undefined)
        .map((f) => `${f === 'addonPercent' ? 'add on' : 'fee'} ${current[f]}% → ${Number(one[f])}%`);
      if (changes.length === 0) {
        return { summary: 'Only an add on or a fee can be parked for a person. Ask what should change.' };
      }
      const live = person.rows.filter((r) => !r.stopped_on).length;
      const what = `${changes.join(', ')} on ${name}'s own rate, so on all ${live} of their deals`;
      const needs = confirmFirst(rawArgs.confirmed, {
        act: `park this for ${name}, applied at the start of each month below`,
        count: months.length,
        noun: 'month',
        keeps: 'Nothing changes now. It is applied on the first sign-in of that month, and the new rate stays from then on.',
        lines: months.map((m) => `  ${monthLabel(m)}: ${what}`),
      });
      if (needs) return needs;
      const saved = [];
      for (const month of months) {
        // eslint-disable-next-line no-await-in-loop
        saved.push(await queue.park({
          dueMonth: month, tool, args: one, expect: {}, targetIds: [], said: `${name}: ${what}`,
        }));
      }
      return {
        summary: `Parked for ${name}: ${months.map(monthLabel).join(', ')}. Nothing has changed yet.`,
        reply: `Done. Saved for ${months.map(monthLabel).join(', ')}: ${what}. Nothing has changed on the sheet yet.`,
        computedReply: true,
        parked: saved.map((e) => ({ id: e.id, month: e.due_month })),
      };
    }

    /**
     * ONE DEAL OR SEVERAL. "Add 5% to zayn's deals next month" is both of
     * his deals: with only one id allowed she made one up, #1, which was
     * somebody else's. Several ids park one entry per deal, shown in ONE
     * preview. Clone 2026-10-05.
     */
    const rowIds = (Array.isArray(args.ids) && args.ids.length ? args.ids : [args[check.spec.idField]])
      .map(Number).filter(Number.isInteger);
    const rowsNow = (await Promise.all(rowIds.map((id) => rowsRepo.findById(id)))).filter(Boolean);
    if (rowsNow.length === 0 || rowsNow.length !== rowIds.length) {
      return { summary: 'That deal is not there, so there is nothing to park. Find it first.' };
    }

    /**
     * "+5%" IS WORKED OUT NOW, per deal, against today's value: a parked
     * change must carry the FINISHED value (see parkable.js). It came as
     * addonPercentDelta and was shown as "update master sheet deal".
     */
    // Carried in the held call (afterNow), since the yes that replays it says no figure.
    const nowValue = rawArgs.afterNow != null ? Number(rawArgs.afterNow) : require('../../shared/when.helper').nowValueIn(rawArgs.said); // eslint-disable-line global-require
    const plans = rowsNow.map((row) => {
      const { ids: _ids, ...base } = args;
      const one = { ...base, ...(check.spec.idField === 'id' ? { id: row.id } : {}) };
      /**
       * "ADD 500 NEXT MONTH" can arrive as `add: { monthlyAmount: 500 }` (the
       * everyday edit's shape). Read as a Delta, so it is shown and stored
       * as the FINISHED value, "monthly amount 4000 → 4500". Left as `add` it
       * was shown as "update master sheet deal" and never said what it
       * changed. Live 2026-10-07.
       */
      if (one.add && typeof one.add === 'object') {
        for (const [field, by] of Object.entries(one.add)) one[`${field}Delta`] = Number(by);
        delete one.add;
      }
      for (const key of Object.keys(one)) {
        if (!key.endsWith('Delta')) continue;
        const field = key.slice(0, -'Delta'.length);
        // "OTTO 1600 IN NOV" IS 1600, not 1500 + 1600: she sent it as an add and
        // it was parked as 3100 (blind park run 2026-10-22). An amount is added
        // only when their words add it; a percentage add stays as sent.
        if (!/percent/i.test(field) && !saidAsAdded(`${rawArgs.said ?? ''}`, Number(one[key]))) {
          one[field] = Number(one[key]);
          delete one[key];
          continue;
        }
        const column = rowsRepo.COLUMN_FOR[field];
        if (column) one[field] = Math.round((Number(row[column] ?? 0) + Number(one[key])) * 100) / 100;
        delete one[key];
      }
      /**
       * THE WORLD AS IT IS NOW, so the runner can tell whether it still
       * matches. Only the fields being written: a snapshot of everything
       * would skip on any unrelated edit.
       */
      const expect = {};
      for (const field of Object.keys(one)) {
        const column = rowsRepo.COLUMN_FOR[field];
        if (column) expect[field] = row[column];
      }
      /**
       * A CHANGE SAID FOR NOW IN THE SAME BREATH. "felix to 1350 now and 1500 from
       * november" parked 1350 for November too, and the November park was checked
       * against today's 1300, so on the day it would find 1350 and be skipped
       * (fresh park run 2026-10-22). The later park expects the value after now.
       */
      if (nowValue != null) {
        for (const f of ['monthlyAmount', 'payableAmount']) {
          if (one[f] === undefined) continue;
          if (Number(one[f]) === nowValue) return { row, args: one, expect, who: '', what: '', same: false, isNow: true };
          if (expect[f] !== undefined) expect[f] = nowValue;
        }
      }
      const who = [row.person_name, row.company, row.group_name].filter(Boolean).join(' · ');
      // WHAT changes, beside WHEN: "Monthly amount 3500 → 3800", not a bare month.
      // A PARKED STOP SAYS "stop the deal": it read "company Reliapay
      // Employment → Reliapay Employment", the field that only found it.
      // Clone 2026-10-05.
      const what = check.spec.terminal ? 'stop the deal'
        : Object.keys(expect).map((f) => {
          // "add on 0% → 5%", not "addon percent 0.00 → 5".
          const pct = /Percent$/.test(f);
          const label = pct ? f.replace(/Percent$/, '').replace(/^addon$/, 'add on') : f.replace(/([A-Z])/g, ' $1').toLowerCase();
          const shown = (v) => (v == null || v === '' ? 'empty' : pct ? `${Number(v)}%` : v);
          return `${label} ${shown(expect[f])} → ${shown(one[f])}`;
        }).join(', ');
      // ALREADY SO: "cash → cash" was parked and called done (blind park run 2026-10-22).
      const same = !check.spec.terminal && Object.keys(expect).length > 0
        && Object.keys(expect).every((f) => String(expect[f] ?? '').toLowerCase() === String(one[f] ?? '').toLowerCase()
          || (Number.isFinite(Number(expect[f])) && expect[f] !== null && expect[f] !== '' && Number(expect[f]) === Number(one[f])));
      return { row, args: one, expect, who, what: what || tool.replace(/_/g, ' '), same };
    }).filter((p, _i, all) => !p.same || all.every((x) => x.same));
    if (plans.some((p) => p.isNow)) {
      return { summary: `NOT PARKED. ${nowValue} was asked for NOW, not a later month: make that change now with `
        + 'update_master_sheet_row (confirmed false, so it previews), and park only the later value for the later months.' };
    }
    if (plans.every((p) => p.same)) {
      return { summary: `NOTHING TO PARK: ${plans.map((p) => `${p.who} is already ${p.what.replace(/ → .*$/, '').replace(/^[a-z ]+ /, '')}`).join('; ')}. Say so plainly.` };
    }
    const single = plans.length === 1;
    const people = [...new Set(plans.map((p) => p.row.person_name))];
    const who = single ? plans[0].who : people.length > 1 ? people.join(' and ') : `${plans[0].row.person_name}'s ${plans.length} deals`;
    const what = single ? plans[0].what : plans.map((p) => `${p.who}: ${p.what}`).join('; ');
    const lines = months.flatMap((m) => (single
      ? [`  ${monthLabel(m)}: ${plans[0].what}`]
      : plans.map((p) => `  ${monthLabel(m)}: ${p.who}, ${p.what}`)));
    const needs = confirmFirst(rawArgs.confirmed, {
      act: `park this for ${who}, applied at the start of each month below`,
      count: months.length * plans.length,
      noun: single ? 'month' : 'change',
      // WORDED FOR HIM, because she reads it out: it once ended "so never
      // say only about the month", an instruction to her. 2026-10-04.
      keeps: check.spec.terminal
        ? 'Nothing changes now. The deal stops on the first sign-in of that month, if it still looks '
          + 'the way it does today, so this month is still paid.'
        : 'Nothing changes now. It is applied on the first sign-in of that month, if the deal still '
          + 'looks the way it does today, and the new value stays from then on.',
      lines,
    });
    /**
     * THE PREVIEW GOES OUT AS WRITTEN. Clone 2026-10-06: she said "from next
     * month ... nothing changes just yet", dropping the month and the from
     * figure, so the "yes" matched nothing it had been shown and nothing was
     * saved. A finished sentence, read to them as is.
     */
    /**
     * A MONTH NAME ALREADY PASSED THIS YEAR is next year's, and it is ASKED
     * (his call 2026-10-22): "put mara on 1150 for august", said in October,
     * reads "August 2026 has passed, so this is for August 2027".
     */
    const passed = pastMonthNamed(rawArgs.said, now, months);
    if (needs) {
      return {
        ...needs,
        ...(passed ? { summary: `${needs.summary}\n\nSAY FIRST: ${passed}` } : {}),
        reply: `${passed ? `${passed}\n\n` : ''}Here's what I'd save for later, for ${who}:\n\n${lines.map((l) => l.trim()).join('\n')}\n\n`
          + `Nothing changes now. ${check.spec.terminal ? 'The deal stops' : 'It is applied'} on the first `
          + 'sign-in of that month. Shall I save it?',
        computedReply: true,
        // WHO IT IS FOR, so a yes matches it when she words the preview herself
        // ("ok do it" re-previewed it, blind park run 2026-10-22).
        aimedAt: [...new Set(plans.map((p) => p.row.person_name).filter(Boolean))],
        // HELD AS SHOWN: the deal their words named, never the id she first sent.
        // The preview said Juno and the yes saved it on Kiran's deal (blind park run 2026-10-22).
        redirect: {
          name: 'park_for_month',
          args: {
            tool, months, ...(nowValue != null ? { afterNow: nowValue } : {}), args: plans.length === 1 ? { ...args, id: plans[0].row.id, ids: undefined } : { ...args, id: undefined, ids: plans.map((p) => p.row.id) },
          },
        },
      };
    }

    const saved = [];
    for (const month of months) {
      for (const plan of plans) {
        // eslint-disable-next-line no-await-in-loop
        const entry = await queue.park({
          dueMonth: month,
          tool,
          // ONE DEAL, BY ITS ID: Karin's row was saved naming Baker Jones as the
          // person when both were parked at once (blind park run 2026-10-22).
          args: plan.args?.id != null
            ? Object.fromEntries(Object.entries(plan.args).filter(([k]) => !['targetPerson', 'targetCompany', 'targetGroup', 'person'].includes(k)))
            : plan.args,
          expect: plan.expect,
          targetIds: [plan.row.id],
          // WHAT IT DOES, never their sentence: confirmed by "yes", the sentence was "yes".
          said: `${plan.who}: ${plan.what}`,
          // "MAKE IT DECEMBER INSTEAD" moves it rather than adding a second.
          anyMonth: single && months.length === 1 && INSTEAD.test(`${rawArgs.said ?? ''}\n${rawArgs.saidRecent ?? ''}`),
        });
        saved.push(entry);
      }
    }

    return {
      summary: `Parked for ${who}: ${months.map(monthLabel).join(', ')}. `
        + `Nothing has changed on the sheet. Each one is applied on the first sign in of its month, `
        + `and skipped if the deal has moved on by then. A value set then STAYS from that month on, `
        + `so never say "only". Say which months, with their YEARS, what changes, and say plainly `
        + `that nothing has changed yet. Speak normally; do not repeat this text.`,
      // ITS OWN FINISHED SENTENCE, so a yes needs no model round. Clone
      // 2026-10-05: left to her, the yes ended "keep it scheduled or
      // cancel it?" about the thing they had just agreed to.
      reply: check.spec.terminal && single && months.length === 1
        ? `Done. ${who} stops at the start of ${monthLabel(months[0])}, so ${monthLabel(shift(months[0], -1))} is still paid. Nothing has changed on the sheet yet.`
        : `Done. Saved for ${months.map(monthLabel).join(', ')}: ${what}. Nothing has changed on the sheet yet.`,
      computedReply: true,
      parked: saved.map((e) => ({ id: e.id, month: e.due_month })),
    };
  },
};

const listParked = {
  name: 'list_parked_work',
  description: 'What is PARKED for a later month and has not run yet, AND what already ran this month '
    + 'and last. Use for "what is parked", "what happens next month", "what did you schedule", and '
    + '"did the X change go through". The parked part is INTENTIONS, never current values: for what a '
    + 'deal is on today, read the row.',
  parameters: { type: 'object', properties: {} },
  async handler() {
    /**
     * AND WHAT ALREADY RAN. "Did Jason's raise go through?" had no answer:
     * this listed only what was waiting, and the outcome of a run lived on
     * the welcome page alone. This month's and last month's runs, each with
     * the sentence the runner wrote. 2026-10-04.
     */
    const now = currentMonth();
    const [y, m] = now.split('-').map(Number);
    const last = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
    const [rows, ranNow, ranLast] = await Promise.all([
      queue.upcoming(now), queue.ranIn(now).catch(() => []), queue.ranIn(last).catch(() => []),
    ]);
    const ran = [...ranLast, ...ranNow];
    const RAN_AS = { done: 'applied', skipped: 'skipped', failed: 'failed', expired: 'expired, never ran' };
    const ranLines = ran.map((r) => `  ${monthLabel(r.due_month)}: ${r.said}: ${RAN_AS[r.status] ?? r.status}`
      + `${r.outcome && r.status !== 'done' ? ` (${String(r.outcome).replace(/\s+/g, ' ').slice(0, 160)})` : ''}`);
    const ranBlock = ran.length > 0
      ? `\n\nALREADY RAN (${ran.length}), use this for "did it go through":\n${ranLines.join('\n')}`
      : '\n\nNothing parked has run this month or last.';
    if (rows.length === 0) {
      return { summary: `Nothing is parked for a later month.${ranBlock}\n\nAnswer what they asked in one or two sentences.` };
    }
    rows.forEach((r) => { r.said = whatItDoes(r); });
    const lines = rows.map((r) => `  ${monthLabel(r.due_month)}: ${r.said}`);
    /**
     * THE LIST IS THE ANSWER. Asked "what have I got scheduled?" she said
     * "You have one change parked" and never said what it was, though this
     * handed it to her. gpt-4.1 core suite, 2026-10-06. So the reply is
     * built here, every item with its month, and goes out as written.
     */
    const reply = `${rows.length === 1 ? 'One change is' : `${rows.length} changes are`} parked for later, `
      + `not applied yet:\n${rows.map((r) => `- ${monthLabel(r.due_month)}: ${r.said}`).join('\n')}`
      + (ran.length > 0 ? `\n\nAlready ran:\n${ran.map((r) => `- ${monthLabel(r.due_month)}: ${r.said}: ${RAN_AS[r.status] ?? r.status}`).join('\n')}` : '');
    return {
      summary: `${rows.length} parked, none of it applied yet:\n${lines.join('\n')}${ranBlock}\n\n`
        + 'The parked ones WILL happen at the start of their month; they are not true now. Do not '
        + 'describe any of them as done, and do not quote a figure from one as a current value.',
      reply,
      computedReply: true,
    };
  },
};

/**
 * `when` on every change that can be parked. She says WHEN in her own words
 * and code decides: now runs as ever, a later month goes to park_for_month.
 */
const WHEN_FIELDS = {
  when: {
    type: 'string',
    description: 'WHEN this change applies, in their words: "now" (default), "next month", "November", '
      + '"2026-12". A later month SAVES it for that month and changes nothing now. Set it whenever '
      + 'they said a later month ("from next month", "starting November"). A month that is the VALUE '
      + 'being set ("preset to November") is not a when.',
  },
  forMonths: {
    type: 'number',
    description: 'How many months in a row from `when`. "for the next 3 months" is when "next month", forMonths 3.',
  },
};

/**
 * A deal named, not numbered: find its id the way the edit does. Only when
 * it comes down to ONE deal; otherwise null, and she looks it up first.
 */
async function dealIdFor(args, said) {
  if (args.id != null || !args.targetPerson) return args.id ?? null;
  const { resolvePerson, fold } = require('./resolvePerson');
  const found = await rowsRepo.searchFuzzy({ q: args.targetPerson, group: args.targetGroup });
  const person = resolvePerson(found, args.targetPerson, said);
  if (person.ambiguous || !person.matched) return null;
  const has = (value, want) => !want || fold(value).includes(fold(want));
  // A GROUP SENT AS THE COMPANY still finds the deal: "gloria's nexus deal"
  // came as targetCompany "Nexus" and was never found, so she went round
  // in circles guessing ids. 2026-10-03.
  const rows = person.rows.filter((r) => !r.stopped_on
    && (has(r.company, args.targetCompany) || has(r.group_name, args.targetCompany))
    && has(r.group_name, args.targetGroup) && has(r.role_label, args.targetRole));
  return rows.length === 1 ? rows[0].id : null;
}

/** "August 2026 has passed, so this is for August 2027." when a bare month name rolled to next year; else null. */
/** Did their words ADD this figure ("+100", "up by 100", "100 more", "raise 100")? */
function saidAsAdded(said, n) {
  if (!Number.isFinite(n)) return true;
  const text = String(said ?? '').toLowerCase().replace(/,(?=\d{3}\b)/g, '');
  const num = String(Math.abs(n)).replace('.', '\\.');
  if (!new RegExp(`(?<![\\d.])${num}(?![\\d.])`).test(text)) return true;
  return new RegExp(`[+-]\\s*(?:gbp|aed|usd|eur|£|\\$)?\\s*${num}(?![\\d.])`
    + `|\\b(?:up|down|add|adds|adding|raise\\w*|increase\\w*|bump\\w*|plus|extra|another|drop\\w*|cut|lower\\w*|reduce\\w*)\\s+(?:it\\s+|him\\s+|her\\s+|them\\s+)?(?:by\\s+)?(?:an?\\s+)?(?:extra\\s+)?(?:gbp|aed|usd|eur|£|\\$)?\\s*${num}(?![\\d.])`
    + `|\\bby\\s+(?:an?\\s+)?(?:extra\\s+)?(?:gbp|aed|usd|eur|£|\\$)?\\s*${num}(?![\\d.])`
    + `|(?<![\\d.])${num}\\s+(?:more|extra|on top|up|less)\\b`).test(text);
}

function pastMonthNamed(said, now, months) {
  const text = String(said ?? '').toLowerCase();
  if (/\b20\d\d\b|\bnext year\b/.test(text)) return null;
  const [ny] = String(now).split('-').map(Number);
  for (const m of months) {
    const [y, mm] = String(m).split('-').map(Number);
    const name = MONTH_NAMES[mm - 1];
    const [, nm] = String(now).split('-').map(Number);
    // Only a month just gone is unclear: "january" said in October is plainly next year's.
    if (y > ny && nm - mm >= 1 && nm - mm <= 6 && new RegExp(`\\b${name.slice(0, 3).toLowerCase()}[a-z]*\\b`).test(text) && `${ny}-${String(mm).padStart(2, '0')}` < now) {
      return `${name} ${ny} has passed, so this is for ${name} ${y}.`;
    }
  }
  return null;
}

/**
 * The live deals of the ONE person their words name, narrowed by a company or
 * group also named. A first name, a full name, or a name one letter short
 * ("otto fen") counts; two people named gives none (the model's id stands).
 */
async function dealsSaid(said) {
  // Spaces kept: resolvePerson's fold joins the words ("junopark").
  const fold = (v) => String(v ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const pool = require('../../../configs/db');
  const text = ` ${fold(said).replace(/'s\b/g, '').replace(/[^a-z0-9 ]+/g, ' ')} `;
  const words = text.trim().split(/\s+/);
  const { rows } = await pool.query('SELECT id, person_name, company, group_name FROM tb_mastersheet WHERE stopped_on IS NULL').catch(() => ({ rows: [] }));
  const nameHit = (name) => {
    const parts = fold(name).split(/\s+/).filter(Boolean);
    if (text.includes(` ${parts.join(' ')} `)) return 2;
    const first = parts[0];
    if (!first || first.length < 3) return 0;
    return words.some((w) => w === first || w === `${first}s` || (w.length >= 3 && first.startsWith(w) && first.length - w.length <= 1)) ? 1 : 0;
  };
  const scored = rows.map((r) => ({ r, s: nameHit(r.person_name) })).filter((x) => x.s > 0);
  const best = Math.max(0, ...scored.map((x) => x.s));
  const people = [...new Set(scored.filter((x) => x.s === best).map((x) => x.r.person_name))];
  if (people.length !== 1) {
    // Every named person's live deals, narrowed by a company or group named.
    let all = rows.filter((r) => people.includes(r.person_name));
    const namedAll = all.filter((r) => [r.company, r.group_name].some((v) => v && text.includes(` ${fold(v).split(/\s+/)[0]} `)));
    if (namedAll.length) all = namedAll;
    return { people, rows: [], all };
  }
  let mine = rows.filter((r) => r.person_name === people[0]);
  const named = mine.filter((r) => [r.company, r.group_name].some((v) => v && text.includes(` ${fold(v).split(/\s+/)[0]} `)));
  if (named.length) mine = named;
  return { people, rows: mine, all: mine };
}

function withWhen(tools) {
  const { PARKABLE } = require('../scheduled/parkable');
  return tools.map((t) => (PARKABLE[t.name]
    ? { ...t, parameters: { ...t.parameters, properties: { ...t.parameters.properties, ...WHEN_FIELDS } } }
    : t));
}

/**
 * ===============================
 * * CALLING OFF WHAT WAS PARKED
 * ===============================
 * Live 2026-10-03: "actually cancel the gloria one" had no door. She said
 * "there is no scheduled bump on that deal, so nothing to cancel" while it
 * sat in the queue for November. Picked by their words against what each
 * entry does, previewed, and called off on a yes. Only a parked entry: one
 * that already ran is undone with the undo, not here.
 */
const cancelParked = {
  name: 'cancel_parked_work',
  writes: true,
  description:
    'CALL OFF something PARKED for a later month before it runs. Use for "cancel the November '
    + 'bump", "don\'t do the Blake Example one", "scrap what is scheduled for Northstar Care". Name it with '
    + '`match` (the person, company or change, as they said it) or `id` from list_parked_work. '
    + 'First call previews; call again with confirmed true after they say yes.',
  parameters: {
    type: 'object',
    properties: {
      match: { type: 'string', description: 'Their words for which one: a person, a company or the change.' },
      id: { type: 'number', description: 'The parked id, when already known from list_parked_work.' },
      ids: { type: 'array', items: { type: 'number' }, description: 'Several parked ids, from list_parked_work.' },
      confirmed: { type: 'boolean' },
    },
  },
  async handler(args = {}) {
    const parked = await queue.upcoming(currentMonth());
    if (parked.length === 0) return { summary: 'Nothing is parked, so there is nothing to call off. Say so.' };
    const words = String(args.match ?? args.said ?? '').toLowerCase()
      .split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(?:the|one|cancel|scrap|that|this|don|dont|for|and|actually|parked|scheduled|change|bump)$/.test(w));
    // Several by id, when she has them from list_parked_work.
    const ids = Array.isArray(args.ids) ? args.ids.map(Number) : null;
    let picked = ids ? parked.filter((p) => ids.includes(Number(p.id)))
      : args.id != null
      ? parked.filter((p) => Number(p.id) === Number(args.id))
      : parked.filter((p) => words.length > 0 && words.some((w) => String(p.said ?? '').toLowerCase().includes(w)));
    const listing = parked.map((p) => `#${p.id} ${monthLabel(p.due_month)}: ${p.said}`).join('\n');
    if (picked.length === 0) {
      return {
        summary: `NOTHING WAS CALLED OFF: no parked entry matches that. What IS parked:\n${listing}\n`
          + 'Say what is parked and ask which one. Never say nothing is parked when the list above has entries.',
      };
    }
    /**
     * ONE ACT PARKED AS SEVERAL ENTRIES is called off as one: "add 5% to
     * kiran's deals" is an entry per deal, and "cancel kiran's add on" asked
     * which of three, then deadlocked on "yes". Same person, same change,
     * or they said all of them. 2026-10-05.
     */
    const personOf = (p) => String(p.said ?? '').split(/ · |: /)[0].trim().toLowerCase();
    /**
     * THE PERSON THEY SAID NARROWS IT. "cancel the mara one" came as match
     * "BAKER", three entries in that group matched, and it asked which. Their
     * own words name one person: when exactly one person's entries are among
     * the matches, those are the ones. gpt-4.1 core suite, 2026-10-06.
     */
    if (picked.length > 1) {
      // THEIR LAST TWO MESSAGES, not the last alone: on the yes the last is
      // "yes", and "the mara one" before it is what narrowed it. Without it
      // two entries in BAKER matched and the yes asked which (suite 2026-10-13).
      const heard = `${args.said ?? ''} ${args.saidRecent ?? ''}`.toLowerCase();
      const people = [...new Set(picked.map(personOf))]
        .filter((who) => who && heard.split(/[^a-z0-9']+/).some((w) => w.length >= 3 && who.split(/\s+/).includes(w.replace(/'s$/, ''))));
      if (people.length === 1) picked = picked.filter((p) => personOf(p) === people[0]);
    }
    const changeOf = (p) => String(p.said ?? '').slice(String(p.said ?? '').indexOf(': ') + 2).trim().toLowerCase();
    const oneAct = picked.length > 1 && (/\b(?:all|both|every|them|those|these)\b/i.test(String(args.said ?? args.match ?? ''))
      || (new Set(picked.map(personOf)).size === 1 && new Set(picked.map(changeOf)).size === 1));
    if (oneAct) {
      const needs = confirmFirst(args.confirmed, {
        act: 'call off these parked changes, so they never run',
        count: picked.length,
        noun: 'parked change',
        lines: picked.map((p) => `${monthLabel(p.due_month)}: ${p.said}`),
        identity: `call off parked #${picked.map((p) => p.id).join(',')}`,
      });
      if (needs) return needs;
      const gone = [];
      for (const p of picked) {
        // eslint-disable-next-line no-await-in-loop
        if (await queue.cancel(p.id)) gone.push(p);
      }
      if (gone.length === 0) return { summary: 'Those have already run or been called off. Nothing was changed. Say so.' };
      const reply = `Called off ${gone.length} parked ${gone.length === 1 ? 'change' : 'changes'}: `
        + `${gone.map((p) => `${p.said} (due 1 ${monthLabel(p.due_month)})`).join('; ')}. Nothing on the sheet changed.`;
      return { summary: reply, reply, computedReply: true };
    }
    if (picked.length > 1) {
      return {
        summary: `NOTHING WAS CALLED OFF: ${picked.length} parked entries match:\n`
          + `${picked.map((p) => `#${p.id} ${monthLabel(p.due_month)}: ${p.said}`).join('\n')}\nAsk which one.`,
        ambiguous: true,
      };
    }
    const [one] = picked;
    const needs = confirmFirst(args.confirmed, {
      act: 'call off this parked change, so it never runs',
      count: 1,
      noun: 'parked change',
      lines: [`${monthLabel(one.due_month)}: ${one.said}`],
      identity: `call off parked #${one.id}`,
    });
    if (needs) return needs;
    const gone = await queue.cancel(one.id);
    if (!gone) return { summary: 'That one has already run or been called off. Nothing was changed. Say so.' };
    const reply = `Called off: ${one.said}, which was due on 1 ${monthLabel(one.due_month)}. Nothing on the sheet changed.`;
    return { summary: reply, reply, computedReply: true };
  },
};

/**
 * WHAT A PARKED CHANGE DOES, in words, from what it will write. One saved
 * before 2026-10-07 can read only "update master sheet deal": asked "what's
 * the change about?" she listed it again, word for word. The stored values
 * say it, so they are read back.
 */
const SKIP_ARGS = new Set(['id', 'ids', 'confirmed', 'when', 'targetPerson', 'targetCompany', 'targetGroup', 'said', 'handedOver']);
function whatItDoes(row) {
  const said = String(row.said ?? '');
  if (/→|stop the deal/.test(said)) return said;
  const args = typeof row.args === 'string' ? JSON.parse(row.args) : (row.args ?? {});
  const label = (f) => f.replace(/Delta$/, '').replace(/([A-Z])/g, ' $1').toLowerCase();
  const bits = [];
  for (const [k, v] of Object.entries(args)) {
    if (SKIP_ARGS.has(k) || v == null) continue;
    if (k === 'add' && typeof v === 'object') {
      for (const [f, by] of Object.entries(v)) bits.push(`${label(f)} ${Number(by) >= 0 ? '+' : ''}${by} (on its value then)`);
    } else if (/Delta$/.test(k)) bits.push(`${label(k)} ${Number(v) >= 0 ? '+' : ''}${v} (on its value then)`);
    else if (typeof v !== 'object') bits.push(`${label(k)} → ${v}`);
  }
  const who = said.split(':')[0];
  return bits.length ? `${who}: ${bits.join(', ')}` : said;
}

module.exports = {
  parkForMonth, listParked, cancelParked, monthsFor, monthLabel, withWhen, dealIdFor, dealsSaid, whatItDoes, scheduledTools: [parkForMonth, listParked, cancelParked],
};
