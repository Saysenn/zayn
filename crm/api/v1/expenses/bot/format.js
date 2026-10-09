// ***************************************************
// * WHAT THE BOT SAYS, IN WHATSAPP'S OWN FORMATTING
// ***************************************************
//
// His call 2026-10-07, twice. Written by code from these templates, never by
// the model, so it looks the same every time. WhatsApp shows proportional
// text, so nothing is lined up with spaces: ONE FIELD PER LINE, with a label,
// a bullet, separator lines and a bold total. WhatsApp marks only: *bold*,
// _italic_. Never Markdown ("**", "#", tables show as raw symbols).
// Problems after the list, then ONE line saying what to reply:
// yes · modify · cancel.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHOWN = 15;
const SEP = '==================';

/** "2026-10-06" → "06 Oct". */
function day(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]}` : '';
}

/** "2026-10-06" → "06 Oct 2026". */
function dayFull(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** 1250 → "1,250.00": always two decimals, so amounts read alike. */
function amount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '?';
  return v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const money = (currency, n) => `${currency ?? '?'} ${amount(n)}`;

/** Totals per currency: "AED 545.00" or "AED 500.00 + GBP 20.00". Bold. */
function totals(items) {
  const by = new Map();
  for (const x of items) {
    if (!Number.isFinite(Number(x.rawAmount)) || !x.currency) continue;
    by.set(x.currency, (by.get(x.currency) ?? 0) + Number(x.rawAmount));
  }
  return [...by].map(([c, n]) => `*${money(c, Math.round(n * 100) / 100)}*`).join(' + ');
}
/** The total, and what it comes to in AED when other currencies are in it. */
function totalLine(items) {
  const mixed = items.some((x) => x.currency && x.currency !== 'AED');
  const rated = items.every((x) => x.currency === 'AED' || x.exchangeRate);
  const aed = items.reduce((n, x) => n + (Number(x.rawAmount) || 0) * (x.currency === 'AED' ? 1 : Number(x.exchangeRate) || 0), 0);
  return `*TOTAL:* ${totals(items) || '*?*'}${mixed && rated ? ` (≈ *${money('AED', Math.round(aed * 100) / 100)}*)` : ''}`;
}

const LABEL = {
  exchangeRate: 'rate to AED', groupName: 'group', spentOn: 'date', description: 'what it was for', rawAmount: 'amount', currency: 'currency', payee: 'paid to', spentBy: 'spent by', category: 'category',
};
// What to ask for each missing field.
const ASK = {
  groupName: 'which group?', spentOn: 'what date?', description: 'what was it for?', rawAmount: 'how much?', payee: 'who was it paid to?', spentBy: 'who spent it?',
};
const MISSING = '❓ _missing_';

/** One expense on ONE line, for lists and answers. */
function line(x, { number = true, group = false } = {}) {
  const bits = [
    `${number && x.n != null ? `*${x.n}.* ` : ''}${x.description || 'no description'}`,
    `*${x.rawAmount == null ? '?' : money(x.currency, x.rawAmount)}*`,
    x.spentOn ? day(x.spentOn) : null,
    x.payee || null,
    x.spentBy ? `by ${x.spentBy}` : null,
    group && x.groupName ? x.groupName : null,
  ];
  return `• ${bits.filter(Boolean).join(' · ')}`;
}

/** One expense as a block: a field per line. */
function block(x, { group = false } = {}) {
  const has = (f) => !(x.missing ?? []).includes(f);
  const out = [`*${x.n != null ? `${x.n}. ` : ''}${x.description || 'No description'}*${x.flag ? ' ⚠️' : ''}`];
  if (group) out.push(`• Group: ${x.groupName && has('groupName') ? x.groupName : MISSING}`);
  out.push(`• Amount: ${x.rawAmount != null && has('rawAmount') ? `*${money(x.currency, x.rawAmount)}*` : MISSING}`);
  out.push(`• Date: ${x.spentOn && has('spentOn') ? dayFull(x.spentOn) : MISSING}`);
  out.push(`• Paid to: ${x.payee && has('payee') ? x.payee : MISSING}`);
  out.push(`• Spent by: ${x.spentBy && has('spentBy') ? x.spentBy : MISSING}`);
  if (x.category) out.push(`• Category: ${x.category.charAt(0).toUpperCase()}${x.category.slice(1)}${x.receipt ? ' · 🧾 receipt kept' : ''}`);
  if (x.currency && x.currency !== 'AED') {
    out.push(`• Rate: ${x.exchangeRate ? `1 ${x.currency} = ${x.exchangeRate} AED _(${x.rateSource ?? 'rate'})_` : MISSING}`);
    if (x.exchangeRate && x.rawAmount != null) out.push(`• In AED: *${money('AED', Math.round(x.rawAmount * x.exchangeRate * 100) / 100)}*`);
  }
  for (const d of [...(x.doubts ?? []), ...(x.notes ?? [])]) out.push(`• Note: _${d}_`);
  return out.join('\n');
}

/** "3, 5, 7–12": numbers as short runs. */
function ranges(ns) {
  const sorted = [...new Set(ns)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    out.push(j - i >= 2 ? `${sorted[i]}–${sorted[j]}` : j > i ? `${sorted[i]}, ${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  return out.join(', ');
}

