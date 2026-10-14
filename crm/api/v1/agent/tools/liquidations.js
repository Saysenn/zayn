const repo = require('../../repos/liquidations.repo');
const undoRepo = require('../../repos/agentUndo.repo');
const { resolveCompanies } = require('./companies');
const companiesRepo = require('../../repos/companies.repo');
const { confirmFirst } = require('./confirmFirst');
const { broadcast } = require('../../sockets/index');
const { currentDay } = require('../../shared/presetMonth.helper');
const { dayFrom, sayDay } = require('../../shared/dayWords.helper');
const { moveAside, moveBack, storeDoc } = require('../../shared/liquidationDocs.helper');
const { money } = require('../../shared/money.helper');
const logger = require('../../../configs/logger');

// ***************************************************
// * THE LIQUIDATIONS PAGE, FOR DIANE (his call 2026-10-13, docs/diane.md D)
// ***************************************************
//
// Three tools, so the list she is handed grows by three, not ten:
//   list_liquidations     read: the page, filtered, or one company in full
//   update_liquidation    write: any field on one or many, a contact line,
//                         and undo
//   liquidation_document  send one back in chat, or remove one
//
// THE SAME CODE THE PAGE USES (liquidations.repo), so the two can never
// disagree. A company is on the page because its status is liquidation;
// she never adds one here, and the stage never moves the status.
//
// MESSY IN, CLEAN OUT, the expense brain's way: she reads the request into
// items; CODE resolves every company ("did you mean"), every day word
// ("Friday" is a date here, not hers to work out), every stage and owner,
// and shows one numbered preview. Nothing is written before yes, every
// write is read back, and the whole act is one undo.

const BY = 'Diane';
const MAX_ROWS = 40;

const STAGE_LABEL = {
  own_liq: 'Own liq', hmrc_liq: 'HMRC liq', strike_off: 'Strike off',
  strike_off_rejected: 'Strike off rejected', dissolved: 'Dissolved', active: 'Active',
};
const stageName = (s) => (s ? STAGE_LABEL[s] ?? s : 'Not set');
// Their words for a stage, folded to the stored value.
const STAGE_WORDS = [
  [/^(?:not set|none|unset|clear|blank)$/, null],
  [/hmrc/, 'hmrc_liq'],
  [/reject/, 'strike_off_rejected'],
  [/strike/, 'strike_off'],
  [/own|ours|our|voluntary|cvl|mvl/, 'own_liq'],
  [/dissolv/, 'dissolved'],
  [/^active$/, 'active'],
];
function stageFrom(said) {
  const t = String(said ?? '').trim().toLowerCase().replace(/_/g, ' ');
  if (STAGE_LABEL[t.replace(/ /g, '_')]) return t.replace(/ /g, '_');
  for (const [re, value] of STAGE_WORDS) if (re.test(t)) return value;
  return undefined;
}

const FIELD_LABEL = {
  stage: 'stage', deadline: 'deadline', nextAction: 'next action', instructions: 'instructions',
  owner: 'owner', blamed: 'blamed', liquidator: 'liquidator', note: 'note',
};
const COLUMN = {
  stage: 'stage', deadline: 'deadline', nextAction: 'next_action', instructions: 'instructions',
  owner: 'owner', blamed: 'blamed', liquidator: 'liquidator', note: 'note',
};
const show = (field, v) => {
  if (v === null || v === undefined || v === '') return field === 'stage' ? 'Not set' : '—';
  if (field === 'stage') return stageName(v);
  if (field === 'deadline') return sayDay(String(v).slice(0, 10));
  if (field === 'blamed') return v ? 'yes' : 'no';
  return `"${String(v).length > 60 ? `${String(v).slice(0, 57)}…` : v}"`;
};

const fold = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
// THE NAME WITHOUT ITS LEGAL ENDING: "zz harbour test" is "ZZ Harbour Test Ltd"
// (browser check 2026-10-13: she said there was no such company).
const bare = (s) => fold(s).replace(/[.,]/g, '').replace(/\s+(?:ltd|limited|plc|llp|llc|inc|co)$/, '').trim();
const sameCompany = (r, name) => {
  const key = fold(name);
  return r.company_key === key || fold(r.company_name) === key || (bare(name) !== '' && bare(r.company_name) === bare(name));
};

/** How near a deadline is, in words a person says. */
function nearness(deadline, today) {
  if (!deadline) return '';
  const days = Math.round((Date.parse(String(deadline).slice(0, 10)) - Date.parse(today)) / 86_400_000);
  if (days < 0) return ` (passed ${-days} ${days === -1 ? 'day' : 'days'} ago)`;
  if (days === 0) return ' (today)';
  return days <= 7 ? ` (in ${days} ${days === 1 ? 'day' : 'days'})` : '';
}

