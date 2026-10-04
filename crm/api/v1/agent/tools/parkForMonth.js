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
    + 'NOW, call the ordinary tool instead.',
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
    },
    required: ['tool', 'args'],
  },

  // IT CHANGES DATA — the queue, not the sheet. Still a write: a parked
  // row will act on its own later, and that is a thing that happened.
  writes: true,

  async handler(rawArgs = {}) {
    const now = currentMonth();
    const { tool, args = {} } = rawArgs;

    const check = checkParkable(tool, args);
    if (!check.ok) return { summary: check.why };

    const months = monthsFor(rawArgs, now);
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
      const companies = [].concat(args[check.spec.idField] ?? []).map(String).filter(Boolean);
      const act = args.status === 'dissolved' ? 'dissolve' : args.status === 'active' ? 'reopen' : 'close';
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

    const rowId = Number(args[check.spec.idField]);
    const row = Number.isInteger(rowId) ? await rowsRepo.findById(rowId) : null;
    if (!row) {
      return { summary: 'That deal is not there, so there is nothing to park. Find it first.' };
    }

    const who = [row.person_name, row.company, row.group_name].filter(Boolean).join(' · ');

    /**
     * THE WORLD AS IT IS NOW, so the runner can tell whether it still
     * matches. Only the fields being written: a snapshot of everything
     * would skip on any unrelated edit.
     */
    const expect = {};
    for (const field of Object.keys(args)) {
      const column = rowsRepo.COLUMN_FOR[field];
      if (column) expect[field] = row[column];
    }

    // WHAT changes, beside WHEN: "Monthly amount 3500 → 3800", not a bare month.
    const what = Object.keys(expect).map((f) => `${f.replace(/([A-Z])/g, ' $1').toLowerCase()} ${expect[f] ?? 'empty'} → ${args[f]}`).join(', ');
    const lines = months.map((m) => `  ${monthLabel(m)}: ${what || tool.replace(/_/g, ' ')}`);
    const needs = confirmFirst(rawArgs.confirmed, {
      act: `park this for ${who}, applied at the start of each month below`,
      count: months.length,
      noun: 'month',
      // WORDED FOR HIM, because she reads it out: it once ended "so never
      // say only about the month", an instruction to her. 2026-10-04.
      keeps: 'Nothing changes now. It is applied on the first sign-in of that month, if the deal still '
        + 'looks the way it does today, and the new value stays from then on.',
      lines,
    });
    if (needs) return needs;

    // WHAT IT DOES, never their sentence: confirmed by "yes", the sentence was "yes".
    const said = `${who}: ${what || tool.replace(/_/g, ' ')}`;
    const saved = [];
    for (const month of months) {
      // eslint-disable-next-line no-await-in-loop
      const entry = await queue.park({
        dueMonth: month,
        tool,
        args,
        expect,
        targetIds: [rowId],
        said,
        // "MAKE IT DECEMBER INSTEAD" moves it rather than adding a second.
        anyMonth: months.length === 1 && INSTEAD.test(`${rawArgs.said ?? ''}\n${rawArgs.saidRecent ?? ''}`),
      });
      saved.push(entry);
    }

    return {
      summary: `Parked for ${who}: ${months.map(monthLabel).join(', ')}. `
        + `Nothing has changed on the sheet. Each one is applied on the first sign in of its month, `
        + `and skipped if the deal has moved on by then. A value set then STAYS from that month on, `
        + `so never say "only". Say which months, with their YEARS, what changes, and say plainly `
        + `that nothing has changed yet. Speak normally; do not repeat this text.`,
      parked: saved.map((e) => ({ id: e.id, month: e.due_month })),
    };
  },
};

const listParked = {
  name: 'list_parked_work',
  description: 'What is PARKED for a later month and has not run yet. Use for "what is parked", '
    + '"what happens next month", "what did you schedule". It is a list of INTENTIONS, never '
    + 'current values: for what a deal is on today, read the row.',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const rows = await queue.upcoming(currentMonth());
    if (rows.length === 0) {
      return { summary: 'Nothing is parked for a later month. Say so in one sentence.' };
    }
    const lines = rows.map((r) => `  ${monthLabel(r.due_month)}: ${r.said}`);
    return {
      summary: `${rows.length} parked, none of it applied yet:\n${lines.join('\n')}\n\n`
        + 'These are things that WILL happen at the start of their month, not things that are true '
        + 'now. Do not describe any of it as done, and do not quote a figure from it as a current '
        + 'value.',
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
    + 'bump", "don\'t do the gloria one", "scrap what is scheduled for relia pa". Name it with '
    + '`match` (the person, company or change, as they said it) or `id` from list_parked_work. '
    + 'First call previews; call again with confirmed true after they say yes.',
  parameters: {
    type: 'object',
    properties: {
      match: { type: 'string', description: 'Their words for which one: a person, a company or the change.' },
      id: { type: 'number', description: 'The parked id, when already known from list_parked_work.' },
      confirmed: { type: 'boolean' },
    },
  },
  async handler(args = {}) {
    const parked = await queue.upcoming(currentMonth());
    if (parked.length === 0) return { summary: 'Nothing is parked, so there is nothing to call off. Say so.' };
    const words = String(args.match ?? args.said ?? '').toLowerCase()
      .split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(?:the|one|cancel|scrap|that|this|don|dont|for|and|actually|parked|scheduled|change|bump)$/.test(w));
    const picked = args.id != null
      ? parked.filter((p) => Number(p.id) === Number(args.id))
      : parked.filter((p) => words.length > 0 && words.some((w) => String(p.said ?? '').toLowerCase().includes(w)));
    const listing = parked.map((p) => `#${p.id} ${monthLabel(p.due_month)}: ${p.said}`).join('\n');
    if (picked.length === 0) {
      return {
        summary: `NOTHING WAS CALLED OFF: no parked entry matches that. What IS parked:\n${listing}\n`
          + 'Say what is parked and ask which one. Never say nothing is parked when the list above has entries.',
      };
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

module.exports = {
  parkForMonth, listParked, cancelParked, monthsFor, monthLabel, withWhen, dealIdFor, scheduledTools: [parkForMonth, listParked, cancelParked],
};
