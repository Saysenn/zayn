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

/**
 * WHAT NEEDS AN ANSWER (his call 2026-10-07, "Please check"): a few are
 * listed ONE PER LINE by number with why, so each gets its own answer; many
 * are grouped by kind with their numbers as runs, never 60 lines.
 */
function questions(live) {
  const flagged = live.filter((x) => (x.missing ?? []).length || (x.doubts ?? []).length);
  if (flagged.length && flagged.length <= ONE_BY_ONE) {
    return flagged.map((x) => {
      const why = [
        ...(x.missing ?? []).map((f) => (f === 'exchangeRate' ? `1 ${x.currency} to AED is?` : ASK[f] ?? `${LABEL[f] ?? f}?`)),
        ...(x.doubts ?? []).map(reasonOf),
      ];
      const what = x.payee || x.description || 'no description';
      return `${x.n}. ${what} · ${x.rawAmount == null ? '?' : money(x.currency, x.rawAmount)}: ${why.join('; ')}`;
    });
  }
  const by = new Map();
  const put = (key, n) => by.set(key, [...(by.get(key) ?? []), n]);
  for (const x of live) {
    for (const f of x.missing ?? []) put(f === 'exchangeRate' ? `1 ${x.currency} to AED is?` : ASK[f] ?? `${LABEL[f] ?? f}?`, x.n);
    for (const d of x.doubts ?? []) {
      if (/^same as \d+/.test(d)) put('copies of earlier ones', x.n);
      else if (/^looks already saved/.test(d)) put('look like ones already saved (same shop, amount and day), different receipts', x.n);
      else if (/^same receipt as one saved/.test(d)) put('the same receipts you already saved', x.n);
      else if (/^another .+: new, or a change/.test(d)) put('another expense to the same payee that day: new, or a change to that one?', x.n);
      else put(reasonOf(d), x.n);
    }
  }
  const lines = [...by].map(([q, ns]) => `• No. ${ranges(ns)}: ${q}`);
  return lines.length > QUESTIONS_SHOWN
    ? [...lines.slice(0, QUESTIONS_SHOWN), `• _…and ${lines.length - QUESTIONS_SHOWN} more, see the tinted cells_`]
    : lines;
}

/**
 * HOW TO ANSWER, with their own numbers: one word for all of them, or one
 * line each ("1 skip", "2 replace", "3 save", "4 me").
 */
function howToAnswer(live) {
  const choice = live.filter((x) => (x.doubts ?? []).some((d) => CHOICE.test(d)));
  const replaceable = choice.filter((x) => x.repeatOf || x.lookalikeOf);
  const spender = live.filter((x) => (x.missing ?? []).includes('spentBy'));
  const out = [];
  if (choice.length) out.push(`For all of them: *skip all* · *save all*${replaceable.length ? ' · *replace all*' : ''}`);
  const examples = [];
  for (const x of choice) {
    if (examples.length >= 3) break;
    const verb = (x.repeatOf || x.lookalikeOf) && !examples.some((e) => /replace/.test(e)) ? 'replace' : examples.some((e) => /skip/.test(e)) ? 'save' : 'skip';
    examples.push(`${x.n} ${verb}`);
  }
  if (spender.length) {
    examples.push(spender.length > 1 ? `${ranges(spender.slice(0, -1).map((x) => x.n))} Ahmed` : `${spender[0].n} me`);
    if (spender.length > 1) examples.push(`${spender.at(-1).n} me`);
  }
  if (examples.length) {
    out.push(choice.length ? 'Or one by one, like:' : 'Reply like:', ...examples.slice(0, 4).map((e) => `*${e}*`));
    if (spender.length) out.push('_*me* is you; a name is who spent it._');
  }
  return out;
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
  if (missing.length || doubts.length) {
    out.push('', '⚠️ *Please check*', ...questions(live));
    const how = howToAnswer(live);
    if (how.length) out.push('', ...how);
  }
  const m = missing.find((x) => !x.missing.includes('spentBy') || x.missing.length > 1);
  const example = m && (m.missing.includes('exchangeRate') ? `*1 ${m.currency.toLowerCase()} to aed is 4.85*` : m.missing.includes('groupName') ? `*${m.n} is MANBAT*`
    : m.missing.includes('spentOn') ? `*${m.n} is 5 Oct*` : m.missing.includes('payee') ? `*${m.n} paid to Careem*`
      : m.missing.includes('rawAmount') ? `*${m.n} is 150*` : `*${m.n} is taxi*`);
  out.push('', missing.length
    ? `Reply with the answers${example ? ` (like ${example})` : ''} · *modify* · *cancel*`
    : doubts.length
      ? 'Reply *yes* to save as shown · *modify* to change · *cancel*'
      : 'Reply *yes* to save · *modify* to change · *cancel*');
  return out.join('\n');
}

