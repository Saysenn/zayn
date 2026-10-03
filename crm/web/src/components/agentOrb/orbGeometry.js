import * as THREE from 'three';

/**
 * How Diane's particle field is actually shaped.
 *
 * Split out of ParticleOrb.jsx because this runs ONCE at construction and
 * is pure maths — keeping it beside the per-frame render loop made both
 * harder to follow.
 */

// Particle budget by device.
//
// Deliberately below the spec's 30-50k. With the point size fixed
// (orbShaders.js) the GPU could carry 40k, but frame time still isn't the
// only thing that matters: 40k made `dance` and `explode` visibly stutter
// on the machine this is actually used on, and the user's verdict on that
// is the one that counts. At these counts the orb still reads as dense
// dust rather than countable dots, which was the point of the density.
export function particleBudget() {
  if (typeof window === 'undefined') return 12000;
  const w = window.innerWidth;
  const cores = navigator.hardwareConcurrency ?? 4;
  // deviceMemory is Chromium-only; absent elsewhere, which is why it only
  // ever lowers the estimate rather than being required.
  const lowMemory = (navigator.deviceMemory ?? 8) <= 4;

  if (w < 640 || lowMemory) return 5000;
  if (w < 1024) return 9000;
  if (cores <= 4) return 12000;
  return 18000;
}

/**
 * A SHELL-biased distribution, deliberately not uniform.
 *
 * Two things fall out of this that the design depends on:
 *  - the middle stays dark, because few particles are there to begin with,
 *    so it reads as depth rather than as a glowing core
 *  - the silhouette reads bright, because density peaks near the surface
 *
 * Clustering is layered on top so the surface has dense patches and empty
 * pockets instead of an even dusting, which is the difference between
 * "living system" and "procedural sphere".
 */
export function buildParticleField(count, radius) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);
  const phases = new Float32Array(count);
  const drift = new Float32Array(count * 3);

  // A handful of attractors on the sphere. Particles biased toward one of
  // these is what produces visible clusters and gaps.
  const CLUSTERS = 14;
  const clusterDirs = [];
  for (let i = 0; i < CLUSTERS; i++) {
    clusterDirs.push(new THREE.Vector3().randomDirection());
  }

  const dir = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    dir.randomDirection();

    // Pull a share of particles toward a cluster centre. Not all of them,
    // or the gaps between clusters become obvious voids.
    if (Math.random() < 0.55) {
      const c = clusterDirs[(Math.random() * CLUSTERS) | 0];
      dir.lerp(c, Math.random() * 0.55).normalize();
    }

    // Radial placement. `**` biases hard toward the outside; the small
    // tail below scatters a few genuinely deep inside so the interior
    // isn't empty, just sparse.
    let r;
    const roll = Math.random();
    if (roll < 0.08) {
      r = Math.random() * 0.55; // sparse interior
    } else if (roll < 0.94) {
      r = 0.72 + Math.random() ** 0.6 * 0.28; // the shell itself
    } else {
      r = 1.0 + Math.random() * 0.16; // atmospheric haze just outside
    }

    positions[i * 3] = dir.x * r * radius;
    positions[i * 3 + 1] = dir.y * r * radius;
    positions[i * 3 + 2] = dir.z * r * radius;

    // Brightness tiers — a bright minority against a visible majority.
    //
    // The floor here matters more than it looks. An earlier version put
    // the bottom 70% at 0.16-0.30, which after the fragment shader's own
    // depth fade left them at roughly 0.06 alpha: invisible. All you could
    // actually see was the top 2%, a few hundred specks with no sphere
    // between them — which is exactly what "I just see scattered
    // particles, there's no orb" was describing. The mass has to be
    // visible for there to BE a mass; the tiers give it structure, they
    // aren't there to hide most of it.
    const b = Math.random();
    if (b < 0.70) brightness[i] = 0.42 + Math.random() * 0.18;
    else if (b < 0.90) brightness[i] = 0.66 + Math.random() * 0.24;
    else if (b < 0.98) brightness[i] = 1.0 + Math.random() * 0.3;
    else brightness[i] = 1.5 + Math.random() * 0.4;

    // Size correlates with brightness — a bright speck reads as a node
    // rather than as an anomaly — but with enough spread to avoid a
    // uniform stipple.
    sizes[i] = (0.9 + brightness[i] * 2.4) * (0.6 + Math.random() * 0.9);

    phases[i] = Math.random() * Math.PI * 2;

    // Its own random direction, used by both the burst and the sign-in
    // assembly. Shared deliberately: the same particle flies out the way
    // it once flew in.
    const d = new THREE.Vector3().randomDirection();
    drift[i * 3] = d.x;
    drift[i * 3 + 1] = d.y;
    drift[i * 3 + 2] = d.z;
  }

  return { positions, sizes, brightness, phases, drift };
}
