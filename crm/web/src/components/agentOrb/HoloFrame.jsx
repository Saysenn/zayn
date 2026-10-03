import { useDianePalette } from './DianePalette';

/**
 * The holographic frame around the login card — cut corners, bracket
 * accents, and the tick marks along each edge.
 *
 * Drawn as one SVG with `vectorEffect="non-scaling-stroke"` and
 * `preserveAspectRatio="none"`, so it stretches to whatever the card is
 * without the 1px lines thickening or the corner cuts distorting. A CSS
 * clip-path could shape the card but couldn't give the edge a visible
 * stroke, which is most of the look.
 */

const CUT = 26; // corner cut, in viewBox units

export default function HoloFrame({ className = '' }) {
  // The chosen theme's palette. See configs/themes.js.
  const palette = useDianePalette();
  const { tint } = palette;
  const edge = tint(0.75);
  const faint = tint(0.28);
  return (
    <svg
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
      viewBox="0 0 400 500"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      {/* The card body: an octagon, cut at all four corners. */}
      <path
        d={`M ${CUT} 2 H ${400 - CUT} L 398 ${CUT} V ${500 - CUT} L ${400 - CUT} 498
            H ${CUT} L 2 ${500 - CUT} V ${CUT} Z`}
        fill={tint(0.77, palette.panel)}
        stroke={edge}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />

      {/* A second, inset outline. One line reads as a border; two read as
          a machined panel. */}
      <path
        d={`M ${CUT + 6} 9 H ${394 - CUT} L 391 ${CUT + 6} V ${494 - CUT} L ${394 - CUT} 491
            H ${CUT + 6} L 9 ${494 - CUT} V ${CUT + 6} Z`}
        stroke={faint}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />

      {/* Bracket accents biting into each corner. */}
      {[
        `M 14 ${CUT + 30} V ${CUT + 4} L ${CUT + 4} 14 H ${CUT + 34}`,
        `M ${386 - 0} ${CUT + 30} V ${CUT + 4} L ${400 - CUT - 4} 14 H ${400 - CUT - 34}`,
        `M 14 ${500 - CUT - 30} V ${500 - CUT - 4} L ${CUT + 4} 486 H ${CUT + 34}`,
        `M 386 ${500 - CUT - 30} V ${500 - CUT - 4} L ${400 - CUT - 4} 486 H ${400 - CUT - 34}`,
      ].map((d, i) => (
        <path key={i} d={d} stroke={edge} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      ))}

      {/* Tick marks down both sides — the detail that makes the frame read
          as instrumentation rather than as a decorative border. */}
      {Array.from({ length: 9 }).map((_, i) => {
        const y = 120 + i * 30;
        return (
          <g key={y}>
            <line x1="4" y1={y} x2="10" y2={y} stroke={faint} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <line x1="390" y1={y} x2="396" y2={y} stroke={faint} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}

      {/* A bright seam at the bottom edge, where the card meets its own
          glow — the light source the whole panel appears to sit above. */}
      <line
        x1="150" y1="498" x2="250" y2="498"
        stroke={tint(0.9, palette.hot)} strokeWidth="2" vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
