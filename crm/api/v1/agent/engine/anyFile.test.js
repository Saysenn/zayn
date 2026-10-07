const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { buildMasterSheetWorkbook } = require('../../masterSheet/buildWorkbook');
const { sheetTurn } = require('./runPlan');
const { intake } = require('./intake');

/**
 * ANY FILE, ANY LAYOUT, proved without a paid call: the model's half (what
 * each column means) is stood in for by a dictionary that answers the way
 * the model is asked to, so every line of OUR half is tested. What the model
 * itself understands is checked on the clone, with a real file, when asked.
 */
const MEANS = {
  role: 'role', 'name of individual': 'person', staff: 'person', name: 'person', 'company in question': 'company', client: 'company',
  'appointment date': 'assignedOn', 'payment start date': 'paymentStartOn', 'preset date': 'presetOn', 'provisional payment end date': 'endOn',
  'payable days this month': 'payableDays', 'method of payment': 'paymentMethod', 'monthly amount': 'monthlyAmount', salary: 'monthlyAmount',
  'payable amount': 'payableAmount', currency: 'currency', team: 'group', phone: 'phone',
  email: 'email', bank: 'bankDetails', 'account no': 'accountNumber', 'add on %': 'addonPercent', company: 'company', tier: 'tier', status: 'status',
};
const standIn = {
  chat: {
    completions: {
      create: async ({ messages }) => {
        const briefs = JSON.parse(messages[1].content);
        const tables = briefs.map((t) => {
          const summary = t.headers.some((h) => /row labels|sum of/i.test(h.header));
          const cols = t.headers.map((h) => ({ index: h.index, field: MEANS[String(h.header).toLowerCase()] ?? 'other' }));
          return {
            id: t.id,
            kind: summary ? 'summary' : t.headers.some((h) => /tier/i.test(h.header)) ? 'companies'
              : t.headers.some((h) => /email|bank/i.test(h.header)) && !t.headers.some((h) => /monthly|salary/i.test(h.header)) ? 'people' : 'deals',
            groupFrom: cols.some((c) => c.field === 'group') ? 'column' : t.sheet ? 'sheet' : 'none',
            columns: cols,
          };
        });
        return { choices: [{ message: { content: JSON.stringify({ tables }) } }] };
      },
    },
  },
};

const full = (id, person, group, company, role, monthly) => ({
  id, sync_key: `${group}|${company}|${role}|-|${person}`.toLowerCase(), source: 'synced', person_id: person.toLowerCase(),
  person_name: person, phone: '', role: role.toLowerCase(), seat: null, role_label: role, group_name: group, company,
  assigned_on: '2025-01-01', payment_start_on: '2025-04-01', preset_on: '2026-10-01', end_on: null, stopped_on: null,
  special_case_deal: false, payable_days: 31, monthly_amount: String(monthly), payable_amount: String(monthly), currency: 'GBP',
  payment_method: 'cash', location: 'South East', door_number: '', postcode: '', label: '', should_be_paid: '', paid: '', notes: '',
  bank_details: '', account_number: '', sort_code: '', accepting_postals: '', status: 'active', needs_review: false, review_reason: '',
  addon_percent: '0.00', fee_percent: '0.00', end_note: null, review_monthly: false,
});
const DEALS = [
  full(1, 'Gary', 'MANBAT', 'KP', 'KP', 6250),
  full(2, 'James Heath', 'MANBAT', 'Kryptonia', 'Director', 1500),
  full(3, 'Smurf', 'MANBAT', 'Workforce', 'Admin', 500),
  full(4, 'Gloria', 'MANBAT', 'Workforce', 'Closer', 500),
  full(5, 'Paddy', 'INDIGO', 'Workforce', 'Tech', 13500),
  full(6, 'Leanne Wong', 'INDIGO', 'Ackerman', 'Director', 1100),
];
const GROUPS = ['MANBAT', 'INDIGO'];
const check = async (input) => sheetTurn({ ...input, said: 'check this', groups: GROUPS, client: standIn, deals: DEALS, profiles: [], companies: [] });

