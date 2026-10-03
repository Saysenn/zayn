/**
 * ***************************************************
 * * SHE READS WHAT IS ON THE SCREEN, ALL OF IT
 * ***************************************************
 *
 * His call 2026-09-30. A list of 60 deals came back with "There are 90
 * deals in total. Which group would you like?", and the sheet check with
 * "the biggest issues are 2 deals where the payable is above the monthly"
 * over a report of 29 findings in five sections. What she said was a
 * fraction of what was drawn, and on voice that fraction is all there is.
 *
 * SO THE READING IS BUILT FROM THE DRAWN DATA, never from her. The model
 * cannot skip a row or invent one here: every line below comes off the same
 * object the browser just rendered.
 *
 * TWO OUTPUTS, because the eye and the ear need different things:
 *   `summary`  what goes in the bubble under a sheet check: every section
 *              with its count. The card beside it already shows the rows.
 *   `spoken`   what she SAYS: her own line, then every row of every panel.
 */

const SEP = ', ';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function readCheck(check) {
  if (!check) return { summary: '', spoken: '' };
  if (!check.total) {
    const clean = `Sheet check for ${check.monthName}: ${plural(check.rows, 'deal')} read and nothing to flag.`;
    return { summary: clean, spoken: clean };
  }
  const head = `Sheet check for ${check.monthName}: ${plural(check.total, 'thing')} to look at across `
    + `${plural(check.rows, 'deal')}.`;
  const lines = check.sections.map((s) => `${s.label.charAt(0)}${s.label.slice(1).toLowerCase()}: ${s.count}.`);
  const spokenSections = check.sections.map((s) => {
    // EVERY row, the ones the card cut at twelve included. The card says
    // "showing 12 of 15"; the voice has no other screen to send them to.
    const rows = s.all ?? s.rows ?? [];
    return `${s.label.charAt(0)}${s.label.slice(1).toLowerCase()}, ${s.count}:\n`
      + rows.map((r) => `${r.who}, ${r.where.replace(/ · /g, SEP)}: ${r.fault}.`).join('\n');
  });
  return {
    summary: [head, ...lines].join('\n'),
    spoken: [head, ...spokenSections].join('\n\n'),
  };
}

function readList(list) {
  if (!list?.rows?.length) return '';
  if (list.kind === 'recent-changes') {
    return `${list.title}:\n${list.rows.map((c) => `${c.name}, ${c.where || 'no company or group'}: `
      + `${(c.changes ?? []).map((f) => `${f.label} ${f.oldValue || 'blank'} to ${f.newValue || 'blank'}`).join(SEP)}.`).join('\n')}`;
  }
  if (list.kind === 'review' || list.kind === 'report') {
    const words = (s) => String(s ?? '').replace(/ · /g, SEP);
    return [list.title, list.note, ...(list.sections ?? []).map((s) => `${[s.label, s.count].filter((v) => v !== undefined && v !== '').join(', ')}:\n`
      + s.rows.map((r) => `${[r.name, words(r.where)].filter(Boolean).join(SEP)}: ${words(r.detail)}.`).join('\n'))]
      .filter(Boolean).join('\n\n');
  }
  if (list.kind === 'companies') {
    return `${list.title}:\n${list.rows.map((c) => [
      c.name, c.statusLabel ?? c.status, c.groups, c.dealsText, c.amount,
    ].filter(Boolean).join(SEP)).map((l) => `${l}.`).join('\n')}`;
  }
  return `${list.title}:\n${list.rows
    .map((r) => [r.name, r.group, r.company, r.role, r.amount].filter(Boolean).join(SEP))
    .map((l) => `${l}.`).join('\n')}`;
}