const QUESTIONS_SHOWN = 6;
// up to this many expenses to check are listed ONE PER LINE, by number
const ONE_BY_ONE = 8;

/** A doubt as the short reason it is listed for. */
function reasonOf(d) {
  const receipt = /^same receipt as one saved on (\d{1,2} \w{3})/.exec(d);
  if (receipt) return `same receipt as one saved on ${receipt[1]}`;
  const alike = /^looks already saved:\s*(.+)$/.exec(d);
  if (alike) return `looks like one already saved (${alike[1]}), different receipt`;
  const copy = /^same as (\d+)/.exec(d);
  if (copy) return `a copy of No. ${copy[1]}`;
  const near = /^did you mean (.+?)\? \((.+)\)$/.exec(d);
  if (near) return `"${near[2]}" is not on the master sheet. Did you mean *${near[1]}*?`;
  const which = /^which (.+?)\? (.+)$/.exec(d);
  if (which) return `which ${which[1]}? *${which[2].split(' or ').join('* or *')}*`;
  if (/^another .+: new, or a change/.test(d)) return d.replace(/^another (.+?) on .*$/, 'another $1 that day: new, or a change to that one?');
  return `_${d}_`;
}

/** Can it be skipped, saved again or replaced? A repeat, a lookalike, a copy. */
const CHOICE = /^same receipt as one saved|^looks already saved|^same as \d+/;

/** What one doubt is, in a few words, grouped with every expense it is on. */
function doubtLabel(d) {
  if (/^same receipt as one saved/.test(d)) return 'Already saved (same receipt)';
  if (/^looks already saved/.test(d)) return 'Looks like a saved one';
  if (/^same as \d+/.test(d)) return 'A copy of another in this list';
  if (/^another .+: new, or a change/.test(d)) return 'Same payee, same day: new, or a change?';
  if (/large amount/.test(d)) return 'Large amount: right?';
  if (/in the future/.test(d)) return 'Date is in the future';
  if (/over 2 months ago/.test(d)) return 'Date is over 2 months ago';
  if (/not recognised, read as AED/.test(d)) return 'Currency not recognised, read as AED';
  if (/far from the market/.test(d)) return 'Your rate is far from the market rate';
  if (/not above 0/.test(d)) return 'Amount is 0 or less';
  const which = /^which (.+?)\? (.+)$/.exec(d);
  if (which) return `Which ${which[1]}? *${which[2].split(' or ').join('* or *')}*`;
  const near = /^did you mean (.+?)\? \((.+)\)$/.exec(d);
  if (near) return `"${near[2]}": did you mean *${near[1]}*?`;
  return `_${d}_`;
}

const MISSING_LABEL = {
  spentBy: 'Who spent it?', spentOn: 'Date?', payee: 'Paid to?', rawAmount: 'Amount?', description: 'What was it for?', groupName: 'Which group?',
};

/**
 * WHAT NEEDS AN ANSWER, ONE LINE PER QUESTION (his call 2026-10-07: "easy to
 * read, directly what I need to know, no extras"). Each line is the question
 * and the numbers it is on; the payees and amounts are in the picture.
 */
