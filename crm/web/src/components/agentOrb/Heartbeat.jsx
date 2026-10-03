import { useEffect, useRef } from 'react';
import { useDianePalette } from './DianePalette';

// ***************************************************
// * Her pulse
// ***************************************************
//
// A trace that scrolls one pixel per drawn frame, so the width IS the time
// window. Two things drive it and both are real:
//
//   the RATE  is her state. At rest it is slow; thinking, listening and
//             speaking each quicken it. So a glance says whether she is
//             working without reading a word.
//   the HEIGHT is the live amplitude the orb is reacting to: the same
//             `level`, so the pulse and the orb can never disagree.
//
// The beat-to-beat interval is jittered, because a metronome reads as a
// progress bar and a heart does not.
//
// CANVAS, NOT DOM. Twenty animated spans would be twenty style
// recalculations a frame; this is one 168x46 buffer and a polyline, capped
// at 30fps and stopped dead whenever she is off screen.

const W = 168;              // css px, and also the number of samples held
const H = 46;
const FPS = 30;
const DPR_CAP = 1.5;

// Samples between beats at rest, and the floor when she is busiest. A beat
// every ~34 frames is a shade under two seconds at 30fps.
const REST_INTERVAL = 52;
const BUSY_INTERVAL = 22;
const JITTER = 0.14;

// Which states quicken her. `building` is a held state rather than a
// momentary one, so it sits between resting and working.
const EFFORT = { idle: 0, building: 0.45, listening: 0.7, thinking: 1, speaking: 0.8 };

// One beat, as a sum of gaussians: the small P bump, the sharp QRS, the
// broad T that follows. Phase runs 0 to 1 across one interval.
function beatAt(p) {
  const g = (centre, width, height) => height * Math.exp(-((p - centre) ** 2) / (2 * width * width));
  return g(0.14, 0.022, 0.16)
    - g(0.272, 0.008, 0.26)
    + g(0.30, 0.011, 1)
    - g(0.332, 0.013, 0.34)
    + g(0.50, 0.045, 0.28);
}

export default function Heartbeat({ mode = 'idle', level = 0, active = true, className = '' }) {
  const canvasRef = useRef(null);
  // Live inputs read inside the loop, so a changing level never restarts it.
  // The palette too: the command center paints it in its own colours.
  const palette = useDianePalette();
  const inputRef = useRef({ mode, level, active, palette });
  inputRef.current = { mode, level, active, palette };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const samples = new Float32Array(W); // ring buffer, oldest at `head`
    let head = 0;
    let phase = 0;
    let interval = REST_INTERVAL;
    let smoothed = 0;
    let raf;
    let last = 0;

    function step(now) {
      raf = requestAnimationFrame(step);
      const { mode: m, level: lv, active: live } = inputRef.current;
      if (!live || document.hidden) return;
      if (now - last < 1000 / FPS) return;
      last = now;

      const effort = EFFORT[m] ?? 0;
      smoothed += (lv - smoothed) * 0.15;

      // A new beat picks its own interval, so no two are the same length.
      phase += 1 / interval;
      if (phase >= 1) {
        phase -= 1;
        const target = REST_INTERVAL - (REST_INTERVAL - BUSY_INTERVAL) * effort;
        interval = target * (1 + (Math.random() - 0.5) * 2 * JITTER);
      }

      const amplitude = 0.42 + smoothed * 0.7 + effort * 0.14;
      const noise = (Math.random() - 0.5) * 0.035;
      samples[head] = reducedMotion ? 0 : beatAt(phase) * amplitude + noise;
      head = (head + 1) % W;

      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // The resting line, so an empty stretch still reads as a signal
      // rather than as a dead panel.
      ctx.strokeStyle = inputRef.current.palette.tint(0.12);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();

      ctx.strokeStyle = inputRef.current.palette.signal;
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        // Oldest sample on the left: the buffer is read from `head`.
        const v = samples[(head + x) % W];
        const y = H / 2 - v * (H / 2 - 3);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // The leading edge, so it is obvious which end is now.
      const tip = samples[(head + W - 1) % W];
      ctx.fillStyle = inputRef.current.palette.hot;
      ctx.beginPath();
      ctx.arc(W - 1, H / 2 - tip * (H / 2 - 3), 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    draw();
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: `${W}px`, height: `${H}px` }}
      aria-hidden="true"
    />
  );
}
