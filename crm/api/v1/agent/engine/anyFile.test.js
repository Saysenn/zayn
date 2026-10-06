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
  assert.match(turn.reply, /6 rows checked/);
  const how = turn.card.sections.find((x) => x.label === 'How I read your file').rows.map((r) => r.name).join('\n');
  assert.match(how, /MANBAT tab: 4 rows of deals\. group = the tab name/);
  assert.match(how, /summary\/totals table, not compared/);
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
  const queries = [
    { kind: 'question', source: 'not_in_crm', filters: [], groupBy: '', measure: 'list', field: '' },
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
  assert.equal(who.card.kind, 'report');
  assert.deepEqual(who.card.sections[0].rows.map((r) => r.name), ['New Person · MANBAT · Workforce']);
  const total = await ask('total the salaries by team');
  assert.equal(total.reply, 'MANBAT: 7,050, INDIGO: 13,500');
  assert.equal(asked.length, 2);
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
