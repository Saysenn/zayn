const { presetTable, PICTURE_PRESETS } = require('../../masterSheet/presetTable');
const { notAGroup } = require('./notAGroup');

/**
 * ===============================
 * * "SHOW ME THE CASH SHEET": THE EXPORT'S PRESET, ON SCREEN
 * ===============================
 * His call 2026-10-07: Standard, Bank, Cash and Crypto as a picture that
 * matches the export file column for column (masterSheet/presetTable.js
 * reads exactly what the export reads). Read only: nothing is built or
 * changed. The card is a short line per group; the whole sheet is the
 * picture drawn under it (pictures/fromAgent.js, from `list.preset`).
 */
const LABEL = { standard: 'Standard', bank: 'Bank', cash: 'Cash', crypto: 'Crypto' };
const money = (m) => [...m].map(([c, n]) => `${c} ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(' + ') || 'nothing';

const showSheetPreset = {
  name: 'show_sheet_preset',
  description:
    'Show one of the export\'s sheets ON SCREEN, exactly as the export file has it, with its totals: the '
    + 'Standard sheet (everyone), or the Bank, Cash or Crypto sheet (only those paid that way, with their '
    + 'bank details, address and phone as the file has them). Use it for "show me the standard sheet", '
    + '"the cash sheet", "the bank list", "crypto sheet". It is a picture, not a file: for a FILE use '
    + 'export_sheet. Read only.',
  parameters: {
    type: 'object',
    properties: {
      preset: { type: 'string', enum: PICTURE_PRESETS, description: 'Which sheet.' },
      group: { type: 'string', description: 'One group, only if they named one. Otherwise every group.' },
      groups: { type: 'array', items: { type: 'string' }, description: 'Several groups, when they named more than one. Use this INSTEAD of group.' },
      month: { type: 'string', description: 'YYYY-MM, only if they named another month. Otherwise this month.' },
    },
    required: ['preset'],
  },
  async handler(args = {}) {
    const id = String(args.preset ?? '').toLowerCase();
    if (!PICTURE_PRESETS.includes(id)) {
      return { summary: 'Only the Standard, Bank, Cash and Crypto sheets can be shown. Ask which one.', reply: 'Which sheet: Standard, Bank, Cash or Crypto?', computedReply: true };
    }
    const asked = [...(args.groups ?? []), ...(args.group ? [args.group] : [])].map((g) => String(g).trim()).filter(Boolean);
    // A GROUP THAT IS NOT ONE is said, never answered as an empty sheet
    for (const g of asked) {
      // eslint-disable-next-line no-await-in-loop
      const wrong = await notAGroup(g, args.said);
      if (wrong) return { summary: wrong };
    }
    const group = asked.length ? asked.map((g) => g.toUpperCase()).join(',') : undefined;
    const month = /^\d{4}-\d{2}$/.test(String(args.month ?? '')) ? args.month : undefined;
    const t = await presetTable(id, { group, month });
    const label = `${LABEL[id]} sheet${group ? ` · ${group}` : ''}`;
    if (!t.count) {
      const reply = `The ${label} has nobody on it${month ? ` for ${month}` : ' this month'}.`;
      return { summary: reply, reply, computedReply: true };
    }
    const few = t.count < 4;
    const at = (name) => t.columns.findIndex((c) => c.key === name);
    return {
      summary: `${label}: ${t.count} deals, payable ${money(t.totals)}. Already on screen as the sheet itself, so do NOT list it. Say this one line and stop.`,
      reply: `${label}: ${t.count} ${t.count === 1 ? 'deal' : 'deals'}, payable ${money(t.totals)}.`,
      computedReply: true,
      list: {
        kind: 'report',
        title: `${label} · ${t.count} ${t.count === 1 ? 'deal' : 'deals'}`,
        note: few ? '' : 'The whole sheet is in the picture below.',
        // a short card: one line per group, the sheet itself is the picture
        sections: few
          ? [{ label: 'Deals', rows: t.groups.flatMap((g) => g.rows.map((r) => ({ name: r[at('person_name')], where: `${r[at('company')]} · ${g.name}`, detail: `${r[at('currency')]} ${r[at('payable_amount')]}` }))) }]
          : [{ label: 'By group', rows: t.groups.map((g) => ({ name: g.name, where: `${g.rows.length} ${g.rows.length === 1 ? 'deal' : 'deals'}`, detail: money(g.totals) })) }],
        preset: { id, group, month },
      },
    };
  },
};

module.exports = { showSheetPreset };
