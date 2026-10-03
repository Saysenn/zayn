// ***************************************************
// * The particles orb: a sphere of dots on a 2D canvas, one motion per mode
// ***************************************************
//
// Built to replace the command center orb when he says so. Not wired in yet.
// idle breathes, connecting draws a ring, listening ripples, thinking pulses,
// speaking flows, error shakes red, disabled goes still and grey.

import {
  forwardRef, useCallback, useEffect, useRef,
} from 'react';
import { PARTICLES_ORB } from '../../../configs/dianeTheme';
import {
  approach, createStateMix, ERROR_COLOR_FROM, ERROR_COLOR_TO, hexToRgb,
  ORB_STATE, ORB_STATES, orbVars, stateEnergy, stateMotion,
} from './orbState';
import { useOrbLevel } from './useOrbLevel';
import { observeActivity } from './observeActivity';

const PARTICLE_COUNT = 720;
const TWO_PI = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// The moment drawn when motion is reduced.
const STATIC_TIME = 1.7;
const MAX_DPR = 2;
const MAX_DT = 0.1;
const TILT_X = 0.32;
const RADIUS_OF_HALF = 0.62;

const ERROR_FROM_RGB = hexToRgb(ERROR_COLOR_FROM);
const ERROR_TO_RGB = hexToRgb(ERROR_COLOR_TO);

const mixRgb = (a, b, m) => [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Evenly spread points on a unit sphere, each with its own seed and tone. */
function buildSphere(count) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = GOLDEN_ANGLE * i;
    points.push({
      x: Math.cos(theta) * r,
      y,
      z: Math.sin(theta) * r,
      ringFrac: (i * 0.61803398875) % 1,
      seed: ((i * 0.7548776662) % 1) * TWO_PI,
      tone: (i * 0.5436890126) % 1,
    });
  }
  return points;
}

/**
 * @param {object} p
 * @param {string} [p.state]   one of ORB_STATE
 * @param {number} [p.size]    px
 * @param {number} [p.speed]   multiplier
 * @param {string} [p.colorFrom]
 * @param {string} [p.colorTo]
 * @param {{ current: number }} [p.levelRef] live 0 to 1; negative means none
 */
