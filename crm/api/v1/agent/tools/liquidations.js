const repo = require('../../repos/liquidations.repo');
const undoRepo = require('../../repos/agentUndo.repo');
const { resolveCompanies } = require('./companies');
const { companyKey } = require('../../shared/companyKey');
const companiesRepo = require('../../repos/companies.repo');
const { confirmFirst } = require('./confirmFirst');
const { applyCompanyStatus, wouldStop, wouldResume, defaultReviewIds } = require('../../shared/companyStatus.helper');
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

// One set of stage words for her, the export and the page (2026-10-14).
const { STAGE_LABEL, STAGE_KINDS, stageText } = require('../../shared/liquidationStages');
const stageName = (s) => (s ? STAGE_LABEL[s] ?? s : 'Not set');
// THE COMPANY STATUSES this tool moves, and how a preview says them.
const STATUS_LABEL = { active: 'Active', liquidation: 'Winding down', closed: 'Dissolved', review: 'Review', going_concern: 'Going concern' };
const STATUS_WORD = (w) => {
  const t = fold(w);
  if (!t) return null;
  // OFF THE PAGE (2026-10-21): "take it off winding down", "trading again".
  if (/^active$|\b(?:off|out of|no longer|not) (?:the )?(?:winding|liquidat)|\btrading\b|back to (?:active|normal)|^remove/.test(t)) return 'active';
  if (/dissolv|struck|clos/.test(t)) return 'closed';
  if (/wind|liquidat/.test(t)) return 'liquidation';
  return null;
};
// Their words for a stage, folded to the stored value.
// ORDER MATTERS (his corrected flowchart, 2026-10-14): "struck off" IS
// dissolved, while "strike off" on its own is the proposal; "strike off
// suspended" is not either; "a voluntary proposal" is no liquidation.
const STAGE_WORDS = [
  [/^(?:not set|none|unset|clear|blank)$/, null],
  [/struck off|dissolv/, 'dissolved'],
  [/hmrc|compulsory liq|winding.?up|petition/, 'hmrc_liq'],
  [/suspend|objection|objected/, 'strike_off_suspended'],
  [/reject|cancel/, 'strike_off_rejected'],
  [/proposal|gazette|proposed|strike/, 'active_proposal'],
  [/own|ours|our|voluntary liq|cvl|mvl|creditors.? voluntary|members.? voluntary/, 'own_liq'],
  [/^(?:in )?liquidation$|^liq$|liquidating/, 'liquidation'],
  [/^active$/, 'active'],
];
/**
 * Which kind of `stage` their words say, or undefined. Only Active proposal,
 * Own liq, HMRC liq and Dissolved have kinds (migration 090).
 */
function kindFrom(stage, said) {
  const t = String(said ?? '').toLowerCase();
  if (stage === 'active_proposal') {
    if (/compulsory|forced|companies house/.test(t)) return 'compulsory';
    if (/voluntary|ds01|applied|we asked/.test(t)) return 'voluntary';
  }
  if (stage === 'own_liq') {
    // CVL first: "insolvent" has "solvent" in it.
    if (/\bcvl\b|creditors|insolvent|can.?t pay|cannot pay/.test(t)) return 'cvl';
    if (/\bmvl\b|members|solvent|can pay/.test(t)) return 'mvl';
  }
  if (stage === 'hmrc_liq') {
    if (/order|wound up|court (?:made|granted|ordered)/.test(t)) return 'winding_up_order';
    if (/petition/.test(t)) return 'petition';
  }
  if (stage === 'dissolved') {
    if (/struck|strike/.test(t)) return 'struck_off';
    if (/liquidat|after liq|liquidator/.test(t)) return 'after_liquidation';
  }
  return undefined;
}
// Every kind's words, for a preview line: "kind none → CVL".
const KIND_LABEL = Object.assign({}, ...Object.values(STAGE_KINDS));
function stageFrom(said) {
  const t = String(said ?? '').trim().toLowerCase().replace(/_/g, ' ');
  // A stage's own name, but never the old "strike_off" (a history word only, migration 090).
  const exact = t.replace(/ /g, '_');
  if (STAGE_LABEL[exact] && exact !== 'strike_off') return exact;
  for (const [re, value] of STAGE_WORDS) if (re.test(t)) return value;
  return undefined;
}

