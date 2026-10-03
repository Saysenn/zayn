/**
 * ***************************************************
 * * SEVERAL OF SOMETHING, ANSWERED ONE AT A TIME
 * ***************************************************
 *
 * A question can name several people, several months, several groups. A
 * tool argument that takes one means answering needs N calls, nothing tells
 * her to make N calls, and she fills the gap instead. That is how "Nicola
 * for August and September" became one tool call and two answers, one of
 * them invented.
 *
 * So the plural argument runs the SAME handler once per value and hands
 * back one reply. Never a second implementation of the work: whatever the
 * single path does, and is already tested as doing, is what each value
 * gets.
 *
 * Sequential rather than `Promise.all`, deliberately. Each call reads the
 * sheet, so a burst is a burst of identical queries for no gain, and the
 * order of the sections is the order she should say them in.
 */

/**
 * The values actually asked for, cleaned.
 *
 * DEDUPED AND SORTED, so "September and August" and "August, August and
 * September" ask the same question. Anything failing `isValid` is dropped
 * rather than guessed at: a value she invented the shape of was not asked
 * for by anybody.
 *
 * @param {*} raw whatever arrived in the argument
 * @param {(v: string) => boolean} [isValid]
 * @returns {string[]}
 */
function listAsked(raw, isValid = () => true) {
  return [...new Set(
    (Array.isArray(raw) ? raw : [])
      .map((v) => String(v ?? '').trim())
      .filter((v) => v !== '' && isValid(v)),
  )].sort();
}

/**
 * @param {object}   o
 * @param {string[]} o.values    what to answer for, already cleaned
 * @param {string}   o.singular  the argument the single path reads
 * @param {string}   o.plural    the argument to clear, so it cannot recurse
 * @param {object}   o.args      the call as it arrived
 * @param {Function} o.handler   the tool's own handler
 * @param {Function} [o.heading] how to title each section
 * @param {string}   o.guidance  what she must do with several answers
 * @param {string}   [o.mark]     stops one section splitting the same sentence again
 * @param {boolean}  [o.terminal] return the computed sentences as the final reply
 */
async function answerEach({
  values, singular, plural, args, handler, heading = (v) => v, guidance, mark, terminal = false,
}) {
  const parts = [];
  const sentences = [];

  for (const value of values) {
    // eslint-disable-next-line no-await-in-loop
    const answer = await handler({
      ...args,
      [singular]: value,
      [plural]: undefined,
      ...(mark ? { answeredPlural: mark } : {}),
    });
    parts.push(`===== ${heading(value)} =====\n${answer?.summary ?? ''}`);
    if (answer?.say) sentences.push(answer.say);
  }

  const computed = terminal && sentences.length === values.length;

  return {
    summary: `${guidance}\n\n${parts.join('\n\n')}`,
    ...(computed ? { reply: sentences.join('\n\n'), computedReply: true } : {}),
  };
}

/**
 * ===============================
 * * SEVERAL GROUPS, ANSWERED SEPARATELY
 * ===============================
 *
 * Six read tools take `group`. Six copies of the argument and six copies of
 * the loop is five chances for them to disagree, so the tool is WRAPPED
 * where it is registered instead: the schema and the behaviour cannot drift
 * apart because neither is written twice.
 *
 * SEPARATE, NEVER COMBINED, decided 2026-09-03. Leaving the group out
 * already gives the figure across every group, so that question has an
 * answer and this one did not.
 */
const GROUPS_ARG = {
  type: 'array',
  items: { type: 'string' },
  description: 'SEVERAL groups, when they asked about more than one. Use this INSTEAD of '
    + '`group`, and never one call per group. Each is answered ON ITS OWN and never added '
    + 'together: for a figure across the whole sheet leave both this and `group` out.',
};

const groupsGuidance = (n) => `${n} SEPARATE GROUPS, each answered on its own. Give EACH group `
  + 'its own answer, naming the group every time. Do NOT add them together and do NOT carry one '
  + 'group\'s result across to another. A combined figure is a DIFFERENT question, asked by '
  + 'leaving the group out entirely.';

/**
 * @param {object} tool a tool whose `group` argument should accept a list
 * @returns {object} the same tool, plural
 */
function perGroup(tool) {
  const inner = tool.handler;

  return {
    ...tool,
    parameters: {
      ...tool.parameters,
      properties: { ...tool.parameters?.properties, groups: GROUPS_ARG },
    },
    async handler(args) {
      // Their exact sentence outranks the model's argument. This is loaded
      // lazily to keep the generic answerEach helper usable in isolation.
      // eslint-disable-next-line global-require
      const { exactGroupsMentioned } = require('./notAGroup');
      const saidGroups = await exactGroupsMentioned(args?.said);
      const groups = listAsked(saidGroups.length > 0 ? saidGroups : args?.groups);

      if (groups.length > 1) {
        return answerEach({
          values: groups,
          singular: 'group',
          plural: 'groups',
          args,
          handler: inner,
          guidance: groupsGuidance(groups.length),
        });
      }

      // One group in the plural argument is just the singular question.
      if (groups.length === 1) {
        return inner({ ...args, group: groups[0], groups: undefined });
      }
      return inner(args);
    },
  };
}

module.exports = {
  answerEach, listAsked, perGroup, GROUPS_ARG,
};
