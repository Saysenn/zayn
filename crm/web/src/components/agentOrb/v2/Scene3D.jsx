import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ORB_FRAGMENT, ORB_VERTEX, RING_FRAGMENT, RING_VERTEX, STAR_FRAGMENT, STAR_VERTEX } from './shaders';

// ***************************************************
// * COMMAND CENTER V2: THE WHOLE STAGE IS ONE 3D SCENE
// ***************************************************
//
// His call 2026-10-10: "a jarvis one … it should feel like 3d everything
// about it". One canvas behind the panels:
//
//   - a GLASS ORB with a real volume inside (ray marched in its shader):
//     nebula, stars or tide, in the theme's two colours;
//   - RINGS on tilted orbits that pass in front of AND behind the orb (the
//     orb writes depth, so the far half of each ring is hidden by it);
//   - STARS and dust at three depths, so the mouse parallax reads as space;
//   - BLOOM, so the light glows instead of sitting flat on the screen.
//
// It reacts to her: thinking swirls it, speaking pulses it with her voice,
// listening sends ripples, an answer landing flares it. It follows the
// mouse, and a click on the orb is "talk to her". Paused while hidden.

const STATE_ENERGY = { idle: 0.25, connecting: 0.55, listening: 0.5, thinking: 0.9, speaking: 0.7, error: 0.3, disabled: 0.1 };
const STYLE_ID = { nebula: 0, stars: 1, tide: 2 };

const hex = (c) => new THREE.Color(c);

