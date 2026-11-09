const ExcelJS = require('exceljs');
const { randomUUID } = require('node:crypto');
const pool = require('../../configs/db');
const repo = require('../repos/liquidations.repo');
const { applyCompanyStatus } = require('./companyStatus.helper');
const { currentDay } = require('./presetMonth.helper');

// ***************************************************
// * THE BOSS'S CLOSURE SHEET, IMPORTED (his call 2026-11-04)
// ***************************************************
//
// "WR CLOSURE SPREADSHEET NEW 1-3.xlsx": one tab per group, one company a
// row, each tab with its own columns. Read into the Winding down page:
//
//   PREVIEW FIRST, nothing written. Four lists: already winding down, in
//   the CRM but not winding down, not in the CRM, and problems.
//   EVERY COMPANY IS SAVED (his call): one not in the CRM is created, and
//   the page tags it "No deals" (worked out live, never stored).
//   A CRM VALUE WINS by default: a field already filled that the file says
//   differently is only overwritten when ticked.
//   DISSOLVED IS NEVER AUTOMATIC where it would stop live deals: shown with
//   the count, unticked.
//   ONE ACT: one batch, every change on the audit trail with the file's name,
//   and the whole import undoable.
//
// Template is skipped (an older copy of Tawin), and so is Other 2 (active
// company lists, not closures). Rows with "???" are skipped as uncertain.

const SKIP_TABS = [/^template$/i, /^other\s*2$/i];

/** A header's words to the field it fills. Matched folded, typos included. */
const HEADER_FIELDS = [
  [/^name of company$/, 'company'],
  [/^name of director$/, 'director'],
  [/^name of mid$/, 'mid'],
  [/^group$/, 'group'],
  [/^status$/, 'status'],
  [/^official rec(?:ei|ie)ver$/, 'officialReceiver'],
  [/^(?:liquidator|handling liquidation)$/, 'liquidator'],
  [/^other (?:involved parties|parties involved) name$/, 'partyNames'],
  [/^other (?:involved parties|parties involved) position$/, 'partyPositions'],
  [/^last action$/, 'lastAction'],
  [/^current instructions$/, 'instructions'],
  [/^deadline$/, 'deadline'],
  [/^(?:proposed )?next action$/, 'nextAction'],
  [/^owner$/, 'owner'],
  // The older tabs kept their contact notes under "Supporting docs".
  [/^(?:last contact (?:and|&|\+) notes|last communication(?: \+ notes)?|supporting docs)$/, 'comms'],
  [/^unres+olved matters$/, 'unresolved'],
  [/^current play$/, 'play'],
  [/^links$/, 'links'],
  [/^promp?t?s$/, 'prompts'],
];
const fieldOfHeader = (h) => {
  const t = String(h ?? '').toLowerCase().replace(/[.\s]+/g, ' ').trim();
  return HEADER_FIELDS.find(([re]) => re.test(t))?.[1] ?? null;
};

/** A cell as plain text: rich text, formulas, links and dates included. */
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.result !== undefined) return cellText(v.result);
    if (v.text !== undefined) return cellText(v.text);
    if (v.hyperlink) return String(v.hyperlink);
    return '';
  }
  return String(v);
}