function line(r, today) {
  const bits = [
    `${r.company_name}: ${stageName(r.stage)}`,
    r.deadline ? `deadline ${sayDay(String(r.deadline).slice(0, 10))}${nearness(r.deadline, today)}` : 'no deadline',
    r.owner ? `owner ${r.owner}` : null,
    r.director ? `director ${r.director}` : null,
    r.mid ? `mid ${r.mid}` : null,
    (r.groups ?? []).length ? (r.groups ?? []).join('/') : null,
    r.next_action ? `next: ${r.next_action}` : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

/** One letter added, dropped or changed. */
function near(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}

/**
 * Company names to the page's rows, matched against THE PAGE first: a
 * company in liquidation may have no deals, and the sheet's company list
 * would call it unknown. A real company not on the page says so; anything
 * else gets "did you mean" from the page and the sheet both.
 */
async function rowsFor(names, said) {
  const rows = await repo.list();
  const found = [];
  const unknown = [];
  for (const name of names ?? []) {
    const hit = rows.find((r) => sameCompany(r, name));
    if (hit) { if (!found.includes(hit)) found.push(hit); } else unknown.push(String(name ?? '').trim());
  }
  const notOnPage = [];
  const missing = [];
  const corrections = [];
  if (unknown.length) {
    // A company with no deals is only in tb_companies: found by its key.
    for (const name of [...unknown]) {
      // eslint-disable-next-line no-await-in-loop
      const company = await companiesRepo.findByKey(name).catch(() => null);
      if (company) { notOnPage.push(company.name); unknown.splice(unknown.indexOf(name), 1); }
    }
  }
  if (unknown.length) {
    const sheet = await resolveCompanies(unknown, said ?? '');
    notOnPage.push(...sheet.found.map((f) => f.name));
    for (const name of unknown.filter((n) => !sheet.found.some((f) => f.key === fold(n)))) {
      const close = rows.filter((r) => near(fold(r.company_name), fold(name))).map((r) => r.company_name);
      if (close.length) corrections.push(`No company called "${name}" on the Liquidations page. Did you mean ${close.join(' or ')}?`);
      else missing.push(name);
    }
    if (!corrections.length && sheet.corrections.length && missing.length) corrections.push(...sheet.corrections);
  }
  return { rows: found, missing, corrections, notOnPage, all: rows };
}

function problems({ missing, corrections, notOnPage }) {
  const out = [];
  if (corrections.length) out.push(...corrections);
  else if (missing.length) out.push(`No company called ${missing.map((m) => `"${m}"`).join(', ')}.`);
  if (notOnPage.length) {
    out.push(`${notOnPage.join(', ')} ${notOnPage.length === 1 ? 'is' : 'are'} not in liquidation, so not on the Liquidations page. `
      + 'A company goes on it when its status is set to liquidation (update_company); offer that, do not change anything else.');
  }
  return out.length ? `NOTHING HAS BEEN CHANGED. ${out.join(' ')}` : null;
}

// ===============================
// * READ
// ===============================
const listLiquidations = {
  name: 'list_liquidations',
  description:
    'The Liquidations page: every company whose status is liquidation, with its stage, deadline, owner, '
    + 'director, mid, next action. Filter by stage, group, owner or deadline ("due this week", "passed"). '
    + 'Name ONE company to get it in full: instructions, liquidator, note, blamed, settlement, its '
    + 'contact log, stage history and documents.',
  parameters: {
    type: 'object',
    properties: {
      company: { type: 'string', description: 'One company, for its full row.' },
      stage: { type: 'string', description: 'own liq, HMRC liq, strike off, strike off rejected, dissolved, active, or not set.' },
      group: { type: 'string' },
      owner: { type: 'string', description: 'An admin username, or "none".' },
      due: { type: 'string', enum: ['week', 'passed'], description: 'week: passed or due in the next 7 days. passed: already passed.' },
    },
  },
  async handler(args = {}) {
    const today = currentDay();
    if (args.company) {
      const { rows, ...rest } = await rowsFor([args.company], args.said);
      const stop = problems({ ...rest, notOnPage: rest.notOnPage });
      if (stop) return { summary: stop.replace('NOTHING HAS BEEN CHANGED. ', '') };
      const r = rows[0];
      const d = await repo.details(r.id);
      const lines = [
        line(r, today),
        // "none", never "—": her dash rule turns a dash into ", " and the
        // empty note read "Note:, No settlement set." (browser 2026-10-13).
        `Instructions: ${r.instructions || 'none'}`,
        `Liquidator: ${r.liquidator || 'none'} · Blamed: ${r.blamed ? 'yes' : 'no'}`,
        `Note: ${r.note || 'none'}`,
        r.settlement != null ? `Settlement ${r.currency ?? ''} ${money(r.settlement)}, ${r.currency ?? ''} ${money(r.allocated ?? 0)} a month allocated to its live deals.` : 'No settlement set.',
        `Contact log (${d.comms.length}):${d.comms.length ? '' : ' none'}`,
        // "•", a real bullet: stripMarkdown takes "- " and "1." off a reply
        // (his screenshot 2026-10-13: the list had no bullets at all).
        ...d.comms.slice(0, 8).map((c) => `• ${sayDay(String(c.said_on).slice(0, 10))}: ${c.body}`),
        `Documents (${d.docs.length}):${d.docs.length ? ', open them with View documents' : ' none'}`,
        ...d.docs.map((x) => `• ${x.file_name} (${READ_WORD[x.read_status] ?? x.read_status})`),
        `Stage history:${d.history.length ? '' : ' no changes'}`,
        ...d.history.slice(0, 6).map((h) => `• ${stageName(h.from_stage)} → ${stageName(h.to_stage)}, ${sayDay(new Date(h.changed_at).toISOString().slice(0, 10))}${h.by_user ? `, by ${h.by_user}` : ''}`),
      ];
      const reply = lines.join('\n');
      // EVERY DOCUMENT A CHIP, so the list can be opened (his call 2026-10-13).
      return { summary: reply, reply, computedReply: true, files: d.docs.map((x) => docView(r.id, x)) };
    }
    let rows = await repo.list();
    const want = args.stage !== undefined && args.stage !== '' ? stageFrom(args.stage) : undefined;
    if (args.stage && want === undefined) return { summary: `"${args.stage}" is not a stage. The stages are: ${Object.values(STAGE_LABEL).join(', ')}, or not set.` };
    if (args.stage) rows = rows.filter((r) => (r.stage ?? null) === want);
    if (args.group) rows = rows.filter((r) => (r.groups ?? []).some((g) => fold(g) === fold(args.group)));
    if (args.owner) rows = rows.filter((r) => (fold(args.owner) === 'none' ? !r.owner : fold(r.owner) === fold(args.owner)));
    if (args.due) {
      rows = rows.filter((r) => {
        if (!r.deadline || r.stage === 'dissolved') return false;
        const days = Math.round((Date.parse(String(r.deadline).slice(0, 10)) - Date.parse(today)) / 86_400_000);
        return args.due === 'passed' ? days < 0 : days <= 7;
      });
    }
    const scope = [args.stage && stageName(want), args.group, args.owner && `owner ${args.owner}`, args.due === 'week' ? 'deadline passed or due this week' : args.due === 'passed' ? 'deadline passed' : null].filter(Boolean).join(', ');
    if (rows.length === 0) {
      const reply = `No companies in liquidation${scope ? ` (${scope})` : ''}.`;
      return { summary: reply, reply, computedReply: true };
    }
    const reply = `${rows.length} ${rows.length === 1 ? 'company' : 'companies'} in liquidation${scope ? ` (${scope})` : ''}:\n`
      + rows.slice(0, MAX_ROWS).map((r) => `• ${line(r, today)}`).join('\n')
      + (rows.length > MAX_ROWS ? `\n…and ${rows.length - MAX_ROWS} more on the Liquidations page.` : '');
    return { summary: reply, reply, computedReply: true };
  },
};

// ===============================
// * WRITE
// ===============================

/** One item's words to stored values, or the reason it cannot be. */
async function cleanItem(item, today, owners) {
  const set = {};
  const why = [];
  if (item.stage !== undefined) {
    const s = stageFrom(item.stage);
    if (s === undefined) why.push(`"${item.stage}" is not a stage`);
    else set.stage = s;
  }
  if (item.deadline !== undefined) {
    if (item.deadline === null || /^(?:none|clear|no deadline|remove)$/i.test(String(item.deadline).trim())) set.deadline = null;
    else {
      const d = dayFrom(item.deadline, today);
      if (!d) why.push(`"${item.deadline}" is not a day I can be sure of`);
      else set.deadline = d;
    }
  }
  for (const f of ['nextAction', 'instructions', 'liquidator', 'note']) {
    if (item[f] !== undefined && item[f] !== null) set[f] = String(item[f]).trim().slice(0, 4000);
  }
  if (item.blamed !== undefined && item.blamed !== null) set.blamed = Boolean(item.blamed);
  if (item.owner !== undefined) {
    if (item.owner === null || /^(?:none|nobody|no one|clear)$/i.test(String(item.owner).trim())) set.owner = null;
    else {
      const o = owners.find((x) => fold(x) === fold(item.owner));
      if (!o) why.push(`"${item.owner}" is not one of the admins (${owners.join(', ')})`);
      else set.owner = o;
    }
  }
  let log = null;
  if (item.log && String(item.log).trim()) {
    const on = item.logDate ? dayFrom(item.logDate, today) : today;
    if (!on) why.push(`"${item.logDate}" is not a day I can be sure of`);
    else log = { body: String(item.log).trim().slice(0, 4000), saidOn: on };
  }
  return { set, log, why };
}

const ITEM = {
  type: 'object',
  properties: {
    company: { type: 'string', description: 'As they named it.' },
    stage: { type: 'string', description: 'own liq, HMRC liq, strike off, strike off rejected, dissolved, active, or not set.' },
    deadline: { type: 'string', description: 'THEIR WORDS ("Friday", "30 Nov", "end of month"), or "none". Never work the date out yourself.' },
    nextAction: { type: 'string' },
    instructions: { type: 'string', description: 'The current instructions.' },
    owner: { type: 'string', description: 'An admin username, or "none".' },
    blamed: { type: 'boolean' },
    liquidator: { type: 'string' },
    note: { type: 'string' },
    log: { type: 'string', description: 'A line for its contact log: who said what.' },
    logDate: { type: 'string', description: 'When that contact was, in their words. Leave out for today.' },
  },
  required: ['company'],
};

const updateLiquidation = {
  name: 'update_liquidation',
  writes: true,
  description:
    'Change companies on the Liquidations page: stage, deadline, next action, instructions, owner, blamed, '
    + 'liquidator, note, and add contact log lines. ONE CALL FOR THE WHOLE REQUEST, however messy: one item per '
    + 'company, every change for it in that item. For the same change to many, use `where` and `set`. '
    + 'Pass their words; code works out dates and names. Call with confirmed false first and show the lines; '
    + 'true only after yes. `undo` true puts back the last change you made here AT ONCE (no confirm). '
    + '"Every company in liquidation" is `where` {} with `set`. It never puts a company on '
    + 'or off the page: that is its status (update_company).',
  parameters: {
    type: 'object',
    properties: {
      items: { type: 'array', items: ITEM },
      where: {
        type: 'object',
        description: 'Every company on the page matching ALL of these, for the same change to many.',
        properties: { group: { type: 'string' }, stage: { type: 'string' }, owner: { type: 'string' } },
      },
      set: { ...ITEM, required: [], description: 'The change for every company `where` matches.' },
      undo: { type: 'boolean' },
      confirmed: { type: 'boolean', description: 'False first, which changes nothing. True only after they said yes.' },
    },
  },
  async handler(args = {}) {
    if (args.undo) return undoLiquidations();
    const today = currentDay();
    const owners = await repo.owners();

    // Who, and what for each.
    let targets = [];
    // "EVERY COMPANY" said as one item with no name, or "all": the same as where {}.
    const ALL = /^\s*(?:\*|all|every(?:one|thing)?|all (?:of )?(?:them|companies|the companies)|every company(?: in liquidation| on the page)?|all (?:the )?liquidations)?\s*$/i;
    if (Array.isArray(args.items) && args.items.length === 1 && ALL.test(String(args.items[0].company ?? '')) && !args.where) {
      const { company, ...rest } = args.items[0];
      args = { ...args, items: undefined, where: {}, set: rest };
    }
    if (Array.isArray(args.items) && args.items.length) {
      const { rows, ...rest } = await rowsFor(args.items.map((i) => i.company), args.said);
      const stop = problems(rest);
      if (stop) return { summary: stop };
      const byName = new Map();
      for (const i of args.items) {
        const row = rows.find((r) => sameCompany(r, i.company));
        if (!row) continue;
        // TWO ITEMS FOR ONE COMPANY are one: the later words win per field.
        const was = byName.get(row.id);
        byName.set(row.id, { row, item: { ...(was?.item ?? {}), ...i } });
      }
      targets = [...byName.values()];
    } else if (args.where && args.set) {
      const all = await repo.list();
      let rows = all;
      const w = { ...args.where };
      // FILTERING ON THE VALUE BEING SET is no filter: "every company to own liq"
      // arrived as where stage own liq, set stage own liq, and matched nobody.
      if (w.stage && args.set.stage && stageFrom(w.stage) === stageFrom(args.set.stage)) delete w.stage;
      if (w.group) rows = rows.filter((r) => (r.groups ?? []).some((g) => fold(g) === fold(w.group)));
      // "liquidation" or "in liquidation" is every company on the page, not a stage.
      const s = w.stage ? stageFrom(w.stage) : undefined;
      if (w.stage && s !== undefined && !/liquidation/i.test(w.stage)) rows = rows.filter((r) => (r.stage ?? null) === s);
      if (w.owner) rows = rows.filter((r) => (fold(w.owner) === 'none' ? !r.owner : fold(r.owner) === fold(w.owner)));
      if (!rows.length) {
        logger.info({ where: args.where }, 'diane: update_liquidation where matched nobody');
        const groups = [...new Set(all.flatMap((r) => r.groups ?? []))].join(', ');
        const stages = [...new Set(all.map((r) => stageName(r.stage)))].join(', ');
        return {
          summary: `No company on the Liquidations page matches ${JSON.stringify(args.where)}. Nothing has been changed. `
            + `On the page now: ${all.length} companies; stages ${stages || 'none'}; groups ${groups || 'none'}. `
            + 'For EVERY company on the page call again with where {} (empty). Otherwise fix the filter.',
        };
      }
      targets = rows.map((row) => ({ row, item: { ...args.set, company: row.company_name } }));
    } else {
      return { summary: 'Say which companies (items, or where with set) and what to change. Nothing has been changed.' };
    }
    if (targets.length > MAX_ROWS) return { summary: `That is ${targets.length} companies, more than ${MAX_ROWS} at once. Ask them to narrow it. Nothing has been changed.` };

    // Every value checked before anything is shown.
    const plan = [];
    const refused = [];
    for (const { row, item } of targets) {
      // eslint-disable-next-line no-await-in-loop
      const { set, log, why } = await cleanItem(item, today, owners);
      if (why.length) { refused.push(`${row.company_name}: ${why.join('; ')}`); continue; }
      const changes = Object.entries(set).filter(([f, v]) => (row[COLUMN[f]] ?? null) !== (v ?? null)
        && !(f === 'deadline' && String(row.deadline ?? '').slice(0, 10) === String(v ?? '')));
      if (!changes.length && !log) continue;
      plan.push({ row, set: Object.fromEntries(changes), log });
    }
    if (refused.length) {
      return { summary: `NOTHING HAS BEEN CHANGED. ${refused.join('. ')}. Ask them, then call again with the whole request.` };
    }
    if (!plan.length) {
      const reply = 'Nothing to change: those values are already set.';
      return { summary: reply, reply, computedReply: true };
    }

    const lines = plan.map(({ row, set, log }, i) => {
      const parts = Object.entries(set).map(([f, v]) => `${FIELD_LABEL[f]} ${show(f, row[COLUMN[f]])} → ${show(f, v)}`);
      if (log) parts.push(`log "${log.body}" (${sayDay(log.saidOn)})`);
      return `• ${row.company_name}: ${parts.join('; ')}`;
    });
    const pending = confirmFirst(args.confirmed, {
      act: 'change these companies on the Liquidations page',
      count: plan.length,
      noun: 'company',
      plural: 'companies',
      keeps: 'Their company status and pay do not change.',
      lines,
      // Matched against what she read out, which drops the "1." numbering.
      identity: lines.map((l) => l.replace(/^\d+\.\s*/, '')).join(' '),
    });
    if (pending) return { ...pending, aimedAt: plan.map((p) => p.row.company_name) };

    // WRITE, keeping what each replaced for undo.
    const restore = { rows: [], comms: [] };
    for (const { row, set, log } of plan) {
      if (Object.keys(set).length) {
        restore.rows.push({ id: row.id, fields: Object.fromEntries(Object.keys(set).map((f) => [f, row[COLUMN[f]] ?? null])) });
        // eslint-disable-next-line no-await-in-loop
        await repo.update(row.id, set, BY);
      }
      if (log) {
        // eslint-disable-next-line no-await-in-loop
        const c = await repo.addComm(row.id, log, BY);
        restore.comms.push(c.id);
      }
    }
    // READ BACK: every field as written, or it is not reported as done.
    const after = new Map((await repo.list()).map((r) => [r.id, r]));
    const failed = plan.filter(({ row, set }) => Object.entries(set).some(([f, v]) => {
      const got = after.get(row.id)?.[COLUMN[f]] ?? null;
      return f === 'deadline' ? String(got ?? '').slice(0, 10) !== String(v ?? '') : got !== (v ?? null);
    }));
    await undoRepo.record('liquidations', `${plan.length} ${plan.length === 1 ? 'company' : 'companies'} on the Liquidations page`, restore, BY);
    broadcast(null, 'liquidations:changed', { via: 'agent' });
    const reply = failed.length
      ? `Saved, but ${failed.map((p) => p.row.company_name).join(', ')} did not read back as written: check them on the Liquidations page.`
      : `Done. ${lines.join('\n')}`;
    return { summary: reply, reply, computedReply: true };
  },
};

async function undoLiquidations() {
  const last = await undoRepo.latest('liquidations');
  if (!last) {
    const reply = 'There is no change of mine on the Liquidations page to undo.';
    return { summary: reply, reply, computedReply: true };
  }
  // AT ONCE: "undo that" is the instruction, and it only puts back what she
  // herself changed. A preview of "back as it was" had nothing in it a yes
  // could be matched to, so the yes undid nothing (suite, 2026-10-13).
  const { rows = [], comms = [] } = last.restore;
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    await repo.update(r.id, r.fields, `${BY} (undo)`);
  }
  if (comms.length) await repo.removeComms(comms);
  await undoRepo.markUndone(last.id);
  broadcast(null, 'liquidations:changed', { via: 'agent' });
  const reply = `Undone: ${last.summary} put back as it was${comms.length ? `, and ${comms.length} contact log ${comms.length === 1 ? 'line' : 'lines'} taken out` : ''}.`;
  return { summary: reply, reply, computedReply: true };
}

// ===============================
// * DOCUMENTS (his call 2026-10-13)
// ===============================
// One tool for a company's documents: list them, open one or several in
// the chat's viewer, save files attached in the chat onto it, rename, and
// remove (moved aside, never deleted), and undo the last of those. Saving,
// renaming and removing show first; the whole act is one undo.

const docView = (rowId, d) => ({
  // Which company's set it belongs to: her chip opens all of them, arrows between.
  liquidationId: rowId,
  docId: d.id,
  name: d.file_name,
  mime: d.mime,
  viewUrl: `/api/v1/liquidations/${rowId}/docs/${d.id}?inline=1`,
  textUrl: `/api/v1/liquidations/${rowId}/docs/${d.id}/text`,
  downloadUrl: `/api/v1/liquidations/${rowId}/docs/${d.id}`,
  url: `/api/v1/liquidations/${rowId}/docs/${d.id}`,
});
const READ_WORD = { read: 'readable', reading: 'being read', waiting: 'waiting to be read', unreadable: 'kept, not readable' };

/** The named files among a company's documents; `unmatched` the names that found none or several. */
function pickDocs(docs, names) {
  const picked = [];
  const unmatched = [];
  for (const n of names) {
    const want = fold(n);
    const exact = docs.filter((d) => fold(d.file_name) === want);
    const hits = exact.length ? exact : docs.filter((d) => fold(d.file_name).includes(want) || want.includes(fold(d.file_name).replace(/\.[a-z0-9]+$/, '')));
    if (hits.length === 1) { if (!picked.includes(hits[0])) picked.push(hits[0]); } else unmatched.push(`"${n}" (${hits.length ? `${hits.length} match` : 'none matches'})`);
  }
  return { picked, unmatched };
}

const liquidationDocument = {
  name: 'liquidation_document',
  writes: true,
  description:
    'A company\'s documents on the Liquidations page. action list: what it has. open: show one or several in this chat. '
    + 'save: put the files they ATTACHED in this chat onto the company (all of them unless they name some). rename: one, '
    + 'to newName. remove: one or several (moved aside, never deleted). undo: puts back your last save, rename or remove at '
    + 'once. save, rename and remove: confirmed false first and show the lines; true only after yes. To ANSWER from what '
    + 'documents say, use search_company_documents or read_company_document.',
  parameters: {
    type: 'object',
    properties: {
      company: { type: 'string' },
      action: { type: 'string', enum: ['list', 'open', 'save', 'rename', 'remove', 'undo'] },
      files: { type: 'array', items: { type: 'string' }, description: 'File names as they said them (or the attached ones for save).' },
      newName: { type: 'string' },
      confirmed: { type: 'boolean', description: 'False first, which changes nothing. True only after they said yes.' },
    },
    required: ['action'],
  },
  async handler(args = {}) {
    if (args.action === 'undo') return undoDocuments();
    /**
     * THE COMPANY FROM THE DOCUMENT when the one she named is not on the page:
     * "rename the hmrc petition to …" came as company "HMRC" (overnight suite
     * 2026-10-13). One company holding a document their words name is it.
     */
    if (args.action !== 'save') {
      const all = await repo.list();
      if (!all.some((r) => sameCompany(r, args.company))) {
        const owner = await companyOfNamedDoc(args.said, all);
        if (owner) args.company = owner.company_name;
      }
    }
    const { rows, ...rest } = await rowsFor([args.company], args.said);
    const stop = problems(rest);
    if (stop) return { summary: stop };
    const row = rows[0];
    const { docs } = await repo.details(row.id);
    // THEIR WORDS DECIDE THE ACT when hers disagree: "remove the call notes"
    // arrived as a list (suite, 2026-10-13). The verb they used wins.
    const verb = String(args.said ?? '').toLowerCase();
    if (args.action === 'list' && /\b(?:remove|delete|bin|drop|take off|get rid of|clear out)\b|\btake\b[^.]*\boff\b/.test(verb)) args.action = 'remove';
    else if (args.action === 'list' && /\brenam\w*\b|\bshould be (?:called|named)\b|\bcall it\b|\bname to\b/.test(verb)) args.action = 'rename';
    else if (args.action === 'list' && /\b(?:open|show me the|send|give me the|get me the|download|zip)\b/.test(verb)) args.action = 'open';
    // AND THE FILES: named in their words when she named none ("the hmrc petition").
    const SKIP = new Set(['the', 'and', 'for', 'from', 'pdf', 'txt', 'csv', 'docx', 'xlsx', 'doc', 'png', 'jpg', 'file', 'letter', 'document']);
    const wordsOf = (n) => fold(n).replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !SKIP.has(w));
    const saidWords = new Set(wordsOf(verb));
    const inSaid = docs.filter((d) => { const w = wordsOf(d.file_name); const hit = w.filter((x) => saidWords.has(x)).length; return w.length && hit >= Math.min(2, w.length); });
    if (!(args.files ?? []).length && inSaid.length && args.action !== 'save') args.files = inSaid.map((d) => d.file_name);
    // "BOTH", "ALL", "EVERY ONE": every document it has.
    // "DOWNLOAD / ZIP THEIR DOCUMENTS" with none named is all of them, and so
    // is "clear out the pinecrest documents": the plural with no file named
    // (6 model rounds asking "which?", efficiency run 2026-10-14). A removal is
    // still previewed and needs a yes.
    const zipAll = (args.action === 'open' && !(args.files ?? []).length && /\b(?:download|zip)\b/i.test(String(args.said ?? '')))
      || (['open', 'remove'].includes(args.action) && !(args.files ?? []).length && !inSaid.length
        && /\b(?:documents|docs|files|paperwork|everything)\b/i.test(String(args.said ?? '')));
    const everyOne = zipAll || /\b(?:both|all|every(?:thing| one)?)\b/i.test(`${(args.files ?? []).join(' ')} ${args.action === 'remove' || args.action === 'open' ? args.said ?? '' : ''}`)
      && !(args.files ?? []).some((f) => docs.some((d) => fold(d.file_name).includes(fold(f))));
    const names = everyOne ? docs.map((d) => d.file_name) : (args.files ?? []).filter((f) => String(f ?? '').trim() && !/^(?:both|all|every(?:thing| one)?)$/i.test(String(f).trim()));

    if (args.action === 'list') {
      const reply = docs.length
        ? `${row.company_name} has ${docs.length} ${docs.length === 1 ? 'document' : 'documents'}, open them with View documents:\n${docs.map((d) => `• ${d.file_name} (${READ_WORD[d.read_status] ?? d.read_status}, added ${sayDay(String(d.uploaded_at instanceof Date ? d.uploaded_at.toISOString() : d.uploaded_at).slice(0, 10))})`).join('\n')}`
        : `${row.company_name} has no documents yet.`;
      return { summary: reply, reply, computedReply: true, files: docs.map((d) => docView(row.id, d)) };
    }

    if (args.action === 'open') {
      const { picked, unmatched } = names.length ? pickDocs(docs, names) : { picked: docs.length === 1 ? docs : [], unmatched: docs.length > 1 ? ['(none named)'] : [] };
      if (!picked.length || unmatched.length) {
        return { summary: `${unmatched.length ? `Not sure which: ${unmatched.join(', ')}. ` : ''}${row.company_name}'s documents: ${docs.map((d) => d.file_name).join(', ') || 'none'}. Ask which.` };
      }
      // DOWNLOADING SEVERAL is the viewer's Download all, one zip (his call 2026-10-13).
      const zipNote = picked.length > 1 && /\b(?:download|zip)\b/i.test(String(args.said ?? '')) ? ' Download all, in the viewer, saves them as one zip.' : '';
      const reply = `${picked.length === 1 ? `Here is ${picked[0].file_name} from ${row.company_name}.` : `Here are ${picked.length} documents from ${row.company_name}.`}${zipNote}`;
      return { summary: reply, reply, computedReply: true, files: picked.map((d) => docView(row.id, d)) };
    }

    if (args.action === 'save') {
      const attached = args.chatFiles ?? [];
      // A FINISHED ANSWER, not an instruction to word one: 4 model rounds and two
      // retries went into saying this (efficiency run 2026-10-14).
      if (!attached.length) {
        const reply = `There is no file attached yet, so nothing was saved to ${row.company_name}. Attach it with the paperclip, then tell me where to save it.`;
        return { summary: reply, reply, computedReply: true };
      }
      const chosen = names.length ? attached.filter((f) => names.some((n) => fold(f.filename).includes(fold(n)) || fold(n).includes(fold(f.filename)))) : attached;
      if (!chosen.length) return { summary: `None of the attached files is called ${names.join(', ')}. Attached: ${attached.map((f) => f.filename).join(', ')}. Ask which.` };
      const lines = chosen.map((f) => `• ${f.filename} → ${row.company_name}`);
      const pending = confirmFirst(args.confirmed, {
        act: `save ${chosen.length === 1 ? 'this file' : 'these files'} to ${row.company_name}'s documents`,
        count: chosen.length, noun: 'file', keeps: 'Each is read so you can ask about it.', lines,
        identity: `${row.company_name} ${chosen.map((f) => f.filename).join(' ')}`,
      });
      if (pending) return { ...pending, aimedAt: [row.company_name], redirect: resolvedCall(args, { files: chosen.map((f) => f.filename) }) };
      // eslint-disable-next-line global-require
      const files = await require('../../shared/chatFiles.helper').take(chosen.map((f) => f.fileId));
      if (!files.length) return { summary: 'NOTHING HAS BEEN SAVED: the attached files are no longer here (over a day old, or the server restarted). Ask them to attach them again.' };
      const saved = [];
      for (const f of files) {
        // eslint-disable-next-line no-await-in-loop
        saved.push(await storeDoc(row.id, { buffer: f.buffer, originalName: f.name, mime: f.mime }, BY));
      }
      await undoRepo.record('documents', `${saved.length} ${saved.length === 1 ? 'document' : 'documents'} saved to ${row.company_name}`, { saved: saved.map((d) => ({ rowId: row.id, id: d.id })) }, BY);
      broadcast(null, 'liquidations:changed', { via: 'agent' });
      const reply = `Saved to ${row.company_name}: ${saved.map((d) => d.file_name).join(', ')}. ${saved.length === 1 ? 'It is' : 'They are'} being read now, so you can ask about ${saved.length === 1 ? 'it' : 'them'} in a moment.`;
      return { summary: reply, reply, computedReply: true };
    }

    const { picked, unmatched } = pickDocs(docs, names);
    if (!names.length || unmatched.length || !picked.length) {
      return { summary: `${unmatched.length ? `Not sure which: ${unmatched.join(', ')}. ` : 'Say which documents. '}${row.company_name}'s documents: ${docs.map((d) => d.file_name).join(', ') || 'none'}. Ask which. Nothing has been changed.` };
    }

    if (args.action === 'rename') {
      // THE NEW NAME AND THE FILE FROM THEIR WORDS when hers miss one ("rename
      // the call notes on quarry lane to Begbies call 12 Oct": four calls and
      // no rename, suite 2026-10-13). The name is what follows the last "to".
      const saidTo = String(args.said ?? '').match(/\b(?:renam\w*|called|named|name)\b(?:[\s\S]*\bto)?\s+["“']?([^"”'\n]+?)["”']?\s*[.!?]?\s*$/i)?.[1]?.trim();
      const to = String(args.newName || saidTo || '').trim().slice(0, 200);
      if (picked.length > 1 && inSaid.length === 1) picked.splice(0, picked.length, ...picked.filter((d) => d.id === inSaid[0].id));
      if (!to || picked.length !== 1) return { summary: 'Rename one document at a time, and say its new name. Nothing has been changed.' };
      const ext = (picked[0].file_name.match(/\.[a-z0-9]+$/i) ?? [''])[0];
      const name = /\.[a-z0-9]{2,5}$/i.test(to) ? to : `${to}${ext}`;
      const pending = confirmFirst(args.confirmed, {
        act: `rename a document of ${row.company_name}`, count: 1, noun: 'document',
        lines: [`1. ${picked[0].file_name} → ${name}`], identity: `${picked[0].file_name} ${name}`,
      });
      if (pending) return { ...pending, redirect: resolvedCall(args, { files: [picked[0].file_name], newName: name }) };
      await repo.renameDoc(row.id, picked[0].id, name);
      // eslint-disable-next-line global-require
      require('../../shared/liquidationDocIndex').forgetCache();
      await undoRepo.record('documents', `the rename of ${name}`, { renamed: [{ rowId: row.id, id: picked[0].id, from: picked[0].file_name }] }, BY);
      broadcast(null, 'liquidations:changed', { via: 'agent' });
      const reply = `Renamed: ${picked[0].file_name} is now ${name}.`;
      return { summary: reply, reply, computedReply: true };
    }

    // remove
    const lines = picked.map((d) => `• ${d.file_name}`);
    const pending = confirmFirst(args.confirmed, {
      act: `remove ${picked.length === 1 ? 'this document' : 'these documents'} from ${row.company_name}`,
      count: picked.length, noun: 'document', keeps: 'The files are moved aside on this computer, not deleted.', lines,
      identity: `${row.company_name} ${picked.map((d) => d.file_name).join(' ')}`,
    });
    if (pending) return { ...pending, aimedAt: [row.company_name], redirect: resolvedCall(args, { action: 'remove', files: picked.map((d) => d.file_name) }) };
    const removed = [];
    for (const d of picked) {
      // eslint-disable-next-line no-await-in-loop
      const full = await repo.findDoc(row.id, d.id);
      if (!full) continue;
      // eslint-disable-next-line no-await-in-loop
      const aside = await moveAside(full.stored_path);
      // eslint-disable-next-line no-await-in-loop
      await repo.removeDoc(d.id, aside);
      removed.push({ id: d.id, aside, name: d.file_name });
    }
    // eslint-disable-next-line global-require
    require('../../shared/liquidationDocIndex').forgetCache();
    await undoRepo.record('documents', `${removed.length} ${removed.length === 1 ? 'document' : 'documents'} removed from ${row.company_name}`, { removed }, BY);
    broadcast(null, 'liquidations:changed', { via: 'agent' });
    const reply = `Removed from ${row.company_name}: ${removed.map((r) => r.name).join(', ')}. The files are kept aside; say "undo that" to put them back.`;
    return { summary: reply, reply, computedReply: true };
  },
};

