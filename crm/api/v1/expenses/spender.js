const pool = require('../../configs/db');

// ***************************************************
// * WHO SPENT IT, AS A MASTER SHEET PERSON
// ***************************************************
//
// His calls 2026-10-07: people see their OWN expenses on WhatsApp, so the
// "spent by" name is matched to a master sheet person once, when it is
// saved, and the expense carries that person's id. WhatBot never reads a
// name when someone asks; it asks for the expenses of the person their
// verified phone already is.
//
// The rule, the same everywhere (WhatBot, Diane, the Expenses page):
//   - EXACTLY ONE person with that name: linked;
//   - the name is the FIRST NAME of exactly one person: linked, said back
//     with the full name so the admin sees who it went to;
//   - two or more: narrowed to the expense's group; still two → asked,
//     never guessed;
//   - nobody (a cleaner, a shop): saved as typed, unlinked, never shown;
//   - "<Name> difference" is <Name>'s.

const fold = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const DIFFERENCE = /\s+(?:difference|diff)\s*$/i;
const digits = (p) => String(p ?? '').replace(/\D/g, '');

/** Every master sheet person who can be spent by, with the groups they are in. */
async function people() {
  const { rows } = await pool.query(
    `SELECT p.person_id, p.display_name,
            COALESCE(array_agg(DISTINCT m.group_name) FILTER (WHERE m.group_name IS NOT NULL), '{}') AS groups
       FROM tb_people p
       LEFT JOIN tb_mastersheet m ON m.person_id = p.person_id
      WHERE p.display_name !~* '\\s(difference|diff)\\s*$'
      GROUP BY p.person_id, p.display_name`,
  );
  return rows.map((r) => ({ personId: r.person_id, name: r.display_name, groups: r.groups ?? [] }));
}

/**
 * A NAME TO ONE PERSON, or why not. Pure, so it is tested without a database.
 * @returns {{ status: 'linked'|'ambiguous'|'near'|'none', personId?: string, name?: string, choices?: string[], firstName?: boolean }}
 */
function matchName(typed, list, group = null) {
  const want = fold(String(typed ?? '').replace(DIFFERENCE, ''));
  if (want.length < 2) return { status: 'none' };
  const narrow = (hits) => {
    if (hits.length <= 1 || !group || group === '*') return hits;
    const here = hits.filter((p) => p.groups.some((g) => fold(g) === fold(group)));
    return here.length ? here : hits;
  };
  const decide = (hits, firstName) => {
    const n = narrow(hits);
    if (n.length === 1) return { status: 'linked', personId: n[0].personId, name: n[0].name, firstName };
    return { status: 'ambiguous', choices: n.map((p) => p.name).sort() };
  };
  const exact = list.filter((p) => fold(p.name) === want);
  if (exact.length) return decide(exact, false);
  const first = want.length >= 3 && !want.includes(' ') ? list.filter((p) => fold(p.name).split(' ')[0] === want) : [];
  if (first.length) return decide(first, true);
  // ONE LETTER OFF in each word ("Abe Lincon"): suggested, never linked
  const { oneTypo } = require('../agent/tools/resolvePerson');
  const said = want.split(' ');
  const near = list.filter((p) => {
    const words = fold(p.name).split(' ');
    return words.length === said.length && words.every((w, i) => w === said[i] || (w.length >= 4 && oneTypo(said[i], w)));
  });
  if (near.length) return { status: 'near', choices: narrow(near).map((p) => p.name).sort() };
  return { status: 'none' };
}

/** The ONE master sheet person a phone belongs to, or null (none, or several). */
async function personOfPhone(phone) {
  const d = digits(phone);
  if (d.length < 7) return null;
  const { rows } = await pool.query(
    `SELECT DISTINCT m.person_id, p.display_name
       FROM tb_mastersheet m JOIN tb_people p ON p.person_id = m.person_id
      WHERE regexp_replace(m.phone, '\\D', '', 'g') = $1`,
    [d],
  );
  return rows.length === 1 ? { personId: rows[0].person_id, name: rows[0].display_name } : null;
}

/**
 * WHO SPENT IT, LINKED. `me` is the admin themselves: by their phone's
 * master sheet person, else by their admin phone (WhatsApp), else by name
 * (the CRM username).
 * @param {{ name?: string, me?: boolean, admin?: { name?: string, phone?: string }, group?: string, list?: object[] }} a
 * @returns {Promise<{ spentBy: string|null, personId: string|null, phone: string|null, status: string, choices?: string[], firstName?: boolean }>}
 */
async function linkSpender({ name, me = false, admin = null, group = null, list = null }) {
  if (me) {
    const viaPhone = admin?.phone && /^\+/.test(admin.phone) ? await personOfPhone(admin.phone) : null;
    if (viaPhone) return { spentBy: admin.name || viaPhone.name, personId: viaPhone.personId, phone: null, status: 'linked' };
    if (admin?.phone && /^\+/.test(admin.phone)) return { spentBy: admin.name ?? null, personId: null, phone: admin.phone, status: 'linked' };
    name = admin?.name ?? name;
  }
  const typed = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!typed) return { spentBy: null, personId: null, phone: null, status: 'none' };
  const m = matchName(typed, list ?? (await people()), group);
  if (m.status === 'linked') {
    // the full name shows who it went to; a "difference" stays as typed
    const shown = DIFFERENCE.test(typed) ? typed : m.name;
    return { spentBy: shown, personId: m.personId, phone: null, status: 'linked', firstName: m.firstName };
  }
  return { spentBy: typed, personId: null, phone: null, status: m.status, choices: m.choices };
}

module.exports = { linkSpender, matchName, people, personOfPhone, fold };