// THE CLOSURE SHEET'S FIELDS (migration 092, his call 2026-11-04): official
// receiver, last action, unresolved matters, current play, prompts, stage date.
const FIELD_LABEL = {
  stage: 'stage', stageKind: 'kind', deadline: 'deadline', nextAction: 'next action', instructions: 'instructions',
  owner: 'owner', blamed: 'blamed', liquidator: 'liquidators', note: 'note',
  officialReceiver: 'official receiver', lastAction: 'last action', unresolved: 'unresolved matters',
  play: 'current play', prompts: 'prompts', stageDate: 'stage date',
};
const COLUMN = {
  stage: 'stage', stageKind: 'stage_kind', deadline: 'deadline', nextAction: 'next_action', instructions: 'instructions',
  owner: 'owner', blamed: 'blamed', liquidator: 'liquidator', note: 'note',
  officialReceiver: 'official_receiver', lastAction: 'last_action', unresolved: 'unresolved',
  play: 'play', prompts: 'prompts', stageDate: 'stage_date',
};
const PLAY_LABEL = { wait: 'Wait', chase: 'Chase', leave: 'Leave', do_not_contact: 'Do not contact' };
/** "chase them", "dont contact", "leave it": the play, or undefined. */
function playFrom(said) {
  const t = fold(said).replace(/['’]/g, '');
  if (!t) return undefined;
  if (/^(?:none|clear|not set|no play)$/.test(t)) return null;
  if (/\b(?:do ?n[o']?t|dont|no|never) (?:contact|call|chase|email|ring|reach out)\b|^do not contact$|\bdnc\b/.test(t)) return 'do_not_contact';
  // "STOP CHASING", "BIN THE CHASING": the chase called off is a wait, not a
  // chase. The word "chasing" alone set it to chase (blind sheet run 2026-11-04).
  if (/\b(?:stop|stopped|no more|bin|binned|drop|dropped|quit|pause|paused|enough|call off|hold off)\b(?: \w+){0,2}? chas\w*\b|\bnot chas\w*\b/.test(t)) return 'wait';
  if (/\bchas\w*\b|\bfollow(?:ing)? up\b|\bpush\b/.test(t)) return 'chase';
  // "PARK IT", "ON HOLD", "NOTHING MORE WE CAN DO TILL HMRC COME BACK": a wait.
  if (/\bwait\w*\b|\bhold\b|\bsit tight\b|\bpark\w*\b|\bnothing (?:more )?(?:we can|to) do\b/.test(t)) return 'wait';
  if (/\bleave\b|\bdrop\b|\bignore\b/.test(t)) return 'leave';
  return undefined;
}
/** Joint liquidators are one a line. */
const liquidatorsOf = (text) => String(text ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
const show = (field, v) => {
  // "none", never "—": her dash rule made it "proposal type, → compulsory" (2026-10-14).
  if (v === null || v === undefined || v === '') return field === 'stage' ? 'Not set' : 'none';
  if (field === 'stage') return stageName(v);
  if (field === 'stageKind') return KIND_LABEL[v] ?? v;
  if (field === 'deadline' || field === 'stageDate') return sayDay(String(v).slice(0, 10));
  if (field === 'play') return PLAY_LABEL[v] ?? v;
  if (field === 'liquidator') return `"${liquidatorsOf(v).join(', ')}"`;
  if (field === 'blamed') return v ? 'yes' : 'no';
  return `"${String(v).length > 60 ? `${String(v).slice(0, 57)}…` : v}"`;
};

const fold = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
// THE NAME WITHOUT ITS LEGAL ENDING: "zz harbour test" is "ZZ Harbour Test Ltd"
// (browser check 2026-10-13: she said there was no such company).
const bare = (s) => fold(s).replace(/[.,]/g, '').replace(/\s+(?:ltd|limited|plc|llp|llc|inc|co)$/, '').trim();
/**
 * THE SAME COMPANY ONLY BY ITS EXACT NAME (his rule 2026-11-04): lower-cased,
 * letter by letter; spaces at the ends and doubled spaces are typing. "Competex
 * pro" and "Competex Pro Limited" are two companies, as are "Reliapay" and
 * "Reliapay payroll". Close names are ASKED about (closeRows), never picked.
 */
const sameCompany = (r, name) => {
  const key = companyKey(name);
  return key !== '' && (r.company_key === key || companyKey(r.company_name) === key);
};
/**
 * THEIR OWN WORDS SPELL IT CLOSE, NOT EXACT: the model sent "Quarry Lane" for
 * "wats nxt w/ quary lane" (wind run 2026-11-04), so the code never saw the slip.
 * The close words they wrote, else null. Only words they typed count: a "yes"
 * or "its next action" names nothing and passes.
 */
function saidClose(name, said) {
  // A POSSESSIVE IS THE NAME, not a slip: "whos pinecrests liquidator" is
  // Pinecrest (heldout suite 2026-11-04). Only a final 's / s on the name's last word.
  const want = bare(name);
  const last = want.split(' ').pop();
  const words = fold(String(said ?? '').replace(/[^\p{L}\p{N}&' -]+/gu, ' ')).split(' ').filter(Boolean)
    .map((w) => (last && (w === `${last}'s` || w === `${last}’s` || w === `${last}s` || w === `${last}'`) ? last : w));
  // A SUFFIX THE NAME ON FILE HAS NOT: "pinecrest ltd" is not Pinecrest
  // (exact-name blind set 2026-11-04). Ltd and Limited are part of a name.
  const said1 = ` ${words.join(' ')} `;
  const own = ` ${fold(name)} `;
  for (const sfx of ['ltd', 'limited', 'plc', 'llp']) {
    if (said1.includes(` ${want} ${sfx} `) && !own.includes(` ${sfx} `)) return `${want} ${sfx}`;
  }
  if (!words.length || !want || said1.includes(` ${want} `)) return null;
  const n = want.split(' ').length;
  for (const size of [n, n + 1, n - 1].filter((k) => k >= 1)) {
    for (let i = 0; i + size <= words.length; i += 1) {
      const w = words.slice(i, i + size).join(' ');
      if (w.length >= 4 && w !== want && near(w, want)) return w;
    }
  }
  // A SHORT FORM, spelt right or not: "otery mill" for Ottery Mill Foods went
  // straight to it (doc4 suite 2026-11-04). The name's first words, said as
  // the whole of it, is another company until they say yes.
  const parts = want.split(' ');
  for (let k = parts.length - 1; k >= 1; k -= 1) {
    const head = parts.slice(0, k).join(' ');
    if (head.length < 4) continue;
    for (let i = 0; i + k <= words.length; i += 1) {
      const w = words.slice(i, i + k).join(' ');
      const next = words[i + k] ?? '';
      // "quarry ln", "harbor 9": a short or numbered last word is part of the slip.
      const rest = parts[k] ?? '';
      const abbrev = next && next !== rest && (/^\d+$/.test(next) || (next[0] === rest[0] && next.length < rest.length));
      if (w.length >= 4 && (w === head || near(w, head)) && next !== rest) return abbrev ? `${w} ${next}` : w;
    }
  }
  return null;
}
/** Page rows whose names are close to this one: for "did you mean", never a pick. */
const closeRows = (rows, name) => rows.filter((r) => !sameCompany(r, name) && (
  near(fold(r.company_name), fold(name)) || (bare(name) !== '' && (near(bare(r.company_name), bare(name)) || (bare(name).length >= 5 && bare(r.company_name).startsWith(`${bare(name)} `))))));

/** The parts of a message about one company, else the whole message. */
function clauseFor(name, text) {
  const key = bare(name).split(' ')[0];
  if (!key) return text;
  const parts = String(text ?? '').split(/[,.;!?]|\b(?:and|oh|also|then)\b/i).filter((p) => fold(p).includes(key));
  // "QUARRY LANE AND PINECREST BOTH GOT PETITIONS": a part that is only its
  // name shares what follows, and Quarry Lane lost its petition (regression run 2026-10-22).
  if (parts.some((p) => !bare(p).replace(bare(name), '').trim())) return text;
  return parts.length ? parts.join(' ') : text;
}

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
    `${r.company_name}: ${stageText(r.stage, r.stage_kind)}`,
    r.deadline ? `deadline ${sayDay(String(r.deadline).slice(0, 10))}${nearness(r.deadline, today)}` : 'no deadline',
    r.owner ? `owner ${r.owner}` : null,
    r.director ? `director ${r.director}` : null,
    r.mid ? `mid ${r.mid}` : null,
    (r.groups ?? []).length ? (r.groups ?? []).join('/') : null,
    r.next_action ? `next: ${r.next_action}` : null,
    r.play ? `play ${PLAY_LABEL[r.play] ?? r.play}` : null,
    r.unresolved ? `unresolved: ${r.unresolved.length > 80 ? `${r.unresolved.slice(0, 77)}…` : r.unresolved}` : null,
    r.no_deals ? 'No deals with us' : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

/**
 * THE WHOLE OF ONE COMPANY ON THE PAGE: "show me zz harbour test in full"
 * was looked up on the master sheet and not found (his screenshot 2026-10-14).
 */
const WANTS_ALL = /\b(?:in full|full details|details|about|info|information|overview|summary|rundown|everything|status|where (?:are we|we are) (?:with|on|at))\b/;

/** "update on X" as the noun it is: news, never a change. */
// The word in front stays: "any news on" is still a question (ASK_START).
const asNews = (text) => text.replace(/\bupdates?\s+(?:on|for|about|with|re)\b/g, 'news on');

/** "a, b and c", the first `max` then "and N more" (the rest are in the viewer). */
function namesList(names, max = 8) {
  const shown = names.slice(0, max);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : (shown[0] ?? '');
}

/** The one page row whose name STARTS with theirs: "churchill knight" is Churchill Knight employment. */
function byStart(rows, name) {
  const want = bare(name);
  if (want.length < 5) return undefined;
  const hits = rows.filter((r) => bare(r.company_name).startsWith(`${want} `));
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * One letter added, dropped or changed; two in a long name ("wexcom glazing"
 * for Wexcombe Glazing, fresh doc run 2026-10-22). Every caller still wants
 * exactly one company that near, so two close names are asked about.
 */
function near(a, b) {
  if (a === b) return true;
  const allowed = Math.min(a.length, b.length) >= 10 ? 2 : 1;
  if (Math.abs(a.length - b.length) > allowed) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= allowed;
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
  const corrections = [];
  for (const name of names ?? []) {
    const hit = rows.find((r) => sameCompany(r, name));
    const misspelt = hit && saidClose(hit.company_name, said);
    if (misspelt) {
      corrections.push(`They wrote "${misspelt}", which is not exactly "${hit.company_name}". Only an exact name is a company. Reply with only this question: Did you mean "${hit.company_name}"? Do nothing until they say yes. Copy each name in quotes EXACTLY as written here, Ltd/Limited and all: a shortened name is another company.`);
      continue;
    }
    if (hit) { if (!found.includes(hit)) found.push(hit); } else unknown.push(String(name ?? '').trim());
  }
  const notOnPage = [];
  const offPage = [];
  const missing = [];
  if (unknown.length) {
    // A company with no deals is only in tb_companies: found by its key.
    for (const name of [...unknown]) {
      // A CLOSE PAGE NAME IS ASKED, not picked ("pincrest" is not Pinecrest until
      // they say so; his rule 2026-11-04). Only an exact company off the page is found.
      // eslint-disable-next-line no-await-in-loop
      const company = await companiesRepo.findByKey(name).catch(() => null);
      if (company) { notOnPage.push(company.name); offPage.push({ name: company.name, key: companyKey(company.name), said: name }); unknown.splice(unknown.indexOf(name), 1); }
    }
  }
  if (unknown.length) {
    const sheet = await resolveCompanies(unknown, said ?? '');
    notOnPage.push(...sheet.found.map((f) => f.name));
    offPage.push(...sheet.found.map((f) => ({ name: f.name, key: f.key })));
    for (const name of unknown.filter((n) => !sheet.found.some((f) => f.key === companyKey(n)))) {
      // CLOSE NAMES, ON THE PAGE OR OFF IT, ARE ONLY ASKED: nothing is read or
      // written for a name that is not exact. On "yes" she calls again with the exact name.
      // eslint-disable-next-line no-await-in-loop
      const close = [...new Set([...closeRows(rows, name).map((r) => r.company_name), ...(await closeCompanies(name))])];
      if (close.length) { corrections.push(`No company called exactly "${name}". Only an exact name is a company. Reply with only this question: Did you mean ${close.map((c) => `"${c}"`).join(' or ')}? Use the exact name they confirm. Copy each name in quotes EXACTLY as written here, Ltd/Limited and all: a shortened name is another company.`); continue; }
      /**
       * A PERSON SENT AS THE COMPANY: "close the company kiran is at" arrived as
       * company "Kiran" (held-out run 2026-10-22). Their one company is it;
       * several are asked about by name.
       */
      // eslint-disable-next-line no-await-in-loop
      const theirs = await personsCompanies(`${fold(name)}'s company`).catch(() => []);
      if (theirs.length === 1) {
        const hit = rows.find((r) => bare(r.company_name) === bare(theirs[0]));
        if (hit) { if (!found.includes(hit)) found.push(hit); } else { notOnPage.push(theirs[0]); offPage.push({ name: theirs[0], key: companyKey(theirs[0]) }); }
        continue;
      }
      if (theirs.length > 1) { corrections.push(`"${name}" is a person, not a company: they are at ${theirs.slice(0, -1).join(', ')} and ${theirs[theirs.length - 1]}. Which one?`); continue; }
      missing.push(name);
    }
    if (!corrections.length && sheet.corrections.length && missing.length) corrections.push(...sheet.corrections);
  }
  return { rows: found, missing, corrections, notOnPage, offPage, all: rows };
}

/**
 * A COMPANY NAMED BY THE START OF ITS NAME, whatever its status: "ackerman
 * pearce" is Ackerman Pearce payroll, closed with no live deal, so the sheet
 * never finds it (browser 2026-10-21). Only when exactly one company starts so.
 */
async function companyByPart(name) {
  const want = bare(name);
  if (want.length < 4) return null;
  // Deal-only companies too (see everyCompany).
  const all = await everyCompany();
  const hits = all.filter((n) => bare(n).startsWith(`${want} `) || bare(n) === want);
  return hits.length === 1 ? companiesRepo.findByKey(fold(hits[0])).catch(() => null) : null;
}

/**
 * ONE LETTER AWAY FROM EXACTLY ONE COMPANY, whatever its status: "harbour
 * nine" is Harbor Nine (suite 2026-10-21). The preview names it in full.
 */
/** Companies anywhere whose names are close to this one: said, never picked. */
async function closeCompanies(name) {
  const want = bare(name);
  if (want.length < 4) return [];
  const all = await everyCompany();
  return all.filter((n) => companyKey(n) !== companyKey(name) && (bare(n) === want || bare(n).startsWith(`${want} `) || (want.length >= 5 && near(bare(n), want)))).slice(0, 4);
}
async function companyNear(name) {
  const want = bare(name);
  if (want.length < 5) return null;
  const all = await everyCompany();
  const hits = all.filter((n) => near(bare(n), want));
  return hits.length === 1 ? companiesRepo.findByKey(fold(hits[0])).catch(() => null) : null;
}

function problems({ missing, corrections, notOnPage }) {
  const out = [];
  if (corrections.length) out.push(...corrections);
  else if (missing.length) out.push(`No company called ${missing.map((m) => `"${m}"`).join(', ')}.`);
  if (notOnPage.length) {
    out.push(`${notOnPage.join(', ')} ${notOnPage.length === 1 ? 'is' : 'are'} not winding down, so not on the Winding down page. `
      + 'Only a winding down step or status "winding down" puts a company on it; ask whether to put it into winding down, '
      + 'do not change anything else.');
  }
  return out.length ? `NOTHING HAS BEEN CHANGED. ${out.join(' ')}` : null;
}

/**
 * "⚠ its documents read like HMRC liq (Petition filed)" for a row whose
 * paper is further on than the page (2026-10-21): a status answer that
 * says only what the page says would repeat a stage that is out of date.
 */
async function aheadNote(r) {
  if (!r.doc_count && r.doc_count !== undefined) return '';
  const { docs } = await repo.details(r.id);
  const read = [];
  for (const d of docs.filter((x) => x.text_chars)) read.push({ file_name: d.file_name, text: (await repo.docWithText(d.id))?.text ?? '' }); // eslint-disable-line no-await-in-loop
  // eslint-disable-next-line global-require
  const ahead = require('../../shared/windingDownSteps').aheadOfPage(read, r.stage, r.stage_kind);
  return ahead ? ` · ⚠ "${ahead.file}" reads like ${stageText(ahead.stage, ahead.kind)}: say "update it from the docs"` : '';
}

// ===============================
// * READ
// ===============================
const listLiquidations = {
  name: 'list_liquidations',
  description:
    'The Winding down page: every company whose status is liquidation, with its stage, deadline, owner, '
    + 'director, mid, next action, current play, unresolved matters. Filter by stage, group, owner, deadline ("due this week", "passed"), '
    + 'current play (wait, chase, leave, do not contact), no deals, or unresolved. '
    + 'Name ONE company to get it in full: instructions, liquidators, official receiver, other parties, last action, '
    + 'unresolved matters, prompts, note, blamed, settlement, its contact log, stage history, documents and latest changes. '
    + '"What\'s happening with X" is that full view. "Who changed X" / "X\'s history" is company + history true.',
  parameters: {
    type: 'object',
    properties: {
      company: { type: 'string', description: 'One company, for its full row. Only an exact name is a company: when they named it, their spelling, never corrected by you; when they did not ("its", "that one"), the name exactly as the page list shows it, never as a document spells it ("Pinecrest Ltd" for the page "Pinecrest" is another company).' },
      companies: { type: 'array', items: { type: 'string' }, description: 'Several companies, a line each.' },
      stage: { type: 'string', description: 'active, active proposal (a strike off proposed), strike off suspended, strike off rejected (or cancelled), liquidation, own liq, HMRC liq, dissolved (struck off is dissolved), or not set.' },
      group: { type: 'string' },
      owner: { type: 'string', description: 'An admin username, or "none".' },
      due: { type: 'string', enum: ['week', 'passed'], description: 'week: passed or due in the next 7 days. passed: already passed.' },
      play: { type: 'string', description: 'Only companies on this current play: wait, chase, leave, or do not contact ("which are do not contact", "who are we chasing").' },
      noDeals: { type: 'boolean', description: 'true: only the companies with no deal with us (not on the master sheet, nobody paid from them; saved from the closure sheet). false: only those with deals.' },
      unresolved: { type: 'boolean', description: 'true: only companies with unresolved matters written down.' },
      history: { type: 'boolean', description: 'With company: its full change history (who changed what, when, from what to what; admin, Diane or the closure import).' },
    },
  },
  async handler(args = {}) {
    const today = currentDay();
    // SEVERAL NAMED ("closure status of quarry lane and pinecrest"): a line each.
    if ((args.companies ?? []).length > 1) {
      const { rows, ...rest } = await rowsFor(args.companies, args.said);
      const lines = [];
      for (const r of rows) lines.push(`• ${line(r, today)}${await aheadNote(r)}`); // eslint-disable-line no-await-in-loop
      // OFF THE PAGE, where each one IS, never the model's instructions (blind run 2026-10-22).
      for (const o of rest.offPage) {
        const c = await companiesRepo.findByKey(o.key).catch(() => null); // eslint-disable-line no-await-in-loop
        if (!c) continue;
        const on = c.closed_on ? ` on ${sayDay(String(c.closed_on instanceof Date ? c.closed_on.toISOString() : c.closed_on).slice(0, 10))}` : '';
        lines.push(c.status === 'closed'
          ? `• ${c.name}: closed (dissolved${on}), its deals stopped and in the Archive`
          : `• ${c.name}: not winding down, its status is ${STATUS_LABEL[c.status] ?? c.status}`);
      }
      const stop = problems({ ...rest, notOnPage: [] });
      const reply = [lines.join('\n'), stop ? stop.replace('NOTHING HAS BEEN CHANGED. ', '') : null].filter(Boolean).join('\n');
      return { summary: reply, reply, computedReply: true };
    }
    if (args.company) {
      const { rows, ...rest } = await rowsFor([args.company], args.said);
      const stop = problems({ ...rest, notOnPage: rest.notOnPage });
      // NOT ON THE PAGE: where the company IS, said plainly (browser 2026-10-21).
      if (stop && rest.offPage.length === 1) {
        const c = await companiesRepo.findByKey(rest.offPage[0].key).catch(() => null);
        if (c) {
          const on = c.closed_on ? ` on ${sayDay(String(c.closed_on instanceof Date ? c.closed_on.toISOString() : c.closed_on).slice(0, 10))}` : '';
          const reply = c.status === 'closed'
            ? `Yes, ${c.name} is closed (dissolved${on}). Its deals are stopped and in the Archive.`
            : `${c.name} is not winding down: its status is ${STATUS_LABEL[c.status] ?? c.status}, so it is not on the Winding down page.`;
          return { summary: reply, reply, computedReply: true };
        }
      }
      if (stop) return { summary: stop.replace('NOTHING HAS BEEN CHANGED. ', '') };
      const r = rows[0];
      const d = await repo.details(r.id);
      // THE AUDIT TRAIL (his call 2026-11-04): "who changed X", "history of X".
      const auditLine = (a) => {
        const v = (x) => (x == null || x === '' ? null : String(x).length > 80 ? `${String(x).slice(0, 77)}…` : String(x));
        const what = a.field === 'stage' ? [a.old_value && stageName(a.old_value), a.new_value && stageName(a.new_value)]
          : a.field === 'play' ? [a.old_value && (PLAY_LABEL[a.old_value] ?? a.old_value), a.new_value && (PLAY_LABEL[a.new_value] ?? a.new_value)]
          : a.field === 'status' ? [a.old_value && (STATUS_LABEL[a.old_value] ?? a.old_value), a.new_value && (STATUS_LABEL[a.new_value] ?? a.new_value)]
          : [v(a.old_value), v(a.new_value)];
        const change = what[0] && what[1] ? `${what[0]} → ${what[1]}` : what[1] ? `added ${what[1]}` : `removed ${what[0] ?? ''}`;
        const how = a.via === 'import' ? ` (closure import${a.source ? `, ${a.source}` : ''})` : a.via === 'undo' ? ' (undo)' : '';
        return `• ${sayDay(new Date(a.changed_at).toISOString().slice(0, 10))}, ${a.by_user ?? 'someone'}${how}: ${a.field} ${change}`;
      };
      if (args.history) {
        const reply = d.audit.length
          ? `${r.company_name}'s history (${d.audit.length} ${d.audit.length === 1 ? 'change' : 'changes'}, newest first):\n${d.audit.slice(0, 30).map(auditLine).join('\n')}${d.audit.length > 30 ? `\n…and ${d.audit.length - 30} older on its History in the Winding down page.` : ''}`
          : `${r.company_name} has no changes on its history yet.`;
        return { summary: reply, reply, computedReply: true };
      }
      const lines = [
        `${line(r, today)}${await aheadNote({ ...r, doc_count: d.docs.length })}`,
        // "none", never "—": her dash rule turns a dash into ", " and the
        // empty note read "Note:, No settlement set." (browser 2026-10-13).
        `Instructions: ${r.instructions || 'none'}`,
        `Liquidators: ${liquidatorsOf(r.liquidator).join(', ') || 'none'} · Official receiver: ${r.official_receiver || 'none'} · Blamed: ${r.blamed ? 'yes' : 'no'}`,
        `Other parties: ${(r.parties ?? []).map((x) => [x.name, x.position].filter(Boolean).join(', ')).join('; ') || 'none'}`,
        `Current play: ${PLAY_LABEL[r.play] ?? 'not set'}${r.stage_date ? ` · Stage date: ${sayDay(String(r.stage_date).slice(0, 10))}` : ''}${r.no_deals ? ' · No deals with us' : ''}`,
        `Last action: ${r.last_action || 'none'}`,
        `Unresolved matters: ${r.unresolved || 'none'}`,
        ...(r.prompts ? [`Prompts: ${r.prompts.length > 400 ? `${r.prompts.slice(0, 397)}…` : r.prompts}`] : []),
        `Note: ${r.note || 'none'}`,
        r.settlement != null ? `Settlement ${r.currency ?? ''} ${money(r.settlement)}, ${r.currency ?? ''} ${money(r.allocated ?? 0)} a month allocated to its live deals.` : 'No settlement set.',
        `Contact log (${d.comms.length}):${d.comms.length ? '' : ' none'}`,
        // "•", a real bullet: stripMarkdown takes "- " and "1." off a reply
        // (his screenshot 2026-10-13: the list had no bullets at all).
        ...d.comms.slice(0, 8).map((c) => `• ${sayDay(String(c.said_on).slice(0, 10))}: ${c.body}`),
        // "Documents (8):, open them" read as a typo (his screenshot 2026-10-14).
        `Documents (${d.docs.length})${d.docs.length ? ', open them with View documents:' : ': none'}`,
        ...d.docs.map((x) => `• ${x.file_name} (${READ_WORD[x.read_status] ?? x.read_status})`),
        `Stage history:${d.history.length ? '' : ' no changes'}`,
        ...d.history.slice(0, 6).map((h) => `• ${stageName(h.from_stage)} → ${stageName(h.to_stage)}, ${sayDay(new Date(h.changed_at).toISOString().slice(0, 10))}${h.by_user ? `, by ${h.by_user}` : ''}`),
        `Latest changes${d.audit.length ? '' : ': none'}`,
        ...d.audit.slice(0, 5).map(auditLine),
      ];
      // "IS CAPILANO CLOSED YET": the yes or no first (browser 2026-10-21). On this
      // page it is still winding down, so the answer is no.
      const yesNo = /^\s*(?:is|has|have|did|was)\b[^?]*\b(?:closed|dissolved|struck off|wound up|finished|done|gone|over)\b/i.test(lazy(fold(args.said ?? '')))
        ? `No, ${r.company_name} is not closed yet: it is still winding down, at ${stageText(r.stage, r.stage_kind)}.` : null;
      const reply = [yesNo, ...lines].filter(Boolean).join('\n');
      // EVERY DOCUMENT A CHIP, so the list can be opened (his call 2026-10-13).
      return { summary: reply, reply, computedReply: true, files: d.docs.map((x) => docView(r.id, x)) };
    }
    let rows = await repo.list();
    const want = args.stage !== undefined && args.stage !== '' ? stageFrom(args.stage) : undefined;
    if (args.stage && want === undefined) return { summary: `"${args.stage}" is not a stage. The stages are: ${Object.values(STAGE_LABEL).join(', ')}, or not set.` };
    if (args.stage) rows = rows.filter((r) => (r.stage ?? null) === want);
    if (args.group) rows = rows.filter((r) => (r.groups ?? []).some((g) => fold(g) === fold(args.group)));
    if (args.owner) rows = rows.filter((r) => (fold(args.owner) === 'none' ? !r.owner : fold(r.owner) === fold(args.owner)));
    const playWant = args.play ? playFrom(args.play) : undefined;
    if (args.play && playWant === undefined) return { summary: `"${args.play}" is not a current play. The plays are Wait, Chase, Leave and Do not contact, or none.` };
    if (args.play) rows = rows.filter((r) => (r.play ?? null) === playWant);
    if (typeof args.noDeals === 'boolean') rows = rows.filter((r) => Boolean(r.no_deals) === args.noDeals);
    if (args.unresolved === true) rows = rows.filter((r) => String(r.unresolved ?? '').trim());
    if (args.due) {
      rows = rows.filter((r) => {
        if (!r.deadline || r.stage === 'dissolved') return false;
        const days = Math.round((Date.parse(String(r.deadline).slice(0, 10)) - Date.parse(today)) / 86_400_000);
        return args.due === 'passed' ? days < 0 : days <= 7;
      });
    }
    const scope = [args.stage && stageName(want), args.group, args.owner && `owner ${args.owner}`,
      args.play && `play ${PLAY_LABEL[playWant] ?? 'not set'}`, args.noDeals === true ? 'no deals with us' : args.noDeals === false ? 'with deals' : null,
      args.unresolved === true ? 'with unresolved matters' : null, args.due === 'week' ? 'deadline passed or due this week' : args.due === 'passed' ? 'deadline passed' : null].filter(Boolean).join(', ');
    if (rows.length === 0) {
      const reply = `No companies in liquidation${scope ? ` (${scope})` : ''}.`;
      return { summary: reply, reply, computedReply: true };
    }
    // EVERY COMPANY'S DOCUMENTS ON ITS LINE (his call 2026-10-14), named so
    // each opens from her words. One query for all of them.
    const docsOf = new Map();
    for (const d of await repo.docNames().catch(() => [])) docsOf.set(d.liquidation_id, [...(docsOf.get(d.liquidation_id) ?? []), d]);
    const docsBit = (r) => {
      const docs = (docsOf.get(r.id) ?? []).sort((a, b) => b.id - a.id);
      return docs.length ? ` · documents: ${namesList(docs.map((d) => d.file_name))}` : ' · no documents';
    };
    const reply = `${rows.length} ${rows.length === 1 ? 'company' : 'companies'} in liquidation${scope ? ` (${scope})` : ''}:\n`
      + (await Promise.all(rows.slice(0, MAX_ROWS).map(async (r) => `• ${line(r, today)}${docsBit(r)}${(docsOf.get(r.id) ?? []).length ? await aheadNote(r) : ''}`))).join('\n')
      + (rows.length > MAX_ROWS ? `\n…and ${rows.length - MAX_ROWS} more on the Winding down page.` : '');
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
  // "null" SENT AS WORDS is no stage said (suite 2026-10-21: "take it off winding down").
  // Blank too, and any stage at all when it leaves the page (status active): it is no step.
  if (item.stage === null || /^\s*(?:null|undefined)?\s*$/i.test(String(item.stage ?? ''))
    || (STATUS_WORD(item.status) === 'active' && !stageFrom(item.stage))) item = { ...item, stage: undefined };
  if (item.stage !== undefined) {
    const s = stageFrom(item.stage);
    if (s === undefined) why.push(`"${item.stage}" is not a stage`);
    else set.stage = s;
    // "Own liq, a CVL" said in the one stage: its kind too.
    const k = s ? kindFrom(s, item.stage) : undefined;
    if (k && item.stageKind === undefined && item.proposalKind === undefined) set.stageKind = k;
  }
  // `proposalKind` is the name it had for a day; still read.
  const kindSaid = item.stageKind !== undefined ? item.stageKind : item.proposalKind;
  if (kindSaid !== undefined) {
    if (kindSaid === null || /^(?:none|clear|not said)$/i.test(String(kindSaid))) set.stageKind = null;
    else {
      // Read against the stage it will sit on: the one set here, else checked at apply.
      const onStage = set.stage ?? item.onStage;
      let k = onStage ? kindFrom(onStage, kindSaid) : undefined;
      // A KIND NAMES ITS STEP (suite 2026-10-14): "liquidation, a CVL" is
      // Own liq · CVL. Only when no stage or the bare Liquidation was said:
      // "active proposal, a CVL" is a clash, and asked. Liquidation's own
      // kinds first, so "creditors voluntary" is a CVL, not a voluntary strike off.
      if (!k && (!set.stage || set.stage === 'liquidation')) {
        const roads = set.stage === 'liquidation' ? ['own_liq', 'hmrc_liq'] : ['own_liq', 'hmrc_liq', 'dissolved', 'active_proposal'];
        const st = roads.find((r) => kindFrom(r, kindSaid));
        if (st) { k = kindFrom(st, kindSaid); if (st !== onStage) set.stage = st; }
      }
      // A STAGE SENT AS A KIND (suite 2026-10-15): "suspended" came as the
      // proposal's kind and was refused. A stage's own word is the stage.
      if (!k && !set.stage) {
        const asStage = stageFrom(kindSaid);
        if (asStage) { set.stage = asStage; set.stageKind = null; }
        else why.push(`"${kindSaid}" is not a kind of ${onStage ? stageName(onStage) : 'any stage'}`);
      } else if (!k) {
        // "active proposal, kind suspended" (suite 2026-10-21): a stage's own
        // word sent as the kind is the NEXT stage, said their way.
        const asStage = stageFrom(kindSaid);
        // eslint-disable-next-line global-require
        const next = (require('../../shared/windingDownSteps').ROADS[set.stage ?? onStage] ?? []).map(([st]) => st);
        if (asStage && next.includes(asStage)) { set.stage = asStage; set.stageKind = null; }
        else why.push(`"${kindSaid}" is not a kind of ${onStage ? stageName(onStage) : 'any stage'}`);
      }
      else set.stageKind = k;
    }
  }
  if (item.deadline !== undefined) {
    if (item.deadline === null || /^(?:none|clear|no deadline|remove)$/i.test(String(item.deadline).trim())) set.deadline = null;
    else {
      const d = dayFrom(item.deadline, today);
      if (!d) why.push(`"${item.deadline}" is not a day I can be sure of`);
      else set.deadline = d;
    }
  }
  for (const f of ['nextAction', 'instructions', 'liquidator', 'note', 'officialReceiver', 'lastAction', 'unresolved', 'prompts']) {
    if (item[f] !== undefined && item[f] !== null) set[f] = String(item[f]).trim().slice(0, 4000);
  }
  // JOINT LIQUIDATORS: a list sent is one a line.
  if (Array.isArray(item.liquidators)) set.liquidator = item.liquidators.map((x) => String(x).trim()).filter(Boolean).join('\n');
  if (item.play !== undefined) {
    const pl = item.play === null ? null : playFrom(item.play);
    if (pl === undefined) why.push(`"${item.play}" is not a current play (Wait, Chase, Leave, Do not contact)`);
    else set.play = pl;
  }
  if (item.stageDate !== undefined) {
    if (item.stageDate === null || /^(?:none|clear|remove)$/i.test(String(item.stageDate).trim())) set.stageDate = null;
    else {
      const d = dayFrom(item.stageDate, today);
      // A VAGUE TIME IS LEFT OUT, never a block: "brightwell got struck off last
      // week" was refused whole for its stage date, which is only a note of when
      // (liq run 2026-11-04). The deadline still needs a day; this does not.
      if (d) set.stageDate = d;
    }
  }
  // OTHER INVOLVED PARTIES and single joint liquidators, worked out against the row later.
  const people = {
    addLiquidator: [item.addLiquidator].flat().filter((x) => x && String(x).trim()).map((x) => String(x).trim()),
    removeLiquidator: [item.removeLiquidator].flat().filter((x) => x && String(x).trim()).map((x) => String(x).trim()),
    addParty: [item.addParty].flat().filter((x) => x && String(x.name ?? '').trim()).map((x) => ({ name: String(x.name).trim().slice(0, 200), position: String(x.position ?? '').trim().slice(0, 200) })),
    removeParty: [item.removeParty].flat().filter((x) => x && String(x).trim()).map((x) => String(x).trim()),
  };
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
  return { set, log, why, people };
}

/** The parties and liquidators said, against the row: what changes, or why not. */
function peopleFor(row, people, set) {
  const why = [];
  const parties = { add: [], remove: [] };
  if (people.addLiquidator.length || people.removeLiquidator.length) {
    let list = liquidatorsOf(set.liquidator ?? row.liquidator);
    for (const n of people.removeLiquidator) {
      const hit = list.find((x) => fold(x) === fold(n)) ?? list.find((x) => fold(x).includes(fold(n)));
      if (!hit) why.push(`${row.company_name} has no liquidator "${n}" (${list.join(', ') || 'none'})`);
      else list = list.filter((x) => x !== hit);
    }
    for (const n of people.addLiquidator) if (!list.some((x) => fold(x) === fold(n))) list.push(n);
    set.liquidator = list.join('\n');
  }
  const have = row.parties ?? [];
  for (const n of people.removeParty) {
    const hit = have.find((x) => fold(x.name) === fold(n)) ?? have.find((x) => fold(x.name).includes(fold(n)));
    if (!hit) why.push(`${row.company_name} has no other party "${n}" (${have.map((x) => x.name).join(', ') || 'none'})`);
    else parties.remove.push(hit);
  }
  for (const p of people.addParty) if (!have.some((x) => fold(x.name) === fold(p.name))) parties.add.push(p);
  return { parties, why };
}
const partyWords = (p) => [p.name, p.position].filter(Boolean).join(', ');

const ITEM = {
  type: 'object',
  properties: {
    company: { type: 'string', description: 'As they named it. Only an exact name is a company: when they named it, their spelling, never corrected by you; when they did not ("its", "that one"), the name exactly as the page list shows it, never as a document spells it ("Pinecrest Ltd" for the page "Pinecrest" is another company).' },
    status: {
      type: 'string',
      description: 'Only to move the company itself: "winding down" puts it on this page (its deals keep paying); '
        + '"closed" when it HAS BEEN struck off or dissolved (stage Dissolved; closes it and stops its live deals); '
        + '"active" to take it OFF the page (petition dismissed, debt paid, trading again: never by clearing the stage). Leave out otherwise. '
        + 'A step said for a company not winding down yet ("strike off X", "HMRC petitioned X") puts it on by itself.',
    },
    stage: { type: 'string', description: 'active, active proposal (a strike off proposed), strike off suspended, strike off rejected (or cancelled), liquidation, own liq, HMRC liq, dissolved (struck off is dissolved), or not set.' },
    stageKind: { type: 'string', description: 'The stage\'s kind, as they said it. Active proposal: compulsory or voluntary. Own liq: MVL or CVL. HMRC liq: petition filed or winding-up order. Dissolved: struck off or after liquidation.' },
    deadline: { type: 'string', description: 'THEIR WORDS ("Friday", "30 Nov", "end of month"), or "none". Never work the date out yourself.' },
    nextAction: { type: 'string' },
    instructions: { type: 'string', description: 'The current instructions.' },
    owner: { type: 'string', description: 'An admin username, or "none".' },
    blamed: { type: 'boolean' },
    liquidator: { type: 'string', description: 'The WHOLE list of liquidators, one a line (joint liquidators). To add or take off one, use addLiquidator / removeLiquidator.' },
    addLiquidator: { type: 'string', description: 'One joint liquidator to add.' },
    removeLiquidator: { type: 'string', description: 'One liquidator to take off, by name.' },
    officialReceiver: { type: 'string', description: 'The Official Receiver ("the OR"): a name and office, or "appointed as liquidator". Replaces it.' },
    addParty: {
      type: 'object',
      description: 'An other involved party to add: someone on the case besides the liquidator (an examiner, investigator, officer).',
      properties: { name: { type: 'string' }, position: { type: 'string', description: 'Their job title, as said.' } },
      required: ['name'],
    },
    removeParty: { type: 'string', description: 'An other involved party to take off, by name.' },
    lastAction: { type: 'string', description: 'What WE did last (sent, filed, paid, signed), only when they call it the last action or say what we did. Someone ringing, emailing or writing to us ("begbies rang asking for X") is a `log` line, not this.' },
    unresolved: { type: 'string', description: 'The unresolved matters.' },
    play: { type: 'string', description: 'Current play, in THEIR words: wait ("park it", "on hold", "nothing we can do till X", "stop chasing"), chase, leave, or do not contact; "none" clears it. A play said is this field, never instructions.' },
    prompts: { type: 'string', description: 'Prompts: what the director said, who was blamed and why. Replaces the whole text.' },
    stageDate: { type: 'string', description: 'The Companies House date of the stage (the gazette, the suspension), in THEIR words. Only when they give a day; a vague time ("last week") is left out.' },
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
    'Change companies on the Winding down page: stage, stage date, deadline, next action, instructions, owner, blamed, '
    + 'liquidators (joint ones a line each; add or take off one), official receiver, other involved parties (add or take off), '
    + 'last action, unresolved matters, current play (wait, chase, leave, do not contact), prompts, note, and add contact log lines. ONE CALL FOR THE WHOLE REQUEST, however messy: one item per '
    + 'company, every change for it in that item. For the same change to many, use `where` and `set`. '
    + 'Pass their words; code works out dates and names. Call with confirmed false first and show the lines; '
    + 'true only after yes. `undo` true puts back the last change you made here AT ONCE (no confirm). '
    + '"Every company in liquidation" is `where` {} with `set`. PUTTING COMPANIES INTO WINDING DOWN is here too, '
    + 'one or many: an item each with status "winding down" and any stage they said ("strike off X" is Active proposal). '
    + '"X has been struck off" / "X is dissolved" is stage dissolved: the company is CLOSED in the same yes (dissolved and closed are one).',
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
    if (args.undo) return undoLiquidations(args.confirmed === true);
    const today = currentDay();
    const owners = await repo.owners();

    // Who, and what for each.
    let targets = [];
    // "PINECREST N BRIGHTWELL" arrived as company "N Brightwell" (blind run 2026-10-22).
    if (Array.isArray(args.items)) {
      args = { ...args, items: args.items.map((i) => (typeof i?.company === 'string' ? { ...i, company: i.company.replace(/^\s*(?:n|and|&|\+|also|plus)\s+/i, '').replace(/\bln\b/i, 'lane').replace(/\brd\b/i, 'road') } : i)) };
    }
    /**
     * EACH COMPANY'S OWN WORDS SAY CLOSE OR WIND DOWN. "pinecrest can be closed
     * off and put brightwell into winding down" came as both winding down
     * (held-out run 2026-10-22). Only before the yes, and the corrected call is
     * the one held, so the yes saves what the preview showed.
     */
    /**
     * A CLOSE SAID FOR LATER IS NOT A CLOSE NOW. "close pinecrest at the end of
     * the month" was previewed as "at the end of October" and the yes closed it
     * that minute, stopping its deals (blind park run 2026-10-22). A close is never
     * on a date (his call 2026-10-15), so the deadline carries the date instead.
     */
    /**
     * A PERSON TAKEN OFF THE CASE IS NOT THE COMPANY TAKEN OFF THE PAGE. "remove
     * chloe fletcher from harbor nine, shes not on it anymore" was previewed as
     * Harbor Nine back to Active, and the yes took it off the page; "take gareth
     * lyle off quarry lane" tried to close it (blind sheet run 2026-11-04). When
     * their words name someone on that company's case (a liquidator line or a
     * party) with a removal, and say nothing about the company itself, the
     * status and stage go and the removal of that person is what is shown.
     */
    let reworded = false;
    if (Array.isArray(args.items) && args.confirmed !== true && !args.undo && args.said) {
      const words = lazy(fold(String(args.said))).replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ');
      const takenOff = /\b(?:off|remove\w*|take\w*|drop\w*|delete\w*|no longer|not on (?:it|the case)|anymore|any more|left|gone|replac\w*)\b/.test(words);
      const companyMoved = /\b(?:close[ds]?|closing|dissolv\w*|struck off|trading|active again|back to active|off (?:the )?(?:winding down|page|list)|winding down|wind(?:ing)?(?: \w+){0,2} down|petition (?:was |got )?dismissed)\b/.test(words);
      if (takenOff && !companyMoved) {
        const all = await repo.list();
        const named = (n) => { const f = fold(n).replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim(); return f.includes(' ') && words.includes(f); };
        args = {
          ...args,
          items: args.items.map((i) => {
            if (typeof i?.company !== 'string') return i;
            const row = all.find((r) => sameCompany(r, i.company));
            if (!row) return i;
            const lq = liquidatorsOf(row.liquidator).find(named);
            const pt = (row.parties ?? []).find((x) => named(x.name));
            if (!lq && !pt) return i;
            const { status, stage, stageKind, ...rest } = i;
            // Held as shown: the yes replayed the model's own call and closed
            // Quarry Lane while the preview said one liquidator off (sheet run 2026-11-04).
            reworded = true;
            if (lq && !rest.removeLiquidator && !rest.liquidator) rest.removeLiquidator = lq;
            if (pt && !rest.removeParty) rest.removeParty = pt.name;
            return rest;
          }),
        };
      }
    }
    const LATER = /\bend of (?:this|the|next) month\b|\b(?:at|by|on|in|from|for|after|come|until|till) (?:next month|the (?:1st|first|start|end) of (?:next|the) month|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b|\bnext month\b|\bnxt month\b/i;
    const closing = [...(args.items ?? []), args.set ?? {}].some((i) => STATUS_WORD(i?.status) === 'closed' || stageFrom(i?.stage) === 'dissolved');
    // The shared reading of a later time too: "at month end" got past LATER alone (held-out park run 2026-10-22).
    // eslint-disable-next-line global-require
    if (closing && args.confirmed !== true && (LATER.test(String(args.said ?? '')) || require('../../shared/when.helper').saysLater(args.said))) {
      const names = (args.items ?? []).map((i) => i?.company).filter(Boolean).join(', ') || 'it';
      return {
        summary: `NOTHING HAS BEEN CHANGED. They want ${names} closed LATER ("${String(args.said).trim()}"). A close is never `
          + 'scheduled on a date: it happens on the Winding down page when the company is dissolved. Say that in one line, '
          + `and offer instead to set ${names}'s deadline to that date with next action "close it", or to close it now. `
          + 'Do not close anything.',
      };
    }
    /**
     * NO CLOSE THAT NOBODY SAID AND NOTHING SHOWS. "wrenfeild tannery got the court
     * thing, theyre being wound up. page is behind fix it" was previewed as
     * Dissolved, and the yes closed it and stopped its deals, while its only
     * document was a petition (blind docs run 2026-10-22). Being wound up is a
     * winding-up order, not the end. A close needs their words (closed, dissolved,
     * struck off) or a document on file that shows it.
     */
    // A CLOSE THEY ASKED ONLY ABOUT rides along with ones they asked to close:
    // "pinecrest is finished close it … whats happening with brightwell btw"
    // previewed Brightwell → Dissolved from its Gazette in the same yes (blind
    // suite 2026-11-04). In a list, each company's own words must ask to close it.
    if (closing && args.confirmed !== true && !args.undo && (args.items ?? []).length > 1) {
      const CLOSE_SAID = /\b(?:close[ds]?|closing|shut(?: down)?|dissolv\w*|struck off|strike (?:it |them )?off|final gazette|gazette|gone|finished|over)\b/i;
      const text = String(args.said ?? '');
      const closingItems = args.items.filter((x) => STATUS_WORD(x?.status) === 'closed' || stageFrom(x?.stage) === 'dissolved');
      const own = (i) => {
        const clause = clauseFor(String(i.company ?? ''), text);
        return clause !== text && CLOSE_SAID.test(clause);
      };
      const asked = closingItems.filter(own);
      const unasked = closingItems.filter((i) => !own(i) && clauseFor(String(i.company ?? ''), text) !== text);
      if (asked.length && unasked.length) {
        const names = unasked.map((i) => i.company).join(', ');
        return {
          summary: `NOTHING HAS BEEN CHANGED. They did not ask to close ${names}: they only asked about it. Call this again `
            + `WITHOUT ${names}, and answer their question about it on its own; if its documents show it dissolved, `
            + 'say so and offer that close separately at the end.',
        };
      }
    }
    if (closing && args.confirmed !== true && !args.undo) {
      // THE LAST TWO TURNS, not only this one: "drop brightwell" after "close
      // quarry lane pinecrest brightwell" changes a close they DID ask for, and
      // it still previews (blind suite 2026-11-04).
      const words = lazy(fold(`${args.said ?? ''} ${args.saidRecent ?? ''}`));
      const theySaid = /\b(?:close[ds]?|closing|shut(?: down)?|dissolv\w*|struck off|final gazette|gone|finished|over)\b/.test(words.replace(/\bwound up\b|\bwinding up\b/g, ' '));
      if (!theySaid) {
        const all = await repo.list();
        const unproven = [];
        for (const i of [...(args.items ?? [])].filter((x) => STATUS_WORD(x?.status) === 'closed' || stageFrom(x?.stage) === 'dissolved')) {
          const row = all.find((r) => sameCompany(r, i.company));
          // eslint-disable-next-line no-await-in-loop
          if (row && await closeCaution(row)) unproven.push(row);
        }
        if (unproven.length) {
          const names = unproven.map((r) => r.company_name).join(', ');
          const at = unproven.map((r) => `${r.company_name}: ${stageText(r.stage, r.stage_kind)}`).join('; ');
          return {
            summary: `NOTHING HAS BEEN CHANGED. Do NOT close or dissolve ${names}: they did not say it is closed, dissolved or struck off, `
              + `and nothing on file shows it dissolved (no Final Gazette, no dissolution notice). The page says ${at}. `
              + '"Being wound up" means a winding-up order (HMRC liq, kind winding-up order), never dissolved. If their words '
              + 'only say what a document says, check it with liquidation_next_step first. Tell them in one or two lines what the '
              + 'documents show and ask whether they have the winding-up order, or want the stage set to it. Change nothing.',
          };
        }
      }
    }
    /**
     * AN OWNER THEY NEVER GAVE: "the OR handed it over, liquidator is Kroll" sent
     * owner "OR" (the Official Receiver), was refused as no admin, and the
     * liquidator was never saved (held-out run 2026-10-22). No owner word, no owner.
     */
    if (Array.isArray(args.items) && !/\b(?:owner|owned by|owns|assign\w*|give (?:it|them) to|hand (?:it|them) to|handled by|looks? after|looking after|in charge)\b/i.test(`${args.said ?? ''} ${args.saidRecent ?? ''}`)) {
      args = { ...args, items: args.items.map((i) => (i?.owner && !owners.some((o) => fold(o) === fold(i.owner)) && !/^(?:none|nobody|no one|clear)$/i.test(String(i.owner).trim()) ? (({ owner, ...rest }) => rest)(i) : i)) };
    }
    if (Array.isArray(args.items) && args.confirmed !== true && args.said) {
      const said = lazy(fold(args.said));
      args = {
        ...args,
        items: args.items.map((i) => {
          if (typeof i?.company !== 'string' || !['closed', 'liquidation'].includes(STATUS_WORD(i.status) ?? (stageFrom(i.stage) === 'dissolved' ? 'closed' : null))) return i;
          const own = fold(clauseFor(i.company, said));
          if (own === said && args.items.length > 1) return i;
          const closes = /\b(?:close[ds]?|closing|shut|dissolv\w*|struck off)\b/.test(own.replace(/\bclos(?:ing|ed)? (?:down )?(?:status|stage)\b/g, ''));
          const winds = /\bwind(?:ing)?(?: \w+){0,3}? down\b|\bwinding down\b|\bgoing under\b|\binto liquidation\b|\bgoing bust\b/.test(own);
          const want = closes && !winds ? 'closed' : winds && !closes ? 'liquidation' : null;
          const has = STATUS_WORD(i.status) ?? 'closed';
          if (!want || want === has) return i;
          reworded = true;
          const { stage, stageKind, ...rest } = i;
          return want === 'closed' ? { ...rest, status: 'closed' } : { ...rest, status: 'winding down', ...(stageFrom(stage) && stageFrom(stage) !== 'dissolved' ? { stage, stageKind } : {}) };
        }),
      };
    }
    // "EVERY COMPANY" said as one item with no name, or "all": the same as where {}.
    // "companies in liquidation", "all the companies on the page" too: it was
    // passed as a company name and refused as unknown (suite 2026-10-14).
    const ALL = /^\s*(?:\*|all|every(?:one|thing)?|(?:all (?:of )?(?:the )?|every |each )?(?:them|compan(?:y|ies))(?: (?:in|on|under) (?:liquidation|the (?:liquidations )?page|the list))?|all (?:the )?liquidations)?\s*$/i;
    // EVERY ITEM NAMELESS OR "ALL", with or without a `where` beside it: she
    // sent company "" AND where {} and was told "" is no company (suite
    // 2026-10-14). The items' changes become the set; any `where` is kept.
    if (Array.isArray(args.items) && args.items.length && args.items.every((i) => ALL.test(String(i?.company ?? '')))) {
      const set = Object.assign({}, ...args.items.map(({ company, ...rest }) => rest), args.set ?? {});
      args = { ...args, items: undefined, where: args.where ?? {}, set };
    }
    // A CHANGE WITH NO "WHO", when they said every or all: every company on the page.
    if (!args.where && !(args.items ?? []).length && args.set && /\b(?:every|all|each)\b/i.test(String(args.said ?? ''))) {
      args = { ...args, where: {} };
    }
    // ITEMS NAMED AND THE CHANGE IN `set`: the change is each item's (suite 2026-10-21:
    // "wind down ironleaf and brightwell" came so, and was refused as not on the page).
    if (Array.isArray(args.items) && args.items.length && args.set) {
      args = { ...args, items: args.items.map((i) => ({ ...args.set, ...i })), set: undefined, where: undefined };
    }
    // WINDING DOWN "EVERY COMPANY ON THE PAGE" means nothing: they are on it already.
    if (args.where && STATUS_WORD(args.set?.status) === 'liquidation' && !(args.items ?? []).length) {
      return { summary: 'NOTHING HAS BEEN CHANGED. To put companies into winding down, name each one as an item (company + status "winding down"): they are not on the page yet, so `where` cannot reach them.' };
    }
    if (Array.isArray(args.items) && args.items.length) {
      const { rows, ...rest } = await rowsFor(args.items.map((i) => i.company), args.said);
      // NOT ON THE PAGE YET (his call 2026-10-14): a company told to wind down,
      // or given a step, comes on with it. Anything else for it is still refused.
      const joins = [];
      for (const off of rest.offPage) {
        const its = args.items.filter((i) => sameCompany({ company_key: off.key, company_name: off.name }, i.company)
          || (off.said && companyKey(off.said) === companyKey(i.company)));
        const item = Object.assign({}, ...its);
        const s = item.stage !== undefined ? stageFrom(item.stage) : undefined;
        const kindStage = item.stageKind ? ['own_liq', 'hmrc_liq', 'dissolved', 'active_proposal'].find((st) => kindFrom(st, item.stageKind)) : undefined;
        if (!its.length || !(STATUS_WORD(item.status) || (s && s !== 'active') || kindStage)) continue;
        // eslint-disable-next-line no-await-in-loop
        const company = await companiesRepo.findByKey(off.key).catch(() => null);
        if (!company) continue;
        joins.push({ company, item: { ...item, company: company.name } });
      }
      const joined = joins.map((j) => j.company.name);
      const stop = problems({ ...rest, notOnPage: rest.notOnPage.filter((n) => !joined.includes(n)) });
      if (stop) return { summary: stop };
      for (const { company, item } of joins) {
        const row = { id: null, company_name: company.name, company_key: companyKey(company.name), stage: null, stage_kind: null, pay_status: company.status };
        targets.push({ row, item, company });
      }
      const byName = new Map();
      for (const i of args.items) {
        const row = rows.find((r) => sameCompany(r, i.company));
        if (!row) continue;
        // TWO ITEMS FOR ONE COMPANY are one: the later words win per field.
        const was = byName.get(row.id);
        byName.set(row.id, { row, item: { ...(was?.item ?? {}), ...i } });
      }
      targets = [...targets, ...byName.values()];
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
          summary: `No company on the Winding down page matches ${JSON.stringify(args.where)}. Nothing has been changed. `
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
      // `onStage`: a kind said alone ("pinecrest is a CVL") is read against the stage it has.
      const { set, log, why, people } = await cleanItem({ ...item, onStage: row.stage }, today, owners);
      const { parties, why: peopleWhy } = peopleFor(row, people, set);
      why.push(...peopleWhy);
      if (why.length) { refused.push(`${row.company_name}: ${why.join('; ')}`); continue; }
      // eslint-disable-next-line no-await-in-loop
      await ownWords(set, row, `${args.said ?? ''} ${args.saidRecent ?? ''}`);
      // THE COMPANY'S OWN STATUS, when this act moves it (his call 2026-10-14):
      // stage Dissolved is the end of either road, so the company is CLOSED
      // and its deals stop (one ending, migration 091); a step for a company
      // not winding down yet puts it on the page.
      const statusNow = row.pay_status ?? 'liquidation';
      const said = STATUS_WORD(item.status);
      let statusTo = null;
      if (said === 'active' && statusNow === 'liquidation' && set.stage !== 'dissolved') statusTo = 'active';
      else if (said === 'closed' || set.stage === 'dissolved') statusTo = 'closed';
      else if (said === 'liquidation' || (statusNow !== 'liquidation' && set.stage)) statusTo = 'liquidation';
      if (statusTo === 'closed' && set.stage === undefined && row.stage !== 'dissolved') set.stage = 'dissolved';
      // HOW IT ENDED, when they did not name the kind: their words, else its road.
      if (set.stage === 'dissolved' && set.stageKind == null) {
        // THE YES ONLY SAYS "yes": the words that asked are in saidRecent (suite 2026-10-14).
        // ITS OWN PART OF THE MESSAGE (2026-10-15): "ironleaf was struck off and
        // pinecrest dissolved after the liquidation" is two different endings.
        const heard = `${args.said ?? ''} ${args.saidRecent ?? ''}`;
        let own = `${clauseFor(row.company_name, heard)} ${item.stage ?? ''} ${item.status ?? ''}`;
        // "QUARRY LANE AND PINECREST HAVE BOTH BEEN STRUCK OFF": its own part
        // names no ending, so the ending said for them all is its own (suite 2026-10-15).
        if (!/strike|struck|liquidat/i.test(own)) own = `${heard} ${item.stage ?? ''} ${item.status ?? ''}`;
        set.stageKind = /strike|struck/i.test(own) ? 'struck_off'
          : /liquidat/i.test(own) ? 'after_liquidation'
          : (['own_liq', 'hmrc_liq', 'liquidation'].includes(row.stage) ? 'after_liquidation'
            : (['active_proposal', 'strike_off_suspended'].includes(row.stage) ? 'struck_off' : null));
      }
      if (statusTo === statusNow) statusTo = null;
      // DISSOLVED ONLY FROM WINDING DOWN (his call 2026-10-15): a company not
      // winding down is offered that first, never dissolved in one step.
      if (statusTo === 'closed' && statusNow !== 'liquidation') {
        refused.push(`${row.company_name} is not winding down, and a company is dissolved only from the Winding down page. `
          + 'Offer to put it into winding down (status "winding down") first; do not dissolve it');
        continue;
      }
      const changes = Object.entries(set).filter(([f, v]) => (row[COLUMN[f]] ?? null) !== (v ?? null)
        && !((f === 'deadline' || f === 'stageDate') && String(row[COLUMN[f]] ?? '').slice(0, 10) === String(v ?? '')));
      const partiesMove = parties.add.length || parties.remove.length;
      if (!changes.length && !log && !statusTo && !partiesMove) continue;
      // eslint-disable-next-line no-await-in-loop
      const stops = statusTo === 'closed' ? await wouldStop(row.company_name) : null;
      // eslint-disable-next-line no-await-in-loop
      const resumes = statusTo === 'liquidation' && companiesRepo.isTerminal(statusNow) ? await wouldResume(row.company_name) : null;
      // eslint-disable-next-line no-await-in-loop
      const joins = statusTo === 'liquidation' ? (await defaultReviewIds(row.company_name)).length : 0;
      // eslint-disable-next-line no-await-in-loop
      const caution = statusTo === 'closed' && row.id ? await closeCaution(row) : null;
      plan.push({ row, set: Object.fromEntries(changes), log, parties, caution, status: statusTo ? { from: statusNow, to: statusTo, stops, resumes, joins } : null });
    }
    if (refused.length) {
      return { summary: `NOTHING HAS BEEN CHANGED. ${refused.join('. ')}. Ask them, then call again with the whole request.` };
    }
    if (!plan.length) {
      const reply = 'Nothing to change: those values are already set.';
      return { summary: reply, reply, computedReply: true };
    }

    const lines = plan.map(({ row, set, log, parties, status, caution }) => {
      const parts = [];
      if (status) {
        const deals = status.to === 'active' ? ', off the Winding down page; its deals keep paying and leave the monthly Review'
          : status.stops
          ? (status.stops.count ? `, stops its ${status.stops.count} live ${status.stops.count === 1 ? 'deal' : 'deals'} (${status.stops.currency} ${money(status.stops.money)} a month)` : ', no live deals to stop')
          : status.resumes?.count ? `, puts back its ${status.resumes.count} stopped ${status.resumes.count === 1 ? 'deal' : 'deals'}` : `, its deals keep paying${status.joins ? ` and ${status.joins} ${status.joins === 1 ? 'goes' : 'go'} to Review every month` : ''}`;
        parts.push(`status ${STATUS_LABEL[status.from] ?? status.from} → ${STATUS_LABEL[status.to]}${deals}`);
      }
      parts.push(...Object.entries(set).map(([f, v]) => `${FIELD_LABEL[f]} ${show(f, row[COLUMN[f]])} → ${show(f, v)}`));
      if (log) parts.push(`log "${log.body}" (${sayDay(log.saidOn)})`);
      for (const p of parties?.add ?? []) parts.push(`add party "${partyWords(p)}"`);
      for (const p of parties?.remove ?? []) parts.push(`take off party "${partyWords(p)}"`);
      return `• ${row.company_name}: ${parts.join('; ')}${caution ? `\n  ⚠ ${caution}` : ''}`;
    });
    const pending = confirmFirst(args.confirmed, {
      act: 'change these companies on the Winding down page',
      count: plan.length,
      noun: 'company',
      plural: 'companies',
      keeps: plan.some((p) => p.status) ? 'Nothing else on the sheet changes.' : 'Their company status and pay do not change.',
      lines,
      // Matched against what she read out, which drops the "1." numbering.
      identity: lines.map((l) => l.split('\n  ⚠')[0].replace(/^\d+\.\s*/, '')).join(' '),
    });
    if (pending) {
      const also = await alsoAsked(args.said, plan.map((p) => p.row.company_name), today);
      return {
        ...pending,
        ...(also ? { summary: `${pending.summary}\n\nTHEY ALSO ASKED, answer it after the preview, word for word: ${also}` } : {}),
        // "STRIKE OFF IS BACK ON" was asked "compulsory or voluntary?" though the
        // preview was ready (regression run 2026-10-22): a kind not said stays not set.
        ...(plan.some((p) => p.set?.stage && STAGE_KINDS[p.set.stage] && !p.set.stageKind && !p.row.stage_kind)
          ? { summary: `${also ? `${pending.summary}\n\nTHEY ALSO ASKED, answer it after the preview, word for word: ${also}` : pending.summary}\n\nA kind they did not say stays Not set: show the preview as it is, do not ask for the kind.` } : {}),
        aimedAt: plan.map((p) => p.row.company_name),
        /**
         * "ALL THE WINDING DOWN ONES" HELD AS THE COMPANIES SHOWN, by name: "not
         * quarry lane" then had no list to take it out of, and the yes was asked
         * again (blind run 2026-10-22). The yes also lands on exactly these.
         */
        ...(args.where ? { redirect: { name: 'update_liquidation', args: { items: targets.filter((t) => plan.some((p) => p.row.id === t.row.id)).map((t) => t.item) } } } : {}),
        // Held as corrected (see `reworded`).
        ...(reworded && !args.where ? { redirect: { name: 'update_liquidation', args: { items: args.items } } } : {}),
      };
    }

    // WRITE, keeping what each replaced for undo.
    const restore = { rows: [], comms: [], statuses: [], parties: [], partiesBack: [] };
    let statusMoved = false;
    for (const p of plan) {
      const { set, log, status, parties } = p;
      // INTO winding down first: the row is the page's once the status is.
      if (status?.to === 'liquidation') {
        // eslint-disable-next-line no-await-in-loop
        // ITS DEALS JOIN THE REVIEW (his call 2026-10-15): the dialog's default.
        // eslint-disable-next-line no-await-in-loop
        await applyCompanyStatus(p.row.company_name, { status: 'liquidation', via: 'diane', byUser: BY, reviewMonthlyDealIds: await defaultReviewIds(p.row.company_name) });
        restore.statuses.push({ name: p.row.company_name, status: status.from });
        statusMoved = true;
      }
      if (p.row.id === null) {
        // eslint-disable-next-line no-await-in-loop
        const made = await repo.ensureRow(p.row.company_name);
        p.row = { ...made, company_name: p.row.company_name };
      }
      const { row } = p;
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
      for (const party of parties?.add ?? []) {
        // eslint-disable-next-line no-await-in-loop
        const made = await repo.addParty(row.id, party, BY);
        restore.parties.push(made.id);
      }
      if (parties?.remove?.length) {
        // eslint-disable-next-line no-await-in-loop
        const gone = await repo.removeParties(row.id, parties.remove.map((x) => x.id), BY);
        restore.partiesBack.push(...gone.map((x) => ({ id: row.id, name: x.name, position: x.position })));
      }
      // OUT, closed or active, last: the stage says how it ended before it leaves the page.
      if (status?.to === 'closed' || status?.to === 'active') {
        // eslint-disable-next-line no-await-in-loop
        await applyCompanyStatus(row.company_name, { status: status.to, via: 'diane', byUser: BY });
        restore.statuses.push({ name: row.company_name, status: status.from });
        statusMoved = true;
      }
    }
    // READ BACK: every field as written, or it is not reported as done.
    const after = new Map();
    for (const { row } of plan) after.set(row.id, await repo.findById(row.id)); // eslint-disable-line no-await-in-loop
    for (const { row, status } of plan.filter((p) => p.status)) {
      // eslint-disable-next-line no-await-in-loop
      const c = await companiesRepo.findByKey(fold(row.company_name)).catch(() => null);
      if (c?.status !== status.to) after.set(row.id, null);
    }
    const failed = plan.filter(({ row, set, status }) => (status && !after.get(row.id)) || Object.entries(set).some(([f, v]) => {
      const got = after.get(row.id)?.[COLUMN[f]] ?? null;
      if (f === 'deadline' || f === 'stageDate') {
        const day = got instanceof Date ? `${got.getFullYear()}-${String(got.getMonth() + 1).padStart(2, '0')}-${String(got.getDate()).padStart(2, '0')}` : String(got ?? '').slice(0, 10);
        return day !== String(v ?? '');
      }
      return got !== (v ?? null);
    }));
    await undoRepo.record('liquidations', `${plan.length} ${plan.length === 1 ? 'company' : 'companies'} on the Winding down page`, restore, BY);
    broadcast(null, 'liquidations:changed', { via: 'agent' });
    if (statusMoved) {
      broadcast(null, 'companies:changed', { action: 'updated', via: 'agent' });
      broadcast(null, 'master-sheet:changed', { action: 'company-status', via: 'agent' });
      broadcast(null, 'people:changed', { action: 'company-status', via: 'agent' });
    }
    const reply = failed.length
      ? `Saved, but ${failed.map((p) => p.row.company_name).join(', ')} did not read back as written: check them on the Winding down page.`
      : `Done. ${lines.map((l) => l.split('\n  ⚠')[0]).join('\n')}`;
    return { summary: reply, reply, computedReply: true };
  },
};

/**
 * THEIR OWN WORDS FOR THIS COMPANY over her reading (suite 2026-10-21):
 * "companies house cancelled the strike off" came as stage Active, "strike
 * off is suspended now" as Active proposal, and "the strike off is back on"
 * gained a Compulsory nobody said. Only a stage she sent is corrected, only
 * to its flowchart neighbour, and a kind stays only when their words or
 * the documents they pointed at say it.
 */
async function ownWords(set, row, heard) {
  const own = fold(clauseFor(row.company_name, heard));
  // "GOT WOUND UP BY THE COURT" is the winding-up order, said or not (suite 2026-10-21).
  if ([undefined, null, 'liquidation', 'hmrc_liq'].includes(set.stage) && set.stageKind !== 'winding_up_order'
    && [null, 'liquidation', 'hmrc_liq'].includes(row.stage ?? null)
    && /\bwound[\s-]?up\b|\bwinding[\s-]?up order\b|\bofficial receiver (?:took|has taken|is) /.test(own)
    && !/\bpetition\b/.test(own)) {
    set.stage = 'hmrc_liq'; set.stageKind = 'winding_up_order';
  }
  const strikeOff = /strike[\s-]?off|striking off/;
  if (['active', 'active_proposal', null].includes(set.stage) && set.stage !== undefined && strikeOff.test(own)) {
    if (/(?:cancel\w*|reject\w*|withdr[ae]w\w*|refus\w*|won'?t go ahead|not going ahead)/.test(own) && !/objection\w*\s+(?:is |was |has been |got )?withdr|back on/.test(own)) {
      set.stage = 'strike_off_rejected'; set.stageKind = null;
    } else if (/suspend\w*|objected|objection/.test(own) && !/withdr\w*|back on|resum\w*|lifted|going ahead/.test(own)) {
      set.stage = 'strike_off_suspended'; set.stageKind = null;
    }
  }
  if (set.stageKind && set.stageKind !== row.stage_kind) {
    const on = set.stage ?? row.stage;
    const said = kindFrom(on, own) ?? kindFrom(on, heard);
    // THE COMPANY'S OWN DOCUMENTS say it too: "is the page right" read them.
    if (said !== set.stageKind && !(row.id && await docsSayKind(row.id, on, set.stageKind))) delete set.stageKind;
  }
  // A STAGE WITH ITS KIND LEFT OUT: their words, else the documents', fill it
  // ("pinecrest docs say its a cvl" came as Own liq alone, suite 2026-10-21).
  if (set.stage && STAGE_KINDS[set.stage] && set.stage !== 'dissolved' && set.stageKind === undefined && !row.stage_kind) {
    const k = kindFrom(set.stage, own);
    if (k) set.stageKind = k;
    else if (row.id) {
      for (const kind of Object.keys(STAGE_KINDS[set.stage])) {
        // eslint-disable-next-line no-await-in-loop
        if (await docsSayKind(row.id, set.stage, kind)) { set.stageKind = kind; break; }
      }
    }
  }
}

/** Whether one of the company's documents reads like that stage and kind. */
/**
 * CLOSING IS THE LAST ACT, SO IT IS CHECKED (his call 2026-10-21: closure
 * is very important, take the time). A company is closed when it IS
 * dissolved; when nothing on file says so, the preview says that plainly.
 */
async function closeCaution(row) {
  const { docs } = await repo.details(row.id);
  for (const d of docs.filter((x) => x.text_chars)) {
    // eslint-disable-next-line no-await-in-loop
    if (steps.stageInText((await repo.docWithText(d.id))?.text)?.stage === 'dissolved') return null;
  }
  const at = stageText(row.stage, row.stage_kind);
  const deadline = row.deadline && steps.daysTo(String(row.deadline).slice(0, 10), currentDay()) >= 0
    ? `, deadline ${sayDay(String(row.deadline).slice(0, 10))} still ahead` : '';
  return `Note: the page says ${at}${deadline}; nothing on file shows it dissolved yet (no Final Gazette, no dissolution notice).`;
}

async function docsSayKind(rowId, stage, kind) {
  const { docs } = await repo.details(rowId);
  for (const d of docs.filter((x) => x.text_chars)) {
    // eslint-disable-next-line no-await-in-loop
    const seen = steps.stageInText((await repo.docWithText(d.id))?.text);
    if (seen && seen.stage === stage && seen.kind === kind) return true;
  }
  return false;
}

/**
 * A STATUS QUESTION INSIDE A CHANGE ("close competex … oh and whats acquas
 * status") was dropped under the preview (browser 2026-10-21): answered
 * here, in code, from the page.
 */
async function alsoAsked(said, changing, today) {
  const parts = lazy(fold(said)).split(/[.?!;]|\b(?:oh and|and also|also|plus|btw)\b/).filter((p) => /\b(?:whats|what is|status|where are we|where is|how is|hows|how much|who|stage|is \w+ (?:closed|dissolved|winding))\b/.test(p));
  if (!parts.length) return null;
  await loadNames();
  const rows = await repo.list();
  const out = [];
  for (const p of parts) {
    // A PERSON'S PAY OR A DEAL asked beside the close is the sheet's question:
    // "whats kiran vale on at brightwell" was answered with Brightwell's stage (blind run 2026-10-22).
    if (!/\b(?:status|stage|where|happening|going on|closed|closing|dissolved|winding|liquidat\w*|deadline|next)\b/.test(p)) {
      out.push(`Their other question, "${p.trim()}", is not about winding down: look it up now with the right tool and answer it under the preview.`);
      continue;
    }
    const name = pageCompanyIn(p);
    const r = name ? rows.find((x) => bare(x.company_name) === name) : null;
    if (r && !changing.includes(r.company_name)) out.push(`${line(r, today)}${await aheadNote(r)}`); // eslint-disable-line no-await-in-loop
  }
  return out.length ? out.join('\n') : null;
}

async function undoLiquidations(confirmed) {
  const last = await undoRepo.latest('liquidations');
  if (!last) {
    const reply = 'There is no change of mine on the Winding down page to undo.';
    return { summary: reply, reply, computedReply: true };
  }
  const { rows = [], comms = [], statuses = [], parties = [], partiesBack = [] } = last.restore;
  /**
   * SHOWN FIRST, like every undo (his rule; blind run 2026-10-22: "undo that"
   * reopened a closed company's deals with no word). The held call is this
   * one with `undo`, so their yes replays it; the 2026-10-13 preview had no
   * call behind it and the yes undid nothing.
   */
  if (!confirmed) {
    const back = statuses.map((s) => `• ${s.name}: status back to ${STATUS_LABEL[s.status] ?? s.status}${s.status === 'closed' ? '' : s.status === 'liquidation' || s.status === 'active' ? ', its stopped deals live again' : ''}`);
    const summary = `NOTHING HAS BEEN CHANGED YET. Undo puts back: ${last.summary}.${back.length ? `\n${back.join('\n')}` : ''}`
      + `${comms.length ? `\n• ${comms.length} contact log ${comms.length === 1 ? 'line' : 'lines'} taken out` : ''}`
      + `${parties.length ? `\n• ${parties.length} other ${parties.length === 1 ? 'party' : 'parties'} taken off` : ''}`
      + `${partiesBack.length ? `\n• ${partiesBack.map((x) => partyWords(x)).join('; ')} put back as ${partiesBack.length === 1 ? 'a party' : 'parties'}` : ''}\nShow this and ask "Shall I undo it?"; call again with confirmed true only after their yes.`;
    // What her words are matched to, so the yes finds this held call (blind run
    // 2026-10-22: with neither, the yes said "that confirmation has expired").
    // A fields only undo names its companies through their page rows (regression run 2026-10-22).
    const page = rows.length || parties.length || partiesBack.length ? await repo.list().catch(() => []) : [];
    // A PARTIES ONLY CHANGE named no company, so the yes found nothing held and
    // undid nothing (blind sheet run 2026-11-04). Its parties name it.
    const partyRows = parties.length
      ? (await require('../../../configs/db').query('SELECT liquidation_id FROM tb_liquidation_parties WHERE id = ANY($1::int[])', [parties]).catch(() => ({ rows: [] }))).rows.map((x) => x.liquidation_id) // eslint-disable-line global-require
      : [];
    const ids = [...rows.map((r) => r.id), ...partyRows, ...partiesBack.map((x) => x.id)];
    const aimedAt = [...new Set([...statuses.map((s) => s.name), ...ids.map((id) => page.find((p) => p.id === id)?.company_name).filter(Boolean)])];
    return {
      pending: true, summary, confirming: `${last.summary} ${back.join(' ')}`,
      // The companies named, which is what her words are matched on (confirmReplay remember).
      aimedAt,
      // Held as THIS undo, whichever tool showed it: replaying the master sheet's
      // undo put back a review flag instead (regression run 2026-10-22).
      redirect: { name: 'update_liquidation', args: { undo: true } },
    };
  }
  // The statuses first, newest last undone first: a dissolve reopens its deals.
  for (const s of [...statuses].reverse()) {
    // eslint-disable-next-line no-await-in-loop
    await applyCompanyStatus(s.name, { status: s.status, via: 'diane', byUser: `${BY} (undo)`, auditVia: 'undo' });
  }
  if (statuses.length) {
    broadcast(null, 'companies:changed', { action: 'updated', via: 'agent' });
    broadcast(null, 'master-sheet:changed', { action: 'company-status', via: 'agent' });
  }
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    await repo.update(r.id, r.fields, `${BY} (undo)`);
  }
  if (comms.length) await repo.removeComms(comms, `${BY} (undo)`);
  // The parties added come off; the ones taken off come back.
  const byRow = new Map();
  for (const pid of parties) {
    // eslint-disable-next-line no-await-in-loop
    const { rows: [p] } = await require('../../../configs/db').query('SELECT liquidation_id FROM tb_liquidation_parties WHERE id = $1', [pid]); // eslint-disable-line global-require
    if (p) byRow.set(p.liquidation_id, [...(byRow.get(p.liquidation_id) ?? []), pid]);
  }
  for (const [rid, ids] of byRow) await repo.removeParties(rid, ids, `${BY} (undo)`); // eslint-disable-line no-await-in-loop
  for (const x of partiesBack) await repo.addParty(x.id, { name: x.name, position: x.position }, `${BY} (undo)`); // eslint-disable-line no-await-in-loop
  await undoRepo.markUndone(last.id);
  broadcast(null, 'liquidations:changed', { via: 'agent' });
  const reply = `Undone: ${last.summary} put back as it was${comms.length ? `, and ${comms.length} contact log ${comms.length === 1 ? 'line' : 'lines'} taken out` : ''}`
    + `${parties.length + partiesBack.length ? `, other parties as they were` : ''}.`;
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
    'A company\'s documents on the Winding down page. action list: what it has. open: show one or several in this chat. '
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
      // NAMED, so each opens from her words too (his call 2026-10-14).
      const reply = `${picked.length === 1 ? `Here is ${picked[0].file_name} from ${row.company_name}.` : `Here are ${picked.length} documents from ${row.company_name}: ${namesList(picked.map((d) => d.file_name))}.`}${zipNote}`;
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
      // eslint-disable-next-line global-require
      const video = require('../../shared/videoTranscript.helper');
      // A VIDEO BECOMES ITS TRANSCRIPT, and the video is not kept (his call 2026-10-14).
      const lines = chosen.map((f) => (video.isVideo(f.filename)
        ? `• ${f.filename} → ${row.company_name}, as its written transcript (the video is not kept)`
        : `• ${f.filename} → ${row.company_name}`));
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
      const jobs = [];
      for (const f of files) {
        if (f.video) {
          // Moved out of the chat's files: the job owns it now, and removes it.
          const tmp = require('node:path').join(video.TEMP_ROOT, 'uploads', `chat-${f.id}${require('node:path').extname(f.name)}`); // eslint-disable-line global-require
          // eslint-disable-next-line no-await-in-loop
          await require('node:fs/promises').mkdir(require('node:path').dirname(tmp), { recursive: true }); // eslint-disable-line global-require
          // eslint-disable-next-line no-await-in-loop, global-require
          await require('node:fs/promises').rename(f.path, tmp);
          jobs.push(video.view(video.start(row.id, {
            videoPath: tmp, fileName: f.name, names: [row.company_name, row.liquidator, row.owner], origin: 'chat',
          }, BY)));
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        saved.push(await storeDoc(row.id, { buffer: f.buffer, originalName: f.name, mime: f.mime }, BY));
      }
      if (saved.length) await undoRepo.record('documents', `${saved.length} ${saved.length === 1 ? 'document' : 'documents'} saved to ${row.company_name}`, { saved: saved.map((d) => ({ rowId: row.id, id: d.id })) }, BY);
      broadcast(null, 'liquidations:changed', { via: 'agent' });
      const parts = [];
      if (saved.length) parts.push(`Saved to ${row.company_name}: ${namesList(saved.map((d) => d.file_name))}. ${saved.length === 1 ? 'It is' : 'They are'} being read now, so you can ask about ${saved.length === 1 ? 'it' : 'them'} in a moment.`);
      if (jobs.length) parts.push(`Transcribing ${namesList(jobs.map((j) => j.fileName))} now. ${jobs.length === 1 ? 'Its transcript is' : 'Their transcripts are'} saved to ${row.company_name}'s documents when ${jobs.length === 1 ? 'it is' : 'they are'} done, and the video is not kept.`);
      const reply = parts.join(' ');
      return { summary: reply, reply, computedReply: true, videoJobs: jobs };
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
      await repo.renameDoc(row.id, picked[0].id, name, BY);
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
      await repo.removeDoc(d.id, aside, BY);
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
    if (full) await repo.removeDoc(full.id, await moveAside(full.stored_path), `${BY} (undo)`);
  }
  for (const r of removed) {
    // eslint-disable-next-line no-await-in-loop
    await repo.restoreDoc(r.id, await moveBack(r.aside), `${BY} (undo)`);
  }
  for (const r of renamed) {
    // eslint-disable-next-line no-await-in-loop
    await repo.renameDoc(r.rowId, r.id, r.from, `${BY} (undo)`);
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
    let named = [];
    // THE COMPANY THEIR WORDS NAME when she sent none: "whats the latest doc on
    // quale & oddbody say" was answered with every company's papers (blind docs run 2026-10-22).
    const company = args.company || (args.said ? await pageCompanyNamed(args.said).catch(() => null) : null);
    if (company) {
      let { rows, ...rest } = await rowsFor([company], args.said);
      // HER NAME FOR IT MISSED, THEIRS MAY NOT: "Oddbody" for Quayle & Oddbody Haulage.
      if (problems(rest) && args.company && args.said) {
        const theirs = await pageCompanyNamed(args.said).catch(() => null);
        if (theirs) ({ rows, ...rest } = await rowsFor([theirs], args.said));
      }
      // A CLOSE NAME IS ASKED, never searched as another company or as all of
      // them: "wexcom glazing" read Wexcombe Glazing's papers (his rule 2026-11-04).
      if (rest.corrections?.some((c) => /did you mean/i.test(c))) return { summary: rest.corrections.join(' ') };
      // NOT A COMPANY ON THE PAGE ("the hmrc petition" came as company "HMRC",
      // overnight suite 2026-10-13): every company's documents are searched.
      keys = problems(rest) ? null : rows.map((r) => r.company_key);
      named = keys ? rows : [];
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
    /**
     * THE PAPERS AHEAD OF THE PAGE are said with the answer: "wat does the
     * thistlecomb larder paperwork say" read the CVL notice out and never said the
     * page still showed plain liquidation (blind docs run 2026-10-22).
     */
    const behind = [];
    for (const r of named.length === 1 ? named : []) {
      // eslint-disable-next-line no-await-in-loop
      const note = await aheadNote(r).catch(() => '');
      if (note) behind.push(`${r.company_name}: the page says ${stageText(r.stage, r.stage_kind)}, but${note.replace(/^ · ⚠/, '').replace(/: say "update it from the docs"$/, '')}.`);
    }
    if (behind.length && args.turn && typeof args.turn === 'object') args.turn.behindLine = behind.join(' ');
    return {
      summary: (behind.length ? `THE PAGE IS BEHIND ITS DOCUMENTS. ${behind.join(' ')} After the answer, say that in one line and `
        + 'offer to update the page from the documents (shown first, nothing changes until they say yes). Do not change it now.\n\n' : '')
        + 'FROM THEIR DOCUMENTS (quote only what is here, and name the document each fact came from). '
        + 'Ranking, adding or comparing the figures below to answer them IS reading the document: do it, '
        + 'never say you cannot rank or total (that rule is the master sheet\'s, not a document\'s).\n\n'
        + good.map((h) => `${h.company_name} · ${h.file_name}\n${h.text.slice(0, 1800)}`).join('\n\n')
        // Said again last, where it is not lost under the passages (it was, 2026-10-22).
        + (behind.length ? `\n\nEND YOUR ANSWER WITH ONE LINE: ${behind.join(' ')} Then offer: "Want me to update the page from the documents?"` : ''),
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

// ===============================
// * THE NEXT STEP (his ask 2026-10-21)
// ===============================
// "Check the documents per company and tell us the next step." Everything
// she needs in one call: the page's row, its last contacts, every document
// with the dates it gives (worked out in code, with how near), the usual
// process at its stage, the road ahead, and whether the documents read
// further along than the page. She words it; she works nothing out.
const steps = require('../../shared/windingDownSteps');

/** One company's file for the next step. `brief` keeps a whole-page answer short. */
async function nextStepFile(r, today, { brief = false } = {}) {
  const d = await repo.details(r.id);
  const docs = [];
  for (const x of d.docs) {
    // eslint-disable-next-line no-await-in-loop
    const full = x.text_chars ? await repo.docWithText(x.id) : null;
    docs.push({ ...x, text: full?.text ?? '' });
  }
  const ahead = steps.aheadOfPage(docs, r.stage, r.stage_kind);
  const dated = [];
  const out = [
    `### ${r.company_name}`,
    `Page: ${stageText(r.stage, r.stage_kind)} · ${r.deadline ? `deadline ${sayDay(String(r.deadline).slice(0, 10))} (${steps.whenWords(String(r.deadline).slice(0, 10), today)})` : 'no deadline'}`
      + ` · next action: ${r.next_action || 'none'}${r.liquidator ? ` · liquidator ${r.liquidator}` : ''}${r.owner ? ` · owner ${r.owner}` : ''}`,
  ];
  if (r.instructions) out.push(`Instructions: ${r.instructions}`);
  // THE CLOSURE SHEET'S FIELDS: the play decides the step (Do not contact is no contact).
  if (r.play) out.push(`Current play: ${PLAY_LABEL[r.play] ?? r.play}${r.play === 'do_not_contact' ? ' (NEVER suggest contacting them)' : r.play === 'leave' ? ' (being left: suggest nothing unless a date or document needs it)' : ''}`);
  if (r.last_action) out.push(`Last action: ${r.last_action}`);
  // NAMED IN THE ANSWER, whatever the play: "whats our next move" on a company
  // on Wait answered "wait for the liquidator" and left out the £12,400 loan
  // still owed (held-out sheet run 2026-11-04). Waiting is the step; this is what is open.
  if (r.unresolved) out.push(`Unresolved matters (ALWAYS name these in the answer, even when the step is to wait): ${r.unresolved}`);
  if (r.official_receiver) out.push(`Official receiver: ${r.official_receiver}`);
  if ((r.parties ?? []).length) out.push(`Other parties: ${r.parties.map(partyWords).join('; ')}`);
  if (r.prompts && !brief) out.push(`Prompts: ${r.prompts.length > 1200 ? `${r.prompts.slice(0, 1197)}…` : r.prompts}`);
  if (r.note) out.push(`Note: ${r.note}`);
  if (r.deadline) dated.push({ day: String(r.deadline).slice(0, 10), from: 'the page\'s deadline', says: r.next_action || '' });
  const comms = d.comms.slice(0, brief ? 2 : 4);
  if (comms.length) out.push(`Last contact: ${comms.map((c) => `${sayDay(String(c.said_on).slice(0, 10))}: ${c.body}`).join(' | ')}`);
  if (!docs.length) out.push('Documents: none.');
  for (const x of docs) {
    if (!x.text) {
      out.push(`Document "${x.file_name}": not read (${READ_WORD[x.read_status] ?? x.read_status}${x.read_error ? `, ${x.read_error}` : ''}).`);
      continue;
    }
    const dates = steps.datesIn(x.text, today);
    for (const t of dates) dated.push({ day: t.day, from: x.file_name, says: t.says });
    const text = x.text.replace(/\s+/g, ' ').trim();
    const cap = brief ? 700 : 3000;
    out.push(`Document "${x.file_name}": ${text.length > cap ? `${text.slice(0, cap)}…` : text}`);
  }
  // EVERY DATE, NEAREST FIRST, worked out here: she never counts days.
  const upcoming = dated.filter((t) => steps.daysTo(t.day, today) >= 0).sort((a, b) => a.day.localeCompare(b.day));
  const passed = dated.filter((t) => steps.daysTo(t.day, today) < 0).sort((a, b) => b.day.localeCompare(a.day));
  if (upcoming.length) out.push(`Dates ahead: ${upcoming.map((t) => `${sayDay(t.day)} (${steps.whenWords(t.day, today)}, ${t.from}${t.says ? `: "${t.says}"` : ''})`).join('; ')}`);
  if (passed.length) out.push(`Dates passed: ${passed.slice(0, 4).map((t) => `${sayDay(t.day)} (${steps.whenWords(t.day, today)}, ${t.from})`).join('; ')}`);
  if (ahead) {
    out.push(`THE DOCUMENTS READ FURTHER ON: "${ahead.file}" reads like ${stageText(ahead.stage, ahead.kind)}, the page says `
      + `${stageText(r.stage, r.stage_kind)}. Say so and offer to update the stage (update_liquidation); do not change it unasked.`);
  }
  out.push(`Usual process at this stage (general UK steps; the documents and the page win over this): ${steps.guideFor(r.stage, r.stage_kind)}`);
  const road = steps.roadAhead(r.stage);
  out.push(road ? `Road ahead on the page: ${road}.` : 'End of the road.');
  return { text: out.join('\n'), nearest: upcoming[0]?.day ?? null, ahead, company: r.company_name };
}

const liquidationNextStep = {
  name: 'liquidation_next_step',
  description: 'THE NEXT STEP for companies winding down, from their documents, deadline, contact log and stage: '
    + '"what\'s next for quarry lane", "what should we do about pinecrest", "go through the winding down companies '
    + 'and tell me what needs doing", "check pinecrest\'s docs and tell me where we are". Uses the unresolved matters, '
    + 'last action and current play too. Name a company, or leave it '
    + 'out for every company on the page. Read only.',
  parameters: {
    type: 'object',
    properties: {
      company: { type: 'string', description: 'One company as they named it; leave out for all. Only an exact name is a company: when they named it, their spelling, never corrected by you; when they did not ("its", "that one"), the name exactly as the page list shows it, never as a document spells it ("Pinecrest Ltd" for the page "Pinecrest" is another company).' },
      update: { type: 'boolean', description: 'Code only: their yes to your offer to update the page from the documents.' },
    },
  },
  async handler(args = {}) {
    const today = currentDay();
    let rows;
    if (args.company) {
      const found = await rowsFor([args.company], args.said);
      const stop = problems(found);
      if (stop) return { summary: stop.replace('NOTHING HAS BEEN CHANGED. ', '') };
      rows = found.rows;
    } else {
      rows = (await repo.list()).filter((r) => r.stage !== 'dissolved');
      if (!rows.length) {
        const reply = 'No company is winding down right now, so there is no next step to take.';
        return { summary: reply, reply, computedReply: true };
      }
    }
    const brief = rows.length > 1;
    const files = [];
    for (const r of rows.slice(0, MAX_ROWS)) files.push(await nextStepFile(r, today, { brief })); // eslint-disable-line no-await-in-loop
    // MOST URGENT FIRST: a passed or near date leads.
    files.sort((a, b) => (a.nearest ?? '9999').localeCompare(b.nearest ?? '9999'));
    const how = rows.length > 1
      ? 'One short block per company, most urgent first: its NEXT STEP in one line (what, by when, from which '
        + 'document or the page), then at most two lines of why or what follows. A document read further on than the '
        + 'page: say it and offer the stage update once at the end, for all of them in one go.'
      : 'Answer: the NEXT STEP first, in one line (what, and by when). Then why, naming the document or page field each '
        + 'fact came from, then what follows on the road ahead. Short. A document read further on than the page: say '
        + 'it and offer the stage update.';
    // THE STAGE UPDATE THE DOCUMENTS POINT TO, as the exact call, so her
    // offer is a real preview and their "ya go" saves it (browser 2026-10-21:
    // she asked in her own words, then asked again, then it had expired).
    const offers = files.filter((f) => f.ahead).map((f) => ({ company: f.company, stage: STAGE_LABEL[f.ahead.stage], ...(f.ahead.kind ? { stageKind: KIND_LABEL[f.ahead.kind] } : {}) }));
    // BUILT HERE, through the update tool itself, so the preview is real.
    // ONLY WHEN THEY ASKED whether the page is right or to update it from the
    // paper: a held preview swallowed a page-wide rundown and the next edit
    // asked after it (suite 2026-10-21).
    const askedForIt = args.update === true || /\b(?:right|correct|accurate|up to date|wrong|match\w*|sync|update|fix|set|sort)\b|\bcheck\b[^.?!]*\b(?:docs?|documents?|paperwork|papers|files?)\b|\b(?:docs?|documents?|paperwork) say\b/i.test(String(args.said ?? ''));
    const preview = offers.length && askedForIt
      ? await updateLiquidation.handler({ items: offers, said: args.said, saidRecent: args.saidRecent, confirmed: false }).catch(() => null)
      : null;
    const offer = preview?.pending
      ? ' THE STAGE UPDATE THE DOCUMENTS POINT TO IS ALREADY PREVIEWED BELOW (nothing saved): after your answer, read its '
        + 'lines out and ask once; their yes saves it. Do not call update_liquidation for it yourself.'
      : offers.length
        ? ` Where a document reads further on than the page, say so in ONE line and add: say "update it from the docs" and I'll `
          + 'show the change. Do not ask "shall I" and do not call update_liquidation for it.'
        : '';
    // ASKED TO CHANGE THE PAGE FROM THE DOCUMENTS: the read was step one.
    // b, d: NOTHING FURTHER ON in the documents. "page correct vs the gazette?" got no
    // yes, and "docs say its struck off? update it if so" ended in "nothing to change"
    // (held-out doc run 2026-10-22). Said plainly, and nothing is called.
    const asksRight = /\b(?:right|correct|accurate|up to date|match\w*|in line)\b/i.test(String(args.said ?? ''));
    // Held for the turn, so an update sent after it is refused in code (see runAgent docsMatchPage).
    if (!offers.length && args.turn && typeof args.turn === 'object') args.turn.docsMatchPage = true;
    const nothingAhead = !offers.length
      ? ` NO DOCUMENT READS FURTHER ON THAN THE PAGE. ${asksRight ? 'They asked whether the page is right: open with "Yes, the page matches the documents" (or say exactly what differs). ' : ''}`
        + 'If they asked to change it from the documents, say plainly that nothing on file shows a later step, naming what the document IS '
        + '(a First Gazette is a proposal, not dissolution; a petition is not an order). Do NOT call update_liquidation.'
      : '';
    const change = offers.length && !preview?.pending && /\b(?:update|set|change|fix|correct|move|match|sync|put|sort)\b/i.test(String(args.said ?? ''))
      ? ' THEY ASKED TO CHANGE THE PAGE FROM THIS: now call update_liquidation (confirmed false) with ONLY what '
        + 'the documents show (the "READ FURTHER ON" lines and anything they asked for), all companies in one call, so '
        + 'they see the preview. Change nothing the documents do not show.'
      : '';
    const body = {
      summary: `TODAY ${sayDay(today)}. ${how}${change}${offer}${nothingAhead} The companies are listed MOST URGENT FIRST (nearest date): `
        + 'asked which is most urgent, it is the first, and ranking them IS answering (the "cannot rank" rule is the master '
        + `sheet's, not this page's). Use ONLY the facts and dates below; never count days or invent a step, `
        + 'a date or a figure. Where a document and the usual process disagree, the document wins. Everything on the page '
        + 'is here: do not call list_liquidations or search the documents again. A document not read: '
        + `say so.\n\n${files.map((f) => f.text).join('\n\n')}`
        + (rows.length > MAX_ROWS ? `\n\n…and ${rows.length - MAX_ROWS} more on the Winding down page.` : ''),
    };
    if (!preview?.pending) return body;
    // THEIR YES TO THE OFFER: the preview alone, nothing to answer around it.
    if (args.update === true) return { ...preview, redirect: { name: 'update_liquidation', args: { items: offers } } };
    // THE YES RE-RUNS THE UPDATE, not this read (runAgent `redirect`).
    return { ...preview, summary: `${body.summary}\n\n${preview.summary}`, redirect: { name: 'update_liquidation', args: { items: offers } } };
  },
};

const liquidationTools = [listLiquidations, updateLiquidation, liquidationDocument, searchCompanyDocuments, readCompanyDocument, liquidationNextStep];

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

// What is on the Winding down page, by name, for routing: its companies,
// their liquidators and their documents. Looked up once every 5 seconds.
let pageNames = { at: 0, companies: [], liquidators: [] };
async function loadNames() {
  if (Date.now() - docNames.at > 30_000) {
    const pool = require('../../../configs/db'); // eslint-disable-line global-require
    const { rows } = await pool.query('SELECT DISTINCT file_name FROM tb_liquidation_docs WHERE removed_at IS NULL').catch(() => ({ rows: [] }));
    docNames = { at: Date.now(), names: rows.map((r) => fold(r.file_name).replace(/\.[a-z0-9]+$/, '')).filter((n) => n.length >= 4) };
  }
  // Five seconds, not thirty: a company put on the page or added a moment ago
  // was not known by name yet (blind run 2026-10-22). Two small local queries.
  if (Date.now() - pageNames.at > 5_000) {
    const rows = await repo.list().catch(() => []);
    pageNames = {
      at: Date.now(),
      companies: rows.map((r) => bare(r.company_name)).filter((n) => n.length >= 3),
      // "Begbies Traynor" is said "begbies": its first word is enough.
      liquidators: [...new Set(rows.map((r) => fold(r.liquidator).split(' ')[0]).filter((n) => n.length >= 4))],
      // EVERY COMPANY, whatever its status: "is ironleaf closing" asks about one off the page.
      every: (await everyCompany()).map((n) => bare(n)).filter((n) => n.length >= 3),
      // EVERYONE ON A CASE by name, each liquidator line and each party, for
      // "take gareth lyle off quarry lane" (blind sheet run 2026-11-04: the
      // sheet's people were searched, and nobody there had that name).
      people: [
        ...rows.flatMap((r) => liquidatorsOf(r.liquidator).map((n) => fold(n))),
        ...(await require('../../../configs/db').query('SELECT name FROM tb_liquidation_parties').then((q) => q.rows.map((x) => fold(x.name))).catch(() => [])), // eslint-disable-line global-require
      ].map((n) => n.replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()).filter((n) => n.split(' ').length >= 2),
      // COMPANIES WITH NO DOCUMENTS: who their liquidator is can only be the page's.
      paperless: await require('../../../configs/db').query('SELECT DISTINCT liquidation_id AS id FROM tb_liquidation_docs WHERE removed_at IS NULL') // eslint-disable-line global-require
        .then((q) => { const has = new Set(q.rows.map((x) => x.id)); return rows.filter((r) => !has.has(r.id)).map((r) => bare(r.company_name)); })
        .catch(() => []),
    };
  }
}

/**
 * EVERY COMPANY, AS WRITTEN: those with a record of their own and those only
 * on their deals (the suite's Ironleaf has no tb_companies row, and "quarry
 * lane ironleaf harbor nine any of em closing" answered Quarry Lane alone).
 */
async function everyCompany() {
  const [own, onDeals] = await Promise.all([
    companiesRepo.findAllPlain().catch(() => []), companiesRepo.names().catch(() => []),
  ]);
  const out = new Map();
  for (const n of [...own.map((c) => c.name), ...onDeals.map((c) => c.name)]) if (n && !out.has(bare(n))) out.set(bare(n), n);
  return [...out.values()];
}

/**
 * EVERY COMPANY NAME, read now: a company added seconds before was not in
 * the cached list, and "is harbour closing" listed the whole page instead of
 * asking which (blind run 2026-10-22, twice). One small local query.
 */
async function freshNames() {
  await loadNames();
  pageNames.every = (await everyCompany()).map((n) => bare(n)).filter((n) => n.length >= 3);
  pageNames.companies = (await repo.list().catch(() => [])).map((r) => bare(r.company_name)).filter((n) => n.length >= 3);
}

// "harbour" is "harbor": one spelling either side, for matching only.
const spelt = (t) => t.replace(/our\b/g, 'or');

/**
 * EVERY COMPANY THEIR WORDS NAME, on the page or not (blind run 2026-10-22:
 * "quarry lane ironleaf harbor nine any of em closing" answered Quarry Lane
 * alone). A first word that starts two companies ("is harbour closing" with
 * Harbor Nine and Harbor View) is `ambiguous`, to be asked about.
 */
function companiesNamedIn(text) {
  const names = pageCompaniesIn(text);
  let rest = spelt(text);
  for (const n of names) rest = rest.replace(new RegExp(`\\b${escapeRe(spelt(n))}\\b|\\b${escapeRe(spelt(n).split(' ')[0])}s?\\b`, 'g'), ' ');
  const others = pageNames.every.filter((n) => !names.includes(n));
  for (const n of others.filter((x) => new RegExp(`\\b${escapeRe(spelt(x))}(?:'?s)?\\b`).test(rest))) {
    names.push(n);
    rest = rest.replace(new RegExp(`\\b${escapeRe(spelt(n))}\\b`, 'g'), ' ');
  }
  const ambiguous = [];
  const words = rest.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  for (const w of [...new Set(words)]) {
    const starts = others.filter((n) => !names.includes(n) && spelt(n).split(' ')[0] === w);
    if (starts.length === 1 && w.length >= 5 && !['quarry', 'harbor', 'north', 'south', 'social', 'global'].includes(w)) names.push(starts[0]);
    else if (starts.length > 1) ambiguous.push(w);
  }
  return { names, ambiguous };
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
// A CHANGE OF STATUS said anywhere in the message: never answered by a read in code.
const MOVES = /\b(?:close|closing|closed? (?:it|them|em)|wind(?:ing)? (?:\w+ ){0,3}?down|dissolve|strike (?:\w+ )?off|archive|stop|reopen|resume|put (?:\w+ ){0,3}?(?:in|into|on)|move|take (?:\w+ ){0,3}?off)\b/;
/** A change ordered in the words, "closing" and "winding down" as where it is taken out (see liquidationRoute). */
const ordered0 = (text) => MOVES.test(text.replace(/\b(?:next|our|the|whats the) moves?\b/g, ' ').replace(/\bclos(?:ing|ed)\b(?! (?:it|them|em|down|off|up)\b)/g, ' ')
  .replace(/\b(?:is|are|be|being|been|thats|that is|that are|ones|still|currently|already|which|any)(?: \w+){0,3}? winding down\b|\bwinding down (?:ones|companies|page|stage|list|docs|documents|paperwork|papers|files)\b/g, ' '));
/** Lazy spellings to their words: "wats up w/ the winding down ones" (browser 2026-10-21). */
const lazy = (t) => t.replace(/\bwh?at'?s\b/g, 'whats').replace(/\bwat\b/g, 'what').replace(/\bw\/\s*|\bw (?=the|them|it|our|that|this)/g, 'with ')
  .replace(/\bpls\b|\bplz\b/g, 'please').replace(/\bu\b/g, 'you').replace(/\br\b/g, 'are').replace(/\bthx\b/g, '')
  // "wheres quarry lane at", "pinecrest n brightwell", "how many rn" (blind run 2026-10-22).
  .replace(/\bwhere'?s\b/g, 'where is').replace(/\b(?:clsoe|cloes|colse)\b/g, 'close').replace(/\bln\b/g, 'lane').replace(/\bthru\b/g, 'through').replace(/\bcompanys\b/g, 'companies').replace(/\bn\b/g, 'and').replace(/\brn\b/g, 'right now')
  // THE DROPPED G: "anythin left outstandin" (held-out sheet run 2026-11-04).
  .replace(/\b(anyth|noth|someth|everyth|outstand|go|do|chas|wait|happen|trad|pay|clos|wind)in\b/g, '$1ing');
const asksAtAll = (text) => ASK_START.test(text) || /\b(?:what|whats|what's|which|who|how|when|whens)\b/.test(text);
// ASKING WHAT TO DO NEXT, however it is said.
const NEXT_STEP = /\b(?:next steps?|(?:next|our|the) moves?|whats? next|what'?s next|what now|what do (?:we|i) do|what (?:should|shall|must|can) (?:we|i)|what (?:do|does) (?:we|i|it) need|what needs (?:doing|to happen|to be done)|where (?:are|do) we (?:at|go|stand)|where we (?:are|stand)|how do we (?:proceed|close|finish|wrap)|game ?plan|action plan|to ?do list|todos?|advise|advice|recommend\w*|outstanding|what'?s left|whats left|what is left|left to do|what to do|nxt|wat now|wats nxt|what happens (?:next|now|if|when)|(?:gotta|got to|have to|need to|needs to|should|must) (?:do|happen|be done)(?: next)?|(?:do|doing|happen\w*) next|run me (?:thru|through)|walk me (?:thru|through)|if we do nothing|most urgent|urgent|priorit\w*|deal with first|(?:is|are) (?:the )?(?:[a-z]+ ){0,3}(?:page|stage|stages|it|they|everything) (?:right|correct|up to date|accurate|wrong|out of date)|up to date with the (?:docs|documents|paperwork)|(?:check|go through|read|look at|review) (?:the |their |its |all (?:the )?|every )?(?:(?:company|companies|company'?s|one'?s|ones|winding down|liquidation|closing) )?(?:docs|documents|paperwork|papers|files)|\bpage (?:right|correct|accurate|up to date|wrong)\b|where are we)\b/;
// "UPDATE THE STAGES FROM THE DOCS": read them first, then the change.
const FROM_DOCS = /\b(?:from|per|according to|based on|going by|match(?:ing)?|in line with|off) (?:the |their |its |what the )?(?:docs|documents|paperwork|papers|letters|files)\b|\b(?:docs|documents|paperwork|papers) say\b/;
// A CHANGE SAID WITH IT stays a change: "set the next action to …".
const CHANGE_NOW = /^\s*(?:pls |please )?(?:set|change|move|update|mark|rename|remove|delete|add|log|put|save)\b|\bnext (?:step|action) (?:is|to|should be|=)\b/;
/**
 * The page company their words name, a one letter slip allowed ("quary
 * lane" went to the master sheet, suite 2026-10-21). Exact names first.
 */
function pageCompanyIn(text) {
  const exact = pageNames.companies.find((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'?s)?\\b`).test(text));
  if (exact) return exact;
  const words = text.replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => w.replace(/'s$/, ''));
  const hits = pageNames.companies.filter((n) => {
    const size = n.split(' ').length;
    if (n.length < 5) return false;
    for (let i = 0; i + size <= words.length; i += 1) if (near(words.slice(i, i + size).join(' '), n)) return true;
    return false;
  });
  if (hits.length === 1) return hits[0];
  // ITS FIRST TWO WORDS SLIPPED: "otery mill" for Ottery Mill Foods, "halowdene print"
  // (fresh doc run 2026-10-22). Only one company that near.
  // "QUALE & ODDBODY" for Quayle & Oddbody Haulage: the "&" or "and" is no word
  // of the name (blind docs run 2026-10-22).
  const noAnd = words.filter((w) => w !== 'and');
  const firstTwo = (n) => n.replace(/\s*&\s*|\s+and\s+/g, ' ').split(' ').slice(0, 2).join(' ');
  const pairs = [];
  for (let i = 0; i + 1 < noAnd.length; i += 1) pairs.push(`${noAnd[i]} ${noAnd[i + 1]}`);
  const twoNear = pageNames.companies.filter((n) => firstTwo(n).split(' ').length >= 2 && firstTwo(n).length >= 8
    && pairs.some((p) => near(p, firstTwo(n))));
  if (twoNear.length === 1) return twoNear[0];
  // ITS FIRST TWO WORDS, when only one company starts so: "zz harbour".
  const two = pageNames.companies.filter((n) => n.split(' ').length >= 3 && text.includes(n.split(' ').slice(0, 2).join(' ')));
  if (two.length === 1) return two[0];
  // ITS FIRST WORD ALONE, when only one company starts with it: "competex",
  // "acquas status" (browser 2026-10-21).
  const COMMON = new Set(['the', 'diverse', 'social', 'umbrella', 'workforce', 'red', 'peter', 'harbor', 'harbour', 'quarry', 'north', 'south', 'west', 'east', 'new', 'old', 'first', 'global']);
  const firsts = pageNames.companies.filter((n) => n.includes(' ')).map((n) => [n, n.split(' ')[0]]).filter(([, f]) => f.length >= 5 && !COMMON.has(f));
  const at = (f) => { const i = words.findIndex((w) => w === f || w === `${f}s`); return i < 0 ? Infinity : i; };
  const one = firsts.filter(([, f]) => at(f) < Infinity && firsts.filter(([, g]) => g === f).length === 1)
    .sort((a, b) => at(a[1]) - at(b[1]));
  if (one[0]) return one[0][0];
  // ITS FIRST WORD ONE LETTER OUT, when only one company is that near: "fernhollw
  // docs are in" (fresh doc run 2026-10-22). Long words only, so names stay apart.
  const slipped = firsts.filter(([, f]) => f.length >= 6 && words.some((w) => w.length >= 6 && w !== f && near(w, f)));
  return slipped.length === 1 ? slipped[0][0] : undefined;
}

/**
 * A COMPANY NAMED THROUGH ITS PERSON: "where are we with nell ardens company",
 * "what about theo brandts one", "the one kiran's at" (held-out run 2026-10-22:
 * each searched for a company called "Nell Ardens"). Their companies, as the
 * deals write them; none when the person has none or is not one person.
 */
async function personsCompanies(text) {
  const said = [
    text.match(/\b(?:the one|the company|the place|the firm|where) ([a-z]+(?: [a-z]+)?)(?:'s| is| are)? (?:at|in|with|works? (?:at|for))\b/),
    text.match(/\b([a-z]+(?: [a-z]+)?)(?:'s|s'|s)? (?:company|companies|one|firm|place|business|lot)\b/),
  ].filter(Boolean).map((m) => m[1].replace(/^(?:with|about|on|for|of|and|is|are|the) /, '').replace(/ (?:works?|is|are|was)$/, ''))
    .find((x) => x.length >= 3 && !/^(?:the|that|this|which|other|same|first|last|next|winding|closed|active|one)\b/.test(x));
  if (!said) return [];
  const pool = require('../../../configs/db'); // eslint-disable-line global-require
  const { rows } = await pool.query(
    `SELECT DISTINCT person_name, btrim(company) AS company FROM tb_mastersheet
     WHERE company IS NOT NULL AND btrim(company) <> '' AND (lower(person_name) = $1 OR lower(person_name) = $2 OR split_part(lower(person_name), ' ', 1) = $1)`,
    [said, said.replace(/s$/, '')],
  ).catch(() => ({ rows: [] }));
  if (new Set(rows.map((r) => fold(r.person_name))).size !== 1) return [];
  return [...new Set(rows.map((r) => r.company))];
}

/** Every page company a text names, as the page writes them. */
async function pageCompaniesNamed(text) {
  await loadNames();
  const rows = await repo.list();
  return pageCompaniesIn(lazy(fold(text))).map((c) => rows.find((r) => bare(r.company_name) === c)?.company_name).filter(Boolean);
}

/** The page company a text names, as the page writes it, or null. */
async function pageCompanyNamed(text) {
  await loadNames();
  const c = pageCompanyIn(lazy(fold(text)));
  if (!c) return null;
  return (await repo.list()).find((r) => bare(r.company_name) === c)?.company_name ?? null;
}

/** Every page company their words name, in their order. */
function pageCompaniesIn(text) {
  const out = [];
  let rest = text;
  for (let i = 0; i < 12; i += 1) {
    const c = pageCompanyIn(rest);
    if (!c) break;
    out.push(c);
    const before = rest;
    rest = rest.replace(new RegExp(c.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g'), ' ');
    // Named by its first word alone: that word goes.
    if (rest === before) rest = rest.replace(new RegExp(`\\b${c.split(' ')[0]}s?\\b`, 'g'), ' ');
    // a slipped spelling is not taken out by either line above
    if (rest === before) break;
  }
  return out;
}

async function liquidationRoute(said, { hasFiles = false } = {}) {
  // "ANY UPDATE ON QUARRY LANE" asks for news; "update" alone is a change
  // word, and the question went to the sheet's status (night run 2026-10-14).
  const text = asNews(lazy(fold(said)));
  await loadNames();
  const liqWords = /\b(?:in liquidation|winding up|wound up|being liquidated|liquidations)\b/.test(text);
  const company = pageCompanyIn(text);
  // A FILE ATTACHED, A COMPANY ON THE PAGE, and words that put it somewhere.
  if (hasFiles && company && /\b(?:put|save|file|add|upload|attach|store|keep|stick|drop|this|these|them|it)\b/.test(text)) return 'liquidation_document';
  /**
   * THE CLOSURE SHEET'S FIELDS, SAID THE WAY PEOPLE SAY THEM (blind sheet run
   * 2026-11-04). Each went somewhere else: "take gareth lyle off quarry lane"
   * searched the sheet's people, "add hannah price on ironleaf, she's the case
   * officer" started a deal, "the OR on harbor nine" was the word "or", "put
   * copperfield on leave" read as a status move, "what did the director say"
   * searched the documents. Here, before the rules that took them.
   */
  if (company) {
    const asking = asksAtAll(text) && !/^\s*(?:please |can you |could you |pls )?(?:put|set|mark|make|add|take|remove|chase|park|leave)\b/.test(text);
    const caseNamed = (pageNames.people ?? []).some((n) => text.includes(n));
    const orSaid = /\bOR\b/.test(String(said)) || /\b(?:the|new|our|an) or (?:on|for|at|is|has|was|of|now)\b/.test(text);
    const ROLE = /\b(?:officer|examiner|investigator|administrator|insolvency|receiver|liquidators?|solicitor|lawyer|caseworker|case (?:officer|manager|handler|worker)|compliance|creditor|petitioner|at (?:hmrc|companies house|the insolvency service|the official receiver))\b/;
    // Reads: what the director said, who changed it, when a stage happened, the OR.
    // "REMIND ME WHAT KIRAN VALE SAID": the director by name too (held-out sheet run 2026-11-04).
    if (asking && (/\b(?:director|he|she|they) (?:say|said|says|blam\w*|claim\w*|tell|told)\b|\bblam\w*\b|\bprompts?\b/.test(text)
      || /^(?!hmrc|companies house|the |it$|they$|did |has |have )/.test((text.match(/\bwhat (?:did |has |have )?([a-z]+(?: [a-z]+)?) (?:say|said|says|told us|claimed)\b/) ?? [])[1] ?? 'the ')) && !/\b(?:documents?|docs?|files?|pdfs?|letters?|paperwork|papers|minutes)\b/.test(text)) return 'list_liquidations';
    if (asking && /\bwho (?:put|marked|moved|set|changed|made|switched|updated|edited)\b/.test(text)) return 'list_liquidations';
    // "WHAT DATE WAS IT GAZETTED" as well as "when" (held-out sheet run 2026-11-04).
    if (asking && /\bwhen (?:did|was|were|is|has)\b|\b(?:what|which) (?:date|day)\b|\bdate (?:of|it|was)\b/.test(text) && /\b(?:suspend\w*|gazett\w*|struck|strike off|proposal|objection|objected|dissolv\w*|wound up)\b/.test(text) && !/\b(?:documents?|docs?|files?|pdfs?|letters?|paperwork|papers|minutes)\b/.test(text)) return 'list_liquidations';
    if (asking && orSaid && !CHANGE.test(text.replace(ASK_START, ''))) return 'list_liquidations';
    // "WHOS THE LIQUIDATOR FOR X AND WHO ELSE IS ON IT": the page keeps the
    // liquidators by name now, and its other parties (held-out sheet run
    // 2026-11-04: its documents were searched, and it had none). The person
    // behind a firm, or who signed, is still the documents' (see below).
    const othersAsked = /\bwho else\b|\bother part(?:y|ies)\b|\bwho(?:s|'s| is)? (?:on|involved in|working) (?:the |that |this )?case\b/.test(text);
    if (asking && (othersAsked || ((pageNames.paperless ?? []).includes(company) && /\bwho(?:s|'s| is| are)? (?:the |their )?(?:joint )?liquidators?\b/.test(text)))
      && !/\b(?:person|actual|not the firm|signed|individual|the ip|appointed|docs?|documents?|letters?|paperwork)\b/.test(text)) return 'list_liquidations';
    // "WHAT WAS THE LAST THING WE DID ON PINECREST": its last action (held-out sheet run 2026-11-04).
    if (asking && /\blast (?:thing|things|action|step|move)\b|\bwhat (?:did|have) we (?:last )?(?:do|done)\b/.test(text) && !NEXT_STEP.test(text)) return 'list_liquidations';
    // Writes: a liquidator or party named with a removal, a new party with a
    // role, the OR changed, a play said as a verb, the last action or what is outstanding.
    if (!asking) {
      if (caseNamed && /\b(?:off|remove\w*|take\w*|drop\w*|delete\w*|no longer|not on (?:it|the case)|anymore|any more|left|gone|replac\w*)\b/.test(text)) return 'update_liquidation';
      if (/\b(?:add|added|put|joined|new|also|plus|there'?s|theres)\b/.test(text) && ROLE.test(text) && /\b(?:on|to|at|for|from)\b/.test(text)) return 'update_liquidation';
      if (orSaid) return 'update_liquidation';
      if (/\b(?:park\w*|on hold|hold off|back off|leave (?:it|them|em|alone)|on (?:wait|chase|leave|hold)|chase\w*(?: up)?|do ?n[o']?t contact|dont contact|no contact|dnc|stop chasing|nothing (?:more )?we can do)\b/.test(text)) return 'update_liquidation';
      if (/\blast action\b|\b(?:still )?(?:outstanding|unresolved)\b/.test(text) && /\b(?:is|are|was|were|-|:|=|sent|did|done|paid|rang|called|emailed|filed)\b/.test(text)) return 'update_liquidation';
    }
  }
  // "WHAT'S NEXT FOR QUARRY LANE", "GO THROUGH THE WINDING DOWN ONES AND TELL
  // ME WHAT NEEDS DOING": the next step, from the documents (2026-10-21).
  const pageWide0 = /\b(?:winding down|liquidations?|closures?|strike offs?|wind downs?)\b/.test(text);
  // "ANY OF THE CLOSURES ON DO NOT CONTACT", "WHICH CLOSURES ARENT ON THE MASTER
  // SHEET": the page filtered by its own fields (held-out sheet run 2026-11-04).
  if (!company && pageWide0 && asksAtAll(text) && NO_DEAL_WORDS.test(text)) return 'list_liquidations';
  if (!company && pageWide0 && asksAtAll(text) && /\bdo ?n[o']?t contact\b|\bdont contact\b|\bdnc\b|\bon (?:wait|chase|leave|hold)\b|\bparked\b|\bunresolved\b/.test(text) && !CHANGE.test(text.replace(ASK_START, ''))) return 'list_liquidations';
  const pageWide = /\b(?:winding down|liquidations?|closures?|strike offs?|wind downs?|struck off ones|all of them|all the stages|every (?:compan\w*|stage)|each (?:one|compan\w*)|all (?:the )?compan\w*)\b/.test(text);
  if (FROM_DOCS.test(text) && (company || liqWords || pageWide)) return 'liquidation_next_step';
  // "OK FIX IT THEN" after a question on its papers (the company carried over by
  // runAgent): the stage from its documents, shown first (blind docs run 2026-10-22).
  if (company && /^\s*(?:(?:ok|okay|right|so|yeah|yes|yep|go on|then|and)[\s,.]+)*(?:fix|update|sort|correct)\s+(?:it|that|the page|the stage)(?:\s+(?:out|then|up|please|pls))*\s+for\b/.test(text)) return 'liquidation_next_step';
  // "CHECK THEM ALL AGAINST THE DOCS AND FIX WHATS OUT OF DATE": every company,
  // from its papers (blind docs run 2026-10-22: the sheet audit ran instead).
  if (/\b(?:check|go through|run through|look (?:at|through)|compare)\b/.test(text) && /\b(?:them all|all of (?:em|them)|the lot|everything|every one|each one)\b/.test(text)
    && /\b(?:against|with|vs|versus|to|by)\s+(?:the |their |its )?(?:docs|documents|paperwork|papers|letters|files)\b/.test(text)) return 'liquidation_next_step';
  // "WHOS PTOLMEY VARGA, HE KEEPS COMING UP IN THE GORSEBROOK STUFF": someone in
  // their papers, never a search of the sheet's people (blind docs run 2026-10-22).
  if (company && /\bwho(?:s|'s| is| was)\s+(?!the\b|our\b|in charge|on it|handling|dealing|looking|owns|responsible|it\b|that\b|this\b)[a-z]{3,}(?: [a-z]{3,})?\b/.test(text)
    && /\b(?:stuff|docs?|documents?|paperwork|papers|letters?|notice|coming up|keeps|mentioned|named|signed|in the)\b/.test(text)
    && !CHANGE.test(text.replace(ASK_START, ''))) return 'search_company_documents';
  // "ANY WORD FROM COMPANIES HOUSE", "ANYTHING NEW IN THE DOCS": its papers, read (fresh doc run 2026-10-22).
  if (company && /\bany (?:word|news|update|updates|letters?|post)\b|\banything new\b|\bheard (?:anything|back)\b|\bwhats? (?:new|goin(?:g)? on)\b/.test(text)) return 'liquidation_next_step';
  // "COPPERBECK PAGE IS BEHIND I THINK. FIX IT": the documents decide (fresh doc run 2026-10-22).
  if ((company || pageWide) && /\b(?:page|stage|stages)\b[^.?!]{0,20}\b(?:behind|out of date|outdated|old|wrong|not right)\b/.test(text)) return 'liquidation_next_step';
  // "LIQUIDATOR LETTER CAME IN, SORT THE STAGE OUT": the stage from that paper (held-out doc run 2026-10-22).
  if (company && /\b(?:sort|fix|update|correct|set)\b[^.?!]{0,25}\b(?:stage|page)\b/.test(text) && /\b(?:letter|docs?|documents?|notice|gazette|order|paperwork|came in|got)\b/.test(text)) return 'liquidation_next_step';
  // "FIX THE PAGE IF ITS WRONG", "WAT KIND OF LIQ IS IT": checked against the
  // documents, never their list (blind run 2026-10-22: the files were listed).
  if (company && /\b(?:fix|correct|update|sort)\b[^.?!]{0,30}\b(?:page|stage|it)\b[^.?!]{0,20}\bif\b|\bif (?:it'?s|its|the page is|the stage is) wrong\b|\bwhat (?:kind|type|sort) of (?:liq|liquidation|strike off|winding up)\b/.test(text)) return 'liquidation_next_step';
  // "WHAT DOES THE LETTER SAY": answered from it (fresh doc run 2026-10-22).
  if (company && DOC_WORDS.test(text) && /\b(?:what|whats|wat)\b[^.?!]*\b(?:say|says|said|mean|tell)\b/.test(text) && !CHANGE.test(text.replace(ASK_START, ''))) return 'search_company_documents';
  // "WHO GOT APPOINTED": a question about their papers, liquidator said or not (fresh doc run 2026-10-22).
  if (company && /\bwho (?:got|was|has been|is|were|have been) (?:appointed|named|put in)\b/.test(text)) return 'search_company_documents';
  // "WHOS THE ACTUAL LIQUIDATOR, THE PERSON NOT THE FIRM": the page holds the
  // firm; the person is in their letters (blind run 2026-10-22).
  if (company && /\bliquidators?\b/.test(text) && /\b(?:person|people|name of the|actual|named|individual|appointed|signed|insolvency practitioner|the ip|which one at|end(?:ed)? up with|go(?:ne)? with|who did)\b|\bnot the firm\b|\bwho(?:s|'s| is| was)? (?:the |their )?liquidators?\b/.test(text)
    && !CHANGE.test(text.replace(ASK_START, ''))) return 'search_company_documents';
  // "WHATS THE DEADLINE TO SORT HMRC OUT": the documents' dates as well as
  // the page's one (suite 2026-10-21: "no deadline" while HMRC's letter had one).
  if (company && asksAtAll(text) && /\b(?:deadlines?|due|by when|how long|time left|when (?:do|must|should|have) we)\b/.test(text) && !CHANGE.test(text.replace(ASK_START, ''))) return 'liquidation_next_step';
  // "WHICH ONES ARE NEARLY DONE": the furthest along, from the documents (blind run 2026-10-22).
  if (!company && /\b(?:nearly|almost|close to) (?:done|finished|closed|over|there|dissolved)\b|\bfurthest along\b|\bclosest to (?:closing|done|finish\w*|the end)\b/.test(text)
    && !/\b(?:deals?|contracts?|people|staff|invoices?|payments?|expenses?)\b/.test(text)) return 'liquidation_next_step';
  /**
   * WHERE A COMPANY IS AT, asked any way: "wheres quarry lane at", "is
   * pinecrest closed now", "status on everything thats closing", "how many r
   * winding down rn" (blind run 2026-10-22: each went to the sheet or was
   * asked back). "Closing" and "winding down" here are where it is, not an order.
   */
  // "WHAT ABOUT THEO BRANDTS ONE": a follow up through a person (held-out run 2026-10-22).
  if (/^\s*(?:(?:and|so|ok|okay)\s+)?(?:what about|how about|hows|how is)\b/.test(text) && !ordered0(text) && (await personsCompanies(text)).length) return 'list_liquidations';
  const asking = asksAtAll(text) || /^\s*(?:status|update|progress|where)\b|\bwhere (?:is|are)\b/.test(text)
    || /\bany (?:of (?:em|them|these|those) )?(?:closing|closed|winding down|in liquidation|going under)\b/.test(text);
  const ordered = ordered0(text);
  if (asking && !ordered && !CHANGE.test(text.replace(ASK_START, ''))
    && /\b(?:status|stages?|where (?:is|are)|how far|how many|closing|closed|shut|dissolved|wound up|winding down|in liquidation|going under|liquidated|finished|done|still (?:going|trading|open|running|active|alive|around|with us)|gone (?:under|bust))\b/.test(text)
    && !NEXT_STEP.test(text.replace(/\bwhere (?:are|do) we (?:at|stand)\b|\bwhere (?:we are|are we)\b/g, ''))) {
    await freshNames();
    const named = companiesNamedIn(text);
    if (named.names.length || named.ambiguous.length) return 'list_liquidations';
    if ((await personsCompanies(text)).length) return 'list_liquidations';
    if (pageWide || /\b(?:closing|winding down|in liquidation|going under)\b/.test(text)) return 'list_liquidations';
  }
  // "WHATS HAPPENING WITH THE WINDING DOWN ONES": the whole page, with its next steps.
  // A STATUS QUESTION WITH A CHANGE IN IT is the model's whole request.
  // "the ones winding down" is where they are, not an order (see `ordered`).
  if (ordered && !/^\s*(?:what|whats|which|who|how|is|are|any|when)\b/.test(text)) return null;
  // "WHATS THE CURRENT LIQUIDATION STATUS": every company, in code, at once.
  if (!company && (pageWide || liqWords || /\bliquidation\b/.test(text)) && asksAtAll(text) && /\b(?:status|stages?|where (?:are we|we are)|state)\b/.test(text)
    && !/\b(?:next|should|do we|to do|needs?)\b/.test(text) && !CHANGE.test(text.replace(ASK_START, ''))) return 'list_liquidations';
  if (!company && pageWide && asksAtAll(text) && /\b(?:happening|going on|latest|news|update|how are)\b/.test(text)
    && !CHANGE.test(text.replace(ASK_START, '').replace(/\bnews on\b/, ''))) return 'liquidation_next_step';
  if (NEXT_STEP.test(text) && !CHANGE_NOW.test(text)
    && (company || liqWords || pageWide)) return 'liquidation_next_step';
  // A QUESTION NAMING ONE OF THEIR DOCUMENTS is answered from it: "in the
  // statement of affairs, what is the total liabilities figure" (held-out run).
  const asks = ASK_START.test(text) || /\b(?:what|whats|what's|which|who|whos|how much|how many|when)\b/.test(text);
  if (asks && docNames.names.some((n) => text.includes(n)) && !CHANGE.test(text.replace(ASK_START, ''))) return 'search_company_documents';
  // "DOWNLOAD EVERYTHING FOR PINECREST": downloading is documents, never the sheet's export.
  if (company && /\b(?:download|zip)\b/.test(text)) return 'liquidation_document';
  // THE CLOSURE SHEET'S FIELDS (2026-11-04): "who changed pinecrest", "pinecrest's
  // history", "whos the official receiver on X", "any unresolved on X" read the page;
  // "chase X", "X is do not contact", "add Chloe Fletcher, examiner, to X" change it.
  const SHEET_FIELDS = /\b(?:official receiver|receiver|joint liquidators?|other part(?:y|ies)|parties|examiner|investigator|unresolved|last action|current play|play|prompts?|do not contact|dont contact|no deals?)\b/;
  if (company && /\bwho (?:changed|updated|edited|moved|set)\b|\b(?:history|audit|trail|changes) (?:of|on|for)\b|\b(?:its|their|the) (?:history|audit trail|changes)\b|\bhistory\b/.test(text)
    && !/\b(?:undo|revert|put back)\b/.test(text)) return 'list_liquidations';
  if (company && SHEET_FIELDS.test(text) && asksAtAll(text) && !CHANGE.test(text.replace(ASK_START, ''))) return 'list_liquidations';
  if (company && (SHEET_FIELDS.test(text) || /\b(?:chase|chasing|wait on|leave (?:it|them))\b/.test(text)) && !asksAtAll(text)) return 'update_liquidation';
  // A STAGE SAID IS A CHANGE, not its paperwork: "pinecrest GOT a first
  // gazette NOTICE, a compulsory strike off proposal" listed its documents
  // (suite 2026-10-14). Opening or sending a file still goes to the files.
  if (company && /\b(?:gazette|proposal|suspend\w*|objected|objection|strike off|struck off|own liq|hmrc liq|dissolv\w*|winding up order|wound up|next action|deadline (?:is|in|to|of|on|by|for|=))\b/.test(text)
    && !/\b(?:open|show|send|view|see|pull up|bring up)\b(?:\s+\S+){0,3}?\s+(?:the\s+)?(?:letter|pdf|document|documents|docs?|files?|order|petition|notice)\b|\b(?:letter|pdf|document|documents|docs?|files?)\b/.test(text)) return asksAtAll(text) || /\b(?:back|restore|reopen\w*|undo|mistake|resum\w*|revert)\b/.test(text) ? null : 'update_liquidation';
  // "PINECREST DOCS PLS": a company and its documents, nothing else, is its list.
  if (company && DOC_WORDS.test(text) && text.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean).length <= 5 && !DOC_FACTS.test(text)) return 'liquidation_document';
  // "WHAT PAPERWORK HAVE WE GOT FOR PINECREST" is its list, not what it says.
  if (company && DOC_WORDS.test(text) && /\b(?:have|got|on file|list|which|any)\b/.test(text) && !/\b(?:say|says|said|mention\w*|according)\b/.test(text) && !DOC_FACTS.test(text)) return 'liquidation_document';
  // "DOWNLOAD / SEE EVERYTHING ON FILE / THE PAPERWORK" for a company on the page.
  if (company && DOC_WORDS.test(text) && /\b(?:see|show|open|send|view|download|zip|everything|all)\b/.test(text) && !/\b(?:say|says|said|mention)\b/.test(text)) return 'liquidation_document';
  // "ZZ HARBOUR TEST LTD DETAILS" asks without a question word (2026-10-14).
  if (!asks && !(company && WANTS_ALL.test(text) && !CHANGE.test(text))) return null;
  if (!company && liqWords && !CHANGE.test(text.replace(ASK_START, ''))) return 'list_liquidations';
  if (company && DOC_FACTS.test(text) && !CHANGE.test(text.replace(ASK_START, ''))) return 'search_company_documents';
  if (company && !DOC_WORDS.test(text) && !CHANGE.test(text.replace(ASK_START, ''))
    && (/\b(?:deadlines?|due|how long|time left|liquidators?|stage|next action|instructions|liquidation|going on|happening|latest|status|update|where are we|details|everything|news|rundown)\b/.test(text)
      || WANTS_ALL.test(text))) return 'list_liquidations';
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
// NO DEAL WITH US, said the way people say it.
const NO_DEAL_WORDS = /\bno deals?\b|\bwithout (?:a )?deals?\b|\b(?:not|arent|aren't|isnt|isn't) on (?:the )?(?:master )?sheet\b|\b(?:nobody|no one|noone)(?:'?s| is)? (?:paid|being paid|on (?:the )?(?:payroll|sheet))\b|\bnot paying anyone\b|\bno one we pay\b/;
const FILTER_WORDS = /\b(?:not on (?:the )?(?:master )?sheet|nobody|no one|own liq|hmrc liq|strike|dissolved|active|proposal|gazette|suspended|rejected|cancel\w*|not set|passed|overdue|due|this week|owner|owned|group|blamed|stage|play|chas\w*|wait\w*|leave|left|do not contact|dont contact|no deals?|with deals|unresolved)\b/;
async function liquidationPlan(said, { hasFiles = false } = {}) {
  const text = lazy(fold(said));
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
    if (company.status === 'liquidation') return { reply: `${company.name} is already winding down, so it is on the Winding down page.` };
    return {
      tool: 'update_company', args: { name: company.name, status: 'liquidation' },
      reply: `${company.name} is now winding down, so it is on the Winding down page. Its stage starts as Not set.`,
    };
  }
  const tool = await liquidationRoute(said) ?? ((await namesADocument(said)) && /\b(?:open|show|send|get|give|pull up|bring up|view|see|download)\b/.test(text) ? 'liquidation_document' : null);
  if (!tool) return null;
  const company = pageCompanyIn(text);
  const rows = await repo.list();
  const row = company ? rows.find((r) => bare(r.company_name) === company) : null;
  if (tool === 'list_liquidations') {
    await freshNames();
    const { names: found, ambiguous } = companiesNamedIn(text);
    // Through the person when no company is named ("nell ardens company").
    const named = found.length ? found : (await personsCompanies(text)).map((n) => bare(n));
    if (named.length > 1) return { tool, args: { companies: named.map((n) => rows.find((r) => bare(r.company_name) === n)?.company_name ?? n) } };
    // "WHO CHANGED X", "X'S HISTORY": its audit trail.
    const history = /\bwho (?:changed|updated|edited|moved|set|put|marked|made|switched)\b|\bhistory\b|\baudit\b|\btrail\b/.test(text) ? { history: true } : {};
    if (row) return { tool, args: { company: row.company_name, ...history } };
    if (named.length === 1) return { tool, args: { company: named[0], ...history } };
    // "IS HARBOUR CLOSING" with two Harbors: which one, in code.
    if (ambiguous.length) {
      const which = pageNames.every.filter((n) => spelt(n).split(' ')[0] === ambiguous[0]);
      const all = await everyCompany();
      const full = which.map((n) => all.find((c) => bare(c) === n) ?? n);
      return { reply: `Which one do you mean: ${full.slice(0, -1).join(', ')} or ${full[full.length - 1]}?` };
    }
    return FILTER_WORDS.test(text) ? null : { tool, args: {} };
  }
  if (tool === 'liquidation_document' && row) {
    if (/\b(?:rename|remove|delete|bin|drop|take|get rid|clear|save|put|file|add|upload)\b/.test(text)) return null;
    const opens = /\b(?:open|show|send|get|give|pull up|bring up|view|see|download|zip|everything|all|every)\b/.test(text);
    return { tool, args: { company: row.company_name, action: opens ? 'open' : 'list' } };
  }
  return null;
}

/**
 * A HELD WINDING DOWN PREVIEW NARROWED BY THEIR WORDS: "actually just
 * ironleaf", "only quarry lane", "drop brightwell", "not pinecrest", "leave
 * harbor nine out". The items kept, or null when the words narrow nothing.
 */
function narrowItems(said, items) {
  const text = lazy(fold(said));
  const named = (i) => {
    const b = bare(i.company);
    const first = b.split(' ')[0];
    return text.includes(b) || (first.length >= 4 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(text));
  };
  const keep = /^\s*(?:(?:actually|no|nah|wait|ok|okay|oh|hmm|sorry|scratch that)[\s,.!]*)*(?:just|only)\b/.test(text);
  const drop = /^\s*(?:(?:actually|no|nah|wait|ok|okay|oh|hmm|sorry)[\s,.!]*)*(?:drop|remove|skip|not|leave|without|except|take out|minus)\b/.test(text);
  if (!keep && !drop) return null;
  // "LEAVE IRONLEAF FOR NOW, JUST HARBOR NINE": both named, and the "just" part
  // is what stays (blind run 2026-10-22: both were dropped and nothing was left).
  const justPart = drop && text.match(/\b(?:just|only)\b(.*)$/)?.[1];
  if (justPart) {
    const b = (i) => bare(i.company);
    const kept = items.filter((i) => justPart.includes(b(i)) || justPart.includes(b(i).split(' ')[0]));
    return kept.length && kept.length < items.length ? kept : null;
  }
  const hit = items.filter(named);
  if (!hit.length || hit.length === items.length && keep) return null;
  const out = keep ? hit : items.filter((i) => !hit.includes(i));
  return out.length && out.length < items.length ? out : null;
}

/**
 * "WAIT NO NOT QUARRY LANE, PINECREST": the held change moved to the company
 * they meant (held-out run 2026-10-22: she read Pinecrest out and the yes had
 * nothing). One company named that is not held, and a no to one that is.
 */
async function swapItems(said, items) {
  const text = lazy(fold(said));
  if (!/^\s*(?:(?:wait|sorry|oops|ah|ugh|hang on)[\s,.!]*)*(?:no|nah|not|wrong one|i meant|meant|scratch that)\b/.test(text)) return null;
  await freshNames();
  const { names } = companiesNamedIn(text);
  const held = new Set(items.map((i) => bare(i.company)));
  const fresh = names.filter((n) => !held.has(n));
  const dropped = items.filter((i) => names.includes(bare(i.company)));
  if (fresh.length !== 1 || (items.length > 1 && dropped.length !== 1)) return null;
  const from = items.length === 1 ? items[0] : dropped[0];
  const all = await everyCompany();
  const to = { ...from, company: all.find((n) => bare(n) === fresh[0]) ?? fresh[0] };
  return items.map((i) => (i === from ? to : i));
}

module.exports = {
  saidClose, narrowItems, pageCompanyNamed, pageCompaniesNamed, swapItems,
  namesADocument, liquidationRoute, liquidationPlan, namesList, asNews, kindFrom, cleanItem,
  liquidationTools, listLiquidations, updateLiquidation, liquidationDocument, searchCompanyDocuments, readCompanyDocument, liquidationNextStep, stageFrom,
};
