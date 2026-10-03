import { useDianePalette } from './DianePalette';

/**
 * The digital space Diane exists in — grid, scanlines, edge rails and
 * stray HUD marks.
 *
 * Everything here sits between about 0.03 and 0.15 opacity on purpose.
 * It should be noticed subconsciously: the difference between "an orb on
 * a black page" and "a place". Anything brighter starts competing with
 * Diane herself, which is the one thing this must not do.
 *
 * Pure CSS/SVG, never in the WebGL scene: none of it moves per-frame, so
 * paying for it in the render loop would buy nothing.
 */

// A vertical run of ticks and dots, mirrored down both screen edges.
function EdgeRail({ side }) {
  const { tint } = useDianePalette();
  return (
    <div
      className={`absolute top-0 bottom-0 w-8 hidden md:flex flex-col items-center justify-center gap-2 ${
        side === 'left' ? 'left-3' : 'right-3'
      }`}
      aria-hidden="true"
    >
      {Array.from({ length: 22 }).map((_, i) => {
        // Brighter through the middle, so it reads as a gauge rather than
        // an evenly dotted line.
        const centre = 1 - Math.abs(i - 11) / 11;
        return (
          <span
            key={i}
            className="rounded-full"
            style={{
              width: i % 5 === 0 ? '10px' : '3px',
              height: i % 5 === 0 ? '1px' : '3px',
              background: tint(0.08 + centre * 0.32),
            }}
          />
        );
      })}
    </div>
  );
}

// An L-bracket, rotated into each screen corner.
function CornerBracket({ className, rotate }) {
  const { tint } = useDianePalette();
  return (
    <svg
      width="90" height="90" viewBox="0 0 90 90" fill="none"
      className={`absolute ${className} hidden sm:block`}
      style={{ transform: `rotate(${rotate}deg)` }}
      aria-hidden="true"
    >
      <path d="M2 40 V10 A8 8 0 0 1 10 2 H40" stroke={tint(0.3)} strokeWidth="1.5" />
      <path d="M14 52 V22 A4 4 0 0 1 18 18 H48" stroke={tint(0.16)} strokeWidth="1" />
      <circle cx="56" cy="10" r="1.6" fill={tint(0.5)} />
      <circle cx="64" cy="10" r="1.6" fill={tint(0.25)} />
      <path d="M2 56 H26" stroke={tint(0.2)} strokeWidth="1" />
    </svg>
  );
}

export default function DianeEnvironment() {
  const palette = useDianePalette();
  const { tint } = palette;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Technical grid. Two layers at different scales so it doesn't read
          as graph paper. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            `linear-gradient(${tint(0.045)} 1px, transparent 1px), linear-gradient(90deg, ${tint(0.045)} 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            `linear-gradient(${tint(0.03)} 1px, transparent 1px), linear-gradient(90deg, ${tint(0.03)} 1px, transparent 1px)`,
          backgroundSize: '16px 16px',
        }}
      />

      {/* Scanlines — very fine, very faint. Gives the whole page the
          texture of a display rather than a flat background. A palette may
          turn them off: the command center is a calmer, corporate room. */}
      {palette.scanlines !== false && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-linear-gradient(0deg, ${tint(0.035)} 0px, ${tint(0.035)} 1px, transparent 1px, transparent 3px)`,
          }}
        />
      )}

      {/* A faint glow in the orb's own colours, where a palette names them. */}
      {palette.ambientFrom && (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 55% 45% at 30% 35%, ${tint(0.14, palette.ambientFrom)} 0%, transparent 70%), `
              + `radial-gradient(ellipse 50% 40% at 72% 60%, ${tint(0.1, palette.ambientTo)} 0%, transparent 70%)`,
          }}
        />
      )}

      {/* Vignette, pulling focus to the centre and letting the grid fade
          out at the edges rather than stopping abruptly. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            `radial-gradient(ellipse 70% 60% at 50% 40%, transparent 0%, ${tint(0.02)} 40%, ${palette.void} 100%)`,
        }}
      />

      <EdgeRail side="left" />
      <EdgeRail side="right" />

      <CornerBracket className="top-4 left-4" rotate={0} />
      <CornerBracket className="top-4 right-4" rotate={90} />
      <CornerBracket className="bottom-4 right-4" rotate={180} />
      <CornerBracket className="bottom-4 left-4" rotate={270} />
    </div>
  );
}
