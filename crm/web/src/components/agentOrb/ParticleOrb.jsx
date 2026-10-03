import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PARTICLE_VERTEX, PARTICLE_FRAGMENT, CORE_VERTEX, CORE_FRAGMENT } from './orbShaders';
import { particleBudget, buildParticleField } from './orbGeometry';
import { orbColorsOf } from '../../configs/dianeTheme';
import { useTheme } from '../../hooks/useTheme';

/**
 * DIANE, as she appears inside the CRM.
 *
 * This is the orb the user asked to have back: a lot of particles, visibly
 * rotating and moving, nothing else in the frame. A previous version added
 * a neural-connection layer, a Fresnel shell and five orbital rings on top
 * of this — that version was rejected outright ("too slow", "I like the old
 * one"), so those are gone rather than merely turned down. What's left is
 * the thing that was working: dust in motion.
 *
 * NOT shared with the login screen. LoginOrb.jsx is its own component with
 * its own look, on the user's explicit instruction — the two are allowed to
 * drift apart, and a change to one must never silently restyle the other.
 *
 * The displacement maths runs in the vertex shader (orbShaders.js), not in
 * a per-frame JS loop. Same motion, but the particle count stops being
 * bounded by what the main thread can move each frame.
 *
 * Props:
 *   mode      'idle' | 'listening' | 'thinking' | 'speaking' | 'building'
 *   level     0-1 live amplitude (real mic input, or TTS playback)
 *   reaction  { type, at } | null — one-shot glow/sing/dance/explode
 *   formIn    assemble from scattered on first appearance
 *   spread    0-1 how far the field is held OPEN at rest. formIn and
 *             explode both decay to zero, so neither could keep her
 *             scattered: this is the one that stays. The briefing screen
 *             renders her full bleed and wants dust, not a ball.
 *   palette   'glow' (additive, for dark grounds) | 'ink' (for light)
 *   intensity overall brightness multiplier
 *   density   0-1 multiplier on the particle count, for callers that
 *             render her very large (the greeting fills the screen, where
 *             the full count is both slower and far too much light)
 *   maxPixelRatio  the backing store cap. Default 1.5; a full bleed scene
 *             pays it over the whole viewport and asks for less. Count and
 *             resolution are two different costs and `density` only moves
 *             the first
 *   opacity   0-1 multiplier on the whole field
 *   onReady   fired once the first frame is actually on screen
 *   onBurst   fired when a CLICK sets off a burst, so the caller can play
 *             the sound — the burst itself is handled inside the render
 *             loop and never touches React, so without this the click was
 *             silent while an agent-requested explode wasn't
 *   active    false stops the DRAW without tearing the context down. The
 *             overlay hides itself with CSS rather than unmounting, so
 *             without this she rendered a full particle field, sixty times
 *             a second, behind a `display: none`
 */

// `building` is the export session, and it is not like the other four.
// Every one of those is momentary; this is a STATE SHE IS IN, held for the
// whole session including her silences, because she is not waiting for you
// then, she is building with you. Warmer and more orange than thinking, so
// the difference reads from across the room.
//
// The hexes come from the chosen theme (configs/dianeTheme.js orbColorsOf).
// THREE.Color objects are built when the theme changes, never per frame.
const toColors = (set) => Object.fromEntries(
  Object.entries(set).map(([mode, hex]) => [mode, new THREE.Color(hex)]),
);

// ===============================
// * THE BACKING STORE, AND WHY IT IS A PROP
// ===============================
// Thousands of soft blurry dots: the extra sharpness of a retina backing
// store is invisible and its fragment cost is not. 1.5 is the default for
// every scene that renders her at a normal size.
//
// A FULL BLEED SCENE PAYS THIS OVER THE WHOLE VIEWPORT, and with `spread`
// holding the field open the dust covers all of it, additively. That is
// fragment work, not particle count, so `density` alone could not reach it.
const MAX_PIXEL_RATIO = 1.5;

const BASE_RADIUS = 2.5;
const FORM_IN_DURATION = 2.4;
export const REACTION_DURATION = { glow: 1.4, sing: 5.5, dance: 5.5, explode: 2.4 };

