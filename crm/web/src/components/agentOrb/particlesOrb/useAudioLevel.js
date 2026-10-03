// ***************************************************
// * The microphone's voice level, 0 to 1, for the orb's listening mode
// ***************************************************

import { useEffect, useRef, useState } from 'react';

// The voice band, and how its energy maps onto 0 to 1.
const VOICE_MIN_HZ = 85;
const VOICE_MAX_HZ = 3800;
const LEVEL_FLOOR = 0.14;
const LEVEL_RANGE = 0.62;
const PEAK_WEIGHT = 0.35;
const FFT_SIZE = 512;
const ANALYSER_SMOOTHING = 0.7;

// ONE microphone however many orbs listen, closed when the last one stops.
let engine = null;
let consumers = 0;

export const hasAudioInputSupport = () => typeof navigator !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia);

async function createShared() {
  if (!hasAudioInputSupport()) {
    throw new DOMException('getUserMedia is unavailable (use localhost or https).', 'NotSupportedError');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
  ctx.createMediaStreamSource(stream).connect(analyser);
  return { ctx, stream, analyser };
}

function acquire() {
  consumers += 1;
  if (!engine) engine = createShared();
  const current = engine;
  return current.then((shared) => shared.analyser, (err) => {
    if (engine === current) engine = null;
    throw err;
  });
}

function release() {
  consumers = Math.max(0, consumers - 1);
  if (consumers > 0 || !engine) return;
  const current = engine;
  engine = null;
  current.then((shared) => {
    shared.stream.getTracks().forEach((track) => track.stop());
    shared.ctx.close();
  }, () => {});
}

/** 'permission-denied' or 'unavailable'. */
export const classifyAudioError = (err) => (err instanceof DOMException
  && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'permission-denied' : 'unavailable');

/**
 * `levelRef.current` is the voice level while `active`, and -1 otherwise,
 * which tells the orb to fall back to its own animation.
 */
export function useAudioLevel(active, smoothing = 0.15) {
  const levelRef = useRef(-1);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!active) {
      levelRef.current = -1;
      return undefined;
    }
    let cancelled = false;
    let raf = 0;

    acquire().then((analyser) => {
      if (cancelled) return;
      setError(null);
      const bins = analyser.frequencyBinCount;
      const nyquist = analyser.context.sampleRate / 2;
      const binFor = (hz) => Math.min(bins, Math.max(1, Math.round((hz / nyquist) * bins)));
      const lo = binFor(VOICE_MIN_HZ);
      const hi = Math.max(lo + 1, binFor(VOICE_MAX_HZ));
      const data = new Uint8Array(bins);
      let smoothed = 0;

      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        let peak = 0;
        for (let i = lo; i < hi; i += 1) {
          sum += data[i];
          if (data[i] > peak) peak = data[i];
        }
        const energy = (1 - PEAK_WEIGHT) * (sum / (hi - lo) / 255) + PEAK_WEIGHT * (peak / 255);
        const norm = Math.min(1, Math.max(0, (energy - LEVEL_FLOOR) / LEVEL_RANGE));
        smoothed += (norm - smoothed) * smoothing;
        levelRef.current = smoothed;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, (err) => {
      if (cancelled) return;
      setError(classifyAudioError(err));
      levelRef.current = -1;
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      release();
      levelRef.current = -1;
    };
  }, [active, smoothing]);

  return { levelRef, error };
}
