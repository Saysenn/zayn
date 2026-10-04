const ExcelJS = require('exceljs');
const { scrubWorkbook } = require('../shared/scrubWorkbook.helper');
const { MONEY_FMT } = require('../shared/sheetFormats');
const { countsTowardTotal } = require('../shared/owedThisMonth.helper');
const { withRates } = require('../shared/rates.helper');
const { areaOf, kmBetween } = require('../shared/ukPostcodeAreas.helper');
const {
  styleHeader, sortGroupNames, METHOD_LABELS, setPalette, pickColumns,
} = require('./buildWorkbook');

/**
 * ===============================
 * * THE DRIVERS SHEET
 * ===============================
 * His call 2026-10-04, modelled on docs/boss/manually copied driver
 * sheet.xlsx. The month's money sorted by WHO DELIVERS IT:
 *
 *   Area split  the UK cash, a section per run (North run, To be posted,
 *               South run...), a table per location inside it. The main tab.
 *   UK cash     the same people, one row each, their deals added up and
 *               split by group.
 *   Outside UK  everyone at a location outside the UK, any method or
 *               currency, with what it is in USD.
 *   Mid split   the people above who hold several deals, one line per deal.
 *
 * WHICH LOCATION GOES ON WHICH RUN IS A SETTING (tb_settings.driver_sheet,
 * 071), edited on the Drivers tab by dragging a location onto a run. This
 * file never decides it: a location nobody has placed is reported, never
 * guessed.
 */

/**
 * THE DEFAULTS: his manual file's own split (docs/boss/manually copied
 * driver sheet.xlsx). The same as 071's column default, so "Reset to the
 * sheet's defaults" puts it back exactly as it started.
 */
const DEFAULT_DRIVER_SHEET = Object.freeze({
  runs: [
    { id: 'north', label: 'North run', color: '#c2410c' },
    { id: 'posted', label: 'To be posted', color: '#6d28d9' },
    { id: 'south', label: 'South run', color: '#0f766e' },
  ],
  places: {
    'chip county': 'north',
    geordie: 'north',
    'northern dock': 'posted',
    'strong man': 'posted',
    'main city': 'south',
    'south east': 'south',
    'abu dhabi': 'abroad',
    away: 'abroad',
    euro: 'abroad',
  },
});

// The fixed bucket for "not delivered from the UK". Runs are his to add,
// rename or remove; this one is what the Outside UK tab is.
const ABROAD = 'abroad';
const ABROAD_LABEL = 'Outside UK';