export default function ParticleOrb({
  mode = 'idle',
  level = 0,
  reaction = null,
  formIn = false,
  spread = 0,
  palette = 'glow',
  intensity = 1,
  density = 1,
  maxPixelRatio = MAX_PIXEL_RATIO,
  opacity = 1,
  active = true,
  onReady = null,
  onBurst = null,
}) {
  const mountRef = useRef(null);
  const { theme } = useTheme();
  const colorsRef = useRef(null);
  colorsRef.current = useMemo(() => {
    const sets = orbColorsOf(theme);
    return { glow: toColors(sets.glow), ink: toColors(sets.ink) };
  }, [theme]);
  const onBurstRef = useRef(onBurst);
  onBurstRef.current = onBurst;
  // Read inside the render loop without re-running the effect — these
  // change every frame while listening or speaking, and rebuilding the
  // WebGL context that often would flicker and leak.
  // `spread` is read per frame, not at build time, so a caller can open
  // and close the field without rebuilding the WebGL context.
  const stateRef = useRef({ mode, level, reaction, intensity, active, spread });
  stateRef.current = { mode, level, reaction, intensity, active, spread };
  const staticRef = useRef({ formIn, palette, density, opacity, maxPixelRatio });
  // Held in a ref so passing an inline arrow for it can't tear down and
  // rebuild the whole WebGL context on every parent render.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const mount = mountRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ink = staticRef.current.palette === 'ink';
    const colors = ink ? colorsRef.current.ink : colorsRef.current.glow;

    const width = mount.clientWidth || 1;
    const height = mount.clientHeight || 1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.z = 7.4;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    } catch {
      // No WebGL. The caller renders its own fallback; failing silently
      // here beats a blank canvas or a thrown error taking the page down.
      // onReady still fires: it means "stop waiting on the orb", and a
      // machine without WebGL will never produce a first frame.
      onReadyRef.current?.();
      return undefined;
    }
    // Capped, not the display's full 2+. See MAX_PIXEL_RATIO: a full bleed
    // scene asks for less again.
    const pixelRatio = Math.min(window.devicePixelRatio, staticRef.current.maxPixelRatio);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const orb = new THREE.Group();
    scene.add(orb);

    const count = Math.round(particleBudget() * staticRef.current.density);
    const field = buildParticleField(count, BASE_RADIUS);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(field.positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(field.sizes, 1));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(field.brightness, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(field.phases, 1));
    geometry.setAttribute('aDrift', new THREE.BufferAttribute(field.drift, 3));

    // Particle size is relative to the canvas, not absolute — see uScale in
    // orbShaders.js. 340px is the resting box in the overlay, so the orb at
    // that size is the reference everything else is measured against.
    //
    // The 1.7 ceiling is deliberate and low. The greeting renders her at
    // full screen, where a linear scale reached ~4x: every particle four
    // times wider, sixteen times the fill cost, and a wall of light far
    // too bright to look at. Sub-linear growth past the reference size
    // keeps her legible when large without either problem.
    const REFERENCE_HEIGHT = 340;
    const scaleFor = (h) => Math.max(0.8, Math.min(1.7, (h / REFERENCE_HEIGHT) ** 0.55));

    const uniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uScale: { value: scaleFor(height) },
      uAmbient: { value: 0 },
      uReactive: { value: 0 },
      uDance: { value: 0 },
      uExplode: { value: 0 },
      uFormIn: { value: 0 },
      uSpread: { value: 0 },
      uBreath: { value: 1 },
      uColor: { value: colors.idle.clone() },
      uOpacity: { value: ink ? 0.9 : 1 },
    };

    const particles = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_VERTEX,
        fragmentShader: PARTICLE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: ink ? THREE.NormalBlending : THREE.AdditiveBlending,
      }),
    );
    orb.add(particles);

    // ---- the core ---------------------------------------------------------
    // Deliberately small — about a fifth of the field's radius. Any bigger
    // and it stops being a core and starts being a lamp inside a bag; the
    // dark middle is what gives the sphere its depth, and this has to sit
    // inside that darkness without erasing it.
    //
    // Added to `scene`, not to `orb`: the core is the one part that must
    // NOT turn with everything else. A billboard that rotates with the
    // group would swing off centre, and a glowing point has no orientation
    // worth showing anyway.
    const coreUniforms = {
      uSize: { value: BASE_RADIUS * 0.9 },
      uColor: { value: colors.idle.clone() },
      uIntensity: { value: ink ? 0.35 : 1 },
    };
    const core = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: coreUniforms,
        vertexShader: CORE_VERTEX,
        fragmentShader: CORE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: false, // always visible through the particles in front of it
        blending: ink ? THREE.NormalBlending : THREE.AdditiveBlending,
      }),
    );
    scene.add(core);

    // ---- pointer reaction -------------------------------------------------
    const pointer = { x: 0, y: 0, hover: false, down: false, clickedAt: 0 };
    const onMove = (e) => {
      const rect = mount.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      pointer.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    const onEnter = () => { pointer.hover = true; };
    const onLeave = () => { pointer.hover = false; pointer.down = false; pointer.x = 0; pointer.y = 0; };
    // Clicking her bursts the field. Handled here rather than by the
    // parent passing a `reaction` prop, because this is pure play — it
    // shouldn't have to travel through React state, and it shouldn't
    // interrupt a real reaction that's already running (hence the guard in
    // the loop below).
    const onDown = () => { pointer.down = true; pointer.clickedAt = -1; };
    const onUp = () => { pointer.down = false; };
    window.addEventListener('pointermove', onMove);
    mount.addEventListener('pointerenter', onEnter);
    mount.addEventListener('pointerleave', onLeave);
    mount.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);

    // ---- render loop ------------------------------------------------------
    const clock = new THREE.Clock();
    const colorLerp = new THREE.Color();
    let raf;
    let smoothedLevel = 0;
    // Eased toward, never jumped to, so opening the field reads as the
    // particles drifting apart rather than teleporting. See uSpread.
    let spreadNow = 0;
    let activeReactionAt = 0;
    let activeReactionType = null;
    let reactionStartedAt = 0;
    let announced = false;

    function animate() {
      raf = requestAnimationFrame(animate);
      const {
        mode: m, level: lv, reaction: rx, intensity: inten, active: live,
      } = stateRef.current;

      // NOTHING IS DRAWN WHEN SHE IS NOT ON SCREEN. The overlay hides
      // itself with CSS so the WebGL context survives a close and reopen,
      // which also meant the whole field kept rendering behind it. The
      // frame is still requested — restarting a loop from a prop change is
      // more moving parts than skipping a body — but no uniform is written
      // and no draw call is made. `hidden` covers a background tab, where
      // rAF usually stops anyway but is not guaranteed to.
      if (!live || document.hidden) return;

      const t = clock.getElapsedTime();

      // Both real level signals are stepped, not continuous (the mic's
      // analyser samples in chunks, TTS pulses once per word), so easing
      // here is what turns a jumpy signal into a swell.
      const ease = m === 'speaking' ? 0.12 : 0.08;
      smoothedLevel += (lv - smoothedLevel) * ease;

      // Retriggered by timestamp, not by type — asking for "glow" twice
      // in a row should play twice, not be a no-op on the second.
      if (rx && rx.at !== activeReactionAt) {
        activeReactionAt = rx.at;
        activeReactionType = rx.type;
        reactionStartedAt = t;
      }

      // A click bursts her — but never over the top of a reaction she was
      // actually asked for, which would cut Diane's own answer short.
      if (pointer.clickedAt === -1) {
        pointer.clickedAt = 0;
        if (!activeReactionType) {
          activeReactionType = 'explode';
          reactionStartedAt = t;
          onBurstRef.current?.();
        }
      }
      let progress = null;
      if (activeReactionType) {
        const dur = REACTION_DURATION[activeReactionType] ?? 2;
        const elapsed = t - reactionStartedAt;
        if (elapsed >= dur) activeReactionType = null;
        else progress = elapsed / dur;
      }
      const envelope = progress !== null ? Math.sin(progress * Math.PI) : 0;

      const breath = reducedMotion ? 1 : 1 + Math.sin(t * 1.05) * 0.02;

      // Deliberately never zero: even at rest the field is churning, which
      // is what "alive and ready" looked like and what got asked for back.
      const ambient = reducedMotion ? 0 : 0.14 + 0.06 * Math.sin(t * 0.6);
      const thinking = m === 'thinking' ? 0.16 + 0.1 * Math.sin(t * 5) : 0;
      const voice = reducedMotion ? 0 : smoothedLevel * 0.45;
      const pointerBoost = pointer.down ? 0.22 : pointer.hover ? 0.1 : 0;
      const glow = activeReactionType === 'glow' ? envelope * 0.5 : 0;
      const sing = activeReactionType === 'sing'
        ? envelope * (0.3 + 0.3 * Math.abs(Math.sin(progress * Math.PI * 6)))
        : 0;

      uniforms.uTime.value = t;
      uniforms.uAmbient.value = ambient;
      uniforms.uReactive.value = reducedMotion ? 0 : thinking + voice + pointerBoost + glow + sing;
      uniforms.uDance.value = activeReactionType === 'dance' ? envelope : 0;
      uniforms.uExplode.value = activeReactionType === 'explode' ? envelope * BASE_RADIUS * 1.8 : 0;
      uniforms.uBreath.value = breath;

      // Assembly on first appearance. Quintic ease-out: most of the
      // distance early, then a long settle, which reads as assembling
      // rather than flying in and stopping.
      if (staticRef.current.formIn && t < FORM_IN_DURATION) {
        uniforms.uFormIn.value = (1 - t / FORM_IN_DURATION) ** 5 * BASE_RADIUS * 6;
      } else {
        uniforms.uFormIn.value = 0;
      }

      // HELD OPEN, and eased toward rather than jumped to, so a caller can
      // open and close the field without the particles teleporting. It
      // rides the same aDrift the burst and the assembly use, so a spread
      // field still bursts and still assembles from where it stands.
      spreadNow += (stateRef.current.spread * BASE_RADIUS * 2.2 - spreadNow) * 0.05;
      uniforms.uSpread.value = spreadNow;

      const target = progress !== null ? colors.speaking : colors[m] ?? colors.idle;
      colorLerp.copy(uniforms.uColor.value).lerp(target, 0.06);
      uniforms.uColor.value.copy(colorLerp);
      uniforms.uOpacity.value = (ink ? 0.9 : 1) * inten * staticRef.current.opacity;

      // The core is where her state reads first: it swells with her voice,
      // pulses while she thinks, and flares through a reaction. Held to a
      // narrow range so it stays a steady presence rather than a strobe.
      coreUniforms.uColor.value.copy(colorLerp);
      coreUniforms.uIntensity.value =
        (ink ? 0.35 : 0.95) * inten * (0.85 + smoothedLevel * 0.5 + envelope * 0.45)
        * (m === 'thinking' ? 1.1 + 0.12 * Math.sin(t * 5) : 1);
      coreUniforms.uSize.value = BASE_RADIUS * (0.9 + smoothedLevel * 0.18 + envelope * 0.25) * breath;

      // Rotation you can actually see. An earlier version slowed this to
      // roughly a turn every forty seconds and the orb read as static —
      // this is about a turn every twelve, with a slow tumble across it so
      // it never looks like a single fixed axis.
      //
      // AND IT FOLLOWS HER VOICE WHILE SHE SPEAKS. User's call 2026-09-21,
      // for the briefing screen: the field turns faster on a loud syllable
      // and settles in the pauses, so the motion is HER rather than a
      // constant. Only while speaking, and off under reduced motion: on
      // every other screen she turns at the rate she always has.
      const spoken = m === 'speaking' && !reducedMotion ? smoothedLevel * 0.012 : 0;
      orb.rotation.y += (m === 'thinking' ? 0.011 : 0.0055) + spoken;
      orb.rotation.x = Math.sin(t * 0.22) * 0.2 + pointer.y * 0.06;
      orb.rotation.z = Math.cos(t * 0.15) * 0.1 + pointer.x * 0.04;

      renderer.render(scene, camera);

      if (!announced) {
        announced = true;
        onReadyRef.current?.();
      }
    }
    animate();

    // The container animates size (the overlay expands it full-screen for
    // a reaction), and a window-resize listener would miss that entirely,
    // leaving the canvas rendering at the wrong pixel size while CSS
    // stretched it.
    function handleResize() {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      // Grows the particles with the box, so the orb doesn't thin out to
      // nothing when it's rendered large.
      uniforms.uScale.value = scaleFor(h);
    }
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);

      geometry.dispose();
      particles.material.dispose();
      core.geometry.dispose();
      core.material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // Mounted once. mode/level/reaction are read live through stateRef, so
    // the WebGL context is never torn down mid-conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className="w-full h-full cursor-pointer" aria-hidden="true" />;
}