function questions(live) {
  const by = new Map();
  const put = (label, n) => by.set(label, [...(by.get(label) ?? []), n]);
  for (const x of live) {
    for (const f of x.missing ?? []) put(f === 'exchangeRate' ? `Rate for 1 ${x.currency}?` : MISSING_LABEL[f] ?? `${LABEL[f] ?? f}?`, x.n);
    for (const d of x.doubts ?? []) put(doubtLabel(d), x.n);
  }
  return [...by].map(([label, ns]) => {
    const nums = `No. ${ranges([...new Set(ns)])}`;
    // a question with choices: the numbers before the choices
    if (/\?\s+\*/.test(label)) return `• ${label.replace(/\?\s+/, `? ${nums}: `)}`;
    return `• ${label}${/\?$/.test(label) ? '' : ':'} ${nums}`;
  });
}

/**
 * WHAT TO REPLY, ON ONE LINE (his call 2026-10-07: no "Or one by one"
 * examples, no "me is you" note; the reader still understands "18 skip",
 * "1–3 Ahmed" and the rest). One example, made from what is actually missing.
 */
function replyLine(live) {
  const missing = live.filter((x) => x.missing?.length);
  const choice = live.filter((x) => (x.doubts ?? []).some((d) => CHOICE.test(d)));
  const replaceable = choice.some((x) => x.repeatOf || x.lookalikeOf);
  const parts = [];
  if (missing.length) {
    const f = missing[0].missing[0];
    const ns = missing.filter((x) => x.missing.includes(f)).map((x) => x.n);
    const run = ns.length > 1 && ns.at(-1) - ns[0] === ns.length - 1 ? `${ns[0]}–${ns.at(-1)}` : `${ns[0]}`;
    const cur = String(missing[0].currency ?? 'gbp').toLowerCase();
    const ex = {
      spentBy: `${run} me`, payee: `${run} paid to Careem`, spentOn: `${run} is 5 Oct`, rawAmount: `${run} is 150`,
      description: `${run} is taxi`, groupName: `${run} is MANBAT`, exchangeRate: `1 ${cur} to aed is 4.85`,
    }[f] ?? `${run} is 150`;
    parts.push(`answer like *${ex}*`);
  } else {
    parts.push('*yes* to save');
  }
  if (choice.length) parts.push(`*skip all* / *save all*${replaceable ? ' / *replace all*' : ''}`);
  parts.push('*modify*', '*cancel*');
  return `Reply: ${parts.join(' · ')}`;
}

/**
 * THE PREVIEW of new expenses, waiting on a yes. The list, the total, what
 * needs an answer (each by its number), one line saying what to reply.
 */
function addPreview(items, group) {
  const live = items.filter((x) => !x.skipped);
  const all = group === '*';
  const out = [
    `*${live.length} ${live.length === 1 ? 'EXPENSE' : 'EXPENSES'}${all ? '' : ` · ${group}`}*`,
    '_Not saved yet_',
    SEP,
  ];
  for (const x of live.slice(0, SHOWN)) out.push('', block(x, { group: all }));
  if (live.length > SHOWN) out.push('', `_…and ${live.length - SHOWN} more, saved together with these._`);
  out.push('', SEP, totalLine(live));

  const missing = live.filter((x) => x.missing?.length);
  const doubts = live.filter((x) => !x.missing?.length && x.doubts?.length);
  if (missing.length || doubts.length) out.push('', '⚠️ *Please check*', ...questions(live));
  out.push('', replyLine(live));
  return out.join('\n');
}

const FIELD = { groupName: 'Group', spentOn: 'Date', description: 'Description', rawAmount: 'Amount', currency: 'Currency', payee: 'Paid to', spentBy: 'Spent by', category: 'Category' };
const shown = (field, v, x) => (v == null || v === '' ? 'blank'
  : field === 'spentOn' ? dayFull(v) : field === 'rawAmount' ? money(x?.currency, v) : String(v));
const headOf = (x, group) => `*${x.description || 'No description'}* · ${[group && x.groupName, day(x.spentOn), x.payee].filter(Boolean).join(' · ')}`;

/**
 * PICK SOME BY NUMBER (his report 2026-10-08: "only 1-3" on six changes was
 * refused). A preview of more than one is numbered, and the hint says how,
 * in numbers that fit it.
 */