/**
 * THE CALL A YES REPLAYS, resolved: the act and the files read from their
 * words, never her first guess ("remove the call notes" came as a list, and
 * the yes replayed the list, suite 2026-10-13). See runAgent's `redirect`.
 */
const resolvedCall = (args, extra) => ({
  name: 'liquidation_document',
  args: {
    company: args.company, action: args.action, files: args.files, newName: args.newName, ...extra,
  },
});

async function undoDocuments() {
  const last = await undoRepo.latest('documents');
  if (!last) {
    const reply = 'There is no document change of mine to undo.';
    return { summary: reply, reply, computedReply: true };
  }
  const { saved = [], removed = [], renamed = [] } = last.restore;
  for (const s of saved) {
    // eslint-disable-next-line no-await-in-loop
    const full = await repo.findDoc(s.rowId, s.id);
    // eslint-disable-next-line no-await-in-loop
    if (full) await repo.removeDoc(full.id, await moveAside(full.stored_path));
  }
  for (const r of removed) {
    // eslint-disable-next-line no-await-in-loop
    await repo.restoreDoc(r.id, await moveBack(r.aside));
  }
  for (const r of renamed) {
    // eslint-disable-next-line no-await-in-loop
    await repo.renameDoc(r.rowId, r.id, r.from);
  }
  await undoRepo.markUndone(last.id);
  // eslint-disable-next-line global-require
  require('../../shared/liquidationDocIndex').forgetCache();
  broadcast(null, 'liquidations:changed', { via: 'agent' });
  const reply = `Undone: ${last.summary} put back as it was.`;
  return { summary: reply, reply, computedReply: true };
}

