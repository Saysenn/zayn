// ***************************************************
// * What the command center's orb shows, from what she is doing right now
// ***************************************************

import { ORB_STATE } from './particlesOrb/orbState.js';

/**
 * @param {object} p
 * @param {string} p.mode      her mode: idle, listening, thinking, speaking, building
 * @param {boolean} p.streaming her reply is arriving as text (speaking, even when muted)
 * @param {boolean} p.failed    her last answer failed, and nothing has been sent since
 * @returns {string} one of ORB_STATE
 */
export function orbStateFor({ mode, streaming = false, failed = false }) {
  if (mode === 'thinking' && streaming) return ORB_STATE.speaking;
  // Building a file is the turning ring.
  if (mode === 'building') return ORB_STATE.connecting;
  if (mode === 'idle' && failed) return ORB_STATE.error;
  return ORB_STATE[mode] ?? ORB_STATE.idle;
}
