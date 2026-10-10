import {
  lazy, Suspense, useEffect, useRef, useState,
} from 'react';
import { useDianePalette } from '../DianePalette';
import { sfx } from './sfx';
import './v2.css';

const Scene3D = lazy(() => import('./Scene3D'));

// ***************************************************
// * COMMAND CENTER V2: the Jarvis one (his call 2026-10-10)
// ***************************************************
//
// The SAME Diane as V1: every piece that does something (the conversation,
// the composer, the cards, the dialogs) is V1's own element, passed in.
// What is new is the room: a 3D scene behind (Scene3D: the glass orb, the
// orbiting rings, the stars), and the panels floating in front of it at
// different depths, tilting toward the mouse. Colours are the theme's.

const STYLES = [
  { key: 'nebula', label: 'Nebula' },
  { key: 'tide', label: 'Tide' },
];
const read = (k, fallback) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="cc2-clock" aria-label="Time">
      <span className="cc2-clock-time">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      <span className="cc2-clock-date">{now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span>
    </div>
  );
}

function Readout({ label, value, className = '' }) {
  return (
    <div className={`cc2-readout ${className}`}>
      <span className="cc2-readout-label">{label}</span>
      <span className="cc2-readout-value">{value}</span>
    </div>
  );
}

/**
 * HER VOICE, OR YOURS, AS LIVE BARS above the command line (it was a line
 * along the bottom of the bar; he read it as a glitch). Drawn from
 * the same level the orb pulses with, straight to a canvas (no renders).
 */
function VoiceWave({ levelRef, on }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !on) return undefined;
    const ctx = c.getContext('2d');
    const sig = getComputedStyle(c).getPropertyValue('--sig').trim() || '#5eead4';
    let raf = 0; let t = 0; let lvl = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = (c.width = c.clientWidth * 2); const h = (c.height = c.clientHeight * 2);
      lvl += ((levelRef?.current ?? 0) - lvl) * 0.25; t += 0.06;
      ctx.clearRect(0, 0, w, h);
      // mirrored bars, tallest in the middle, each moving on its own
      const n = 36; const gap = w / n;
      ctx.fillStyle = sig; ctx.shadowColor = sig; ctx.shadowBlur = 10;
      for (let k = 0; k < n; k += 1) {
        const u = k / (n - 1);
        const env = 0.35 + 0.65 * Math.sin(Math.PI * u);
        const wob = 0.5 + 0.5 * Math.sin(t * (2.1 + (k % 5) * 0.37) + k * 1.7);
        const bh = Math.max(h * 0.08, h * env * (0.12 + lvl * 0.88 * wob));
        ctx.globalAlpha = 0.45 + 0.55 * env;
        const x = k * gap + gap * 0.3;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, (h - bh) / 2, gap * 0.4, bh, gap * 0.2) : ctx.rect(x, (h - bh) / 2, gap * 0.4, bh);
        ctx.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [on, levelRef]);
  return <canvas ref={ref} className={`cc2-wave ${on ? 'is-on' : ''}`} aria-hidden="true" />;
}