/** A location as one place: "South east" and "South East" are the same. */
const placeKey = (location) => String(location ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const shouldBePaid = (r) => r.override_should_be_paid !== false;
const personKey = (r) => String(r.person_id ?? r.person_name ?? '').trim().toLowerCase();
const round2 = (n) => Math.round(n * 100) / 100;

// The person columns, in the manual file's order and with its headers.
const FIELDS = [
  { key: 'person_name', header: 'Name of individual:', width: 22, required: true },
  { key: 'payment_method', header: 'Method of payment:', width: 16 },
  { key: 'payable_amount', header: 'Payable amount:', width: 15, money: true },
  { key: 'currency', header: 'Currency:', width: 10 },
  { key: 'location', header: 'Location:', width: 16 },
  { key: 'label', header: 'Label', width: 26 },
  { key: 'door_number', header: 'Door number', width: 16 },
  { key: 'postcode', header: 'Postcode', width: 14 },
  { key: 'phone', header: 'Phone number', width: 18 },
  { key: 'accepting_postals', header: 'Accepting postals', width: 16 },
  { key: 'company', header: 'Company', width: 22, optional: true },
  { key: 'group_name', header: 'Group', width: 12, optional: true },
  { key: 'notes', header: 'Notes', width: 26, optional: true },
];
const SEND = FIELDS.filter((f) => !f.optional).map((f) => f.key);
const REQUIRED = new Set(['person_name']);

/** For the column picker: the same shape the other templates answer with. */
function listDriverColumns() {
  return FIELDS.map((f) => ({
    key: f.key, header: f.header.replace(/:$/, ''), required: Boolean(f.required), inSend: SEND.includes(f.key),
  }));
}

/**
 * ===============================
 * * WHICH ROWS, AND WHERE EACH ONE GOES
 * ===============================
 * Owed this month (the same test every payout file uses: counted, should be
 * paid, something to pay), with the person's add on and fee already on the
 * figure, because the manual file's amounts carry them (Zayn's AED 8,000
 * is AED 8,400 there).
 *
 * Then by its location's run: ABROAD goes to Outside UK whatever the
 * method; a UK run takes CASH only, since bank and crypto in the UK are the
 * Bank and Crypto files' business; no run yet is UNASSIGNED.
 */
function sortRows(rows, setup = {}, { rates = null, cryptoPercent = 0, useEndDate = false } = {}) {
  const runs = new Set((setup.runs ?? []).map((r) => r.id));
  const places = setup.places ?? {};
  const owed = (rows ?? [])
    .filter((r) => !r.stopped_on && countsTowardTotal(r, { useEndDate }) && shouldBePaid(r))
    .map((r) => withRates(r, rates, { cryptoPercent }))
    .filter((r) => Number(r.payable_amount) > 0);

  const out = { uk: [], abroad: [], unassigned: [], noLocation: [] };
  for (const r of owed) {
    const key = placeKey(r.location);
    const run = places[key];
    if (!key) {
      if (r.payment_method === 'cash') out.noLocation.push(r);
    } else if (run === ABROAD) {
      out.abroad.push({ ...r, run: ABROAD, place: key });
    } else if (run && runs.has(run)) {
      if (r.payment_method === 'cash') out.uk.push({ ...r, run, place: key });
    } else if (r.payment_method === 'cash' || !isUkPostcodeRow(r)) {
      out.unassigned.push({ ...r, place: key });
    }
  }

  /**
   * NO LOCATION, BUT A POSTCODE: placed at the nearest assigned UK place
   * when it is close (60 km), otherwise left on the "no location" list.
   * Never guessed from anything else.
   */
  const centres = placeCentres(out.uk);
  out.noLocation = out.noLocation.filter((r) => {
    const at = areaOf(r.postcode);
    if (!at) return true;
    let best = null;
    for (const [key, c] of centres) {
      const km = kmBetween(at, c);
      if (km < 60 && (!best || km < best.km)) best = { key, km, run: c.run };
    }
    if (!best) return true;
    out.uk.push({ ...r, run: best.run, place: best.key, placedByPostcode: true });
    return false;
  });
  return out;
}

const isUkPostcodeRow = (r) => Boolean(areaOf(r.postcode));

/** The location whose rows sit nearest this row's postcode, or null. */
function nearestPlace(r, centres, except = null) {
  const at = areaOf(r.postcode);
  if (!at) return null;
  let best = null;
  for (const [key, c] of centres) {
    if (key === except) continue;
    const km = kmBetween(at, c);
    if (!best || km < best.km) best = { key, km };
  }
  return best ? best.key : null;
}

/** Each place's centre, from the postcodes on its rows. */
function placeCentres(rows) {
  const acc = new Map();
  for (const r of rows) {
    const at = areaOf(r.postcode);
    if (!at) continue;
    const c = acc.get(r.place) ?? { lat: 0, lon: 0, n: 0, run: r.run };
    c.lat += at.lat; c.lon += at.lon; c.n += 1;
    acc.set(r.place, c);
  }
  return new Map([...acc].map(([k, c]) => [k, { lat: c.lat / c.n, lon: c.lon / c.n, run: c.run }]));
}

/**
 * ===============================
 * * WHAT THE DRIVERS TAB SHOWS
 * ===============================
 * One entry per location with money on it this month: its run (or none),
 * where it is on the map, a suggestion for a new one, and the deals behind
 * it for the popover. Plus the checks shown before export.
 */
const ABROAD_WORDS = /\b(?:abu dhabi|dubai|uae|euro|europe|away|abroad|outside uk|overseas|cyprus|spain|portugal|lithuania|estonia|colombia)\b/i;

function setupView(rows, setup = {}, opts = {}) {
  const runIds = new Set((setup.runs ?? []).map((r) => r.id));
  const places = setup.places ?? {};
  const sorted = sortRows(rows, setup, opts);
  const all = [...sorted.uk, ...sorted.abroad, ...sorted.unassigned];

  const allAreas = new Map();
  for (const r of rows ?? []) {
    const at = areaOf(r.postcode);
    const key = placeKey(r.location);
    if (!at || !key) continue;
    allAreas.set(key, [...(allAreas.get(key) ?? []), at]);
  }
  const byPlace = new Map();
  for (const r of all) {
    const list = byPlace.get(r.place) ?? [];
    list.push(r);
    byPlace.set(r.place, list);
  }

  const view = [];
  for (const [key, list] of byPlace) {
    const assigned = places[key];
    const run = assigned === ABROAD || runIds.has(assigned) ? assigned : null;
    const spellings = new Map();
    for (const r of list) spellings.set(r.location.trim(), (spellings.get(r.location.trim()) ?? 0) + 1);
    const name = [...spellings].sort((a, b) => b[1] - a[1])[0][0];
    /**
     * WHERE IT IS ON THE MAP: the most common postcode area across EVERY row
     * at this location, not just this month's. Chip county's owed rows all
     * say "In person meet", while its other rows carry B69; and an average
     * let one Leicester row pull Main City halfway up the M1.
     */
    const areas = (allAreas.get(key) ?? []);
    const tally = new Map();
    for (const a of areas) tally.set(a.area, (tally.get(a.area) ?? 0) + 1);
    const top = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
    const topArea = top ? areas.find((a) => a.area === top) : null;
    const centre = topArea ? { lat: topArea.lat, lon: topArea.lon } : null;
    const nonGbp = list.every((r) => (r.currency || 'GBP') !== 'GBP');
    const suggest = run ? null : centre ? 'uk' : nonGbp || ABROAD_WORDS.test(name) ? ABROAD : null;
    view.push({
      key,
      name,
      run,
      suggest,
      ...(centre ?? {}),
      areas: [...tally.keys()],
      people: new Set(list.map(personKey)).size,
      deals: list
        .map((r) => ({
          name: r.person_name,
          group: r.group_name,
          currency: r.currency || 'GBP',
          amount: round2(Number(r.payable_amount)),
          method: r.payment_method,
        }))
        .sort((a, b) => b.amount - a.amount),
    });
  }
  view.sort((a, b) => b.deals.length - a.deals.length || a.name.localeCompare(b.name));
  // The places' map spots, from every row, for the checks' suggestions too:
  // this month's Chip county rows have no postcode, its other rows do.
  const spotsByPlace = new Map(view.filter((p) => p.lat != null)
    .map((p) => [p.key, { lat: p.lat, lon: p.lon, run: p.run }]));
  return { places: view, checks: checksFor(sorted, setup, spotsByPlace) };
}

/**
 * ===============================
 * * CHECKS BEFORE EXPORT, said, never fixed quietly
 * ===============================
 */
function checksFor(sorted, setup = {}, spots = null) {
  const runLabel = new Map((setup.runs ?? []).map((r) => [r.id, r.label]));
  const checks = [];
  const centres = spots && spots.size ? spots : placeCentres(sorted.uk);
  const unassigned = [...new Set(sorted.unassigned.map((r) => r.location.trim()))];
  if (unassigned.length) {
    checks.push({
      kind: 'unassigned',
      blocking: true,
      text: `${unassigned.length} location${unassigned.length === 1 ? ' has' : 's have'} no run yet: ${unassigned.join(', ')}`,
      hint: 'Drag it to a run, or to Outside UK. The export waits until every place has one.',
    });
  }
  if (sorted.noLocation.length) {
    checks.push({
      kind: 'noLocation',
      text: `${sorted.noLocation.length} cash deal${sorted.noLocation.length === 1 ? ' has' : 's have'} no location: ${[...new Set(sorted.noLocation.map((r) => r.person_name))].join(', ')}`,
      hint: 'Not on any run until they have one. Set it here and it is saved on the master sheet.',
      items: sorted.noLocation.map((r) => ({ id: r.id, name: r.person_name, suggest: nearestPlace(r, centres) })),
    });
  }
  const cannotPost = sorted.uk.filter((r) => /post/i.test(runLabel.get(r.run) ?? '')
    && (/in person/i.test(String(r.door_number ?? '')) || /^no$/i.test(String(r.accepting_postals ?? '').trim())));
  if (cannotPost.length) {
    checks.push({
      kind: 'cannotPost',
      text: `Can't be posted (in person meet, or not accepting postals): ${[...new Set(cannotPost.map((r) => r.person_name))].join(', ')}`,
      hint: 'Someone has to hand it over in person. Move the location to a run if that is how it goes.',
    });
  }
  // A postcode far from the rest of its location's rows.
  const strays = sorted.uk.filter((r) => {
    const at = areaOf(r.postcode);
    const c = centres.get(r.place);
    return at && c && !r.placedByPostcode && kmBetween(at, c) > 90;
  });
  if (strays.length) {
    checks.push({
      kind: 'postcodeFar',
      text: `Postcode far from its location: ${strays.map((r) => `${r.person_name} (${String(r.postcode).trim()} under ${r.location.trim()})`).join(', ')}`,
      hint: 'Probably the wrong location. Move it to the place its postcode is in, or leave it if the location is right.',
      items: strays.map((r) => ({ id: r.id, name: r.person_name, current: r.location.trim(), suggest: nearestPlace(r, centres, r.place) })),
    });
  }
  const ukPeople = new Set(sorted.uk.map(personKey));
  const both = [...new Set(sorted.abroad.filter((r) => ukPeople.has(personKey(r))).map((r) => r.person_name))];
  if (both.length) {
    checks.push({
      kind: 'bothSides',
      text: `On both the UK and Outside UK tabs: ${both.join(', ')}`,
      hint: 'Fine as it is: each deal goes on its own tab. Just so you know they appear twice.',
    });
  }
  const notGbp = sorted.uk.filter((r) => (r.currency || 'GBP') !== 'GBP');
  if (notGbp.length) {
    checks.push({
      kind: 'notGbp',
      text: `Paid in another currency in the UK: ${notGbp.map((r) => `${r.person_name} (${r.currency})`).join(', ')}`,
      hint: 'A reminder that this cash is not pounds. Change it on the master sheet only if it is wrong.',
    });
  }
  return checks;
}

/**
 * ===============================
 * * THE WORKBOOK
 * ===============================
 */

/** One row per person (and currency) in `rows`, their deals added up and split by group. */
function perPerson(rows) {
  const out = new Map();
  for (const r of rows) {
    const cur = r.currency || 'GBP';
    const key = `${personKey(r)}|${cur}`;
    const p = out.get(key) ?? {
      person_name: r.person_name, currency: cur, payable_amount: 0, byGroup: new Map(), methods: new Set(), rows: [],
    };
    for (const f of ['location', 'label', 'door_number', 'postcode', 'phone', 'accepting_postals', 'company', 'notes']) {
      if (!p[f] && r[f]) p[f] = r[f];
    }
    p.payable_amount = round2(p.payable_amount + Number(r.payable_amount));
    p.byGroup.set(r.group_name, round2((p.byGroup.get(r.group_name) ?? 0) + Number(r.payable_amount)));
    p.methods.add(METHOD_LABELS[r.payment_method] ?? r.payment_method);
    p.group_name = p.group_name && p.group_name !== r.group_name ? 'Several' : r.group_name;
    p.rows.push(r);
    out.set(key, p);
  }
  return [...out.values()].map((p) => ({ ...p, payment_method: [...p.methods].join(', ') }));
}

function valueOf(p, key) {
  if (key === 'payable_amount') return p.payable_amount;
  return p[key] ?? '';
}

function writeTable(ws, startRow, cols, people, { groups = null, total = false } = {}) {
  const headers = [...cols.map((c) => c.header), ...(groups ? [...groups, 'Total'] : [])];
  ws.getRow(startRow).values = headers;
  styleHeader(ws, startRow);
  let at = startRow + 1;
  for (const p of people) {
    const values = cols.map((c) => valueOf(p, c.key));
    if (groups) values.push(...groups.map((g) => p.byGroup.get(g) ?? 0), p.payable_amount);
    ws.getRow(at).values = values;
    at += 1;
  }
  // A TOTAL PER CURRENCY: one GBP row and one AED row, never the two added.
  if (total && groups && people.length) {
    for (const cur of [...new Set(people.map((p) => p.currency))]) {
      const mine = people.filter((p) => p.currency === cur);
      const sums = groups.map((g) => round2(mine.reduce((n, p) => n + (p.byGroup.get(g) ?? 0), 0)));
      const row = ws.getRow(at);
      row.values = [`Total ${cur}`, ...cols.slice(1).map(() => ''), ...sums, round2(sums.reduce((n, v) => n + v, 0))];
      row.font = { bold: true };
      at += 1;
    }
  }
  return at;
}

function moneyColumns(ws, cols, groupsFrom = null, groupCount = 0) {
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
    if (c.money) ws.getColumn(i + 1).numFmt = MONEY_FMT;
  });
  if (groupsFrom) {
    for (let i = 0; i <= groupCount; i += 1) {
      ws.getColumn(groupsFrom + i).width = 12;
      ws.getColumn(groupsFrom + i).numFmt = MONEY_FMT;
    }
  }
}