test('HIS MASTER SHEET, any tab, read by meaning: the CRM\'s own sheet is NOTHING different', async () => {
  const buf = Buffer.from(await buildMasterSheetWorkbook(DEALS).xlsx.writeBuffer());
  const got = await intake({ buffer: buf, filename: 'm.xlsx' });
  const turn = await check({ tables: got.tables, text: got.text });
  assert.equal(turn.card.plan.status, 'clean', turn.reply);
  assert.match(turn.reply, /^Checked 6 rows\./);
  // How it was read: small print under the card, in their words.
  assert.match(turn.card.footer, /Read 4 deals from the MANBAT tab\. Group from the tab name\./);
  assert.match(turn.card.footer, /a totals table, skipped/);
  assert.ok(!turn.card.sections.some((x) => /How I read/.test(x.label)), 'never among the changes');
});

test('A FLAT CSV with nothing like his headers: Staff, Team, Client, Salary', async () => {
  const csv = 'Staff,Team,Client,Salary,Phone\nGary,MANBAT,KP,6300,\nJames Heath,MANBAT,Kryptonia,1500,\nSmurf,MANBAT,Workforce,500,\nGloria,MANBAT,Workforce,500,\nNew Person,MANBAT,Workforce,800,\n';
  const got = await intake({ buffer: Buffer.from(csv), filename: 'staff.csv' });
  const plan = (await check({ tables: got.tables, text: got.text })).card.plan;
  const changes = plan.steps.map((s) => `${s.action} ${s.person ?? ''} ${(s.changes ?? []).map((c) => `${c.field}=${c.value}`).join(',')}`.trim());
  assert.deepEqual(changes, ['update Gary monthlyAmount=6300', 'add_deal New Person monthlyAmount=800']);
});

test('A TOTAL ROW in any table is understood and skipped, never read as a person', async () => {
  const csv = 'Name,Team,Client,Salary\nGary,MANBAT,KP,6250\nTotal,,,6250\n';
  const got = await intake({ buffer: Buffer.from(csv), filename: 'x.csv' });
  const turn = await check({ tables: got.tables, text: got.text });
  assert.ok(!turn.card.plan.steps.some((s) => /total/i.test(s.person ?? '')));
  assert.ok(turn.card.sections.some((x) => x.label === 'Total rows'));
});

test('FIVE KNOWN EDITS to his sheet come back as exactly those five, through the any-file path', async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await buildMasterSheetWorkbook(DEALS).xlsx.writeBuffer()));
  for (const ws of book.worksheets) {
    const head = ws.getRow(1).values.map((v) => String(v ?? '').toLowerCase());
    const col = (re) => head.findIndex((h) => re.test(h));
    const NAME = col(/name of individual/);
    if (NAME < 0) continue;
    let gloria = null;
    let smurf = null;
    ws.eachRow((row, n) => {
      const name = String(row.getCell(NAME).value ?? '');
      if (name === 'Paddy') row.getCell(col(/^monthly amount/)).value = 14000;
      if (name === 'James Heath') row.getCell(col(/^preset date/)).value = new Date('2026-09-01T00:00:00Z');
      if (name === 'Gloria') gloria = { values: row.values.slice(1), at: n };
      if (name === 'Smurf') smurf = n;
    });
    if (gloria) {
      ws.spliceRows(gloria.at + 1, 0, gloria.values);
      ws.getRow(gloria.at + 1).getCell(NAME).value = 'Proof Newperson';
    }
    if (smurf) ws.spliceRows(smurf, 1);
    if (ws.name === 'MANBAT') ws.name = 'BATMAN';
  }
  const got = await intake({ buffer: Buffer.from(await book.xlsx.writeBuffer()), filename: 'm.xlsx' });
  const plan = (await check({ tables: got.tables, text: got.text })).card.plan;
  const steps = plan.steps.map((s) => (s.kind === 'rename_group' ? `rename ${s.from}>${s.to}`
    : `${s.action} ${s.person} ${(s.changes ?? []).map((c) => c.field).join(',')}`.trim()));
  assert.equal(steps.length, 5, steps.join(' | '));
  for (const want of ['rename MANBAT>BATMAN', 'stop Smurf', 'update James Heath presetOn', 'update Paddy monthlyAmount']) {
    assert.ok(steps.includes(want), `${want} missing from: ${steps.join(' | ')}`);
  }
  assert.ok(steps.some((x) => x.startsWith('add_deal Proof Newperson')), steps.join(' | '));
});

