// ***************************************************
// * The orb's level, written to CSS variables every frame
// ***************************************************

import { useEffect, useRef } from 'react';
import { approach, stateEnergy } from './orbState';
import { observeActivity } from './observeActivity';

// How fast the level follows its target, per second.
const LEVEL_RATE = 7.7;
// The longest frame step allowed, so a paused tab does not jump.
const MAX_DT = 0.1;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Writes --orb-level (and bass, mid, treble) on `ref`'s element. A live
 * `levelRef` (0 to 1) wins; a negative one means no audio, and the state's
 * own procedural energy is used.
 */
export function useOrbLevel(ref, state, levelRef) {
  const smoothedRef = useRef(0);
  const clockRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const write = (level, bass, mid, treble) => {
      el.style.setProperty('--orb-level', level.toFixed(3));
      el.style.setProperty('--orb-bass', bass.toFixed(3));
      el.style.setProperty('--orb-mid', mid.toFixed(3));
      el.style.setProperty('--orb-treble', treble.toFixed(3));
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      write(0, 0, 0, 0);
      return undefined;
    }

    let raf = 0;
    let last = null;
    let active = true;

    const frame = (now) => {
      raf = 0;
      const dt = last === null ? 0 : Math.min((now - last) / 1000, MAX_DT);
      last = now;
      clockRef.current += dt;
      const live = levelRef?.current;
      const target = typeof live === 'number' && live >= 0 ? live : stateEnergy(state, clockRef.current);
      smoothedRef.current = approach(smoothedRef.current, target, LEVEL_RATE, dt);
      const level = smoothedRef.current;
      const t = clockRef.current;
      write(
        level,
        clamp01(level * (0.78 + 0.22 * Math.sin(t * 2.3))),
        clamp01(level * (0.78 + 0.22 * Math.sin(t * 3.4 + 2.1))),
        clamp01(level * (0.78 + 0.22 * Math.sin(t * 4.6 + 4.2))),
      );
      if (active) raf = requestAnimationFrame(frame);
      else last = null;
    };

    const wake = () => { if (raf === 0) raf = requestAnimationFrame(frame); };
    const halt = () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      last = null;
    };

    const unobserve = observeActivity(el, (next) => {
      active = next;
      if (next) wake(); else halt();
    });
    wake();

    return () => {
      halt();
      unobserve();
    };
  }, [ref, state, levelRef]);
}