// ===============================
// * READING THE DOCUMENTS (to answer from them)
// ===============================
const searchCompanyDocuments = {
  name: 'search_company_documents',
  description: 'Find what the documents of our companies in liquidation SAY (letters, petitions, notices, statements), '
    + 'by meaning. Use it to answer "what does HMRC\'s letter ask for", "when is the hearing". Name a company to narrow it.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' }, company: { type: 'string' } },
    required: ['query'],
  },
  async handler(args = {}) {
    // eslint-disable-next-line global-require
    const { search } = require('../../shared/liquidationDocIndex');
    let keys = null;
    if (args.company) {
      const { rows, ...rest } = await rowsFor([args.company], args.said);
      // NOT A COMPANY ON THE PAGE ("the hmrc petition" came as company "HMRC",
      // overnight suite 2026-10-13): every company's documents are searched.
      keys = problems(rest) ? null : rows.map((r) => r.company_key);
    }
    // An empty query is their own question (the embedding refuses an empty string).
    // HER WORDS AND THEIRS, the better of the two: her short query ("hearing")
    // missed what their question found ("when is the petition hearing" scores
    // 0.40 against the petition; overnight suite 2026-10-13).
    const queries = [...new Set([String(args.query ?? '').trim(), String(args.said ?? '').trim()].filter(Boolean))];
    const byChunk = new Map();
    for (const q of queries.length ? queries : ['documents']) {
      // eslint-disable-next-line no-await-in-loop
      for (const h of await search(q, { companyKeys: keys, limit: 8 })) {
        const key = `${h.doc_id}:${h.n}`;
        if (!byChunk.has(key) || byChunk.get(key).score < h.score) byChunk.set(key, h);
      }
    }
    const hits = [...byChunk.values()].sort((x, y) => y.score - x.score).slice(0, 8);
    const best = hits[0]?.score ?? 0;
    // ONE COMPANY NAMED: its few documents' best passages, whatever the score
    // (a short question, "the hearing?", scores low against a whole letter).
    const good = keys ? hits.slice(0, 4) : hits.filter((h) => h.score >= 0.2 && h.score >= best - 0.15);
    if (!good.length) return { summary: 'Nothing in their documents matches that. Say so; do not guess what a document says.' };
    return {
      summary: 'FROM THEIR DOCUMENTS (quote only what is here, and name the document each fact came from). '
        + 'Ranking, adding or comparing the figures below to answer them IS reading the document: do it, '
        + 'never say you cannot rank or total (that rule is the master sheet\'s, not a document\'s).\n\n'
        + good.map((h) => `${h.company_name} · ${h.file_name}\n${h.text.slice(0, 1800)}`).join('\n\n'),
    };
  },
};

