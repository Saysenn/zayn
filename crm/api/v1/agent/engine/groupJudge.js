const env = require('../../../configs/env');
const { getClient } = require('../chatClient');
const logger = require('../../../configs/logger');

// ***************************************************
// * WHAT EACH GROUP IN THEIR FILE IS: JUDGED BY HER, FROM THE FACTS
// ***************************************************
//
// His call 2026-10-08: "isn't AI going to help with classification and
// identification of group?" A rule per name ("MILKMAN 2", a three word
// name, a tag) was the code guessing what she can read. Now:
//
//   CODE gathers the facts: every group in their file that is not one of
//   ours by name, its people, how many of them each of OUR groups holds,
//   whether that group of ours is in the file too, and the names.
//   SHE judges, one call for the whole file: ours (same group, another
//   spelling), renamed, merged (two or more of ours), split (part of one of
//   ours, the rest still there), or new. And whether she is SURE.
//   CODE applies her judgement exactly (sheetCheck.compare), and only what
//   she is not sure of is asked, in her words, with her guess.
//
// Nothing here writes. When she cannot be asked, sheetCheck.groupDoubts is
// the fallback, and a clear case stays planned as before.

const KINDS = ['ours', 'renamed', 'merged', 'split', 'new'];

const SHAPE = {
  type: 'object',
  additionalProperties: false,
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kind', 'ours', 'sure', 'question'],
        properties: {
          name: { type: 'string', description: 'Their group name, exactly as given.' },
          kind: { type: 'string', enum: KINDS },
          ours: { type: 'array', items: { type: 'string' }, description: 'Our group(s) it is, was, or came from, exactly as in OUR GROUPS. Empty for new.' },
          sure: { type: 'boolean' },
          question: { type: 'string', description: 'Only when not sure: ONE short question (max 30 words) saying your guess and the other reading. Empty when sure.' },
        },
      },
    },
  },
};

const PROMPT = [
  'An admin sent a payroll sheet. Each deal is in a GROUP. Some group names in their file are not ours.',
  'For each such group, decide what it is. Judge by MOST of its people; the name only breaks a tie.',
  'One person can hold deals in two groups, so 1 or 2 shared people with a big group is noise, not a merge.',
  '- ours: the same group as one of ours under another spelling or tag (a typo, "Group", "Ltd", case).',
  '  A name that is a SLIP of ours holding that group\'s people is ours, never a rename to the misspelling.',
  '  A NUMBER or an extra word makes it a different name, never a slip: "MANBAT 2" holding MANBAT\'s people,',
  '  with MANBAT gone from the file, is MANBAT renamed; holding new people, it is new.',
  '- renamed: most of ONE of our groups\' people are in it, and that group of ours is NOT in their file.',
  '  Newcomers do not change that: all or nearly all of a missing group\'s people in one name is renamed, and SURE,',
  '  however many joined. Sure only when about 3/4 or more of that group came across.',
  '- merged: most people of TWO OR MORE of our groups are in it, and those groups are NOT in their file.',
  '- split: several people of one of ours are in it while that group of ours IS still in their file.',
  '- new: a group we do not have (its people are mostly newcomers). "X 2" or "X North" with new people is new.',
  'sure = false when the facts fairly allow two readings: e.g. only half or so of a missing group came',
  'across with many newcomers (renamed, or new while the rest left?), or a name like ours with none of our people.',
  'A wrong guess moves people\'s pay, so say when you are unsure, but never ask what the facts settle.',
  'question (only when not sure), max 30 words, British English, in exactly this shape:',
  '"<THEIR NAME>: <the one fact that matters>. I\'d <your guess as an action>. Right, or <the other reading>?"',
  'e.g. "SUMMIT: 3 of MANBAT\'s 5 people, plus 8 new, and MANBAT is not in the file. I\'d take it as MANBAT renamed. Right, or a new group?"',
].join('\n');

/** The facts she reads, one line per group, in plain words. */
function factsOf(found, knownGroups) {
  const theirs = found.unfamiliar ?? [];
  const status = (g) => (found.inFile?.includes(g) ? `${g} IS in their file` : `${g} is NOT in their file`);
  return {
    ours: knownGroups.map((g) => `${g}: ${found.ourSizes?.[g] ?? 0} people, ${found.inFile?.includes(g) ? 'in their file too' : 'NOT in their file'}`),
    theirs: theirs.map((g) => `${g.name}: ${g.people} people (${g.newcomers} in none of our groups), ${g.rows} deals. `
      + `${g.shares.length ? `Holds ${g.shares.map((x) => `${x.shared} of ${x.group}'s ${x.of} people (${status(x.group)})`).join('; ')}.` : 'Holds none of our people.'}`
      + `${g.looksLike ? ` Its name is ${g.looksLike.kind} ${g.looksLike.group}.` : ''}`),
  };
}

/**
 * Her judgement for every unfamiliar group, or null when she cannot be asked.
 * @returns {Promise<null|Array<{name, kind, ours, sure, question}>>}
 */