test('A QUESTION ABOUT THE FILE is answered by code: who is not in the CRM, and a total by team', async () => {
  const asked = [];
  // "Who is not in the CRM?" is the check narrowed to new deals, with no
  // extra call; a total is a question, answered by code.
  const queries = [
    { kind: 'question', source: 'file', filters: [], groupBy: 'group', measure: 'sum', field: 'monthlyAmount' },
  ];
  const client = {
    chat: {
      completions: {
        create: async (req) => {
          if (req.response_format.json_schema.name === 'query') { asked.push(req.messages[1].content); return { choices: [{ message: { content: JSON.stringify(queries.shift()) } }] }; }
          return standIn.chat.completions.create(req);
        },
      },
    },
  };
  const csv = 'Staff,Team,Client,Salary\nGary,MANBAT,KP,6250\nNew Person,MANBAT,Workforce,800\nPaddy,INDIGO,Workforce,13500\n';
  const got = await intake({ buffer: Buffer.from(csv), filename: 'x.csv' });
  const ask = (said) => sheetTurn({ tables: got.tables, text: got.text, said, groups: GROUPS, client, deals: DEALS });
  const who = await ask('who in this file is not in the crm?');
  assert.match(who.reply, /^1 new deal:\n• New Person · MANBAT · Workforce/);
  const total = await ask('total the salaries by team');
  assert.equal(total.reply, 'MANBAT: 7,050, INDIGO: 13,500');
  assert.equal(asked.length, 1);
});

test('A PEOPLE LIST AND A COMPANY LIST are checked too, and their fixes join the plan', async () => {
  const peopleCsv = 'Name,Email,Bank,Account No,Add on %\nGary,gary@new.com,Barclays,123,5\nPaddy,,HSBC,,0\nNobody Here,x@y.z,,,\n';
  const companyCsv = 'Company,Tier,Status\nKP,Gold,active\nKryptonia,Silver,closed\n';
  const profiles = [{ person_id: 'gary', display_name: 'Gary', email: 'gary@old.com', addon_percent: '5.00', fee_percent: '0.00' },
    { person_id: 'paddy', display_name: 'Paddy', email: null, addon_percent: '0.00', fee_percent: '0.00' }];
  const companies = [{ name: 'KP', tier: 'Gold', status: 'active', old_group: null }, { name: 'Kryptonia', tier: 'Bronze', status: 'active', old_group: null }];
  const run = async (csv) => {
    const got = await intake({ buffer: Buffer.from(csv), filename: 'x.csv' });
    return sheetTurn({ tables: got.tables, text: got.text, said: 'check this', groups: GROUPS, client: standIn, deals: DEALS, profiles, companies });
  };
  const people = (await run(peopleCsv)).card.plan;
  const p = people.steps.map((x) => `${x.action} ${x.person} ${x.changes.map((c) => `${c.field}=${c.value}`).join(',')}${x.ids ? ` on ${x.ids.length}` : ''}`);
  assert.deepEqual(p, [
    'person Gary email=gary@new.com',
    'update Gary bankDetails=Barclays,accountNumber=123 on 1',
    'update Paddy bankDetails=HSBC on 1',
  ]);
  assert.ok(people.notes.some((n) => /Could not match/.test(n.label) && n.rows.some((r) => r.name === 'Nobody Here')));
  const co = (await run(companyCsv)).card.plan;
  assert.deepEqual(co.steps.map((x) => `${x.action} ${x.company} ${x.changes.map((c) => `${c.field}=${c.value}`).join(',')}`), ['company Kryptonia tier=Silver,status=closed']);
  assert.match(co.steps[0].lines[0].detail, /closing it ends its live deals/);
});

