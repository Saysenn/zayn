const repo = require('../../repos/hmrc.repo');
const knowledge = require('./knowledge');

// ***************************************************
// * OUR PLAYBOOK: HOW THIS BUSINESS DOES THINGS
// ***************************************************
// His call 2026-10-12: in lawyer mode the company and the boss tell Diane
// their processes and internal ways, and she reads them FIRST on every
// answer. Saved through her (chat or an uploaded document) or in Settings.
// Every change is kept with who made it and when (migration 082), and any
// of them can be put back. Stored in the CRM's own database, nowhere else.

const clean = (t, n) => String(t ?? '').trim().slice(0, n);
const snapshot = (e) => (e ? { section: e.section ?? e.topic, title: e.title, body: e.body } : null);

/** A new entry: saved, cut into passages and searchable. Never cut short. */
async function add({ section, title, body, by = null }) {
  const s = clean(section, 60) || 'General';
  const t = clean(title, 140) || 'Our process';
  const b = String(body ?? '').trim();
  if (!b) throw Object.assign(new Error('An entry needs what it says.'), { status: 400 });
  const saved = await knowledge.index({ kind: 'playbook', title: t, body: b, topic: s, addedBy: by });
  const change = await repo.recordPlaybookChange({ sourceId: saved.id, action: 'add', after: { section: s, title: t, body: b }, by });
  return { id: saved.id, change: change.id, section: s, title: t, passages: saved.chunks };
}

async function edit(id, { section = null, title = null, body = null }, by = null) {
  const before = await repo.playbookEntry(id);
  if (!before || !before.active) return null;
  const saved = await repo.updatePlaybookEntry(id, {
    section: section != null ? clean(section, 60) : null,
    title: title != null ? clean(title, 140) : null,
    body: body != null ? String(body).trim() : null,
  });
  await knowledge.reindex(saved);
  const change = await repo.recordPlaybookChange({ sourceId: id, action: 'edit', before: snapshot(before), after: snapshot(saved), by });
  return { id, change: change.id };
}

async function remove(id, by = null) {
  const before = await repo.playbookEntry(id);
  if (!before || !before.active) return null;
  await repo.setPlaybookActive(id, false);
  knowledge.forget();
  const change = await repo.recordPlaybookChange({ sourceId: id, action: 'remove', before: snapshot(before), by });
  return { id, change: change.id };
}

/**
 * PUT A CHANGE BACK: an add is taken out, an edit goes back to its words, a
 * removal comes back. The undo is itself kept, with who did it.
 */
async function undo(changeId, by = null) {
  const c = await repo.playbookChange(changeId);
  if (!c || c.undone_at || c.action === 'undo') return null;
  if (c.action === 'add') await repo.setPlaybookActive(c.source_id, false);
  if (c.action === 'remove') await repo.setPlaybookActive(c.source_id, true);
  if (c.action === 'edit' && c.before) {
    const saved = await repo.updatePlaybookEntry(c.source_id, c.before);
    if (saved) await knowledge.reindex(saved);
  }
  knowledge.forget();
  await repo.markPlaybookUndone(c.id);
  await repo.recordPlaybookChange({ sourceId: c.source_id, action: 'undo', before: { undid: c.id, action: c.action }, by });
  return { undid: c.action, sourceId: c.source_id };
}

/** Sections and titles, for her to know what the playbook holds. */
async function outline() {
  const rows = await repo.playbook();
  return rows.map((r) => `#${r.id} ${r.section || 'General'}: ${r.title}`).join('\n');
}

/** The whole playbook as one document, for people to read or keep. */
async function asMarkdown() {
  const rows = await repo.playbook();
  if (!rows.length) return '# Our playbook\n\nNothing saved yet.\n';
  const out = ['# Our playbook', ''];
  let section = null;
  for (const r of rows) {
    if (r.section !== section) { section = r.section; out.push(`## ${section || 'General'}`, ''); }
    out.push(`### ${r.title}`, '', r.body, '');
  }
  return out.join('\n');
}

module.exports = { add, edit, remove, undo, outline, asMarkdown };