async function judgeGroups(found, knownGroups, { client = null, model = null } = {}) {
  if (!(found.unfamiliar ?? []).length) return [];
  const openai = client ?? getClient();
  if (!openai) return null;
  const facts = factsOf(found, knownGroups);
  try {
    const res = await openai.chat.completions.create({
      model: model ?? env.openaiModel,
      temperature: 0,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: `OUR GROUPS:\n${facts.ours.join('\n')}\n\nTHEIR GROUPS NOT OURS BY NAME:\n${facts.theirs.join('\n')}` },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'groups', strict: true, schema: SHAPE } },
    });
    const out = JSON.parse(res.choices?.[0]?.message?.content ?? 'null')?.groups ?? null;
    if (!out) return null;
    // HELD TO THE FACTS: a name she made up, or one of ours that is not ours,
    // is not taken. A group she skipped is new, and asked.
    const names = new Set(found.unfamiliar.map((g) => g.name));
    const kept = out.filter((j) => names.has(j.name)).map((j) => ({
      ...j, ours: (j.ours ?? []).filter((o) => knownGroups.includes(o)),
    })).map((j) => (['ours', 'renamed', 'merged', 'split'].includes(j.kind) && !j.ours.length ? { ...j, kind: 'new', sure: false } : j));
    for (const g of found.unfamiliar) {
      if (!kept.some((j) => j.name === g.name)) kept.push({ name: g.name, kind: 'new', ours: [], sure: false, question: `${g.name} is not one of our groups. Add it as a new group?` });
    }
    /**
     * HER VERDICT HELD TO THE FACTS (blind battery 2026-10-09: the same file
     * judged two ways on two runs). Not names: the share of a group's people.
     *  - A slip of our name holding most of that missing group IS that group.
     *  - Never "new" in silence while it holds half or more of a missing
     *    group; never "renamed" in silence with under three quarters of it.
     */
    const byName = new Map(found.unfamiliar.map((g) => [g.name, g]));
    const missing = (grp) => !found.inFile?.includes(grp);
    for (const j of kept) {
      const g = byName.get(j.name);
      const top = g?.shares?.[0];
      const part = top ? top.shared / Math.max(top.of, 1) : 0;
      if (g?.looksLike?.kind === 'a slip of the same name' && top && top.group === g.looksLike.group && part >= 0.6 && missing(top.group)) {
        Object.assign(j, { kind: 'ours', ours: [top.group], sure: true, question: '' });
      } else if (j.kind === 'new' && j.sure && top && missing(top.group) && part >= 0.5) {
        Object.assign(j, { sure: false, ours: [top.group], question: j.question || `${j.name}: ${top.shared} of ${top.group}'s ${top.of} people, plus ${g.newcomers} new, and ${top.group} is not in the file. I'd add it as a new group. Right, or ${top.group} renamed?` });
      } else if (j.kind === 'renamed' && j.sure && top && part < 0.75) {
        Object.assign(j, { sure: false, question: j.question || `${j.name}: ${top.shared} of ${top.group}'s ${top.of} people, plus ${g.newcomers} new. I'd take it as ${top.group} renamed. Right, or a new group?` });
      }
    }
    logger.info({ judged: kept.map((j) => `${j.name}=${j.kind}${j.ours.length ? `(${j.ours.join('+')})` : ''}${j.sure ? '' : '?'}`) }, 'diane: groups judged');
    return kept;
  } catch (err) {
    logger.warn({ err: err.message }, 'diane: groups could not be judged, the rules decide');
    return null;
  }
}

/** One judgement as what compare() is told. */
// `judged`: her judgement is the whole word on renames (compare's `renames`).
function decisionOf(j) {
  if (j.kind === 'ours') return { judged: true, aliases: { [j.name]: j.ours[0] } };
  if (j.kind === 'renamed' || j.kind === 'merged') return { judged: true, renames: { [j.name]: j.ours } };
  return { judged: true, notRenamed: [j.name] };
}
/** What "no" to her guess means: the other reading. */
function otherOf(j) {
  // "new" guessed beside one of ours: "no" means it is that group renamed.
  if (j.kind === 'new') return j.ours?.length ? { judged: true, renames: { [j.name]: [j.ours[0]] } } : { judged: true, dropGroups: [j.name] };
  return { judged: true, notRenamed: [j.name] };
}

function mergeDecisions(...parts) {
  const out = { aliases: {}, renames: null, notRenamed: [], dropGroups: [] };
  for (const p of parts.filter(Boolean)) {
    Object.assign(out.aliases, p.aliases ?? {});
    if (p.judged || p.renames) out.renames = { ...(out.renames ?? {}), ...(p.renames ?? {}) };
    out.notRenamed.push(...(p.notRenamed ?? []));
    out.dropGroups.push(...(p.dropGroups ?? []));
  }
  return out;
}

module.exports = { judgeGroups, decisionOf, otherOf, mergeDecisions, factsOf, SHAPE };
