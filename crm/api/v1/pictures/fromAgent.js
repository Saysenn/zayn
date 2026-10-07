const { renderTable, worthAPicture } = require('./table');

// ***************************************************
// * DIANE'S LONG MASTER SHEET RESULTS, AS A PICTURE
// ***************************************************
//
// His plan 2026-10-07, phase 2: a sheet check, a plan, a list of deals (a
// person's, or everyone paid by cash, bank or crypto) of 4+ rows also goes
// as a picture under her card, in the style picked in Settings. Built from
// the very event the card was drawn from, so the two always agree; nothing
// in her engine changes. A short result stays a card only.

const fmt = (n) => Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Payable added up in code, per currency: "GBP 4,100.00 + EUR 900.00". */
function payableTotal(rows) {
  const by = new Map();
  for (const r of rows) {
    const n = Number(r.payable);
    if (r.payable != null && Number.isFinite(n)) by.set(r.currency ?? 'GBP', (by.get(r.currency ?? 'GBP') ?? 0) + n);
  }
  return by.size ? [...by].map(([c, n]) => `${c} ${fmt(n)}`).join('  +  ') : null;
}

const METHOD = { cash: 'Cash', bank: 'Bank', crypto: 'Crypto' };

/**
 * A list of deals: grouped by group, a payable total underneath. A column
 * that is the same on every row (all cash) or empty (nothing marked paid)
 * is left out, so the amounts have room.
 */
function deals(list) {
  const rows = list.rows ?? [];
  const byGroup = new Map();
  for (const r of rows) {
    const g = r.group ?? 'No group';
    byGroup.set(g, [...(byGroup.get(g) ?? []), r]);
  }
  const showMethod = new Set(rows.map((r) => r.method ?? '')).size > 1;
  const showPaid = rows.some((r) => r.paid != null);
  const cols = [
    { label: 'Name', weight: 2, cell: (r) => r.name },
    { label: 'Company', weight: 2.2, cell: (r) => r.company ?? '' },
    { label: 'Role', weight: 1.5, cell: (r) => r.role ?? '' },
    ...(showMethod ? [{ label: 'Method', weight: 0.9, cell: (r) => METHOD[r.method] ?? r.method ?? '' }] : []),
    // unpaid is what needs looking at
    ...(showPaid ? [{ label: 'Paid', weight: 0.8, cell: (r) => (r.paid == null ? '' : r.paid ? 'Paid' : 'Unpaid'), tint: (r) => r.paid === false }] : []),
    { label: 'Monthly', weight: 2.6, align: 'right', cell: (r) => r.amount ?? '' },
  ];
  const total = payableTotal(rows);
  return {
    title: list.title,
    subtitle: list.subtitle ?? '',
    columns: cols.map(({ label, weight, align }) => ({ label, weight, align })),
    sections: [...byGroup].map(([label, groupRows]) => ({
      label: byGroup.size > 1 ? label : undefined,
      rows: groupRows.map((r) => ({
        cells: cols.map((c) => c.cell(r)),
        tint: cols.map((c, i) => (c.tint?.(r) ? i : -1)).filter((i) => i >= 0),
      })),
    })),
    ...(total ? { total: { label: 'Payable', value: total } } : {}),
  };
}

/** A plan, a review, a report: her sections, as they are. */
function sectioned(list) {
  const plan = list.kind === 'plan';
  return {
    title: list.title,
    subtitle: list.note ? String(list.note).split('\n')[0] : '',
    status: plan ? { text: 'Not done yet', tone: 'pending' } : undefined,
    columns: [{ label: 'Name', weight: 2 }, { label: 'Where', weight: 2.6 }, { label: plan ? 'Change' : 'Detail', weight: 3.4 }],
    sections: (list.sections ?? []).map((s) => ({
      label: s.label,
      // in a plan the change is the cell to read
      rows: s.rows.map((r) => ({ cells: [r.name ?? '', r.where ?? '', r.detail ?? ''], tint: plan ? [2] : [] })),
    })),
    footer: plan ? 'Reply yes to do it · cancel' : undefined,
    // the tint marks the change, not a problem
    marks: !plan,
  };
}

/** The sheet check: a section per kind of problem, the problem tinted. */
function sheetCheck(check) {
  return {
    title: `Sheet check · ${check.monthName}`,
    subtitle: `${check.rows} rows · ${check.total} to look at`,
    columns: [{ label: 'Who', weight: 2 }, { label: 'Where', weight: 2.6 }, { label: 'Problem', weight: 3.6 }],
    sections: (check.sections ?? []).map((s) => ({
      label: s.label,
      rows: s.rows.map((r) => ({ cells: [r.who ?? '', r.where ?? '', r.fault ?? ''], tint: [2] })),
    })),
  };
}

/**
 * The picture(s) for one of her events, or null when it is short, not a
 * kind that has one, or the style is plain text.
 * @returns {null | { pngs: Buffer[], caption: string }}
 */
function pictureFor(event, style) {
  if (style === 'text') return null;
  let spec = null;
  let caption = '';
  if (event?.type === 'check' && event.check?.total > 0) {
    spec = sheetCheck(event.check);
    caption = 'Sheet check';
  } else if (event?.type === 'list' && event.list) {
    const { kind } = event.list;
    if (kind === 'plan' || kind === 'review' || kind === 'report') {
      spec = sectioned(event.list);
      caption = kind === 'plan' ? 'Plan' : kind === 'review' ? 'Review' : 'Report';
    } else if (!kind || kind === 'deals') {
      spec = deals(event.list);
      caption = 'Deals';
    }
  }
  if (!spec) return null;
  spec.style = style;
  if (!worthAPicture(spec)) return null;
  const pngs = renderTable(spec);
  return pngs.length ? { pngs, caption } : null;
}