const PICK_HINT = (n) => (n > 2 ? `_only 1-${n - 1}_ · _not ${n}_` : '_only 1_ · _not 2_');

/** A change to one saved expense, before ➜ after. */
function editPreview(expense, fields, { group = false } = {}) {
  const out = ['✏️ *CHANGE THIS EXPENSE?*', '_Not changed yet_', SEP, headOf(expense, group)];
  for (const [f, v] of Object.entries(fields)) out.push(`• ${FIELD[f] ?? f}: ${shown(f, expense[f], expense)} ➜ *${shown(f, v, { ...expense, ...fields })}*`);
  out.push(SEP, 'Reply *yes* · *modify* · *cancel*');
  return out.join('\n');
}

/**
 * WHAT A DRAFT DOES TO THE MONEY (his list 2026-10-08): per person when who
 * spent it moves ("Gloria +AED 1,240 · Zayn −AED 1,240"), and the total
 * when it changes. In AED at each expense's own rate.
 */
function effectLines(items, removes = []) {
  const rate = (b) => (b.currency === 'AED' ? 1 : Number(b.exchangeRate) || null);
  const aed = (b, v) => (rate(b) ? Number(v) * rate(b) : null);
  const who = new Map();
  const add = (name, v) => { if (v == null) return; const k = String(name ?? '').trim() || 'nobody'; who.set(k, (who.get(k) ?? 0) + v); };
  let before = 0;
  let after = 0;
  let people = false;
  let unknown = false;
  for (const x of items) {
    const b = x.before;
    const was = aed(b, b.rawAmount);
    const now = aed(b, x.fields.rawAmount ?? b.rawAmount);
    if (was == null || now == null) { unknown = true; continue; }
    before += was;
    after += now;
    if ('spentBy' in x.fields || x.splits?.length) people = true;
    add(b.spentBy, -was);
    add('spentBy' in x.fields ? x.fields.spentBy : b.spentBy, now);
    for (const p of x.splits ?? []) { const v = aed(b, p.rawAmount) ?? 0; after += v; add(p.spentBy, v); }
  }
  for (const r of removes) {
    const v = aed(r.before, r.before.rawAmount);
    if (v == null) { unknown = true; continue; }
    before += v;
    add(r.before.spentBy, -v);
  }
  const out = [];
  const signed = (v) => `*${v > 0 ? '+' : '−'}${money('AED', Math.abs(Math.round(v * 100) / 100))}*`;
  const moved = [...who].filter(([, v]) => Math.abs(v) >= 0.005);
  if (people && moved.length) out.push(`📊 ${moved.slice(0, 6).map(([k, v]) => `${k} ${signed(v)}`).join(' · ')}`);
  if (Math.abs(after - before) >= 0.005 && !unknown) out.push(`📊 Total *${money('AED', Math.round(before * 100) / 100)}* ➜ *${money('AED', Math.round(after * 100) / 100)}*`);
  return out;
}

/** A long preview's lines: the first 10 and a count, unless they asked for all. */
const PAGE_AT = 15;
const PAGE = 10;
function paged(lines, all) {
  if (all || lines.length <= PAGE_AT) return lines;
  return [...lines.slice(0, PAGE), `_…and ${lines.length - PAGE} more · reply *show all* to see every line_`];
}

/**
 * SEVERAL CHANGES, ONE YES (his call 2026-10-07: "why doesn't it stack up
 * the things I want to change and ask once?"). One numbered line per
 * expense, each field before ➜ after; removals after the changes; a split's
 * new expenses under the one they come from.
 */
