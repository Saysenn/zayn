import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { loginOrbColorsOf } from '../../configs/dianeTheme';
import { useDianePalette } from './DianePalette';

/**
 * The login screen's orb.
 *
 * SEPARATE from ParticleOrb.jsx on the user's explicit instruction — these
 * are two orbs, not one orb reused. Everything it needs is in this file:
 * its own geometry, its own shaders, its own motion. Nothing is imported
 * from the CRM orb's modules, so tuning one can never restyle the other,
 * which is exactly what was happening before.
 *
 * It is also deliberately a different THING. The CRM orb is Diane working:
 * dense, churning, reactive. This one is Diane dormant behind the door —
 * a slow-turning lattice with a bright rim, that wakes up when the sign-in
 * request goes out and pulses once when it succeeds. That's the whole
 * vocabulary it needs; there's no conversation happening on this screen.
 *
 * Props:
 *   phase  'idle' | 'authenticating' | 'success'
 */

// Her three login states in the chosen theme (configs/dianeTheme.js), as
// THREE.Color, built when the theme changes and never per frame.
const colorsOf = (palette) => Object.fromEntries(
  Object.entries(loginOrbColorsOf(palette)).map(([phase, hex]) => [phase, new THREE.Color(hex)]),
);

const RADIUS = 2.4;

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uWake;     // 0 at rest, 1 while authenticating
  uniform float uPulse;    // one-shot expansion on success
  uniform float uAssemble; // scatter distance on first appearance

  attribute float aSize;
  attribute float aBrightness;
  attribute float aPhase;
  attribute vec3 aDrift;

  varying float vBrightness;
  varying float vFacing;

  void main() {
    vec3 pos = position;
    vec3 outward = normalize(pos);

    // A slow standing wave over the shell, plus a faster one that only
    // appears once she's awake. At rest this is a barely-moving lattice,
    // which is the point of the contrast.
    float calm = 0.045 * sin(uTime * 0.9 + aPhase);
    float woke = uWake * 0.11 * sin(uTime * 4.5 + aPhase * 2.0);
    pos += outward * (calm + woke + uPulse * 0.5);
    pos += aDrift * uAssemble;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);

    // Front-facing particles are dimmed rather than the back ones, so the
    // silhouette reads as a bright edge around an open middle.
    vFacing = abs(normalize(mv.xyz).z);
    vBrightness = aBrightness * (1.0 + uWake * 0.5 + uPulse * 1.5);

    gl_PointSize = clamp(aSize * uPixelRatio * (9.0 / -mv.z), 1.0, 10.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vBrightness;
  varying float vFacing;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float falloff = smoothstep(0.5, 0.0, d);
    falloff *= falloff;

    // The rim carries the light; straight through the middle it fades so
    // you look into the sphere rather than at a ball. Not to nothing,
    // though: at 0.22 the whole face of the orb went dark and only a thin
    // ring survived, which read as her being switched off.
    float rim = mix(1.0, 0.5, vFacing);

    gl_FragColor = vec4(uColor * vBrightness, falloff * vBrightness * rim);
  }
