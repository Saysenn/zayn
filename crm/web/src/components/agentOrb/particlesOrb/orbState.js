// ***************************************************
// * The particles orb's states, and the maths that blends them
// ***************************************************

import { PARTICLES_ORB } from '../../../configs/dianeTheme.js';

// Every mode the orb can be in. `error` and `disabled` are extensions: they
// tint and quieten the sphere rather than move it.
export const ORB_STATE = Object.freeze({
  idle: 'idle',
  connecting: 'connecting',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  error: 'error',
  disabled: 'disabled',
});

export const ALL_ORB_STATES = Object.freeze(Object.values(ORB_STATE));

// The states that MOVE the sphere, each one kind of motion.
export const ORB_STATES = Object.freeze([
  ORB_STATE.idle, ORB_STATE.connecting, ORB_STATE.listening, ORB_STATE.thinking, ORB_STATE.speaking,
]);

export const ERROR_COLOR_FROM = PARTICLES_ORB.errorFrom;
export const ERROR_COLOR_TO = PARTICLES_ORB.errorTo;

/** "#22d3ee" or "#2de" as [r, g, b]. */
export function hexToRgb(hex) {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const MOTION = {
  [ORB_STATE.listening]: 'ripple',
  [ORB_STATE.thinking]: 'pulse',
  [ORB_STATE.speaking]: 'flow',
};

/** 'ripple', 'pulse', 'flow' or 'none'. */
export const stateMotion = (state) => MOTION[state] ?? 'none';

/** The procedural energy of a state at time t, used when no live audio is given. */
export function stateEnergy(state, t) {
  switch (state) {
    case ORB_STATE.listening:
      return 0.4 + 0.32 * Math.abs(Math.sin(t * 8.5)) + 0.18 * Math.abs(Math.sin(t * 4.1 + 1.5));
    case ORB_STATE.speaking:
      return 0.3 + 0.24 * Math.abs(Math.sin(t * 6.2)) + 0.16 * Math.abs(Math.sin(t * 3 + 0.6));
    case ORB_STATE.thinking:
      return 0.24 + 0.2 * Math.abs(Math.sin(t * 2.4));
    case ORB_STATE.connecting:
      return 0.12 + 0.1 * Math.abs(Math.sin(t * 1.6));
    case ORB_STATE.error:
      return 0.2;
    default:
      return 0;
  }
}

/** Exponential easing of `current` toward `target`. */
export const approach = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

/** Weights per state that ease toward the active one, so a mode change blends rather than cuts. */
export function createStateMix(initial = ORB_STATE.idle) {
  const weights = Object.fromEntries(ALL_ORB_STATES.map((s) => [s, s === initial ? 1 : 0]));
  const update = (state, dt, rate = 6) => {
    let total = 0;
    for (const key of ALL_ORB_STATES) {
      const target = key === state ? 1 : 0;
      const next = approach(weights[key], target, rate, dt);
      weights[key] = target === 0 && next < 0.001 ? 0 : next;
      total += weights[key];
    }
    if (total > 0) for (const key of ALL_ORB_STATES) weights[key] /= total;
    return weights;
  };
  return { weights, update };
}

/** The CSS variables the orb exposes, so it can be themed from CSS too. */
export function orbVars({ size, speed, colorFrom, colorTo }) {
  const vars = {};
  if (size != null) vars['--orb-size'] = `${size}px`;
  if (speed != null) vars['--orb-speed'] = `${speed}`;
  if (colorFrom) vars['--orb-color-from'] = colorFrom;
  if (colorTo) vars['--orb-color-to'] = colorTo;
  return vars;
}