/**
 * A SHEET PRESET (Standard, Bank, Cash, Crypto) as a picture, from
 * masterSheet/presetTable.js: the export's own rows, columns and totals.
 * The group is a heading rather than a column, and a column that is the
 * same on every row (the method, on a Cash list) is left out, so it reads
 * on a phone. Wider than the other pictures: these are wide sheets.
 */
function presetSpec(table, { group } = {}) {
  const constant = table.columns.map((c, i) => c.key !== 'group_name'
    && table.count > 1 && new Set(table.groups.flatMap((g) => g.rows.map((r) => r[i]))).size === 1);
  const keep = table.columns.map((c, i) => c.key !== 'group_name' && !(constant[i] && c.key === 'payment_method'));
  const money = (m) => [...m].map(([c, n]) => `${c} ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join('  +  ');
  const right = new Set(['payable_amount', 'monthly_amount', 'payable_days']);
  const cols = table.columns.filter((_, i) => keep[i]);
  return {
    title: `${table.preset.label} sheet${group ? ` · ${group}` : ''}`,
    subtitle: `${table.month ?? ''} · ${table.count} ${table.count === 1 ? 'deal' : 'deals'} · as the ${table.preset.label} export`,
    width: cols.length > 8 ? 1500 : 1200,
    columns: cols.map((c) => ({
      label: c.key === 'accepting_postals' ? 'Postals' : c.header.replace(/ of individual$/, '').replace(/ in question$/, '').replace(/ this month$/, ''),
      align: right.has(c.key) ? 'right' : 'left',
      weight: { person_name: 1.6, company: 1.8, bank_details: 1.6, location: 1.2, payable_days: 0.9, currency: 0.8, role_label: 0.9, phone: 1.4, accepting_postals: 0.8 }[c.key] ?? 1,
    })),
    sections: table.groups.map((g) => ({
      label: table.groups.length > 1 || !group ? `${g.name} · ${money(g.totals)}` : undefined,
      rows: g.rows.map((r) => {
        const cells = r.filter((_, i) => keep[i]);
        // the sheet's own "Will never be bank" on a bank row: the sheet check flags it too
        return { cells, tint: cells.map((v, i) => (/will never be bank/i.test(v) ? i : -1)).filter((i) => i >= 0) };
      }),
    })),
    total: table.totals.size ? { label: 'Payable', value: money(table.totals) } : undefined,
  };
}

/** The export sheet a list of deals is exactly, or null. */
async function sameAsSheet(list) {
  const rows = list?.rows ?? [];
  const methods = new Set(rows.map((r) => r.method));
  if (rows.length < 4 || methods.size !== 1 || !['cash', 'bank', 'crypto'].includes([...methods][0])) return null;
  const id = [...methods][0];
  // eslint-disable-next-line global-require
  const { presetTable } = require('../masterSheet/presetTable');
  const everywhere = await presetTable(id);
  const mine = new Set(rows.map((r) => r.id));
  if (everywhere.ids.length === mine.size && everywhere.ids.every((x) => mine.has(x))) return { id };
  const groups = [...new Set(rows.map((r) => r.group).filter(Boolean))].join(',');
  if (!groups) return null;
  const narrowed = await presetTable(id, { group: groups });
  return narrowed.ids.length === mine.size && narrowed.ids.every((x) => mine.has(x)) ? { id, group: groups } : null;
}

/**
 * The `image` events to send after one of her events: drawn in the style
 * picked in Settings, each page kept (pictures/store.js) so Attachments can
 * open it again. Never throws: a picture is never worth failing her turn.
 */
async function imageEventsFor(event) {
  try {
    if (event?.type !== 'list' && event?.type !== 'check') return [];
    // eslint-disable-next-line global-require
    const style = await require('../repos/settings.repo').expenseStyle();
    let pic;
    // HER LIST IS EXACTLY A SHEET: the same deals as the export's Cash, Bank
    // or Crypto sheet, however she filtered to get there. Then the export's
    // own version is drawn. Matched by the deals, never guessed from words.
    if (event.type === 'list' && !event.list?.preset && !event.list?.kind) {
      const matched = await sameAsSheet(event.list);
      if (matched) event = { ...event, list: { ...event.list, preset: matched } };
    }
    if (event.type === 'list' && event.list?.preset) {
      // THE EXPORT'S OWN SHEET (Standard, Bank, Cash, Crypto), not her list
      if (style === 'text') return [];
      // eslint-disable-next-line global-require
      const { presetTable } = require('../masterSheet/presetTable');
      const { id, group, month } = event.list.preset;
      const spec = { ...presetSpec(await presetTable(id, { group, month }), { group }), style };
      const pngs = worthAPicture(spec) ? renderTable(spec) : [];
      pic = pngs.length ? { pngs, caption: `${id.charAt(0).toUpperCase()}${id.slice(1)} sheet` } : null;
    } else {
      pic = pictureFor(event, style);
    }
    if (!pic) return [];
    // eslint-disable-next-line global-require
    const { keepImage } = require('./store');
    const when = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const out = [];
    for (const [i, png] of pic.pngs.entries()) {
      const caption = `${pic.caption}${pic.pngs.length > 1 ? ` ${i + 1}/${pic.pngs.length}` : ''} · ${when}`;
      // eslint-disable-next-line no-await-in-loop
      out.push({ type: 'image', image: { id: await keepImage(png, caption), caption } });
    }
    return out;
  } catch (err) {
    // eslint-disable-next-line global-require
    require('../../configs/logger').warn({ err: err.message }, 'diane: could not draw the picture');
    return [];
  }
}

module.exports = { pictureFor, payableTotal, imageEventsFor, presetSpec };