const readCompanyDocument = {
  name: 'read_company_document',
  description: 'Read one of a company\'s documents in full (to summarise it or answer from all of it).',
  parameters: {
    type: 'object',
    properties: { company: { type: 'string' }, file: { type: 'string' } },
    required: ['company', 'file'],
  },
  async handler(args = {}) {
    const { rows, ...rest } = await rowsFor([args.company], args.said);
    const stop = problems(rest);
    if (stop) return { summary: stop.replace('NOTHING HAS BEEN CHANGED. ', '') };
    const row = rows[0];
    const { docs } = await repo.details(row.id);
    const { picked, unmatched } = pickDocs(docs, [args.file]);
    if (!picked.length || unmatched.length) return { summary: `Not sure which document. ${row.company_name}'s: ${docs.map((d) => d.file_name).join(', ') || 'none'}. Ask which.` };
    const full = await repo.docWithText(picked[0].id);
    if (!full?.text) return { summary: `${picked[0].file_name} has no readable text (${full?.read_error ?? READ_WORD[full?.read_status] ?? 'not read'}). Offer to open it instead.` };
    return { summary: `${row.company_name} · ${picked[0].file_name} (quote only what is here):\n${full.text.slice(0, 24000)}` };
  },
};

const liquidationTools = [listLiquidations, updateLiquidation, liquidationDocument, searchCompanyDocuments, readCompanyDocument];