/**
 * HIS REAL FILE, 2026-10-06: September's sheet against an October CRM, two
 * deals moved INDIGO → MILKMAN, a few real differences, a few new deals.
 * 96 "changes" and a yes that would have put the sheet back a month.
 */
const { readReply, pendingPlan } = require('./planSteps');
const { planTurn } = require('./runPlan');
const LAST_MONTH = [
  full(1, 'Gary', 'MANBAT', 'KP', 'KP', 6250),
  full(2, 'James Heath', 'MANBAT', 'Kryptonia', 'Director', 1500),
  full(3, 'Smurf', 'MANBAT', 'Workforce', 'Admin', 500),
  full(4, 'Gloria', 'MANBAT', 'Workforce', 'Closer', 500),
  full(5, 'Paddy', 'INDIGO', 'Workforce', 'Tech', 13500),
  full(6, 'James King', 'INDIGO', 'Monument', 'Director', 1250),
];
const septemberCsv = [
  'Name,Team,Client,Salary,Preset date,Payable days',
  'Gary,MANBAT,KP,6250,2026-09-01,30',
  'James Heath,MANBAT,Kryptonia,1600,2026-09-01,30',
  'Smurf,MANBAT,Workforce,500,2026-09-01,30',
  'Gloria,MANBAT,Workforce,500,2026-09-01,30',
  'Paddy,INDIGO,Workforce,13500,2026-09-01,30',
  'James King,MILKMAN,Monument,1250,2026-09-01,30',
  'Fresh Hire,MANBAT,KP,700,2026-09-01,30',
].join('\n');
MEANS['preset date'] = 'presetOn';
MEANS['payable days'] = 'payableDays';
const checkSeptember = async (said) => {
  const got = await intake({ buffer: Buffer.from(septemberCsv), filename: 's.csv' });
  return sheetTurn({ tables: got.tables, text: got.text, said, groups: ['MANBAT', 'INDIGO', 'MILKMAN'], client: standIn, deals: LAST_MONTH, profiles: [], companies: [] });
};
const stepsOf = (plan) => plan.steps.map((x) => (x.kind === 'move_deal' ? `move ${x.person} ${x.from}>${x.to}`
  : `${x.action} ${x.person} ${(x.changes ?? []).map((c) => c.field).join(',')}`.trim()));