function readCard(card) {
  if (!card) return '';
  const cells = (card.groups ?? []).flatMap((g) => g.cells ?? [])
    .filter((c) => c.value !== null && c.value !== undefined && c.value !== '');
  const head = [card.name, card.headline].filter(Boolean).join(SEP);
  const owed = typeof card.payableThisMonth === 'boolean'
    ? (card.payableThisMonth ? ' Payable this month.' : ' Not payable this month.') : '';
  return `${head}.${owed}\n${cells.map((c) => `${c.label} ${c.value}`).join(SEP)}.`;
}

/**
 * AN OPEN OFFER AFTER A DRAWN ANSWER IS FILLER. "What would you like to do
 * next, darling?" under a list the admin asked for, every time. A real
 * question ("which deal?") names something and is kept. 2026-09-30.
 */
// An OFFER, by its verb. "Would you like me to resume it first?" is a real
// question about the thing on screen and is kept.
const FILLER = /\s*[^.!?\n]*\b(?:what (?:else|exactly|next|specific|would you like)|anything else|would you like (?:me )?to (?:undo|see|know|do|check|open|show|look|view|read|help)|how can i help|let me know if)\b[^?\n]*\?\s*$/i;

function withoutFiller(reply) {
  const text = String(reply ?? '');
  const cut = text.replace(FILLER, '').trim();
  return cut || text;
}

/**
 * THE LIST IS ON SCREEN, SO IT IS NOT READ BACK IN TEXT. Live 2026-09-30:
 * "There are 7 active companies in MILKMAN. They include Capilano, Red
 * Horizon, Relia PA..." under the drawn list of the same seven. Four or more
 * of the drawn names in her line means she read it back: her first sentence
 * stays, the recital goes.
 */
function withoutRecital(reply, shown) {
  const names = shown.flatMap((e) => (e.type === 'list' ? (e.list?.rows ?? []).map((r) => r.name) : []))
    .filter((n) => n && n.length >= 3);
  const text = String(reply ?? '');
  const hits = names.filter((n) => text.toLowerCase().includes(String(n).toLowerCase())).length;
  if (hits < 4) return text;
  const first = /^[\s\S]*?[.!?](?=\s|$)/.exec(text);
  const lead = first ? first[0].trim() : text;
  /**
   * AND WHEN THE COUNT AND THE RECITAL ARE ONE SENTENCE ("MANBAT has 6
   * deals held by 5 people: Gary, Gloria, ..."), it ends where the first
   * name begins. 2026-09-30.
   */
  const lower = lead.toLowerCase();
  const at = Math.min(...names.map((n) => lower.indexOf(String(n).toLowerCase())).filter((i) => i > 0));
  if (Number.isFinite(at)) {
    const cut = lead.slice(0, at).replace(/[\s:,;-]*(?:including|they are|namely|which are)?[\s:,;-]*$/i, '').trim();
    if (cut.length > 10) return `${cut}.`;
  }
  return lead;
}

/**
 * @param {string} rawReply her own finished line
 * @param {object[]} shown  every panel event drawn this turn, in order
 * @returns {{ reply: string, spoken: string|null }}
 */
function screenReading(rawReply, shown = []) {
  if (!shown.length) return { reply: rawReply, spoken: null };
  const reply = withoutFiller(withoutRecital(rawReply, shown));
  let visible = reply;
  const parts = [];
  for (const e of shown) {
    if (e.type === 'check') {
      const { summary, spoken } = readCheck(e.check);
      // HER LINE IS REPLACED, not kept beside it: it was the partial answer
      // ("the biggest issues are...") this exists to stop.
      visible = summary;
      parts.push(spoken);
    } else if (e.type === 'list') {
      parts.push(readList(e.list));
    } else if (e.type === 'card') {
      parts.push(readCard(e.card));
    }
  }
  const spokenOnly = parts.filter(Boolean);
  const leadLine = shown.some((e) => e.type === 'check') ? '' : String(reply ?? '').trim();
  return {
    reply: visible,
    spoken: [leadLine, ...spokenOnly].filter(Boolean).join('\n\n'),
  };
}

module.exports = { screenReading, readCheck, readList, readCard };
