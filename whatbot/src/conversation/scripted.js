/**
 * A reply written here in code rather than by the model.
 *
 * Everything in `about`, `escalate` and `outOfScope` returns one of these. They
 * are the answers where being consistent matters more than being fluent: what
 * we hold about somebody, who can see it, what happens when they say their pay
 * is wrong. A model improvising those is a model that answers the same question
 * two different ways on two different days.
 */

/**
 * What to offer after saying no.
 *
 * Every refusal ends with something that actually runs. The rule the whole
 * codebase keeps coming back to is never leave them at a dead end, and an offer
 * the bot cannot follow through on is a dead end with extra steps.
 */
export const NEXT_STEPS = {
  prompt: "What I can do:",
  choices: [
    { label: "What I'm owed this month", ask: "show me my full breakdown" },
    { label: "When each one ends", ask: "when do my assignments end?" },
  ],
};

/**
 * What to offer somebody who says a figure is wrong or wants a person.
 *
 * Their next step is comparing what we hold against what they were actually
 * paid, so the breakdown comes first — that is the thing they will be asked for
 * anyway. The last choice routes straight back into `wants-human`, because
 * "flag it for a person" has to be a button and not a phrase somebody has to
 * guess at.
 *
 * Still no phone number and no email. There is not one to give.
 */
export const REVIEW_STEPS = {
  prompt: "What might help:",
  choices: [
    {
      label: "See what I hold for this month",
      ask: "show me my full breakdown",
    },
    { label: "Check the dates on file", ask: "when do my assignments end?" },
    { label: "Have a person look at it", ask: "can a person review this" },
  ],
};