const ParticlesOrb = forwardRef(function ParticlesOrb({
  state = ORB_STATE.idle,
  size = PARTICLES_ORB.size,
  speed = PARTICLES_ORB.speed,
  colorFrom = PARTICLES_ORB.colorFrom,
  colorTo = PARTICLES_ORB.colorTo,
  levelRef,
  label = 'Assistant orb',
  className,
}, forwardedRef) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  const speedRef = useRef(speed);
  const colorRef = useRef({ from: colorFrom, to: colorTo });
  const drawStaticRef = useRef(null);

  const setHostRef = useCallback((node) => {
    hostRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  useEffect(() => {
    stateRef.current = state;
    speedRef.current = speed;
    colorRef.current = { from: colorFrom, to: colorTo };
  });

  useOrbLevel(hostRef, state, levelRef);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!host || !ctx) return undefined;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const points = buildSphere(PARTICLE_COUNT);
    const center = size / 2;
    const baseRadius = center * RADIUS_OF_HALF;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stateMix = createStateMix(stateRef.current);
    let t = reduce ? STATIC_TIME : 0;
    let angleY = 0;
    let connectingPhase = 0;
    let levelS = 0;

    const render = (dt, isStatic = false) => {
      const st = stateRef.current;
      const spd = speedRef.current;
      const easeDt = isStatic ? 60 : dt;
      const w = stateMix.update(st, easeDt);

      let ripple = 0;
      let pulse = 0;
      let flow = 0;
      for (const s of ORB_STATES) {
        const kind = stateMotion(s);
        if (kind === 'ripple') ripple += w[s];
        else if (kind === 'pulse') pulse += w[s];
        else if (kind === 'flow') flow += w[s];
      }
      const wIdle = w[ORB_STATE.idle];
      const wConn = w[ORB_STATE.connecting];
      const wError = w[ORB_STATE.error];
      const motionScale = 1 - w[ORB_STATE.disabled] * 0.96;

      const rawLevel = isStatic
        ? stateEnergy(st, t)
        : clamp01(Number.parseFloat(getComputedStyle(host).getPropertyValue('--orb-level')) || 0);
      levelS = approach(levelS, rawLevel, 9, easeDt);
      const level = levelS;

      angleY += dt * spd * (0.14 + ripple * (0.9 + level * 1.6) + flow * 0.4 + wConn * 0.3) * motionScale;
      connectingPhase = (connectingPhase + dt * spd * 1.1) % TWO_PI;

      const breathe = 0.05 * (0.25 + wIdle * 0.75) * Math.sin(t * 1.1 * spd) * motionScale;
      const conv = pulse * (0.22 + 0.12 * Math.sin(t * 2.6 * spd + 1));
      const expand = flow * (0.08 + level * 0.32);
      const radius = baseRadius * (1 + breathe + level * 0.16 + expand - conv);

      const from = mixRgb(hexToRgb(colorRef.current.from), ERROR_FROM_RGB, wError);
      const to = mixRgb(hexToRgb(colorRef.current.to), ERROR_TO_RGB, wError);

      const shakeAmp = wError * radius * 0.05 * motionScale;
      const shakeX = shakeAmp * (Math.sin(t * 26 * spd) + 0.5 * Math.sin(t * 15.7 * spd));
      const shakeY = shakeAmp * (Math.cos(t * 22.5 * spd) + 0.5 * Math.sin(t * 13.1 * spd));
      const idleAmp = wIdle * radius * 0.055 * motionScale;
      const jitterAmp = (flow + wError * 0.7) * radius * (0.015 + level * 0.085) * motionScale;
      const rippleAmp = ripple * (0.045 + level * 0.24);
      const pulseAmp = pulse * 0.16;
      const alphaScale = 1 - w[ORB_STATE.disabled] * 0.35;

      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const cosX = Math.cos(TILT_X);
      const sinX = Math.sin(TILT_X);

      ctx.clearRect(0, 0, size, size);
      ctx.globalCompositeOperation = !isStatic && ripple + pulse + flow > 0.5 ? 'lighter' : 'source-over';

      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const x1 = p.x * cosY - p.z * sinY;
        const z1 = p.x * sinY + p.z * cosY;
        const y1 = p.y * cosX - z1 * sinX;
        const z2 = p.y * sinX + z1 * cosX;
        const depth = (z2 + 1) / 2;
        const perspective = 0.65 + depth * 0.45;

        let pointRadius = radius;
        if (rippleAmp > 0.002) pointRadius *= 1 + rippleAmp * Math.sin(p.y * 4.5 - t * 6.5 * spd);
        if (pulseAmp > 0.002) {
          pointRadius *= 1 - pulseAmp * (0.5 + 0.5 * Math.sin(p.ringFrac * TWO_PI + t * 3.1 * spd));
        }

        let ox = shakeX;
        let oy = shakeY;
        if (idleAmp > 0.01) {
          ox += idleAmp * (Math.sin(t * 0.55 * spd + p.seed * 3.7) + 0.5 * Math.sin(t * 1.3 * spd + p.seed * 1.3));
          oy += idleAmp * (Math.cos(t * 0.62 * spd + p.seed * 2.9) + 0.5 * Math.sin(t * 1.05 * spd + p.seed * 5.1));
        }
        if (jitterAmp > 0.01) {
          ox += jitterAmp * Math.sin(t * 14 * spd + p.seed * 9.3);
          oy += jitterAmp * Math.cos(t * 17 * spd + p.seed * 6.1);
        }

        const sphereX = center + x1 * pointRadius * perspective + ox;
        const sphereY = center + y1 * pointRadius * perspective + oy;
        const sphereAlpha = (0.12 + depth * depth * 0.78) * alphaScale;
        const sphereDot = 0.6 + depth * 1.5;
        let screenX = sphereX;
        let screenY = sphereY;
        let alpha = sphereAlpha;
        let dot = sphereDot;

        // CONNECTING pulls the sphere into a turning ring, blended by its weight.
        if (wConn > 0.004) {
          const ringAngle = (i / points.length) * TWO_PI + connectingPhase + 0.05 * Math.sin(t * 1.3 + p.seed);
          const ringR = center * (0.58 + 0.13 * p.ringFrac) * (1 + 0.05 * Math.sin(t + p.seed * 1.7));
          screenX = sphereX + (center + Math.cos(ringAngle) * ringR - sphereX) * wConn;
          screenY = sphereY + (center + Math.sin(ringAngle) * ringR - sphereY) * wConn;
          alpha = sphereAlpha + (0.35 + p.tone * 0.5 - sphereAlpha) * wConn;
          dot = sphereDot + (0.75 + p.tone * 0.9 - sphereDot) * wConn;
        }

        const cr = from[0] + (to[0] - from[0]) * p.tone;
        const cg = from[1] + (to[1] - from[1]) * p.tone;
        const cb = from[2] + (to[2] - from[2]) * p.tone;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${cr | 0}, ${cg | 0}, ${cb | 0}, ${alpha.toFixed(3)})`;
        ctx.arc(screenX, screenY, dot, 0, TWO_PI);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    };

    if (reduce) {
      render(0, true);
      drawStaticRef.current = () => render(0, true);
      return () => { drawStaticRef.current = null; };
    }

    let raf = 0;
    let last = null;
    let running = true;
    const frame = (now) => {
      raf = 0;
      const dt = last === null ? 0 : Math.min((now - last) / 1000, MAX_DT);
      last = now;
      t += dt;
      render(dt);
      if (running) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (raf !== 0) return;
      last = null;
      raf = requestAnimationFrame(frame);
    };
    const halt = () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      last = null;
    };
    const unobserve = observeActivity(host, (active) => {
      running = active;
      if (active) wake(); else halt();
    });
    wake();

    return () => {
      halt();
      unobserve();
    };
  }, [size]);

  // Reduced motion draws one still frame, so it is redrawn when the look changes.
  useEffect(() => { drawStaticRef.current?.(); }, [state, colorFrom, colorTo]);

  const disabled = state === ORB_STATE.disabled;
  return (
    <div
      ref={setHostRef}
      role="img"
      aria-label={label}
      data-state={state}
      className={className}
      style={{
        ...orbVars({ size, speed, colorFrom, colorTo }),
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        opacity: disabled ? 0.5 : 1,
        filter: disabled ? 'grayscale(0.85)' : undefined,
        transition: 'opacity 0.4s ease, filter 0.4s ease',
      }}
    >
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
    </div>
  );
});

export default ParticlesOrb;