const FIELD = { groupName: 'Group', spentOn: 'Date', description: 'Description', rawAmount: 'Amount', currency: 'Currency', payee: 'Paid to', spentBy: 'Spent by' };
const shown = (field, v, x) => (v == null || v === '' ? 'blank'
  : field === 'spentOn' ? dayFull(v) : field === 'rawAmount' ? money(x?.currency, v) : String(v));
const headOf = (x, group) => `*${x.description || 'No description'}* · ${[group && x.groupName, day(x.spentOn), x.payee].filter(Boolean).join(' · ')}`;

/** A change to one saved expense, before ➜ after. */
function editPreview(expense, fields, { group = false } = {}) {
  const out = ['✏️ *CHANGE THIS EXPENSE?*', '_Not changed yet_', SEP, headOf(expense, group)];
  for (const [f, v] of Object.entries(fields)) out.push(`• ${FIELD[f] ?? f}: ${shown(f, expense[f], expense)} ➜ *${shown(f, v, { ...expense, ...fields })}*`);
  out.push(SEP, 'Reply *yes* · *modify* · *cancel*');
  return out.join('\n');
}

function removePreview(list, { group = false } = {}) {
  const out = [`🗑️ *REMOVE ${list.length === 1 ? 'THIS EXPENSE' : `${list.length} EXPENSES`}?*`, '_Not removed yet_', SEP];
  for (const x of list) out.push(line({ ...x, n: null }, { number: false, group }));
  out.push(SEP, totalLine(list), '', 'Reply *yes* · *cancel*  (you can *undo* afterwards)');
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
  ...items.slice(0, SHOWN).map((x) => `• ${x.description} · ${money(x.currency, x.rawAmount)}`),
  ...(items.length > SHOWN ? [`• _…and ${items.length - SHOWN} more_`] : []),
  SEP,
  totalLine(items),
  '',
  `Reply *undo* to take ${items.length === 1 ? 'it' : 'them'} back.`,
].join('\n');

const changed = (x, { group = false } = {}) => [
  '✅ *CHANGED*', SEP, block({ ...x, n: null }, { group }), SEP, 'Reply *undo* to put it back.',
].join('\n');

const removed = (list) => [
  `✅ *REMOVED · ${list.length} ${list.length === 1 ? 'expense' : 'expenses'}*`,
  SEP,
  ...list.slice(0, SHOWN).map((x) => `• ${x.description} · ${money(x.currency, x.rawAmount)}`),
  SEP,
  `Reply *undo* to bring ${list.length === 1 ? 'it' : 'them'} back.`,
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
function caption(items, group, { saved = false } = {}) {
  const live = items.filter((x) => !x.skipped);
  const head = saved
    ? `✅ *SAVED · ${live.length} ${live.length === 1 ? 'expense' : 'expenses'} · ${group === '*' ? [...new Set(live.map((x) => x.groupName))].join(', ') : group}*`
    : `*${live.length} ${live.length === 1 ? 'EXPENSE' : 'EXPENSES'}${group === '*' ? '' : ` · ${group}`}* _(not saved yet)_`;
  const out = [head, totalLine(live)];
  if (saved) return [...out, '', `Reply *undo* to take ${live.length === 1 ? 'it' : 'them'} back.`].join('\n');
  const missing = live.filter((x) => x.missing?.length);
  const doubts = live.filter((x) => !x.missing?.length && x.doubts?.length);
  if (missing.length || doubts.length) {
    out.push('', '⚠️ *Please check*', ...questions(live));
    const how = howToAnswer(live);
    if (how.length) out.push('', ...how);
  }
  // the same last line as the text preview
  out.push('', addPreview(items, group).split('\n').at(-1));
  return out.join('\n');
}

module.exports = {
  HELP_DIANE, HELLO, guideSpec, guideText, SEP, ratesBubble, caption, ranges, questions, howToAnswer,
  day, dayFull, amount, money, totals, line, block, addPreview, editPreview, removePreview, pickList, undoPreview, saved, changed, removed, LABEL,
};
