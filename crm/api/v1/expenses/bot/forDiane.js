const format = require('./format');

// ***************************************************
// * THE SAME ANSWER, IN DIANE'S COMMAND CENTER
// ***************************************************
//
// WhatsApp gets *bold* and _italic_; her chat shows plain text, and "#3"
// there becomes a link to deal 3. So a preview becomes a CARD like her
// master sheet plans (problems first, then what is ready), with one plain
// line under it saying what to reply, and every other reply loses the marks.

const plain = (s) => String(s ?? '')
  // Her chat has its own cards and spacing: the WhatsApp separator lines go.
  .split('\n').filter((l) => !/^=+$/.test(l.trim())).join('\n')
  // The card names its sections; there is no ⚠️ on a row to point at.
  .replace(/the ⚠️ ones?/g, 'the ones under Needs an answer')
  .replace(/\*([^*\n]+)\*/g, '$1')
  .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:)!?]|$)/gm, '$1$2')
  .replace(/#(\d)/g, 'no. $1');

const PREVIEW = /_Not (?:saved|removed) yet_/;

function rowOf(x) {
  const notes = [
    ...(x.missing ?? []).map((f) => `${format.LABEL[f] ?? f} missing`),
    ...(x.doubts ?? []),
    ...(x.notes ?? []),
  ];
  return {
    name: `${x.n}. ${x.description || 'no description'}`,
    where: [x.groupName, x.spentOn ? format.day(x.spentOn) : null, x.payee ? `paid to ${x.payee}` : null, x.spentBy ? `by ${x.spentBy}` : null]
      .filter(Boolean).join(' · '),
    detail: [x.rawAmount == null ? '? ' : format.money(x.currency, x.rawAmount), ...notes].join(' · '),
  };
}

/** The add preview as a card. */
function addCard(items) {
  const live = items.filter((x) => !x.skipped);
  const ask = live.filter((x) => x.missing?.length);
  const check = live.filter((x) => !x.missing?.length && x.doubts?.length);
  const ready = live.filter((x) => !x.missing?.length && !x.doubts?.length);
  return {
    kind: 'plan',
    title: `${live.length} ${live.length === 1 ? 'expense' : 'expenses'} · ${plain(format.totals(live))}`,
    note: 'Nothing has been saved yet',
    sections: [
      ...(ask.length ? [{ label: `Needs an answer · ${ask.length}`, rows: ask.map(rowOf) }] : []),
      ...(check.length ? [{ label: `To check · ${check.length}`, rows: check.map(rowOf) }] : []),
      ...(ready.length ? [{ label: `Ready · ${ready.length}`, rows: ready.map(rowOf) }] : []),
    ],
  };
}

function pickCard(state, reply) {
  const lines = String(reply).split('\n').filter((l) => /^\d+\. /.test(l));
  return {
    kind: 'plan',
    title: plain(String(reply).split('\n')[0]),
    note: 'Nothing has changed',
    sections: [{ label: `Matches · ${lines.length}`, rows: lines.map((l) => ({ name: plain(l) })) }],
  };
}

/**
 * @param {string} reply the brain's WhatsApp-formatted reply
 * @param {object} state the conversation after the turn
 * @returns {{ reply: string, card?: object }}
 */
function forDiane(reply, state) {
  const text = String(reply ?? '');
  const pending = state.pending;
  if (pending?.kind === 'add' && PREVIEW.test(text)) {
    const lines = text.split('\n');
    const lead = /^(?:Added|Just to be sure|\()/.test(lines[0]) ? `${plain(lines[0])}\n` : '';
    const hint = plain(lines.filter((l) => l.trim()).at(-1));
    return { reply: `${lead}${hint}`, card: addCard(pending.items) };
  }
  if (pending?.kind === 'pick') {
    return { reply: 'Which one? Reply with its number, or cancel.', card: pickCard(state, text) };
  }
  return { reply: plain(text) };
}

module.exports = { forDiane, plain, addCard };
