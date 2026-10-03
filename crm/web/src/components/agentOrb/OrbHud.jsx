import { useDianePalette } from './DianePalette';

/**
 * The HUD framing around Diane's orb — corner brackets, dotted rails and
 * equator traces. Static marks only, nothing that animates.
 *
 * Pure CSS/SVG decoration layered around the WebGL canvas, deliberately
 * NOT drawn inside Three.js: it never moves, never reacts, and putting it
 * in the scene would mean re-rendering it 60 times a second for nothing.
 * `pointer-events-none` throughout so it can't eat a click meant for the
 * orb itself.
 */

// One L-shaped bracket. Rotated into each corner by the caller rather
// than four hand-written variants.
function Bracket({ className, style }) {
  const { tint } = useDianePalette();
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 26 26"
      fill="none"
      className={`absolute ${className}`}
      style={style}
      aria-hidden="true"
    >
      <path d="M1 9V1h8" stroke={tint(0.45)} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// A vertical column of dots flanking the orb. The middle ones are
// brighter, which reads as a signal-strength rail rather than a plain
// dotted line.
function DotRail({ side }) {
  const { tint } = useDianePalette();
  const dots = Array.from({ length: 13 });
  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 flex flex-col gap-[7px] ${
        side === 'left' ? 'left-1' : 'right-1'
      }`}
      aria-hidden="true"
    >
      {dots.map((_, i) => {
        const centre = 1 - Math.abs(i - 6) / 6;
        return (
          <span
            key={i}
            className="w-[3px] h-[3px] rounded-full"
            style={{ background: tint(0.15 + centre * 0.55) }}
          />
        );
      })}
    </div>
  );
}

export default function OrbHud({ children }) {
  const { tint } = useDianePalette();
  const faint = tint(0.22);
  return (
    <div className="relative w-full h-full pointer-events-none">
      {/* The orb itself. Only this layer takes pointer events, so hovering
          and clicking the orb still works through the framing. */}
      <div className="absolute inset-0 pointer-events-auto">{children}</div>

      <Bracket className="top-3 left-3" />
      <Bracket className="top-3 right-3" style={{ transform: 'rotate(90deg)' }} />
      <Bracket className="bottom-3 right-3" style={{ transform: 'rotate(180deg)' }} />
      <Bracket className="bottom-3 left-3" style={{ transform: 'rotate(270deg)' }} />

      <DotRail side="left" />
      <DotRail side="right" />

      {/* Horizontal trace lines running out of the orb's equator, fading
          to nothing at the edges — the "signal" reading of the reference. */}
      <div
        className="absolute top-1/2 left-0 h-px w-[22%]"
        style={{ background: `linear-gradient(to right, transparent, ${faint})` }}
        aria-hidden="true"
      />
      <div
        className="absolute top-1/2 right-0 h-px w-[22%]"
        style={{ background: `linear-gradient(to left, transparent, ${faint})` }}
        aria-hidden="true"
      />

    </div>
  );
}
