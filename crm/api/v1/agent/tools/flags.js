const concernsRepo = require('../../repos/concerns.repo');
const undoRepo = require('../../repos/agentUndo.repo');
const { confirmFirst } = require('./confirmFirst');
const { broadcast } = require('../../sockets/index');

// ***************************************************
// * FLAGS, FOR DIANE (his call 2026-10-13)
// ***************************************************
//
// One tool for the Flagged page's bar: in progress, resolve, reopen or
// delete the flags of one or many people, the same calls the page makes.
// A person in two groups is two rows there, so a name that matches both is
// ASKED about, never guessed. Every act is one undo, a delete included: the
// flags are kept whole for it.

const BY = 'Diane';
const MAX_PEOPLE = 50;
const ACTION_LABEL = {
  in_progress: 'in progress', resolved: 'resolved', open: 'open', delete: 'deleted',
};

const fold = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const nameOf = (r) => r.person_name || r.person_id;

/** One letter added, dropped or changed: "did you mean". */
function near(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return a === b;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}

async function everyone() {
  const { rows } = await concernsRepo.listGrouped({ limit: 2000, offset: 0 });
  return rows;
}

const updateFlags = {
  name: 'update_flags',
  writes: true,
  description:
    'FLAGS people raised on WhatsApp (the Flagged page), NOT a deal\'s needs-review mark. Set the flags of '
    + 'one or many people to in progress, resolved or open, or '
    + 'DELETE them. Name people (with their group when they gave one), or use `where` for everyone matching '
    + '(e.g. every open flag in ALPHA). All of a person\'s flags in that group move together. '
    + 'Call with confirmed false first and show the lines; true only after yes. `undo` true puts back the '
    + 'last change you made here AT ONCE (no confirm), deleted flags included.',
  parameters: {
    type: 'object',
    properties: {
      people: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, group: { type: 'string', description: 'Their group, or "all" for every group they have flags in.' } },
          required: ['name'],
        },
      },
      where: {
        type: 'object',
        description: 'Everyone matching ALL of these.',
        properties: { group: { type: 'string' }, status: { type: 'string', enum: ['open', 'in_progress', 'resolved'] } },
      },
      action: { type: 'string', enum: ['in_progress', 'resolved', 'open', 'delete'] },
      undo: { type: 'boolean' },
      confirmed: { type: 'boolean', description: 'False first, which changes nothing. True only after they said yes.' },
    },
  },
  async handler(args = {}) {
    if (args.undo) return undoFlags();
    if (!ACTION_LABEL[args.action]) return { summary: 'Say what to do with their flags: in progress, resolved, open or delete. Nothing has been changed.' };
    const all = await everyone();

    let picked = [];
    if (Array.isArray(args.people) && args.people.length) {
      const asks = [];
      for (const p of args.people) {
        const want = fold(p.name);
        let hits = all.filter((r) => fold(nameOf(r)) === want || fold(r.person_id) === want);
        if (!hits.length) {
          // A first name alone: "Drew" for "Drew Cole".
          hits = all.filter((r) => fold(nameOf(r)).split(' ')[0] === want);
        }
        if (p.group && fold(p.group) !== 'all') hits = hits.filter((r) => fold(r.group_name) === fold(p.group));
        const people = [...new Set(hits.map((r) => fold(nameOf(r))))];
        if (!hits.length) {
          const close = [...new Set(all.filter((r) => near(fold(nameOf(r)), want)).map(nameOf))];
          asks.push(close.length ? `No flags for "${p.name}". Did you mean ${close.join(' or ')}?` : `Nobody called "${p.name}" has flags${p.group ? ` in ${p.group}` : ''}.`);
        } else if (people.length > 1) {
          asks.push(`"${p.name}" is more than one person with flags: ${people.map((n) => hits.find((r) => fold(nameOf(r)) === n)).map(nameOf).join(', ')}. Ask which.`);
        } else if (hits.length > 1 && !p.group) {
          asks.push(`${nameOf(hits[0])} has flags in ${hits.map((r) => r.group_name).join(' and ')}. Ask which group, or all of them.`);
        } else {
          picked.push(...hits);
        }
      }
      if (asks.length) return { summary: `NOTHING HAS BEEN CHANGED. ${asks.join(' ')}` };
    } else if (args.where) {
      picked = all.filter((r) => (!args.where.group || fold(r.group_name) === fold(args.where.group))
        && (!args.where.status || r.status === args.where.status));
      if (!picked.length) {
        const reply = 'Nobody\'s flags match that. Nothing has been changed.';
        return { summary: reply, reply, computedReply: true };
      }
    } else {
      return { summary: 'Say whose flags (people, or where). Nothing has been changed.' };
    }
    // the same person and group named twice is one
    picked = [...new Map(picked.map((r) => [`${r.group_name}|${r.person_id}`, r])).values()];
    if (picked.length > MAX_PEOPLE) return { summary: `That is ${picked.length} people, more than ${MAX_PEOPLE} at once. Ask them to narrow it. Nothing has been changed.` };
    // Already there: said, not written again.
    const moving = args.action === 'delete' ? picked : picked.filter((r) => r.status !== args.action);
    if (!moving.length) {
      const reply = `Their flags are already ${ACTION_LABEL[args.action]}. Nothing to change.`;
      return { summary: reply, reply, computedReply: true };
    }

    const flags = moving.reduce((n, r) => n + (r.concern_count || 0), 0);
    const lines = moving.map((r) => `• ${nameOf(r)} (${r.group_name}): ${r.concern_count} ${r.concern_count === 1 ? 'flag' : 'flags'}, `
      + `${args.action === 'delete' ? 'deleted' : `${r.status.replace('_', ' ')} → ${ACTION_LABEL[args.action]}`}`);
    const pending = confirmFirst(args.confirmed, {
      act: args.action === 'delete' ? `delete every flag these people have (${flags})` : `set their flags to ${ACTION_LABEL[args.action]}`,
      count: moving.length,
      noun: 'person',
      plural: 'people',
      // NO SECOND OPTION IN THE PREVIEW: "...back with undo" read as an either/or,
      // and the yes was refused as picking neither (suite, 2026-10-13).
      keeps: '',
      lines,
      // Matched against what she read out, which drops the "1." numbering.
      identity: lines.map((l) => l.replace(/^\d+\.\s*/, '')).join(' '),
    });
    if (pending) return { ...pending, aimedAt: moving.map(nameOf) };

    const who = moving.map((r) => ({ group: r.group_name, personId: r.person_id }));
    const before = await concernsRepo.snapshotForPeople(who);
    let done;
    if (args.action === 'delete') {
      const rows = await concernsRepo.deleteForPeople(who);
      for (const c of rows) broadcast(c.group_name, 'concern:updated', { ...c, deleted: true });
      done = rows.length;
    } else {
      const rows = await concernsRepo.updateStatusForPeople(who, args.action);
      for (const c of rows) broadcast(c.group_name, 'concern:updated', c);
      done = rows.length;
    }
    // READ BACK
    const after = await concernsRepo.snapshotForPeople(who);
    const ok = args.action === 'delete' ? after.length === 0 : after.every((c) => c.status === args.action);
    await undoRepo.record('flags', `${moving.length} ${moving.length === 1 ? "person's" : "people's"} flags ${ACTION_LABEL[args.action]}`, { rows: before }, BY);
    const reply = ok
      ? `Done: ${done} ${done === 1 ? 'flag' : 'flags'} ${ACTION_LABEL[args.action]}.\n${lines.join('\n')}`
      : 'Saved, but some flags did not read back as asked: check the Flagged page.';
    return { summary: reply, reply, computedReply: true };
  },
};

async function undoFlags() {
  const last = await undoRepo.latest('flags');
  if (!last) {
    const reply = 'There is no change of mine to flags to undo.';
    return { summary: reply, reply, computedReply: true };
  }
  // AT ONCE, like the Liquidations page's undo: see liquidations.js.
  const rows = last.restore.rows ?? [];
  const n = await concernsRepo.restoreRows(rows);
  await undoRepo.markUndone(last.id);
  for (const c of rows) broadcast(c.group_name, 'concern:updated', c);
  const reply = `Undone: ${n} ${n === 1 ? 'flag' : 'flags'} put back as they were.`;
  return { summary: reply, reply, computedReply: true };
}

module.exports = { flagTools: [updateFlags], updateFlags };