test('LAST MONTH\'S SHEET: preset and days are never "changes", the real differences still are', async () => {
  const turn = await checkSeptember('crosscheck this and tell me what is wrong');
  assert.match(turn.reply, /September 2026's sheet and the CRM is on October 2026/);
  assert.deepEqual(stepsOf(turn.card.plan).sort(), [
    'add_deal Fresh Hire monthlyAmount', 'move James King INDIGO>MILKMAN', 'update James Heath monthlyAmount',
  ].sort());
});

test('A DEAL THAT CHANGED GROUP is one move, never an add and a stop', async () => {
  const plan = (await checkSeptember('check this')).card.plan;
  assert.ok(!plan.steps.some((x) => x.person === 'James King' && ['add_deal', 'stop'].includes(x.action)));
});

test('"IF THERE ARE NEW DEALS" is answered with the new deals, by name', async () => {
  const turn = await checkSeptember('crosscheck this if there are new deals');
  assert.deepEqual(stepsOf(turn.card.plan), ['add_deal Fresh Hire monthlyAmount']);
  assert.match(turn.reply, /^1 new deal:\n• Fresh Hire/);
});

test('"SHOW ME ALL DISCREPANCIES" to a waiting plan shows it, and changes nothing', async () => {
  const first = await checkSeptember('check this');
  const history = [{ role: 'user', content: 'check this' }, { role: 'assistant', content: '[plan]', list: first.card }, { role: 'assistant', content: first.reply }, { role: 'user', content: 'show me all discrepancies' }];
  const pending = pendingPlan(history);
  assert.deepEqual(readReply('show me all discrepancies', pending), { kind: 'view' });
  assert.deepEqual(readReply('what about james king?', pending), { kind: 'view' });
  const shown = await planTurn({ said: 'show me all discrepancies', pending, groups: [], invoke: async () => { throw new Error('nothing may be written'); } });
  assert.deepEqual(shown.card.plan.steps.map((x) => x.n), pending.steps.map((x) => x.n), 'the same plan, untouched');
  const narrowed = await planTurn({ said: 'actually only the new ones', pending, groups: [], invoke: async () => { throw new Error('nothing may be written'); } });
  assert.deepEqual(stepsOf(narrowed.card.plan), ['add_deal Fresh Hire monthlyAmount'], 'narrowed in code, no rewrite');
});

/**
 * WHAT WAS EXPECTED TO FAIL NEXT, 2026-10-06, each proved before it can.
 */
const { applyAnswers } = require('./runPlan');
const NEXT = [
  full(1, 'Gary', 'MANBAT', 'KP', 'KP', 6250),
  full(2, 'James Heath', 'MANBAT', 'Kryptonia', 'Director', 1500),
  full(3, 'Nathan', 'INDIGO', 'Social work first PR', 'Mid 1', 1000),
  full(4, 'Drew', 'MILKMAN', 'Workforce', 'Director', 900),
  full(5, 'Drew', 'MILKMAN', 'Workforce', 'Mid 1', 400),
  full(6, 'Paddy', 'INDIGO', 'Acqua resourcing', 'Tech', 13500),
];
MEANS.role = 'role';
MEANS.preset = 'presetOn';
MEANS.notes = 'notes';
const checkNext = async (csv, said = 'check this', means = null) => {
  const got = await intake({ buffer: Buffer.from(csv), filename: 'x.csv' });
  let client = standIn;
  if (means) {
    client = { chat: { completions: { create: async (req) => {
      const out = await standIn.chat.completions.create(req);
      const parsed = JSON.parse(out.choices[0].message.content);
      parsed.tables.forEach((t) => t.columns.forEach((c) => { if (means[c.index]) c.field = means[c.index]; }));
      return { choices: [{ message: { content: JSON.stringify(parsed) } }] };
    } } } };
  }
  return sheetTurn({ tables: got.tables, text: got.text, said, groups: ['MANBAT', 'INDIGO', 'MILKMAN'], client, deals: NEXT, profiles: [], companies: [] });
};

test('1-2. THE SAME DEAL SPELT ANOTHER WAY is that deal, not a new one and a stop', async () => {
  const csv = 'Name,Team,Client,Salary\nGary,MANBAT,KP Ltd,6300\nJamess Heath,MANBAT,Kryptonia,1500\nPaddy,INDIGO,Acqua Resourcing Ltd,13500\n';
  const turn = await checkNext(csv);
  // "KP Ltd", "Jamess" and "Acqua Resourcing Ltd" are all theirs: only Gary's real change is left.
  assert.deepEqual(stepsOf(turn.card.plan), ['update Gary monthlyAmount']);
});

test('1. "Social work FIRST PR" is never taken for "Social work PARTNERS PR"', async () => {
  const csv = 'Name,Team,Client,Salary\nNathan,INDIGO,Social work partners PR,3000\nNathan,INDIGO,Social work first PR,1000\n';
  const plan = (await checkNext(csv)).card.plan;
  assert.deepEqual(stepsOf(plan), ['add_deal Nathan monthlyAmount']);
});

test('3. ANSWERS TO HER QUESTIONS fill the new deal, and nothing else', () => {
  const step = { n: 2, action: 'add_deal', person: 'Fresh Hire', group: 'MANBAT', company: null, changes: [{ field: 'monthlyAmount', mode: 'set', value: '700' }], need: ['company', 'roleLabel'], question: 'Step 2: …', line: 7 };
  const half = applyAnswers(step, [{ step: 2, field: 'roleLabel', value: 'Mid 1' }]);
  assert.deepEqual(half.need, ['company']);
  assert.match(half.question, /still needs: company/);
  const done = applyAnswers(half, [{ step: 2, field: 'company', value: 'KP' }]);
  assert.equal(done.question, null);
  assert.equal(done.company, 'KP');
  assert.deepEqual(applyAnswers(step, []), step, 'no answer for it, untouched');
});

test('4. TWO DEALS AT ONE COMPANY are told apart by the role on the row', async () => {
  const csv = 'Name,Team,Client,Role,Salary\nDrew,MILKMAN,Workforce,Mid 1,450\nDrew,MILKMAN,Workforce,Director,900\n';
  const plan = (await checkNext(csv)).card.plan;
  assert.deepEqual(plan.steps.map((x) => `${x.ids?.[0]} ${x.changes.map((c) => `${c.field}=${c.value}`).join(',')}`), ['5 monthlyAmount=450']);
});

test('6. DATES MONTH FIRST are seen from the column itself', async () => {
  const csv = 'Name,Team,Client,Salary,Preset\nGary,MANBAT,KP,6250,10/25/2026\nJames Heath,MANBAT,Kryptonia,1500,10/01/2026\n';
  const turn = await checkNext(csv);
  const heath = turn.card.plan.steps.find((x) => x.person === 'James Heath');
  assert.equal(heath, undefined, '10/01/2026 is 1 October here, the same as ours');
  assert.match(turn.card.footer, /Dates read month first in: Preset/);
});

test('8. A COLUMN MISREAD AS A NUMBER is set aside and said, never turned into changes', async () => {
  const csv = 'Name,Team,Client,Salary,Notes\nGary,MANBAT,KP,6250,ok\nJames Heath,MANBAT,Kryptonia,1500,fine\nPaddy,INDIGO,Acqua resourcing,13500,good\n';
  const turn = await checkNext(csv, 'check this', { 4: 'payableAmount' });
  assert.equal(turn.card.plan.steps.length, 0);
  assert.match(turn.card.footer, /Set aside: Notes did not look like payable/);
  assert.match(turn.card.footer, /Columns: .*Salary = monthly/, 'the full list, because something looked odd');
});

test('9. TOTALS HOWEVER WRITTEN are skipped', async () => {
  const csv = 'Name,Team,Client,Salary\nGary,MANBAT,KP,6250\nTOTAL GBP,,,6250\nGrand Total,,,6250\n';
  const turn = await checkNext(csv);
  assert.ok(!turn.card.plan.steps.some((x) => /total/i.test(x.person ?? '')));
});

test('10. "ANYONE JOINED?" and "WHO LEFT?" are answered with just those', async () => {
  const csv = 'Name,Team,Client,Salary\nGary,MANBAT,KP,6250\nFresh Hire,MANBAT,KP,700\n';
  assert.deepEqual(stepsOf((await checkNext(csv, 'anyone joined?')).card.plan), ['add_deal Fresh Hire monthlyAmount']);
});

test('A PLAN STEP ON A DEAL CHANGED SINCE THE PREVIEW is left alone, and says what changed', async () => {
  const { runSteps } = require('./runPlan');
  const repo = require('../../repos/masterSheetRows.repo');
  const db = require('../../../configs/db');
  const realFind = repo.findById;
  const realQuery = db.query;
  repo.findById = async (id) => ({ id, monthly_amount: id === 1 ? '6300' : '1500', group_name: 'MANBAT' });
  db.query = async () => ({ rows: [{ id: 0, changes: 0, parked: 0, deals: 0, stopped: 0 }] });
  try {
    const calls = [];
    const plan = { id: 'p', steps: [
      { n: 1, action: 'update', person: 'Gary', ids: [1], changes: [{ field: 'monthlyAmount', mode: 'set', value: '6500' }], before: { 1: { monthlyAmount: '6250' } } },
      { n: 2, action: 'update', person: 'James Heath', ids: [2], changes: [{ field: 'monthlyAmount', mode: 'set', value: '1600' }], before: { 2: { monthlyAmount: '1500' } } },
    ] };
    const done = await runSteps(plan, async (name, args) => { calls.push(args.id); return { summary: 'ok' }; });
    assert.deepEqual(calls, [], 'ALL OR NOTHING: one deal moved, so nothing is written');
    assert.equal(done.status, 'preview');
    assert.deepEqual(done.stale.map((t) => t.n), [1]);
    assert.match(done.stale[0].why, /monthly changed to 6300 since you saw this/);
    const skipped = await runSteps({ ...plan, steps: plan.steps.map((x) => (x.n === 1 ? { ...x, skipped: true } : x)) }, async (name, args) => { calls.push(args.id); return { summary: 'ok' }; });
    assert.deepEqual(calls, [2], 'with it skipped, the rest goes');
    assert.equal(skipped.status, 'done');
  } finally {
    repo.findById = realFind;
    db.query = realQuery;
  }
});

test('A FILE ABOUT ANOTHER AREA is said to be one, never checked as deals', async () => {
  const client = { chat: { completions: { create: async (req) => {
    const briefs = JSON.parse(req.messages[1].content);
    return { choices: [{ message: { content: JSON.stringify({ tables: briefs.map((t) => ({ id: t.id, kind: 'expenses', groupFrom: 'none', columns: t.headers.map((h) => ({ index: h.index, field: /desc/i.test(h.header) ? 'description' : /amount/i.test(h.header) ? 'amount' : 'other' })) })) }) } }] };
  } } } };
  const got = await intake({ buffer: Buffer.from('Description,Amount\nTaxi,40\nLunch,25\n'), filename: 'e.csv' });
  const turn = await sheetTurn({ tables: got.tables, text: got.text, said: 'check this', groups: GROUPS, client, deals: DEALS, profiles: [], companies: [] });
  assert.match(turn.reply, /looks like 2 rows of expenses, not master sheet deals/);
  assert.equal(turn.card.kind, 'report');
});

test('A ROW THAT IS A STOPPED DEAL OF OURS is listed as stopped, never offered as new', async () => {
  const withArchive = [...LAST_MONTH, { ...full(9, 'Fresh Hire', 'MANBAT', 'KP', 'Mid 1', 700), stopped_on: '2026-09-15', stopped_reason: 'stopped_by_hand' }];
  const got = await intake({ buffer: Buffer.from(septemberCsv), filename: 's.csv' });
  const turn = await sheetTurn({ tables: got.tables, text: got.text, said: 'check this', groups: ['MANBAT', 'INDIGO', 'MILKMAN'], client: standIn, deals: withArchive, profiles: [], companies: [] });
  assert.ok(!turn.card.plan.steps.some((x) => x.action === 'add_deal'), 'Fresh Hire is in the Archive, not new');
  assert.ok(turn.card.sections.some((x) => /^Stopped here, still in your file · 1/.test(x.label)));
  assert.match(turn.reply, /1 stopped here but still in your file/);
});

test('A WHOLE GROUP is one step over every live deal in it, each deal shown', async () => {
  const { checkSteps } = require('./runPlan');
  const repo = require('../../repos/masterSheetRows.repo');
  const realAll = repo.findAll;
  repo.findAll = async () => ({ rows: [
    { id: 1, person_name: 'Gary', group_name: 'MANBAT', company: 'KP', payable_days: 30, monthly_amount: 1000, payable_amount: 1000 },
    { id: 2, person_name: 'Drew', group_name: 'MANBAT', company: 'KP', payable_days: 30, monthly_amount: 500, payable_amount: 500 },
    { id: 3, person_name: 'Old', group_name: 'MANBAT', company: 'KP', stopped_on: '2026-09-01' },
    { id: 4, person_name: 'Zayn', group_name: 'INDIGO', company: 'W', payable_days: 30 },
  ] });
  try {
    const [step] = await checkSteps([{ n: 1, action: 'update', person: '*', group: 'manbat', company: '', allDeals: true, changes: [{ field: 'payableDays', mode: 'set', value: '31' }], when: '', newName: '', source: '' }], { groups: ['MANBAT', 'INDIGO'], said: 'set every manbat deal to 31 days' });
    assert.equal(step.question, null);
    assert.deepEqual(step.ids, [1, 2], 'live MANBAT deals only');
    assert.equal(step.lines.length, 2);
    const [stop] = await checkSteps([{ n: 1, action: 'stop', person: '*', group: 'MANBAT', company: '', allDeals: true, changes: [], when: '', newName: '', source: '' }], { groups: ['MANBAT'], said: 'stop all manbat' });
    assert.match(stop.question, /only change figures or details for a whole group/);
  } finally {
    repo.findAll = realAll;
  }
});

test('TABS LAID OUT THE SAME are asked about once, and each gets the answer', async () => {
  const { understand } = require('./layout');
  let asked = 0;
  const client = { chat: { completions: { create: async (req) => {
    const briefs = JSON.parse(req.messages[1].content);
    asked += briefs.length;
    return { choices: [{ message: { content: JSON.stringify({ tables: briefs.map((t) => ({ id: t.id, kind: 'deals', groupFrom: 'sheet', columns: [{ index: 0, field: 'person' }, { index: 1, field: 'monthlyAmount' }] })) }) } }] };
  } } } };
  const tab = (id, sheet) => ({ id, sheet, headers: ['Name', 'Monthly'], rows: [{ cells: ['Gary', '100'] }] });
  const got = await understand([tab('a', 'MANBAT'), tab('b', 'INDIGO'), tab('c', 'MILKMAN')], { client });
  assert.equal(asked, 1, 'one question for three tabs');
  assert.deepEqual([...got.keys()], ['a', 'b', 'c']);
  assert.deepEqual(got.get('c').fields, ['person', 'monthlyAmount']);
});

test('TWO-ROW HEADERS: a band over columns, and sub-labels on the row below', () => {
  const { tablesIn } = require('./intake');
  const banded = tablesIn([
    [null, null, 'Bank details', 'Bank details', null],
    ['Name', 'Company', 'Account', 'Sort code', 'Monthly'],
    ['Gary', 'KP', '12345678', '11-22-33', 1000],
    ['Drew', 'KP', '87654321', '33-22-11', 500],
  ], 'MANBAT');
  assert.deepEqual(banded[0].headers, ['Name', 'Company', 'Bank details Account', 'Bank details Sort code', 'Monthly']);
  const split = tablesIn([
    ['Name', 'Company', 'Monthly', null, 'Role'],
    [null, null, 'Amount', 'Currency', null],
    ['Gary', 'KP', 1000, 'GBP', 'Director'],
    ['Drew', 'KP', 500, 'GBP', 'Mid 1'],
  ], 'MANBAT');
  assert.deepEqual(split[0].headers, ['Name', 'Company', 'Monthly Amount', 'Currency', 'Role']);
  assert.equal(split[0].rows.length, 2, 'the sub-label row is not a deal');
  assert.equal(split[0].rows[0].cells[0], 'Gary');
  const title = tablesIn([
    ['September payroll', null, null],
    ['Name', 'Company', 'Monthly'],
    ['Gary', 'KP', 1000],
    ['Drew', 'KP', 500],
  ], 'S');
  assert.deepEqual(title[0].headers, ['Name', 'Company', 'Monthly'], 'a title in one cell prefixes nothing');
});

test('A POWERPOINT is read slide by slide; a file nothing here reads is refused plainly', async () => {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>Lunch 120 at Zuma</a:t></a:r></a:p></p:sld>');
  zip.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>Taxi 45 &amp; parking 20</a:t></a:r></a:p></p:sld>');
  const pptx = await zip.generateAsync({ type: 'nodebuffer' });
  const got = await intake({ buffer: pptx, filename: 'october.pptx' });
  assert.equal(got.text, 'Slide 1:\nTaxi 45 & parking 20\n\nSlide 2:\nLunch 120 at Zuma');
  await assert.rejects(intake({ buffer: pptx, filename: 'archive.zip' }), /not a kind of file I can read/);
});