function editsPreview(items, { group = false, removes = [], all = false } = {}) {
  const n = items.length;
  const many = n + removes.length > 1;
  if (!many && !removes.length && !items[0]?.splits?.length) {
    const [x] = items;
    return editPreview({ ...x.before, n: null }, x.fields, { group }).replace('Reply *yes* · *modify* · *cancel*', 'Reply *yes* · *cancel* · or add another change');
  }
  const head = removes.length ? `✏️ *${[n ? `CHANGE ${n}` : '', `REMOVE ${removes.length}`].filter(Boolean).join(' · ')}?*` : `✏️ *CHANGE ${n} ${n === 1 ? 'EXPENSE' : 'EXPENSES'}?*`;
  const lines = [];
  items.forEach((x, i) => {
    const b = x.before;
    const what = Object.entries(x.fields).filter(([f]) => f !== 'currency')
      .map(([f, v]) => `${FIELD[f] ?? f} ${shown(f, b[f], b)} ➜ *${shown(f, v, { ...b, ...x.fields })}*`).join(' · ');
    lines.push(`• ${many ? `*${i + 1}.* ` : ''}*${b.description || 'No description'}* · ${[group && b.groupName, day(b.spentOn)].filter(Boolean).join(' · ')}: ${what}`);
    for (const p of x.splits ?? []) lines.push(`   ↳ ➕ new: *${money(b.currency, p.rawAmount)}* · by ${p.spentBy || 'nobody'} _(split)_`);
  });
  removes.forEach((r, i) => lines.push(`• ${many ? `*${n + i + 1}.* ` : ''}🗑️ *${r.before.description}* · ${day(r.before.spentOn)} · ${money(r.before.currency, r.before.rawAmount)}: remove`));
  const effect = effectLines(items, removes);
  const reply = !many ? 'Reply *yes* to do it · *cancel* · or add another'
    : `Reply *yes* to ${removes.length ? 'do' : 'change'} them all · *cancel* · add another, or pick some (${PICK_HINT(n + removes.length)})`;
  return [head, '_Not changed yet_', SEP, ...paged(lines, all), SEP, ...(effect.length ? [...effect, ''] : []), reply].join('\n');
}

/** Several changed at once: one numbered line each, so "undo only 2" is clear. */
function changedMany(rows, { group = false } = {}) {
  return [`✅ *CHANGED · ${rows.length} expenses*`, SEP, ...paged(rows.map((x, i) => line({ ...x, n: i + 1 }, { number: true, group })), false), SEP, 'Reply *undo* to put them all back, or *undo only 2*.'].join('\n');
}

function removePreview(list, { group = false, all = false } = {}) {
  const out = [`🗑️ *REMOVE ${list.length === 1 ? 'THIS EXPENSE' : `${list.length} EXPENSES`}?*`, '_Not removed yet_', SEP];
  out.push(...paged(list.map((x, i) => line({ ...x, n: list.length > 1 ? i + 1 : null }, { number: list.length > 1, group })), all));
  out.push(SEP, totalLine(list), '', list.length === 1
    ? 'Reply *yes* · *cancel* · or add another to remove'
    : `Reply *yes* to remove them all · *cancel* · add another, or pick some (${PICK_HINT(list.length)})`);
  return out.join('\n');
}

/** Which one did they mean: numbered, newest first. */
function pickList(list, what, { group = false } = {}) {
  const out = [`🔎 *WHICH ONE ${what.toUpperCase()}?*`, SEP];
  list.forEach((x, i) => out.push(line({ ...x, n: i + 1 }, { group })));
  out.push(SEP, `Reply with the number (like *${Math.min(2, list.length)}*) or *cancel*`);
  return out.join('\n');
}

function undoPreview(action) {
  const verb = { add: 'Take back', edit: 'Put back', remove: 'Bring back' }[action.kind] ?? 'Undo';
  return ['↩️ *UNDO THIS?*', '_Nothing changed yet_', SEP, `${verb}: ${action.summary}`, SEP, 'Reply *yes* · *cancel*'].join('\n');
}

const saved = (items, group) => [
  `✅ *SAVED · ${items.length} ${items.length === 1 ? 'expense' : 'expenses'} · ${group === '*' ? [...new Set(items.map((x) => x.groupName))].join(', ') : group}*`,
  SEP,
  ...items.slice(0, SHOWN).map((x, i) => `• ${items.length > 1 ? `*${i + 1}.* ` : ''}${x.description} · ${money(x.currency, x.rawAmount)}`),
  ...(items.length > SHOWN ? [`• _…and ${items.length - SHOWN} more_`] : []),
  SEP,
  totalLine(items),
  '',
  `Reply *undo* to take ${items.length === 1 ? 'it' : 'them'} back${items.length > 1 ? ', or *undo only 2*' : ''}.`,
].join('\n');

