// ***************************************************
// * WHAT THE BOT SAYS, IN WHATSAPP'S OWN FORMATTING
// ***************************************************
//
// His call 2026-10-07. Written by code from these templates, never by the
// model, so it looks the same every time. WhatsApp marks only: *bold* for
// amounts and what to reply, _italic_ for notes, numbered lines. Never
// Markdown: "**", "#" and tables show up as raw symbols on a phone.
// Problems first, then the list, then ONE line saying what to reply.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHOWN = 20;

/** "2026-10-06" → "06 Oct". */
function day(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]}` : '';
}

/** 1250 → "1,250", 12.5 → "12.50". */
function amount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '?';
  return v.toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}

const money = (currency, n) => `${currency ?? '?'} ${amount(n)}`;

/** Totals per currency: "AED 545" or "AED 500 + GBP 20". */
function totals(items) {
  const by = new Map();
  for (const x of items) {
    if (!Number.isFinite(Number(x.rawAmount)) || !x.currency) continue;
    by.set(x.currency, (by.get(x.currency) ?? 0) + Number(x.rawAmount));
  }
  return [...by].map(([c, n]) => `*${money(c, Math.round(n * 100) / 100)}*`).join(' + ');
}

const LABEL = {
  groupName: 'group', spentOn: 'date', description: 'what it was for', rawAmount: 'amount', currency: 'currency', payee: 'paid to', spentBy: 'spent by',
};

/** One expense as two short lines. */
function line(x, { number = true, group = false } = {}) {
  const head = `${number ? `${x.n}. ` : ''}${x.flag ? '⚠️ ' : ''}${x.description || '_no description_'} · *${x.rawAmount == null ? '? ' : money(x.currency, x.rawAmount)}*`;
  const bits = [group ? x.groupName || null : null, x.spentOn ? day(x.spentOn) : null, x.payee ? `paid to ${x.payee}` : null, x.spentBy ? `by ${x.spentBy}` : null].filter(Boolean);
  const notes = [
    ...(x.missing ?? []).map((f) => `${LABEL[f] ?? f} missing`),
    ...(x.doubts ?? []),
    ...(x.notes ?? []),
  ];
  return [head, bits.length ? `   ${bits.join(' · ')}` : null, notes.length ? `   _${notes.join('; ')}_` : null].filter(Boolean).join('\n');
}

/**
 * THE PREVIEW of new expenses, waiting on a yes. Problems first: what is
 * missing or doubtful, each with its number, so the admin can answer them
 * all in one message.
 */
function addPreview(items, group) {
  const live = items.filter((x) => !x.skipped);
  const problems = live.filter((x) => x.flag);
  const all = group === '*';
  const out = [`*${live.length} ${live.length === 1 ? 'expense' : 'expenses'}${all ? '' : ` for ${group}`}* (not saved yet)`];
  if (problems.length) {
    const asks = problems.filter((x) => x.missing?.length).length;
    out.push('', asks ? `⚠️ *${problems.length} ${problems.length === 1 ? 'needs' : 'need'} an answer*` : `⚠️ *${problems.length} to check*`);
    for (const x of problems.slice(0, SHOWN)) {
      const what = [...(x.missing ?? []).map((f) => `${LABEL[f] ?? f} missing`), ...(x.doubts ?? [])].join('; ');
      out.push(`${x.n}. ${x.description || 'no description'}: _${what}_`);
    }
  }
  out.push('');
  for (const x of live.slice(0, SHOWN)) out.push(line(x, { group: all }));
  if (live.length > SHOWN) out.push(`_…and ${live.length - SHOWN} more, saved together with these._`);
  out.push('', `Total ${totals(live)}`);
  const n = problems[0]?.n ?? live.at(-1)?.n ?? 1;
  const missing = live.filter((x) => x.missing?.length);
  const m = missing[0];
  const example = m && (m.missing.includes('groupName') ? `*${m.n} is MANBAT*` : m.missing.includes('spentBy') ? `*${m.n} by Gary*`
    : m.missing.includes('spentOn') ? `*${m.n} is 5 Oct*` : m.missing.includes('payee') ? `*${m.n} paid to Careem*`
    : m.missing.includes('rawAmount') ? `*${m.n} is 150*` : `*${m.n} description Taxi*`);
  out.push('', missing.length
    ? `Answer the ⚠️ ones (like ${example}), *skip ${m.n}* to leave one out, or *cancel*.`
    : problems.length
      ? `Check the ⚠️ ones. Reply *yes* to save as shown, *${n} is fine*, a fix like *${n} is 150*, *skip ${n}*, or *cancel*.`
      : `Reply *yes* to save${live.length > 1 ? `, *skip ${n}* to leave one out` : ''}, *${n} is 150* to fix, or *cancel*.`);
  return out.join('\n');
}

const FIELD = { groupName: 'group', spentOn: 'date', description: 'description', rawAmount: 'amount', currency: 'currency', payee: 'paid to', spentBy: 'spent by' };
const shown = (field, v) => (v == null || v === '' ? 'blank' : field === 'spentOn' ? day(v) : field === 'rawAmount' ? amount(v) : String(v));

/** A change to one saved expense, before → after. */
function editPreview(expense, fields, { group = false } = {}) {
  const out = ['*Change this expense?* (not saved yet)', '', line({ ...expense, n: null }, { number: false, group }), ''];
  for (const [f, v] of Object.entries(fields)) out.push(`• ${FIELD[f] ?? f}: ${shown(f, expense[f])} → *${shown(f, v)}*`);
  out.push('', 'Reply *yes* to change it, or *cancel*.');
  return out.join('\n');
}

function removePreview(list, { group = false } = {}) {
  const out = [`*Remove ${list.length === 1 ? 'this expense' : `these ${list.length} expenses`}?* (not removed yet)`, ''];
  for (const x of list) out.push(line({ ...x, n: null }, { number: false, group }));
  out.push('', `Total ${totals(list)}`, '', `Reply *yes* to remove ${list.length === 1 ? 'it' : 'them'}, or *cancel*. You can *undo* afterwards.`);
  return out.join('\n');
}

/** Which one did they mean: numbered, newest first. */
function pickList(list, what, { group = false } = {}) {
  const out = [`*Which one ${what}?*`, ''];
  list.forEach((x, i) => out.push(line({ ...x, n: i + 1 }, { group })));
  out.push('', `Reply with the number, like *${Math.min(2, list.length)}*, or *cancel*.`);
  return out.join('\n');
}

function undoPreview(action) {
  const verb = { add: 'take back', edit: 'put back', remove: 'bring back' }[action.kind] ?? 'undo';
  return [`*Undo this?* (nothing changed yet)`, '', `${verb[0].toUpperCase()}${verb.slice(1)}: ${action.summary}`, '', 'Reply *yes* to undo, or *cancel*.'].join('\n');
}

const saved = (items, group) => `✅ *Saved ${items.length} ${items.length === 1 ? 'expense' : 'expenses'}* · ${totals(items)} · ${group === '*' ? [...new Set(items.map((x) => x.groupName))].join(', ') : group}\nReply *undo* to take ${items.length === 1 ? 'it' : 'them'} back.`;
const changed = (x, { group = false } = {}) => `✅ *Changed.*\n${line({ ...x, n: null }, { number: false, group })}\nReply *undo* to put it back.`;
const removed = (list) => `✅ *Removed ${list.length === 1 ? 'it' : `${list.length} expenses`}.* Reply *undo* to bring ${list.length === 1 ? 'it' : 'them'} back.`;

const HELP = (name, group) => [
  `Hi ${name}! Send me *${group}* expenses and I'll save them to the CRM.`,
  '',
  '• Text: _taxi to office 45 paid to Careem_',
  '• A photo of a receipt, or a file (Excel, CSV, Word, PDF)',
  '• _change the taxi to 50_ · _remove yesterday\'s lunch_',
  '• _how much did we spend this month?_',
  '',
  'I always show you what I read before saving anything.',
  'Type *payments* to ask about your own pay instead.',
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

module.exports = {
  HELP_DIANE,
  day, amount, money, totals, line, addPreview, editPreview, removePreview, pickList, undoPreview, saved, changed, removed, HELP, LABEL,
};
