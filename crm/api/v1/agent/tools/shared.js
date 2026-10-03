/**
 * Tools Diane has in EVERY working context.
 *
 * Deliberately tiny. The whole point of the context system is that
 * a workspace only ever loads its own tools —
 * she can't act on the wrong workspace if the wrong tools aren't there.
 * Only things with no workspace at all belong here.
 *
 * ---- currently empty, on purpose ----
 * There WAS an `orb_reaction` tool here, letting Diane make the orb glow,
 * sing, dance or burst on request. Removed on the user's call: the
 * reactions weren't earning their place, and the tool's 738-character
 * schema was being sent on every round of every turn to support them.
 *
 * The orb still bursts when you CLICK it — that's handled entirely in the
 * browser (ParticleOrb.jsx's pointer handler), never involved the model,
 * and is unaffected by this.
 */

const CLAIM = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['total', 'figure', 'count', 'percent'] },
    value: { type: 'number' },
    subject: { type: 'string' },
    month: { type: 'string', description: 'YYYY-MM, only when the claim is for a month.' },
    currency: { type: 'string' },
    unit: {
      type: 'string',
      enum: ['deal', 'row', 'person', 'group', 'company', 'change', 'month', 'file', 'column'],
    },
    rateKind: { type: 'string', enum: ['addon', 'fee', 'crypto'] },
  },
  required: ['kind', 'value'],
};

const stateClaims = {
  name: 'state_claims',
  description:
    'Record every factual total, other money figure, count or percentage you are about to state. '
    + 'Call this after the read tools and before the final prose. Use value 0 for none or nothing. '
    + 'Do not include dates, row ids, phone numbers or figures you will not say. Pass an empty list '
    + 'when the final answer makes no quantitative claim. This is metadata and changes nothing.',
  parameters: {
    type: 'object',
    properties: { claims: { type: 'array', items: CLAIM } },
    required: ['claims'],
  },
  // Nothing is looked up and nothing reaches the screen, so it is not work
  // an interim line could be covering. Read by `interimLine.js`.
  changesNothing: true,
  async handler({ claims, turn }) {
    turn.claims = claims.map((claim) => ({ ...claim }));
    return {
      typedClaims: true,
      summary: 'Claims recorded. Now give the final prose with exactly those facts.',
    };
  },
};

module.exports = { sharedTools: [stateClaims] };