export default function Scene3D({
  colorFrom, colorTo, state = 'idle', levelRef = null, style = 'nebula', active = true, flareKey = 0, onOrbClick = null, anchorRef = null,
}) {
  const hostRef = useRef(null);
  const live = useRef({ state, style, colorFrom, colorTo, flare: 0 });
  live.current.state = state;
  live.current.style = style;
  live.current.colorFrom = colorFrom;
  live.current.colorTo = colorTo;
  const activeRef = useRef(active);
  activeRef.current = active;
  const clickRef = useRef(onOrbClick);
  clickRef.current = onOrbClick;

  // AN ANSWER LANDED: the orb flares once
  useEffect(() => { if (flareKey) live.current.flare = 1; }, [flareKey]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);
    // setSize(…, false) leaves CSS alone: the canvas must be told to fill, or
    // it shows at buffer size (pixel ratio × too big)
    Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.025);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    camera.position.set(0, 0, 9);

    // ---- the orb: a sphere whose shader marches through the volume inside it
    const orbUniforms = {
      uTime: { value: 0 }, uEnergy: { value: 0.25 }, uLevel: { value: 0 }, uFlare: { value: 0 }, uRipple: { value: 0 },
      uStyle: { value: 0 }, uColorA: { value: hex(colorFrom) }, uColorB: { value: hex(colorTo) }, uError: { value: 0 },
      uCenter: { value: new THREE.Vector3() }, uRadius: { value: 1.75 },
    };
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(1.75, 96, 96),
      new THREE.ShaderMaterial({ vertexShader: ORB_VERTEX, fragmentShader: ORB_FRAGMENT, uniforms: orbUniforms, transparent: true, depthWrite: true }),
    );
    scene.add(orb);

    // ---- the halo: a soft back-glow plane behind the orb
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: hex(colorTo) }, uEnergy: orbUniforms.uEnergy, uFlare: orbUniforms.uFlare },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'varying vec2 vUv; uniform vec3 uColor; uniform float uEnergy; uniform float uFlare; void main(){ float d=length(vUv-0.5)*2.0; float g=smoothstep(1.0,0.18,d)*0.22*(0.6+uEnergy*0.6+uFlare); gl_FragColor=vec4(uColor*g, g); }',
      }),
    );
    halo.position.z = -1.2;
    scene.add(halo);

    // ---- the rings: tilted orbits of segmented light, in front of and behind her
    const rings = [];
    const RING_SPECS = [
      { r: 2.35, w: 0.018, tilt: [1.2, 0.0, 0.25], speed: 0.18, segs: 64, dash: 0.62 },
      { r: 2.75, w: 0.012, tilt: [1.45, 0.35, -0.4], speed: -0.11, segs: 120, dash: 0.45 },
      { r: 3.2, w: 0.03, tilt: [0.9, -0.5, 0.6], speed: 0.07, segs: 12, dash: 0.86 },
      { r: 3.75, w: 0.008, tilt: [1.62, 0.1, 0.0], speed: -0.05, segs: 180, dash: 0.3 },
    ];
    // TIDE turns them elastic: uWave (0 → 1) and two extra strands per ring
    // that only show in Tide (uStrand), so each orbit reads as a filament bundle
    const wave = { value: STYLE_ID[style] === 2 ? 1 : 0 };
    RING_SPECS.forEach((s, n) => {
      const holder = new THREE.Group();
      holder.rotation.set(...s.tilt);
      scene.add(holder);
      for (let strand = 0; strand < 3; strand += 1) {
        const geo = new THREE.RingGeometry(s.r - s.w, s.r + s.w, 384, 1);
        const mat = new THREE.ShaderMaterial({
          vertexShader: RING_VERTEX, fragmentShader: RING_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
          uniforms: {
            uTime: orbUniforms.uTime, uColor: { value: hex(colorFrom) }, uSegs: { value: s.segs }, uDash: { value: s.dash }, uEnergy: orbUniforms.uEnergy, uFlare: orbUniforms.uFlare, uRadius: { value: s.r },
            uWave: wave, uPhase: { value: n * 1.9 + strand * 0.55 }, uK: { value: 3 + n }, uStrand: { value: strand ? 0.55 : 0 },
          },
        });
        const mesh = new THREE.Mesh(geo, mat);
        holder.add(mesh);
        rings.push({ mesh, holder, speed: s.speed, mat });
      }
    });

    // ---- stars and dust, at three depths
    const layers = [];
    const STAR_LAYERS = [
      { n: 1400, spread: 60, z: [-60, -25], size: 1.2 },
      { n: 600, spread: 30, z: [-25, -8], size: 1.8 },
      { n: 260, spread: 7, z: [-4, 4], size: 2.6, orbit: true },
    ];
    for (const L of STAR_LAYERS) {
      const pos = new Float32Array(L.n * 3);
      const seed = new Float32Array(L.n);
      for (let i = 0; i < L.n; i += 1) {
        if (L.orbit) {
          // dust in a thick disc around her
          const a = Math.random() * Math.PI * 2;
          const r = 2.6 + Math.random() * 3.4;
          pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = (Math.random() - 0.5) * 1.4; pos[i * 3 + 2] = Math.sin(a) * r;
        } else {
          pos[i * 3] = (Math.random() - 0.5) * L.spread * 2;
          pos[i * 3 + 1] = (Math.random() - 0.5) * L.spread * 1.2;
          pos[i * 3 + 2] = L.z[0] + Math.random() * (L.z[1] - L.z[0]);
        }
        seed[i] = Math.random();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      const mat = new THREE.ShaderMaterial({
        vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: orbUniforms.uTime, uSize: { value: L.size * renderer.getPixelRatio() }, uColor: { value: hex(L.orbit ? colorFrom : '#ffffff') }, uTint: { value: L.orbit ? 1 : 0.15 } },
      });
      const pts = new THREE.Points(geo, mat);
      const holder = new THREE.Group();
      if (L.orbit) holder.rotation.x = 0.35;
      holder.add(pts);
      scene.add(holder);
      layers.push({ holder, mat, orbit: Boolean(L.orbit) });
    }

    // ---- bloom
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.55, 0.3);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // ---- size; and WHERE she sits: the free space between the panels
    // (anchorRef, 0..1 of the screen), not the middle of the whole screen
    const offset = { key: '' };
    const place = () => {
      const a = anchorRef?.current;
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      const key = a ? `${a.x.toFixed(3)},${a.y.toFixed(3)},${w},${h}` : 'none';
      if (key === offset.key) return;
      offset.key = key;
      if (a) camera.setViewOffset(w, h, -(a.x - 0.5) * w, -(a.y - 0.5) * h, w, h);
      else camera.clearViewOffset();
    };
    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      bloom.setSize(w, h);
      camera.aspect = w / h;
      // a narrow screen pulls the camera back so she still fits
      camera.position.z = w / h < 1 ? 19 : 13.5;
      offset.key = '';
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // ---- the mouse: parallax for the camera, and a click on her
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e) => {
      const r = host.getBoundingClientRect();
      mouse.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    const ray = new THREE.Raycaster();
    const onClick = (e) => {
      if (!clickRef.current) return;
      const r = host.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)), camera);
      if (ray.intersectObject(orb).length) clickRef.current();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    host.addEventListener('click', onClick);

    // ---- the loop
    const clock = new THREE.Clock();
    let raf = 0;
    let energy = 0.25;
    let ripple = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!activeRef.current || document.hidden) { clock.getDelta(); return; }
      const dt = Math.min(clock.getDelta(), 0.05) * (reduced ? 0.25 : 1);
      const t = (orbUniforms.uTime.value += dt);
      const L = live.current;
      // ease toward her state; her voice level drives the pulse
      energy += ((STATE_ENERGY[L.state] ?? 0.25) - energy) * Math.min(1, dt * 3);
      const lvl = Math.max(0, levelRef?.current ?? 0);
      orbUniforms.uEnergy.value = energy;
      orbUniforms.uLevel.value += (lvl - orbUniforms.uLevel.value) * Math.min(1, dt * 12);
      ripple = L.state === 'listening' ? (ripple + dt * (0.8 + lvl * 2)) % 1 : Math.max(0, ripple - dt);
      orbUniforms.uRipple.value = L.state === 'listening' ? ripple : 0;
      L.flare = Math.max(0, L.flare - dt * 1.4);
      orbUniforms.uFlare.value = L.flare;
      orbUniforms.uError.value += ((L.state === 'error' ? 1 : 0) - orbUniforms.uError.value) * Math.min(1, dt * 4);
      orbUniforms.uStyle.value = STYLE_ID[L.style] ?? 0;
      wave.value += ((STYLE_ID[L.style] === 2 ? 1 : 0) - wave.value) * Math.min(1, dt * 1.8);
      orbUniforms.uColorA.value.set(L.colorFrom);
      orbUniforms.uColorB.value.set(L.colorTo);
      halo.material.uniforms.uColor.value.set(L.colorTo);

      // the orb turns slowly; faster while she thinks
      orb.rotation.y += dt * (0.08 + energy * 0.25);
      orb.rotation.x = Math.sin(t * 0.21) * 0.12;
      const breathe = 1 + Math.sin(t * 1.3) * 0.012 + orbUniforms.uLevel.value * 0.05 + L.flare * 0.03;
      orb.scale.setScalar(breathe);
      orb.getWorldPosition(orbUniforms.uCenter.value);
      orbUniforms.uRadius.value = 1.75 * breathe;

      for (const r of rings) {
        r.mesh.rotation.z += dt * r.speed * (0.6 + energy * 1.6);
        r.mat.uniforms.uColor.value.set(L.colorFrom);
      }
      for (const l of layers) {
        if (l.orbit) { l.holder.rotation.y += dt * 0.05 * (0.5 + energy); l.mat.uniforms.uColor.value.set(L.colorFrom); }
        else l.holder.rotation.z += dt * 0.004;
      }

      // the camera drifts with the mouse: near things move more than far ones
      mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 2.5);
      mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 2.5);
      camera.position.x = mouse.x * 1.1;
      camera.position.y = -mouse.y * 0.7;
      camera.lookAt(0, 0, 0);
      place();

      bloom.strength = 0.5 + energy * 0.3 + L.flare * 0.6 + orbUniforms.uLevel.value * 0.3;
      composer.render();
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      host.removeEventListener('click', onClick);
      composer.dispose?.();
      scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      renderer.dispose();
      renderer.domElement.remove();
    };
  // built once; live values flow through refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="absolute inset-0" aria-hidden="true" />;
}