/**
 * A MESSAGE THAT NAMES ONE OF A COMPANY'S DOCUMENTS with a document verb is
 * the document tool, never a company field: "remove the call notes from
 * Quarry Lane" cleared the company's NOTES (suite, 2026-10-13). Read from the
 * documents themselves, cached for half a minute.
 */
let docNames = { at: 0, names: [] };
async function namesADocument(said) {
  const text = fold(said);
  // AN INSTRUCTION NAMING A DOCUMENT, whatever its verb: "call notes for quarry
  // lane should be called …" and "take the creditors list off pinecrest" went
  // to the company's notes (overnight held-out run, 2026-10-13). A QUESTION
  // naming one is a search (liquidationRoute), not this.
  if (/\?\s*$/.test(text) || /^\s*(?:what|whats|what's|which|who|whos|how|when|where|why|is|are|does|did)\b/.test(text)
    || /\b(?:what|whats|what's|which|who|whos|how much|how many|when)\b/.test(text)) return false;
  await loadNames();
  return docNames.names.some((n) => text.includes(n));
}

// What is on the Liquidations page, by name, for routing: its companies,
// their liquidators and their documents. Looked up once a 30 seconds.
let pageNames = { at: 0, companies: [], liquidators: [] };
async function loadNames() {
  if (Date.now() - docNames.at > 30_000) {
    const pool = require('../../../configs/db'); // eslint-disable-line global-require
    const { rows } = await pool.query('SELECT DISTINCT file_name FROM tb_liquidation_docs WHERE removed_at IS NULL').catch(() => ({ rows: [] }));
    docNames = { at: Date.now(), names: rows.map((r) => fold(r.file_name).replace(/\.[a-z0-9]+$/, '')).filter((n) => n.length >= 4) };
  }
  if (Date.now() - pageNames.at > 30_000) {
    const rows = await repo.list().catch(() => []);
    pageNames = {
      at: Date.now(),
      companies: rows.map((r) => bare(r.company_name)).filter((n) => n.length >= 3),
      // "Begbies Traynor" is said "begbies": its first word is enough.
      liquidators: [...new Set(rows.map((r) => fold(r.liquidator).split(' ')[0]).filter((n) => n.length >= 4))],
    };
  }
}

/** The page row holding a document their words name, when exactly one does. */
async function companyOfNamedDoc(said, rows) {
  const SKIP = new Set(['the', 'and', 'for', 'from', 'pdf', 'txt', 'csv', 'docx', 'xlsx', 'doc', 'png', 'jpg', 'file', 'letter', 'document', 'rename', 'remove', 'delete', 'open']);
  const wordsOf = (n) => fold(n).replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !SKIP.has(w));
  const saidWords = new Set(wordsOf(said));
  const owners = [];
  for (const r of rows.filter((x) => x.doc_count)) {
    // eslint-disable-next-line no-await-in-loop
    const { docs } = await repo.details(r.id);
    if (docs.some((d) => { const w = wordsOf(d.file_name); return w.length && w.filter((x) => saidWords.has(x)).length >= Math.min(2, w.length); })) owners.push(r);
  }
  return owners.length === 1 ? owners[0] : null;
}

/**
 * THE LIQUIDATIONS PAGE BY WHAT IS ON IT (overnight suite 2026-10-13). Plain
 * words named a company in liquidation, or its liquidator, and went to the
 * master sheet: "what's going on with quarry lane?" came back as a company
 * count, "when is quarry lanes deadline" as "nothing to change", "how much is
 * begbies charging" as a pay figure, "put this on pinecrest" (a file attached)
 * as "what should I put on Pinecrest?". Returns the tool, or null.
 */
const DOC_WORDS = /\b(?:documents?|docs?|files?|pdfs?|letters?|petition|notice|statements?|minutes|records|creditors? list|says?|paperwork|papers|on file)\b/;
// WHAT A COMPANY'S DOCUMENTS ANSWER, never a pay word ("owed" is the sheet's).
const DOC_FACTS = /\b(?:hearing|court|petition|fees?|charg\w*|cost us|costs?|creditors?|liabilit\w*|assets|debts?|minutes|engagement)\b/;
const ASK_START = /\?\s*$|^\s*(?:what|whats|what's|which|who|whos|who's|how|hows|how's|is|are|do|does|did|any|when|whens|when's|where|tell me|give me|show|list|update me|remind me)\b/;
const CHANGE = /\b(?:set|change|move|push|bring forward|update|make|mark|rename|remove|delete|add|log|note that|put|save|file|upload|attach)\b/;
async function liquidationRoute(said, { hasFiles = false } = {}) {
  const text = fold(said);
  await loadNames();
  const liqWords = /\b(?:in liquidation|winding up|wound up|being liquidated|liquidations)\b/.test(text);
  const company = pageNames.companies.find((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'?s)?\\b`).test(text));
  // A FILE ATTACHED, A COMPANY ON THE PAGE, and words that put it somewhere.
  if (hasFiles && company && /\b(?:put|save|file|add|upload|attach|store|keep|stick|drop|this|these|them|it)\b/.test(text)) return 'liquidation_document';
  // A QUESTION NAMING ONE OF THEIR DOCUMENTS is answered from it: "in the
  // statement of affairs, what is the total liabilities figure" (held-out run).
  const asks = ASK_START.test(text) || /\b(?:what|whats|what's|which|who|whos|how much|how many|when)\b/.test(text);
  if (asks && docNames.names.some((n) => text.includes(n)) && !CHANGE.test(text.replace(ASK_START, ''))) return 'search_company_documents';
  // "DOWNLOAD EVERYTHING FOR PINECREST": downloading is documents, never the sheet's export.
  if (company && /\b(?:download|zip)\b/.test(text)) return 'liquidation_document';
  // "PINECREST DOCS PLS": a company and its documents, nothing else, is its list.
  if (company && DOC_WORDS.test(text) && text.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean).length <= 5 && !DOC_FACTS.test(text)) return 'liquidation_document';
  // "WHAT PAPERWORK HAVE WE GOT FOR PINECREST" is its list, not what it says.
  if (company && DOC_WORDS.test(text) && /\b(?:have|got|on file|list|which|any)\b/.test(text) && !/\b(?:say|says|said|mention\w*|according)\b/.test(text) && !DOC_FACTS.test(text)) return 'liquidation_document';
  // "DOWNLOAD / SEE EVERYTHING ON FILE / THE PAPERWORK" for a company on the page.
  if (company && DOC_WORDS.test(text) && /\b(?:see|show|open|send|view|download|zip|everything|all)\b/.test(text) && !/\b(?:say|says|said|mention)\b/.test(text)) return 'liquidation_document';
  if (!asks) return null;
  if (!company && liqWords && !CHANGE.test(text.replace(ASK_START, ''))) return 'list_liquidations';
  if (company && DOC_FACTS.test(text) && !CHANGE.test(text.replace(ASK_START, ''))) return 'search_company_documents';
  if (company && !DOC_WORDS.test(text) && !CHANGE.test(text.replace(ASK_START, ''))
    && /\b(?:deadlines?|due|how long|time left|liquidators?|stage|next action|instructions|liquidation|going on|happening|latest|status|update|where are we|details|everything|news|rundown)\b/.test(text)) return 'list_liquidations';
  const liquidator = pageNames.liquidators.find((n) => new RegExp(`\\b${n}\\b`).test(text));
  if (liquidator && !CHANGE.test(text.replace(ASK_START, ''))) return 'search_company_documents';
  return null;
}

/**
 * A READ CODE CAN ANSWER WITH NO MODEL ROUND (efficiency pass 2026-10-14).
 * Liquidation and document turns took 1.6 model rounds and 3.4s against the
 * master sheet's 1.0 and 2.5s: "what's going on with quarry lane" asked the
 * model which tool, then the model again to word a reply the tool had
 * already written. Only sure READS: a company's details, the whole list,
 * a company's documents listed or opened. Changes stay with the model, whose
 * confirm and preview flow they need. Returns { tool, args } or null.
 */
const FILTER_WORDS = /\b(?:own liq|hmrc liq|strike|dissolved|active|not set|passed|overdue|due|this week|owner|owned|group|blamed|stage)\b/;
async function liquidationPlan(said, { hasFiles = false } = {}) {
  const text = fold(said);
  if (hasFiles) return null;
  /**
   * "ADD BRIGHTWELL TO THE LIQUIDATIONS PAGE" is its status, the page's only
   * door, and liquidation writes straight away by design (it stops no deal).
   * Six model rounds of retries went into it (efficiency run 2026-10-14).
   */
  const adding = text.match(/^\s*(?:please\s+)?(?:add|put|move)\s+(.+?)\s+(?:to|on|onto|into)\s+(?:the\s+)?liquidations?(?:\s+(?:page|list|tracker))?\s*[.!]?\s*$/);
  if (adding) {
    // eslint-disable-next-line global-require
    const company = await require('../../repos/companies.repo').findByKey(adding[1].replace(/'s$/, '')).catch(() => null);
    if (!company) return null;
    if (company.status === 'liquidation') return { reply: `${company.name} is already in liquidation, so it is on the Liquidations page.` };
    return {
      tool: 'update_company', args: { name: company.name, status: 'liquidation' },
      reply: `${company.name} is now in liquidation, so it is on the Liquidations page. Its stage starts as Not set.`,
    };
  }
  const tool = await liquidationRoute(said) ?? ((await namesADocument(said)) && /\b(?:open|show|send|get|give|pull up|bring up|view|see|download)\b/.test(text) ? 'liquidation_document' : null);
  if (!tool) return null;
  const company = pageNames.companies.find((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'?s)?\\b`).test(text));
  const rows = await repo.list();
  const row = company ? rows.find((r) => bare(r.company_name) === company) : null;
  if (tool === 'list_liquidations') {
    if (row) return { tool, args: { company: row.company_name } };
    return FILTER_WORDS.test(text) ? null : { tool, args: {} };
  }
  if (tool === 'liquidation_document' && row) {
    if (/\b(?:rename|remove|delete|bin|drop|take|get rid|clear|save|put|file|add|upload)\b/.test(text)) return null;
    const opens = /\b(?:open|show|send|get|give|pull up|bring up|view|see|download|zip|everything|all|every)\b/.test(text);
    return { tool, args: { company: row.company_name, action: opens ? 'open' : 'list' } };
  }
  return null;
}

module.exports = {
  namesADocument, liquidationRoute, liquidationPlan,
  liquidationTools, listLiquidations, updateLiquidation, liquidationDocument, searchCompanyDocuments, readCompanyDocument, stageFrom,
};
