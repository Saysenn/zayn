import { useCallback, useEffect, useRef, useState } from 'react';

// ***************************************************
// * Hold, drag, let go: a map that moves like a map
// ***************************************************

/**
 * PAN AND ZOOM FOR AN SVG, in its own viewBox units.
 *
 * The content group is drawn at `translate(x, y) scale(k)`. Dragging moves
 * it under the pointer one to one; letting go keeps the drag's speed and
 * eases it to a stop (the glide), the wheel and a pinch zoom toward the
 * point under the pointer, and every zoom is animated rather than jumping.
 *
 * A CLICK IS STILL A CLICK. Nothing is captured until the pointer has
 * moved a few pixels, so pressing a dot opens it; and the click that ends
 * a real drag is swallowed, so letting go over a dot does not.
 */
const DRAG_START_PX = 4;
const FRICTION = 0.92; // per 16ms frame of glide
const ZOOM_EASE = 0.28; // share of the remaining zoom closed each frame
const SLACK = 0.25; // how far past the edge the map may be pulled

export default function usePanZoom(svgRef, { width, height, minK = 1, maxK = 6 }) {
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [dragging, setDragging] = useState(false);
  const v = useRef(view);
  const raf = useRef(0);
  const zoomGoal = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const swallowClick = useRef(false);

  const clamp = useCallback(({ x, y, k }) => {
    const kk = Math.min(maxK, Math.max(minK, k));
    const span = (size) => [size - size * kk - size * SLACK, size * SLACK];
    const [x0, x1] = span(width);
    const [y0, y1] = span(height);
    return { x: Math.min(x1, Math.max(x0, x)), y: Math.min(y1, Math.max(y0, y)), k: kk };
  }, [width, height, minK, maxK]);

  const commit = useCallback((next) => {
    v.current = clamp(next);
    setView(v.current);
  }, [clamp]);

  const stop = () => { cancelAnimationFrame(raf.current); raf.current = 0; zoomGoal.current = null; };

  /** A client point in viewBox units: the CTM knows about letterboxing. */
  const toSvg = useCallback((cx, cy) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, [svgRef]);

  /** Zoom by a factor toward a viewBox point, animated. */
  const zoomAt = useCallback((anchor, factor) => {
    const from = zoomGoal.current?.k ?? v.current.k;
    zoomGoal.current = { k: Math.min(maxK, Math.max(minK, from * factor)), anchor };
    if (raf.current) return;
    const step = () => {
      const goal = zoomGoal.current;
      if (!goal) { raf.current = 0; return; }
      const { x, y, k } = v.current;
      const nk = Math.abs(goal.k - k) < 0.002 ? goal.k : k + (goal.k - k) * ZOOM_EASE;
      // The content point under the anchor stays under it.
      const cx = (goal.anchor.x - x) / k;
      const cy = (goal.anchor.y - y) / k;
      commit({ x: goal.anchor.x - cx * nk, y: goal.anchor.y - cy * nk, k: nk });
      if (nk === goal.k) { zoomGoal.current = null; raf.current = 0; return; }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [commit, minK, maxK]);

  const centre = () => ({ x: width / 2, y: height / 2 });
  const zoomIn = useCallback(() => zoomAt(centre(), 1.6), [zoomAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomOut = useCallback(() => zoomAt(centre(), 1 / 1.6), [zoomAt]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Back to the whole map, eased over a third of a second. */
  const fit = useCallback(() => {
    stop();
    const start = { ...v.current };
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 320);
      const e = 1 - (1 - t) ** 3;
      commit({ x: start.x * (1 - e), y: start.y * (1 - e), k: start.k + (1 - start.k) * e });
      raf.current = t < 1 ? requestAnimationFrame(step) : 0;
    };
    raf.current = requestAnimationFrame(step);
  }, [commit]);

  const glide = (vx, vy) => {
    let last = performance.now();
    let sx = vx;
    let sy = vy;
    const step = (now) => {
      const dt = Math.min(48, now - last);
      last = now;
      const before = v.current;
      commit({ ...before, x: before.x + sx * dt, y: before.y + sy * dt });
      // Hitting the edge kills that axis rather than sticking to it.
      if (v.current.x === before.x) sx = 0;
      if (v.current.y === before.y) sy = 0;
      const f = FRICTION ** (dt / 16);
      sx *= f;
      sy *= f;
      raf.current = Math.hypot(sx, sy) > 0.004 ? requestAnimationFrame(step) : 0;
    };
    raf.current = requestAnimationFrame(step);
  };

  // THE WHEEL, non-passive so the modal behind does not scroll as well.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      // A trackpad pinch arrives as ctrl+wheel with small deltas.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0022));
      zoomAt(toSvg(e.clientX, e.clientY), factor);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [svgRef, zoomAt, toSvg]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    stop();
    pointers.current.set(e.pointerId, { cx: e.clientX, cy: e.clientY });
    const ps = [...pointers.current.values()];
    if (ps.length === 1) {
      gesture.current = { kind: 'press', startX: e.clientX, startY: e.clientY, samples: [] };
    } else if (ps.length === 2) {
      const [a, b] = ps;
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.cx - b.cx, a.cy - b.cy) };
      svgRef.current?.setPointerCapture?.(e.pointerId);
    }
  };

  const onPointerMove = (e) => {
    const p = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!p || !g) return;
    const prev = toSvg(p.cx, p.cy);
    p.cx = e.clientX;
    p.cy = e.clientY;
    if (g.kind === 'press' && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > DRAG_START_PX) {
      g.kind = 'drag';
      setDragging(true);
      svgRef.current?.setPointerCapture?.(e.pointerId);
    }
    if (g.kind === 'drag') {
      const now = toSvg(e.clientX, e.clientY);
      const dx = now.x - prev.x;
      const dy = now.y - prev.y;
      commit({ ...v.current, x: v.current.x + dx, y: v.current.y + dy });
      const t = performance.now();
      g.samples.push({ t, dx, dy });
      while (g.samples.length && t - g.samples[0].t > 80) g.samples.shift();
    } else if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      const mid = toSvg((a.cx + b.cx) / 2, (a.cy + b.cy) / 2);
      if (g.dist > 0) {
        const { x, y, k } = v.current;
        const nk = Math.min(maxK, Math.max(minK, k * (dist / g.dist)));
        commit({ x: mid.x - ((mid.x - x) / k) * nk, y: mid.y - ((mid.y - y) / k) * nk, k: nk });
      }
      g.dist = dist;
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'drag') {
      swallowClick.current = true;
      setTimeout(() => { swallowClick.current = false; }, 0);
      const span = g.samples.length > 1 ? g.samples[g.samples.length - 1].t - g.samples[0].t : 0;
      if (span > 0) {
        const sx = g.samples.reduce((n, s) => n + s.dx, 0) / span;
        const sy = g.samples.reduce((n, s) => n + s.dy, 0) / span;
        glide(sx, sy);
      }
    }
    if (pointers.current.size === 0) {
      gesture.current = null;
      setDragging(false);
    } else if (g.kind === 'pinch') {
      // One finger left after a pinch carries on as a plain drag.
      const [rest] = [...pointers.current.values()];
      gesture.current = { kind: 'drag', startX: rest.cx, startY: rest.cy, samples: [] };
    }
  };

  const onClickCapture = (e) => {
    if (swallowClick.current) { e.stopPropagation(); e.preventDefault(); }
  };

  return {
    view,
    dragging,
    zoomIn,
    zoomOut,
    fit,
    canZoomIn: view.k < maxK - 0.01,
    canZoomOut: view.k > minK + 0.01,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onClickCapture,
    },
  };
}