const changed = (x, { group = false } = {}) => [
  '✅ *CHANGED*', SEP, block({ ...x, n: null }, { group }), SEP, 'Reply *undo* to put it back.',
].join('\n');

const removed = (list, { start = 0 } = {}) => [
  `✅ *REMOVED · ${list.length} ${list.length === 1 ? 'expense' : 'expenses'}*`,
  SEP,
  ...list.slice(0, SHOWN).map((x, i) => `• ${list.length + start > 1 ? `*${start + i + 1}.* ` : ''}${x.description} · ${money(x.currency, x.rawAmount)}`),
  ...(list.length > SHOWN ? [`• _…and ${list.length - SHOWN} more_`] : []),
  SEP,
  `Reply *undo* to bring ${list.length === 1 ? 'it' : 'them'} back${list.length > 1 ? ', or *undo only 2*' : ''}.`,
].join('\n');


/**
 * THE ADMIN'S HELLO, four lines (his call 2026-10-07: the old one was too
 * long). The full guide is a note picture, only on "help".
 */
const HELLO = (name, group) => [
  `Hi ${name} 👋 *${group}* expenses.`,
  'Send a text, a receipt photo or a file; I show it before saving.',
  'Files: photo, PDF, Excel, CSV, Word, PowerPoint or text.',
  '*help* for examples · *payments* for your pay',
].join('\n');

/** THE GUIDE, as rows: drawn as a paper note on "help", read as text if not. */
const GUIDE = [
  { label: 'Send expenses', rows: [
    ['A typed line', 'taxi to office 45 paid to Careem'],
    ['Who spent it', 'lunch 30 at Pret, spent by Abe'],
    ['A receipt', 'a photo, or several at once'],
    ['A file', 'PDF, Excel, CSV, Word, PowerPoint, text'],
  ] },
  { label: 'Answer "Please check"', rows: [
    ['All of them', 'skip all · save all · replace all'],
    ['One by one', '1 skip · 2 replace · 3 save'],
    ['Who spent it', 'me · 1-3 Ahmed, 4 me'],
    ['Save', 'yes · or cancel'],
  ] },
  { label: 'Change or ask', rows: [
    ['Change', 'change the taxi to 50'],
    ['Remove', "remove yesterday's lunch"],
    ['Totals', 'how much did we spend this month?'],
    ['Undo', 'undo (it asks first)'],
  ] },
];

const guideSpec = (group) => ({
  style: 'notebook',
  title: `${group} expenses · how to`,
  subtitle: 'send it, answer it, change it',
  columns: [{ label: 'To', weight: 1 }, { label: 'Send or type', weight: 2.2 }],
  sections: GUIDE.map((g) => ({ label: g.label, rows: g.rows.map((cells) => ({ cells })) })),
  notes: { title: 'Good to know', lines: [
    { label: 'Nothing saves', text: 'until you reply yes' },
    { label: 'payments', text: 'switches to your own pay' },
  ] },
  marks: false,
});

const guideText = (group) => [
  `📒 *${group} expenses · how to*`,
  ...GUIDE.flatMap((g) => ['', `*${g.label}*`, ...g.rows.map(([a, b]) => `• ${a}: _${b}_`)]),
  '',
  'Nothing saves until you reply *yes*. *payments* switches to your own pay.',
].join('\n');

const HELP_DIANE = [
  'Expenses, for any group. Tell me what was spent and I\'ll save it.',
  '',
  '• "taxi to office 45 for MANBAT, paid to Careem, by Gary"',
  '• Attach a receipt photo, a PDF or a spreadsheet',
  '• "change the taxi to 50" · "remove yesterday\'s lunch"',
  '• "how much did INDIGO spend this month?"',
  '',
  'I show what I read before anything is saved.',
].join('\n');

/**
 * THE RATES BUBBLE, sent after the preview when other currencies are in it:
 * what each converts at, and how to give their own (his call 2026-10-07).
 */