/** Blank, "n/a", "?" and the like say nothing. */
const EMPTY = /^\s*(?:n\/?a|none|nothing|-+|\?+|not applicable|not appicable|unsure|ignore\.?)?\s*$/i;
const clean = (s) => String(s ?? '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/g, '')).join('\n').trim();
const said = (s) => (EMPTY.test(String(s ?? '')) ? '' : clean(s));

const fold = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
/** The name without its legal ending or dots: "Five Payroll Solutions Ltd" is "five payroll solutions". */
const bare = (s) => fold(s).replace(/[.,]/g, '').replace(/\s+(?:ltd|limited|plc|llp|llc|inc|co)$/, '').trim();

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const iso = (y, m, d) => {
  const day = new Date(Date.UTC(y, m - 1, d));
  return day.getUTCMonth() === m - 1 && day.getUTCDate() === d ? day.toISOString().slice(0, 10) : null;
};

/**
 * "06/10" or "6/10/2026" as a day. A day with no year is this year, or last
 * year when it would be ahead of today (the sheet logs what happened).
 */
function dayOf(dd, mm, yyyy, today) {
  const [ty, tm, td] = today.split('-').map(Number);
  let y = yyyy ? Number(String(yyyy).length === 2 ? `20${yyyy}` : yyyy) : ty;
  if (!yyyy && (Number(mm) > tm || (Number(mm) === tm && Number(dd) > td))) y -= 1;
  return iso(y, Number(mm), Number(dd));
}

/** The first dd/mm(/yyyy) in a text, as a day, else null. */
function firstDay(text, today) {
  const m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(String(text ?? ''));
  return m ? dayOf(m[1], m[2], m[3], today) : null;
}

/** "(19Aug2026)", "(15Sept2026)", "20/10" in a status: the stage's date. */
function statusDay(text, today) {
  const m = /\(?\b(\d{1,2})\s*([a-z]{3,5})\s*(\d{4})\b\)?/i.exec(text);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  return firstDay(text, today);
}

/**
 * THE FILE'S STATUS AS A STAGE, the whole cell read (its later lines carry
 * the detail: "Active proposal to strike off / Compulsory strike off
 * suspended (19Aug2026)"). null stage when it says nothing we know.
 */
function stageOf(statusText, today) {
  const t = fold(statusText.replace(/\n/g, ' '));
  const date = statusDay(statusText, today);
  const out = (stage, stageKind = null) => ({ stage, stageKind, stageDate: date });
  if (!t) return { stage: null, stageKind: null, stageDate: null };
  if (/dissolved/.test(t)) return out('dissolved', /strike|struck/.test(t) ? 'struck_off' : null);
  if (/hmrc liq/.test(t)) return out('hmrc_liq');
  if (/\b(?:our|own) liq/.test(t)) return out('own_liq');
  if (/liquidation/.test(t)) return out('liquidation');
  if (/strike off (?:discontinued|cancelled|rejected|withdrawn)|cancelled strike off/.test(t)) return out('strike_off_rejected');
  if (/suspended|objection/.test(t)) return out('strike_off_suspended');
  if (/first gazette|active proposal|proposal to strike off/.test(t)) {
    return out('active_proposal', /compuls/.test(t) ? 'compulsory' : /voluntar/.test(t) ? 'voluntary' : null);
  }
  if (/^active\b|not struck off|^deal existed/.test(t)) return out('active');
  return { stage: null, stageKind: null, stageDate: null, unread: true };
}

const PLAY_WORDS = [[/^wait/, 'wait'], [/^chase/, 'chase'], [/^leave/, 'leave'], [/do not contact|don'?t contact/, 'do_not_contact']];
const playOf = (s) => PLAY_WORDS.find(([re]) => re.test(fold(s)))?.[1] ?? null;

/**
 * THE CONTACT NOTES AS LOG LINES: each dated line starts an entry ("06/10 -
 * contacted"), an undated line belongs to the one above. Text before any
 * date is one undated entry, dated the day of the import and said so.
 */
function commsOf(text, today) {
  const out = [];
  for (const raw of clean(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b\s*[-–:]?\s*(.*)$/.exec(line);
    const day = m ? dayOf(m[1], m[2], m[3], today) : null;
    if (day) out.push({ saidOn: day, body: m[4].trim() || line });
    else if (out.length) out[out.length - 1].body += `\n${line}`;
    else out.push({ saidOn: today, body: `(undated, from the closure sheet) ${line}`, undated: true });
  }
  return out.filter((c) => c.body.trim());
}

/**
 * READ THE WORKBOOK: every company row of every tab, with what the rows
 * under it add (a row with no company name continues the one above:
 * another joint liquidator, another party, more notes).
 */
async function parseWorkbook(buffer, today = currentDay()) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const companies = [];
  const skipped = [];
  // A ROW WITH NO NAME BUT A DIRECTOR AND STATUS is its own company: its name
  // is looked up by director on every tab, Template included.
  const byDirector = new Map();
  wb.eachSheet((ws) => ws.eachRow((row, n) => {
    if (n === 1) return;
    const v = row.values;
    const company = clean(cellText(v[1]));
    const director = fold(cellText(v[2]));
    if (company && director && !/\?\?\?/.test(company)) byDirector.set(director, [...new Set([...(byDirector.get(director) ?? []), company])]);
  }));

  wb.eachSheet((ws) => {
    const tab = ws.name.trim();
    if (SKIP_TABS.some((re) => re.test(tab))) { skipped.push({ tab, why: /template/i.test(tab) ? 'an older copy of Tawin' : 'active company lists, not closures' }); return; }
    const header = ws.getRow(1).values;
    const cols = [];
    for (let c = 1; c < header.length; c += 1) cols[c] = fieldOfHeader(cellText(header[c]));
    let current = null;
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const cells = {};
      const extra = [];
      row.values.forEach((value, c) => {
        const t = clean(cellText(value));
        if (!t) return;
        if (cols[c]) cells[cols[c]] = cells[cols[c]] ? `${cells[cols[c]]}\n${t}` : t;
        // A COMMENT IN A COLUMN WITH NO HEADER ("Please fix and amend") is kept with the prompts.
        else if (c > 1) extra.push(t);
      });
      const name = cells.company ?? '';
      if (/^last updated/i.test(name) || /^last updated/i.test(cells.status ?? '')) return;
      if (/\?\?\?/.test(name)) { skipped.push({ tab, row: n, name, why: 'marked ??? (not sure of the company)' }); current = null; return; }
      let named = name.trim();
      let nameFrom = null;
      if (!named && cells.director && cells.status) {
        const found = byDirector.get(fold(cells.director)) ?? [];
        // NEVER A NAME GUESSED (his rule 2026-11-04: a company is its exact name).
        // The director's other company is only said, for him to write in the file.
        skipped.push({
          tab, row: n, name: `(no name, director ${cells.director})`,
          why: found.length === 1
            ? `no company name in the row. The same director runs "${found[0]}" on another tab, but a name is never guessed: write it in the file and import again`
            : 'no company name in the row',
        });
        current = null;
        return;
      }
      if (!named) {
        // THE ROW ABOVE GOES ON.
        if (!current) return;
        for (const [f, t] of Object.entries(cells)) current.cells[f] = current.cells[f] ? `${current.cells[f]}\n${t}` : t;
        current.extra.push(...extra);
        return;
      }
      current = { tab, row: n, name: named.replace(/\s+/g, ' '), nameFrom, cells, extra };
      companies.push(current);
    });
  });

  // EACH COMPANY READ INTO PAGE FIELDS.
  const read = companies.map((c) => {
    const x = c.cells;
    const st = stageOf(x.status ?? '', today);
    const comms = x.comms ? commsOf(x.comms, today) : [];
    const doNotContact = /do not contact/i.test(`${x.comms ?? ''} ${x.play ?? ''}`);
    const names = said(x.partyNames).split('\n').map((s) => s.trim());
    const positions = clean(x.partyPositions).split('\n').map((s) => s.trim());
    const parties = names.map((name, i) => ({ name, position: said(positions[i]) })).filter((p) => p.name && !EMPTY.test(p.name));
    // A LIQUIDATOR CELL IN BRACKETS is a remark, not names: "(never received, …)"
    // over three lines would be three liquidators. Kept in the prompts instead.
    const liqText = said(x.liquidator);
    const liqRemark = /^\(/.test(liqText) && !/^\(letter not arrived yet\)$/i.test(liqText) ? liqText : '';
    const liquidators = liqRemark ? [] : liqText.split('\n').map((s) => s.trim())
      .filter((s) => s && !EMPTY.test(s) && !/^\(letter not arrived yet\)$/i.test(s));
    // THE STATUS CELL'S OWN WORDS when it says more than one line ("Active /
    // (still going to be used, dir will be swapped out)"): nothing dropped.
    const statusMore = clean(x.status).includes('\n') ? `Status in the sheet: ${clean(x.status).replace(/\n+/g, ' / ')}` : '';
    const prompts = [said(x.links), said(x.prompts), ...c.extra.map(said), liqRemark && `Liquidator: ${liqRemark}`, statusMore]
      .filter(Boolean).join('\n\n');
    const deadline = firstDay(x.deadline, today);
    return {
      tab: c.tab,
      row: c.row,
      name: c.name,
      nameFrom: c.nameFrom,
      director: said(x.director),
      mid: said(x.mid),
      group: said(x.group).replace(/\s*\n\s*/g, ' '),
      statusText: clean(x.status),
      unreadStatus: Boolean(st.unread && clean(x.status)),
      fields: {
        stage: st.stage,
        stageKind: st.stageKind,
        stageDate: st.stageDate,
        officialReceiver: said(x.officialReceiver),
        liquidator: liquidators.join('\n'),
        lastAction: said(x.lastAction),
        instructions: said(x.instructions),
        deadline,
        nextAction: said(x.nextAction),
        owner: said(x.owner) || null,
        unresolved: said(x.unresolved),
        play: doNotContact ? 'do_not_contact' : playOf(x.play ?? ''),
        prompts,
      },
      parties,
      comms,
    };
  });
  return { companies: read, skipped };
}

// ===============================
// * THE PREVIEW: what each company would become, nothing written
// ===============================

const FIELD_COLUMN = repo.COLUMNS;
const asText = (v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/** Every company the CRM knows: tb_companies and the deals' own names. */
async function crmCompanies() {
  const { rows } = await pool.query(
    `WITH deals AS (
       SELECT lower(regexp_replace(btrim(company), '\\s+', ' ', 'g')) AS ckey, btrim(company) AS name, stopped_on
         FROM tb_mastersheet WHERE company IS NOT NULL AND btrim(company) <> ''
     ),
     keys AS (
       SELECT lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) AS ckey FROM tb_companies WHERE btrim(name) <> ''
       UNION SELECT ckey FROM deals
     )
     SELECT k.ckey,
            COALESCE(c.name, (SELECT MAX(d.name) FROM deals d WHERE d.ckey = k.ckey)) AS name,
            COALESCE(c.status, 'active') AS status,
            (SELECT COUNT(*)::int FROM deals d WHERE d.ckey = k.ckey AND d.stopped_on IS NULL) AS live_deals,
            (SELECT COUNT(*)::int FROM deals d WHERE d.ckey = k.ckey) AS all_deals
       FROM keys k
       LEFT JOIN tb_companies c ON lower(regexp_replace(btrim(c.name), '\\s+', ' ', 'g')) = k.ckey`,
  );
  return rows;
}

/**
 * THE CRM COMPANY THE FILE'S NAME IS: ONLY ITS EXACT NAME (his rule 2026-11-04).
 * Lower-cased, letter by letter; spaces at the ends and doubled spaces are
 * typing, not letters. "Reliapay", "Reliapay payroll" and "Reliapay contractor"
 * are three companies. It matched near names before ("Nuvanta Resourcing
 * Limited" to "Nuvanta Resourcing") and moved a paying company onto the page.
 * A near name is returned as `near`, shown as a question, NEVER applied.
 */
function matchCompany(name, crm) {
  const key = fold(name);
  const exact = crm.find((c) => c.ckey === key);
  if (exact) return { company: exact, how: 'exact' };
  return null;
}
/** CRM companies whose names are close to this one: said, never matched. */
function nearNames(name, crm) {
  const parts = name.includes('/') ? name.split('/').map((p) => p.trim()).filter(Boolean) : [];
  return crm.filter((c) => bare(c.name) === bare(name) || parts.some((p) => fold(p) === c.ckey || bare(p) === bare(c.name))).map((c) => c.name);
}

/**
 * THE PLAN: one entry per company, with what would be written and what
 * needs a tick. `key` is how the commit names it back.
 */
async function buildPlan(parsed) {
  const crm = await crmCompanies();
  const { rows: pageRows } = await pool.query('SELECT * FROM tb_liquidations');
  const pageBy = new Map(pageRows.map((r) => [r.company_key, r]));
  const { rows: partyRows } = await pool.query('SELECT liquidation_id, name FROM tb_liquidation_parties');
  const { rows: commRows } = await pool.query('SELECT liquidation_id, said_on, body FROM tb_liquidation_comms');
  const entries = [];
  const problems = [];
  const seen = new Map();

  for (const c of parsed.companies) {
    const m = matchCompany(c.name, crm);
    const key = m ? m.company.ckey : fold(c.name);
    // THE SAME COMPANY ON TWO TABS: the later tab wins, and it is said.
    if (seen.has(key)) {
      const was = entries.findIndex((e) => e.key === key);
      problems.push({ kind: 'duplicate', name: c.name, text: `${c.name} is on both ${seen.get(key)} and ${c.tab}: ${c.tab} is used.` });
      if (was >= 0) entries.splice(was, 1);
    }
    seen.set(key, c.tab);
    if (c.nameFrom) problems.push({ kind: 'name', name: c.name, text: `${c.tab} row ${c.row}: ${c.nameFrom}.` });
    // A CLOSE NAME IS A QUESTION: it is saved as its own company unless the file is fixed.
    if (!m) {
      const close = nearNames(c.name, crm);
      if (close.length) problems.push({ kind: 'near', name: c.name, text: `"${c.name}" (${c.tab}) is not in the CRM, so it is added as its own company. The CRM has a similar name: ${close.map((x) => `"${x}"`).join(', ')}. Only an exact name is the same company: if it is that one, write its exact name in the file and import again.` });
    }
    if (c.unreadStatus) problems.push({ kind: 'status', name: c.name, text: `${c.name}: status "${c.statusText}" is not a stage I know, so the stage is left Not set.` });
    if (!c.statusText) problems.push({ kind: 'status', name: c.name, text: `${c.name} (${c.tab}) has no status in the file: the stage is left Not set.` });

    const status = m?.company.status ?? null;
    const category = !m ? 'new' : status === 'liquidation' ? 'winding' : status === 'closed' ? 'closed' : 'other';
    const page = pageBy.get(key) ?? null;
    const fields = { ...c.fields };
    // NOT IN THE CRM, AND NO DEALS TO READ THEM FROM: the file's director,
    // mid and group are kept in the note, said where they came from.
    if (!m || !m.company.all_deals) {
      const who = [c.director && `Director: ${c.director}`, c.mid && `Mid: ${c.mid}`, c.group && `Group: ${c.group}`].filter(Boolean).join(' · ');
      if (who) fields.note = `${who} (from the closure sheet)`;
      // And as fields, shown in the page's Director, Mid and Group (migration 093).
      if (c.director) fields.sheetDirector = c.director;
      if (c.mid) fields.sheetMid = c.mid;
      if (c.group) fields.sheetGroup = c.group;
    }
    // WHAT EACH FIELD WOULD DO: fill an empty one, or differ from a filled one.
    const fills = [];
    const conflicts = [];
    for (const [f, v] of Object.entries(fields)) {
      const to = asText(v);
      if (!to) continue;
      const from = page ? asText(page[FIELD_COLUMN[f]]) : '';
      if (from === to || (f === 'deadline' || f === 'stageDate' ? from.slice(0, 10) === to : false)) continue;
      // A kind goes with its stage: decided with it, never alone.
      if (f === 'stageKind' && page && page.stage && page.stage !== fields.stage) continue;
      if (!from) fills.push({ field: f, to });
      else conflicts.push({ field: f, from, to });
    }
    const have = new Set(partyRows.filter((p) => page && p.liquidation_id === page.id).map((p) => fold(p.name)));
    const parties = c.parties.filter((p) => !have.has(fold(p.name)));
    const logged = new Set(commRows.filter((r) => page && r.liquidation_id === page.id).map((r) => `${asText(r.said_on).slice(0, 10)}|${fold(r.body)}`));
    const comms = c.comms.filter((x) => !logged.has(`${x.saidOn}|${fold(x.body)}`));

    const dissolves = fields.stage === 'dissolved';
    const liveDeals = m?.company.live_deals ?? 0;
    // DEFAULT TICKS: every company saved (his call), except a dissolve that
    // would stop live deals, which waits for its own tick.
    const stopsDeals = dissolves && category !== 'closed' && liveDeals > 0;
    entries.push({
      key,
      name: m?.company.name ?? c.name,
      fileName: c.name,
      tab: c.tab,
      row: c.row,
      category,
      crmStatus: status,
      noDeals: !m || !m.company.all_deals,
      liveDeals,
      statusText: c.statusText,
      stage: fields.stage,
      stageKind: fields.stageKind,
      dissolves,
      stopsDeals,
      include: true,
      dissolve: dissolves && !stopsDeals,
      fills,
      conflicts,
      parties,
      comms,
      fields,
    });
  }
  return {
    entries,
    problems,
    skipped: parsed.skipped,
    counts: {
      winding: entries.filter((e) => e.category === 'winding').length,
      other: entries.filter((e) => e.category === 'other').length,
      closed: entries.filter((e) => e.category === 'closed').length,
      new: entries.filter((e) => e.category === 'new').length,
    },
  };
}

// ===============================
// * COMMIT: the ticked companies, the ticked overwrites, one batch
// ===============================

/**
 * `choices`: { [key]: { include, overwrite: [field…] } }. A key left out
 * keeps the preview's default. Returns what was done, and the restore
 * record undo uses.
 */
async function commit(plan, choices, { byUser, fileName }) {
  const batchId = randomUUID();
  const stamp = { via: 'import', source: fileName, batchId };
  const restore = { created: [], statuses: [], fields: [], parties: [], comms: [], rows: [] };
  const done = { companies: 0, created: 0, fields: 0, parties: 0, comms: 0, closed: 0, wound: 0 };

  for (const e of plan.entries) {
    const choice = choices?.[e.key] ?? {};
    const include = choice.include ?? e.include;
    if (!include) continue;
    const overwrite = new Set(choice.overwrite ?? []);
    // DISSOLVING IS ITS OWN TICK: off where it would stop live deals.
    const dissolve = e.dissolves && (choice.dissolve ?? !e.stopsDeals);
    done.companies += 1;

    // THE COMPANY ITSELF: created when the CRM has none (by its own spelling).
    if (e.category === 'new') {
      const closedNow = dissolve;
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await pool.query(
        `INSERT INTO tb_companies (name, status, closed_on) VALUES ($1, $2, $3)
         ON CONFLICT (lower(name)) DO NOTHING RETURNING company_id`,
        [e.name, closedNow ? 'closed' : 'liquidation', closedNow ? (e.fields.stageDate ?? currentDay()) : null],
      );
      if (rows[0]) {
        restore.created.push(e.key);
        done.created += 1;
        // eslint-disable-next-line no-await-in-loop
        await repo.auditStatus(e.name, null, closedNow ? 'closed' : 'liquidation', byUser, stamp);
      }
    } else if (e.category === 'other') {
      // INTO WINDING DOWN, as the company page does it: its deals keep paying.
      // eslint-disable-next-line global-require, no-await-in-loop
      const { defaultReviewIds } = require('./companyStatus.helper');
      // eslint-disable-next-line no-await-in-loop
      await applyCompanyStatus(e.name, {
        status: 'liquidation', via: 'import', byUser, source: fileName, reviewMonthlyDealIds: await defaultReviewIds(e.name),
      });
      restore.statuses.push({ name: e.name, status: e.crmStatus });
      done.wound += 1;
    }

    // ITS WINDING DOWN ROW, and the fields: empty ones filled, ticked ones overwritten.
    // eslint-disable-next-line no-await-in-loop
    const row = await repo.ensureRow(e.name);
    const set = {};
    for (const f of e.fills) set[f.field] = e.fields[f.field];
    for (const f of e.conflicts) if (overwrite.has(f.field)) set[f.field] = e.fields[f.field];
    // A STAGE WRITTEN TAKES ITS KIND AND DATE (or none) with it.
    if (set.stage !== undefined) {
      set.stageKind = e.fields.stageKind ?? null;
      if (e.fields.stageDate) set.stageDate = e.fields.stageDate;
    }
    // NOT DISSOLVING (unticked): the stage stays as the CRM has it.
    if (e.dissolves && !dissolve) { delete set.stage; delete set.stageKind; delete set.stageDate; }
    if (Object.keys(set).length) {
      restore.rows.push({ id: row.id, fields: Object.fromEntries(Object.keys(set).map((f) => [f, row[FIELD_COLUMN[f]] ?? null])) });
      // eslint-disable-next-line no-await-in-loop
      await repo.update(row.id, set, byUser, stamp);
      done.fields += Object.keys(set).length;
    }
    for (const p of e.parties) {
      // eslint-disable-next-line no-await-in-loop
      const made = await repo.addParty(row.id, p, byUser, stamp);
      restore.parties.push({ id: made.id, liquidationId: row.id });
      done.parties += 1;
    }
    for (const c of e.comms) {
      // eslint-disable-next-line no-await-in-loop
      const made = await repo.addComm(row.id, { saidOn: c.saidOn, body: c.body.slice(0, 4000) }, byUser, stamp);
      restore.comms.push(made.id);
      done.comms += 1;
    }

    // DISSOLVED LAST: the stage says how it ended, then the company closes.
    if (dissolve && e.category !== 'new' && e.category !== 'closed' && (set.stage === 'dissolved' || row.stage === 'dissolved')) {
      // eslint-disable-next-line no-await-in-loop
      await applyCompanyStatus(e.name, { status: 'closed', via: 'import', byUser, source: fileName });
      restore.statuses.push({ name: e.name, status: 'liquidation', closed: true });
      done.closed += 1;
    }
  }

  const summary = `${done.companies} companies from ${fileName}`;
  const { rows } = await pool.query(
    `INSERT INTO tb_closure_imports (file_name, by_user, batch_id, summary, restore)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
    [fileName, byUser, batchId, JSON.stringify(done), JSON.stringify(restore)],
  );
  return { id: rows[0].id, batchId, done, summary };
}

/**
 * UNDO AN IMPORT: every field back as it was, its parties and log lines
 * taken off, its statuses put back (a close reopens the deals it stopped),
 * and the companies it created removed while they still have no deals.
 * The trail keeps it all, the undo included.
 */
async function undo(importId, byUser) {
  const { rows: [imp] } = await pool.query('SELECT * FROM tb_closure_imports WHERE id = $1', [importId]);
  if (!imp) return { error: 'That import is not there.' };
  if (imp.undone_at) return { error: 'That import was already undone.' };
  const r = imp.restore;
  const stamp = { via: 'undo', source: imp.file_name };
  for (const s of [...(r.statuses ?? [])].reverse()) {
    // eslint-disable-next-line no-await-in-loop
    await applyCompanyStatus(s.name, { status: s.status, via: 'admin', auditVia: 'undo', byUser, source: imp.file_name });
  }
  for (const row of r.rows ?? []) {
    // eslint-disable-next-line no-await-in-loop
    await repo.update(row.id, row.fields, byUser, stamp);
  }
  const byRow = new Map();
  for (const p of r.parties ?? []) byRow.set(p.liquidationId, [...(byRow.get(p.liquidationId) ?? []), p.id]);
  for (const [id, ids] of byRow) await repo.removeParties(id, ids, byUser, stamp); // eslint-disable-line no-await-in-loop
  if (r.comms?.length) await repo.removeComms(r.comms, byUser, stamp);
  let removed = 0;
  for (const key of r.created ?? []) {
    // eslint-disable-next-line no-await-in-loop
    const { rows: deals } = await pool.query(
      "SELECT 1 FROM tb_mastersheet WHERE lower(regexp_replace(btrim(company), '\\s+', ' ', 'g')) = $1 LIMIT 1", [key],
    );
    if (deals.length) continue;
    // eslint-disable-next-line no-await-in-loop
    const { rows: [l] } = await pool.query('SELECT id FROM tb_liquidations WHERE company_key = $1', [key]);
    // eslint-disable-next-line no-await-in-loop
    await repo.audit(pool, { liquidationId: l?.id ?? null, companyKey: key, field: 'company', from: 'created by import', to: 'removed by undo', byUser, via: 'undo', source: imp.file_name });
    // eslint-disable-next-line no-await-in-loop
    await pool.query('DELETE FROM tb_liquidations WHERE company_key = $1', [key]);
    // eslint-disable-next-line no-await-in-loop
    await pool.query("DELETE FROM tb_companies WHERE lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = $1", [key]);
    removed += 1;
  }
  await pool.query('UPDATE tb_closure_imports SET undone_at = now(), undone_by = $2 WHERE id = $1', [importId, byUser]);
  return { undone: imp.id, removed };
}

/** The imports so far, newest first, for Settings. */
async function history() {
  const { rows } = await pool.query(
    'SELECT id, file_name, by_user, summary, created_at, undone_at, undone_by FROM tb_closure_imports ORDER BY created_at DESC LIMIT 20',
  );
  return rows;
}

module.exports = {
  parseWorkbook, buildPlan, commit, undo, history, stageOf, commsOf, fieldOfHeader, matchCompany,
};