`;

// A latitude/longitude lattice rather than a random cloud — the regularity
// is what makes this one read as a constructed, waiting object next to the
// CRM orb's organic churn. Small enough that it costs nothing anywhere.
function buildLattice() {
  const RINGS = 34;
  const PER_RING = 74;
  const total = RINGS * PER_RING;

  const positions = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const brightness = new Float32Array(total);
  const phases = new Float32Array(total);
  const drift = new Float32Array(total * 3);

  let i = 0;
  for (let ring = 0; ring < RINGS; ring++) {
    // Even spacing in cos(latitude), or every particle piles up at the poles.
    const lat = Math.acos(1 - (2 * (ring + 0.5)) / RINGS);
    // Offset each ring so the columns spiral instead of forming a grid,
    // which would strobe badly as it turns.
    const offset = ring * 0.618 * Math.PI * 2;

    for (let j = 0; j < PER_RING; j++) {
      const lon = offset + (j / PER_RING) * Math.PI * 2;
      const x = Math.sin(lat) * Math.cos(lon);
      const y = Math.cos(lat);
      const z = Math.sin(lat) * Math.sin(lon);

      // A little radial jitter, so it's a lattice and not a wireframe.
      const r = RADIUS * (0.97 + Math.random() * 0.06);
      positions[i * 3] = x * r;
      positions[i * 3 + 1] = y * r;
      positions[i * 3 + 2] = z * r;

      // A small minority much brighter than the rest — the same trick that
      // stops any particle field from flattening into a uniform haze.
      //
      // The floor is what matters here. At 0.2-0.4 the mass was invisible
      // until `uWake` brightened it, so the orb only appeared once you
      // pressed sign in — she has to be visibly there while you're typing,
      // and waking up should be a change in intensity, not the difference
      // between existing and not.
      const b = Math.random();
      brightness[i] = b > 0.94 ? 1.1 + Math.random() * 0.4 : 0.5 + Math.random() * 0.22;
      sizes[i] = 1.1 + brightness[i] * 2.2;
      phases[i] = Math.random() * Math.PI * 2;

      const d = new THREE.Vector3().randomDirection();
      drift[i * 3] = d.x;
      drift[i * 3 + 1] = d.y;
      drift[i * 3 + 2] = d.z;
      i += 1;
    }
  }

  return { positions, sizes, brightness, phases, drift, total };
}

const ASSEMBLE_DURATION = 2.0;
const PULSE_DURATION = 0.9;

export default function LoginOrb({ phase = 'idle' }) {
  const mountRef = useRef(null);
  // Read by the render loop, so a theme change reaches her without a rebuild.
  const palette = useDianePalette();
  const colors = useMemo(() => colorsOf(palette), [palette]);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const mount = mountRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const width = mount.clientWidth || 1;
    const height = mount.clientHeight || 1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.z = 7.2;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    } catch {
      return undefined; // no WebGL — LoginForm renders its own static fallback
    }
    const pixelRatio = Math.min(window.devicePixelRatio, 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const lattice = buildLattice();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(lattice.positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(lattice.sizes, 1));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(lattice.brightness, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(lattice.phases, 1));
    geometry.setAttribute('aDrift', new THREE.BufferAttribute(lattice.drift, 3));

    const uniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uWake: { value: 0 },
      uPulse: { value: 0 },
      uAssemble: { value: 0 },
      uColor: { value: colorsRef.current.idle.clone() },
    };

    const points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    scene.add(points);

    const clock = new THREE.Clock();
    const colorLerp = new THREE.Color();
    let raf;
    let wake = 0;
    let successAt = null;

    function animate() {
      raf = requestAnimationFrame(animate);
      const p = phaseRef.current;
      const t = clock.getElapsedTime();

      // Eased rather than switched, so waking up is a swell and not a jump.
      const wakeTarget = p === 'idle' ? 0 : 1;
      wake += (wakeTarget - wake) * 0.05;

      if (p === 'success' && successAt === null) successAt = t;
      const pulse =
        successAt === null
          ? 0
          : Math.max(0, Math.sin(Math.min(1, (t - successAt) / PULSE_DURATION) * Math.PI));

      uniforms.uTime.value = t;
      uniforms.uWake.value = reducedMotion ? 0 : wake;
      uniforms.uPulse.value = pulse;
      uniforms.uAssemble.value =
        t < ASSEMBLE_DURATION ? (1 - t / ASSEMBLE_DURATION) ** 4 * RADIUS * 5 : 0;

      colorLerp.copy(uniforms.uColor.value).lerp(colorsRef.current[p] ?? colorsRef.current.idle, 0.05);
      uniforms.uColor.value.copy(colorLerp);

      // One axis, steady. She is waiting, not working.
      points.rotation.y += reducedMotion ? 0 : 0.0022 + wake * 0.006;
      points.rotation.x = Math.sin(t * 0.11) * 0.14;

      renderer.render(scene, camera);
    }
    animate();

    function handleResize() {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    const ro = new ResizeObserver(handleResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      geometry.dispose();
      points.material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className="w-full h-full" aria-hidden="true" />;
}