const seconds = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`);
const percent = (p) => (p == null ? '—' : `${p.toFixed(p === 100 ? 0 : 1)}%`);

export default function CommandCenterV2({
  open, onClose, onSwitchUi, contexts, context, isSending, onPickContext, muted, onToggleMute,
  orbState, orbLevelRef, mode, level, vitals, statusText, busy, micHint, listening, onToggleMic, flareKey,
  autoChip, convoTools, convoBody, buildProgress, pausedPill, composer, exportCard, overlays,
}) {
  const palette = useDianePalette();
  const rootRef = useRef(null);
  // where the orb sits: the middle of the free space above the dock (0..1)
  const orbSpaceRef = useRef(null);
  const anchorRef = useRef(null);
  // Stars was removed (his call 2026-10-10); a saved 'stars' falls back to Nebula
  const [orbStyle, setOrbStyle] = useState(() => { const v = read('diane.orbStyle', 'nebula'); return STYLES.some((x) => x.key === v) ? v : 'nebula'; });
  const pickStyle = (s) => { setOrbStyle(s); try { localStorage.setItem('diane.orbStyle', s); } catch { /* this tab only */ } };

  /**
   * THE PANELS TILT TOWARD THE MOUSE. Two CSS variables written straight to
   * the root, never through React state, so a mouse move costs no render.
   */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    let raf = 0;
    let x = 0; let y = 0; let tx = 0; let ty = 0;
    const onMove = (e) => { tx = (e.clientX / window.innerWidth) * 2 - 1; ty = (e.clientY / window.innerHeight) * 2 - 1; };
    const loop = () => {
      x += (tx - x) * 0.08; y += (ty - y) * 0.08;
      el.style.setProperty('--mx', x.toFixed(4));
      el.style.setProperty('--my', y.toFixed(4));
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    loop();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); };
  }, []);

  useEffect(() => {
    const el = orbSpaceRef.current;
    if (!el || !open) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      anchorRef.current = { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight };
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    measure();
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [open]);

  /**
   * THE SOUNDS (sfx.js): her moments, and every press. Muted with her voice.
   */
  useEffect(() => { sfx.setMuted(muted); }, [muted]);
  useEffect(() => {
    if (!open) return undefined;
    sfx.play('boot');
    if (!muted) sfx.ambient.start();
    return () => sfx.ambient.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { if (open && !muted) sfx.ambient.start(); }, [muted, open]);
  // her state moves the ambience: the hum lifts, the turning quickens
  useEffect(() => {
    sfx.ambient.setEnergy({ idle: 0.2, connecting: 0.45, listening: 0.5, thinking: 0.9, speaking: 0.7, error: 0.3, disabled: 0.05 }[orbState] ?? 0.2);
  }, [orbState]);
  const prev = useRef({ orbState, isSending, flareKey });
  useEffect(() => {
    const p = prev.current;
    if (orbState !== p.orbState) {
      if (orbState === 'listening') sfx.play('listenOn');
      else if (p.orbState === 'listening') sfx.play('listenOff');
      if (orbState === 'error') sfx.play('error');
    }
    if (isSending && !p.isSending) sfx.play('send');
    if (flareKey > (p.flareKey ?? 0)) sfx.play('answer');
    prev.current = { orbState, isSending, flareKey };
  }, [orbState, isSending, flareKey]);
  const onPress = (e) => {
    if (!muted) sfx.ambient.start();
    const b = e.target.closest?.('button');
    if (!b || b.disabled || b.type === 'submit') return;
    sfx.play(b.closest('.cc2-modes, .cc2-segment') ? 'switch' : 'tick');
  };
  const onHover = (e) => {
    const b = e.target.closest?.('button');
    if (b && !b.disabled && !(e.relatedTarget && b.contains(e.relatedTarget))) sfx.play('hover');
  };

  const vars = {
    '--sig': palette.signal, '--acc': palette.accent, '--hot': palette.hot ?? '#ffffff', '--dim': palette.dim, '--void': palette.void,
  };

  return (
    <div
      ref={rootRef}
      className={`cc2 fixed inset-0 z-30 ${open ? 'block' : 'hidden'} is-${orbState ?? 'idle'}`}
      style={vars}
      role="dialog"
      aria-modal="true"
      aria-label="Diane"
      onPointerDown={onPress}
      onPointerOver={onHover}
    >
      {/* ---- THE ROOM: one 3D scene behind everything ---- */}
      <div className="absolute inset-0">
        <Suspense fallback={<div className="absolute inset-0 bg-black" />}>
          <Scene3D
            colorFrom={palette.signal}
            colorTo={palette.accent}
            state={orbState}
            levelRef={orbLevelRef}
            style={orbStyle}
            active={open}
            flareKey={flareKey}
            onOrbClick={onToggleMic}
            anchorRef={anchorRef}
          />
        </Suspense>
        <div className="cc2-vignette" aria-hidden="true" />
      </div>

      {/* ---- THE FLOATING LAYER: panels at depth, tilting with the mouse ---- */}
      <div className="cc2-stage">
        {/* TOP: who she is, the time, the controls */}
        <header className="cc2-top cc2-depth-near">
          <div className="flex items-center gap-4 min-w-0">
            <div className="cc2-brand">
              <span className="cc2-brand-name">DIANE</span>
              <span className="cc2-brand-sub">Command Center · V2</span>
            </div>
            <div className={`cc2-status ${busy ? 'is-busy' : ''}`} aria-live="polite">
              <span className="cc2-status-dot" />
              <span className="truncate">{statusText}</span>
            </div>
          </div>
          <Clock />
          <div className="flex items-center gap-2 justify-end">
            <div className="cc2-segment" role="radiogroup" aria-label="Orb style">
              {STYLES.map((s) => (
                <button key={s.key} type="button" role="radio" aria-checked={orbStyle === s.key} onClick={() => pickStyle(s.key)} className={orbStyle === s.key ? 'is-on' : ''}>
                  {s.label}
                </button>
              ))}
            </div>
            <button type="button" className="cc2-chip" onClick={onSwitchUi} title="Back to the V1 command center">V1</button>
            <button type="button" className={`cc2-chip ${muted ? '' : 'is-on'}`} onClick={onToggleMute} aria-pressed={!muted} title={muted ? 'Unmute Diane' : 'Mute Diane'}>
              {muted ? 'Muted' : 'Voice'}
            </button>
            <button type="button" className="cc2-chip cc2-chip-strong" onClick={onClose} title="Go to portal">Portal</button>
          </div>
        </header>

        <div className="cc2-body">
          {/* LEFT: what she focuses on */}
          <nav className="cc2-modes cc2-depth-left" aria-label="What Diane focuses on" role="radiogroup">
            <span className="cc2-panel-label">Mode</span>
            {contexts.map((c) => {
              const on = c.key === context;
              return (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={c.soon || isSending}
                  onClick={() => { if (!on) onPickContext(c.key); }}
                  className={`cc2-mode ${on ? 'is-on' : ''} ${c.soon ? 'is-soon' : ''}`}
                  title={c.soon ? `${c.label}: coming soon` : `Focus on ${c.label}`}
                >
                  <span className="cc2-mode-glyph" />
                  <span className="cc2-mode-label">{c.label}</span>
                  {c.soon && <span className="cc2-mode-soon">soon</span>}
                </button>
              );
            })}
            <div className="cc2-vitals">
              <Readout label="Signal" value={`${Math.round((level ?? 0) * 100)}%`} />
              <Readout label="Response" value={seconds(vitals?.lastMs)} />
              <Readout label="Accuracy" value={percent(vitals?.accuracy)} />
              <Readout label="Turns" value={vitals?.turns ?? 0} />
            </div>
          </nav>

          {/* CENTRE: her. The orb is in the scene; this keeps her space and
              carries the readouts on her rings and the export card */}
          <section className="cc2-center">
            <div ref={orbSpaceRef} className="cc2-orb-space" aria-hidden="true">
              <span className="cc2-orb-tag cc2-orb-tag-top">{(mode ?? 'idle').toUpperCase()}</span>
              <span className="cc2-orb-tag cc2-orb-tag-left">{STYLES.find((s) => s.key === orbStyle)?.label.toUpperCase()}</span>
              <span className="cc2-orb-tag cc2-orb-tag-right">{listening ? 'LISTENING' : onToggleMic ? 'TAP TO TALK' : ''}</span>
            </div>
            {exportCard && <div className="cc2-export cc2-depth-near">{exportCard}</div>}
            <div className="cc2-dock cc2-depth-dock">
              {pausedPill}
              <div className="cc2-dock-row">
                <VoiceWave levelRef={orbLevelRef} on={listening || orbState === 'speaking'} />
                <span className={`cc2-wave-label ${listening || orbState === 'speaking' ? 'is-on' : ''}`}>{listening ? 'Listening' : 'Speaking'}</span>
                <div className="ml-auto">{autoChip}</div>
              </div>
              <div className={`cc2-composer ${listening ? 'is-listening' : ''} ${busy ? 'is-thinking' : ''}`}>
                {composer}
              </div>
              <p className="cc2-hint" aria-live="polite">{micHint ? `${micHint} Typing still works.` : ''}</p>
            </div>
          </section>

          {/* RIGHT: THE ORBIT STREAM (his pick 2026-10-10). No box: the
              conversation floats in the room. Her replies are transmissions,
              his words command echoes, and older turns tilt back into the
              dark (v2.css). No spine or beam: his call, he did not like the line. */}
          <aside className="cc2-stream cc2-depth-right" aria-label="Conversation">
            <div className="cc2-stream-head">
              <span className="cc2-panel-label">Transmissions</span>
              <div className="cc2-stream-tools">{convoTools}</div>
            </div>
            {convoBody}
            {buildProgress}
          </aside>
        </div>
      </div>

      {overlays}
    </div>
  );
}