function ratesBubble(items) {
  const by = new Map();
  for (const x of items.filter((i) => !i.skipped && i.currency && i.currency !== 'AED')) {
    if (!by.has(x.currency)) by.set(x.currency, x);
  }
  if (!by.size) return null;
  const lines = [...by.values()].map((x) => (x.exchangeRate
    ? `• 1 ${x.currency} = *${x.exchangeRate} AED* _(${x.rateSource ?? 'rate'})_`
    : `• 1 ${x.currency} = ❓ _what rate?_`));
  const first = [...by.keys()][0].toLowerCase();
  return ['💱 *RATES TO AED*', SEP, ...lines, SEP,
    ![...by.values()].every((x) => x.exchangeRate)
      ? `Send the rate (like *1 ${first} to aed is 4.85*)`
      : items.some((i) => !i.skipped && (i.missing ?? []).length)
        ? `These will be used. To use your own, send it (like *1 ${first} to aed is 4.85*)`
        : `Reply *yes* to save with these, or send your own (like *1 ${first} to aed is 4.85*)`].join('\n');
}

/**
 * THE CAPTION beside the preview picture: the summary, what needs an
 * answer, and the reply line, so it can be answered and searched.
 */
/** The picture's own caption: what it is and what it comes to, nothing more. */
function captionHead(items, group, { saved = false } = {}) {
  const live = items.filter((x) => !x.skipped);
  const head = saved
    ? `✅ *SAVED · ${live.length} ${live.length === 1 ? 'expense' : 'expenses'} · ${group === '*' ? [...new Set(live.map((x) => x.groupName))].join(', ') : group}*`
    : `*${live.length} ${live.length === 1 ? 'EXPENSE' : 'EXPENSES'}${group === '*' ? '' : ` · ${group}`}* _(not saved yet)_`;
  return [head, totalLine(live)].join('\n');
}

/**
 * WHAT GOES UNDER THE PICTURES, as its own message (his call 2026-10-07:
 * the pictures first, then the notes, "Please check" and what to reply).
 */
function captionBody(items, group, { saved = false } = {}) {
  const live = items.filter((x) => !x.skipped);
  const out = [];
  // THE NOTES: nothing to answer, worth knowing ("Ahmed read as Ahmed Khan")
  const notes = new Map();
  for (const x of live) for (const n of x.notes ?? []) notes.set(n, [...(notes.get(n) ?? []), x.n]);
  if (notes.size) out.push('📝 *Notes*', ...[...notes].slice(0, 6).map(([n, ns]) => `• No. ${ranges(ns)}: ${n}`), '');
  if (saved) return [...out, `Reply *undo* to take ${live.length === 1 ? 'it' : 'them'} back.`].join('\n');
  const missing = live.filter((x) => x.missing?.length);
  const doubts = live.filter((x) => !x.missing?.length && x.doubts?.length);
  if (missing.length || doubts.length) out.push('⚠️ *Please check*', ...questions(live), '');
  out.push(replyLine(live));
  return out.join('\n');
}

function caption(items, group, { saved = false } = {}) {
  const live = items.filter((x) => !x.skipped);
  const head = saved
    ? `✅ *SAVED · ${live.length} ${live.length === 1 ? 'expense' : 'expenses'} · ${group === '*' ? [...new Set(live.map((x) => x.groupName))].join(', ') : group}*`
    : `*${live.length} ${live.length === 1 ? 'EXPENSE' : 'EXPENSES'}${group === '*' ? '' : ` · ${group}`}* _(not saved yet)_`;
  const out = [head, totalLine(live)];
  if (saved) return [...out, '', `Reply *undo* to take ${live.length === 1 ? 'it' : 'them'} back.`].join('\n');
  const missing = live.filter((x) => x.missing?.length);
  const doubts = live.filter((x) => !x.missing?.length && x.doubts?.length);
  if (missing.length || doubts.length) out.push('', '⚠️ *Please check*', ...questions(live));
  // the same last line as the text preview
  out.push('', addPreview(items, group).split('\n').at(-1));
  return out.join('\n');
}

module.exports = {
  HELP_DIANE, HELLO, guideSpec, guideText, editsPreview, changedMany, SEP, ratesBubble, caption, captionHead, captionBody, ranges, questions, replyLine,
  day, dayFull, amount, money, totals, line, block, addPreview, editPreview, removePreview, pickList, undoPreview, saved, changed, removed, LABEL,
};