const runOrder = (setup) => (setup.runs ?? []).map((r) => r.id);

function buildDriverWorkbook(rows, {
  driverSheet: setup = {}, columns, rates, cryptoPercent = 0, colorUsesEndDate = false,
  primaryColor, secondaryColor, perUsd = {}, usdRate,
} = {}) {
  setPalette(primaryColor, secondaryColor);
  const chosen = Array.isArray(columns) && columns.length > 0 ? columns : SEND;
  const cols = pickColumns(FIELDS, chosen, REQUIRED);
  const sorted = sortRows(rows, setup, { rates, cryptoPercent, useEndDate: Boolean(colorUsesEndDate) });
  const runs = setup.runs ?? [];
  const order = runOrder(setup);
  const wb = new ExcelJS.Workbook();

  // ---- Area split: a section per run, a table per location in it.
  const area = wb.addWorksheet('Area split');
  let at = 1;
  for (const run of runs) {
    const mine = sorted.uk.filter((r) => r.run === run.id);
    if (!mine.length) continue;
    const head = area.getRow(at);
    head.getCell(1).value = run.label;
    head.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${String(run.color ?? '#555555').replace('#', '').toUpperCase()}` } };
    at += 2;
    const placesHere = [...new Set(mine.map((r) => r.place))];
    for (const place of placesHere) {
      const here = mine.filter((r) => r.place === place);
      area.getRow(at).getCell(1).value = here[0].location.trim();
      area.getRow(at).getCell(1).font = { bold: true, italic: true };
      at = writeTable(area, at + 1, cols, perPerson(here)) + 1;
    }
    const totals = new Map();
    for (const r of mine) totals.set(r.currency || 'GBP', round2((totals.get(r.currency || 'GBP') ?? 0) + Number(r.payable_amount)));
    const t = area.getRow(at);
    t.getCell(1).value = `Total ${run.label}`;
    t.getCell(2).value = [...totals].map(([c, n]) => `${c} ${n.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`).join(' + ');
    t.font = { bold: true };
    at += 3;
  }
  moneyColumns(area, cols);

  // ---- UK cash: everyone above, one row each, split by group.
  const uk = wb.addWorksheet('UK cash');
  const ukPeople = perPerson([...sorted.uk].sort((a, b) => order.indexOf(a.run) - order.indexOf(b.run)));
  const ukGroups = sortGroupNames([...new Set(sorted.uk.map((r) => r.group_name))]);
  writeTable(uk, 1, cols, ukPeople, { groups: ukGroups, total: true });
  moneyColumns(uk, cols, cols.length + 1, ukGroups.length);
  uk.views = [{ state: 'frozen', ySplit: 1 }];

  // ---- Outside UK: any method or currency, with USD.
  const out = wb.addWorksheet(ABROAD_LABEL);
  const outCols = [
    FIELDS[0], FIELDS[1], FIELDS[2], FIELDS[3], { key: 'done', header: 'Done?', width: 8 },
  ];
  const outPeople = perPerson(sorted.abroad);
  const outGroups = sortGroupNames([...new Set(sorted.abroad.map((r) => r.group_name))]);
  const usdPer = (cur) => {
    const c = String(cur).toUpperCase() === 'EURO' ? 'EUR' : String(cur).toUpperCase();
    if (c === 'USD') return 1;
    if (c === 'GBP' && usdRate) return usdRate;
    const per = perUsd?.[c] ?? perUsd?.[cur];
    return per ? 1 / per : null;
  };
  out.getRow(1).values = [...outCols.map((c) => c.header), ...outGroups, 'Total', 'In USD'];
  styleHeader(out, 1);
  let usdTotal = 0;
  outPeople.forEach((p, i) => {
    const rate = usdPer(p.currency);
    const usd = rate ? round2(p.payable_amount * rate) : null;
    if (usd) usdTotal += usd;
    out.getRow(i + 2).values = [
      p.person_name, p.payment_method, p.payable_amount, p.currency, '',
      ...outGroups.map((g) => p.byGroup.get(g) ?? 0), p.payable_amount, usd ?? 'no rate',
    ];
  });
  const outTotal = out.getRow(outPeople.length + 3);
  outTotal.getCell(outCols.length + outGroups.length + 1).value = 'Total in USD';
  outTotal.getCell(outCols.length + outGroups.length + 2).value = round2(usdTotal);
  outTotal.font = { bold: true };
  moneyColumns(out, outCols, outCols.length + 1, outGroups.length + 1);
  // The rates used, beside it, as the manual file has them.
  const rateCol = outCols.length + outGroups.length + 4;
  out.getCell(1, rateCol).value = 'Pair';
  out.getCell(1, rateCol + 1).value = 'X-Rate';
  out.getCell(1, rateCol).font = { bold: true };
  out.getCell(1, rateCol + 1).font = { bold: true };
  [...new Set(outPeople.map((p) => p.currency))].forEach((cur, i) => {
    out.getCell(i + 2, rateCol).value = `${cur} to USD`;
    out.getCell(i + 2, rateCol + 1).value = usdPer(cur) ? round2(usdPer(cur) * 10000) / 10000 : 'no rate';
  });
  out.getColumn(rateCol).width = 14;
  out.views = [{ state: 'frozen', ySplit: 1 }];

  // ---- Mid split: people with several deals, one line per deal.
  const mid = wb.addWorksheet('Mid split');
  const everyone = [...sorted.uk, ...sorted.abroad];
  const counts = new Map();
  for (const r of everyone) counts.set(personKey(r), (counts.get(personKey(r)) ?? 0) + 1);
  const several = everyone
    .filter((r) => counts.get(personKey(r)) > 1)
    .sort((a, b) => String(a.person_name).localeCompare(String(b.person_name)));
  const midCols = pickColumns(FIELDS, [...new Set([...chosen, 'group_name', 'company'])], REQUIRED);
  writeTable(mid, 1, midCols, several.map((r) => ({
    ...r,
    payable_amount: round2(Number(r.payable_amount)),
    payment_method: METHOD_LABELS[r.payment_method] ?? r.payment_method,
  })));
  moneyColumns(mid, midCols);
  mid.views = [{ state: 'frozen', ySplit: 1 }];

  return scrubWorkbook(wb);
}

module.exports = {
  DEFAULT_DRIVER_SHEET, ABROAD, ABROAD_LABEL, placeKey, sortRows, setupView, checksFor, listDriverColumns, buildDriverWorkbook,
};
