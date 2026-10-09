/**
 * ***************************************************
 * * THE LIBRARY: one set, its cases kept by GROUP, every one with an id
 * ***************************************************
 * Plan items 13-22, 2026-10-08. `SUITE_SET=library` runs it; SUITE_GROUP
 * (e.g. pay, trust) runs one group. Each file is one group; data.mjs holds
 * the people every expected answer is worked out from, and regression.mjs
 * holds every bug as a case that never leaves.
 *
 * Groups grow by adding wordings to the files, not new mechanisms.
 */
import * as basic from './basic.mjs';
import * as relational from './relational.mjs';
import * as historical from './historical.mjs';
import * as ambiguous from './ambiguous.mjs';
import * as pay from './pay.mjs';
import * as trust from './trust.mjs';
import * as workflows from './workflows.mjs';
import * as actions from './actions.mjs';
import * as adversarial from './adversarial.mjs';
import * as regression from './regression.mjs';
import * as conversation from './conversation.mjs';

export { extraSeed } from './data.mjs';

const GROUPS = { basic, relational, historical, ambiguous, pay, trust, workflows, actions, adversarial, conversation, regression };
const tagged = (key) => Object.entries(GROUPS).flatMap(([group, mod]) => (mod[key] ?? []).map((c) => ({ ...c, group })));

export const READS = tagged('READS');
// Risky actions first: each checks NOTHING changed, before the writes below
// change things on purpose.
export const WRITES = [...tagged('WRITES')].sort((a, b) => Number(Boolean(b.risky && !b.turns.some((t) => t.say === 'yes'))) - Number(Boolean(a.risky && !a.turns.some((t) => t.say === 'yes'))));
export const PENDING = [];
