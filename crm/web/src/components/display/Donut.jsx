import { useTheme } from '../../hooks/useTheme';

// ***************************************************
// * One ring, two uses
// ***************************************************
//
// Deals by Stage and Forecast Performance both drew their own
// conic-gradient with the hex inline. A conic has no gaps between segments,
// so two adjacent slices read as one, and it cannot be given a track.

const SIZE = 128;
const THICKNESS = 15;
// The gap between two slices, in px of arc. Dropped when a slice would be
// shorter than the gap itself, which is what turned 1% slices into nothing.
const GAP = 4;

// `total` is for a ring that is a PROPORTION rather than a breakdown: pass
// 100 and one segment and the rest of the ring stays as track.
//
// `onSelect` makes each slice a POINTER affordance, never a focusable one:
// the svg is aria-hidden, so a button in here would be a tab stop nothing
// announces. Whatever calls it owes the keyboard the same destination in
// readable markup beside the ring.
export default function Donut({ segments, total: given, size = SIZE, thickness = THICKNESS, track: givenTrack, onSelect, children }) {
  // SVG cannot read a token, so the theme's value. See configs/themes.js.
  const { theme } = useTheme();
  const track = givenTrack ?? theme.chart.track;
  const drawable = segments.filter((segment) => Number(segment.value) > 0);
  const total = given ?? drawable.reduce((sum, segment) => sum + Number(segment.value), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = drawable.length > 1 ? GAP : 0;

  let travelled = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={thickness} />
        {total > 0 && drawable.map((segment) => {
          const length = (Number(segment.value) / total) * circumference;
          const dash = Math.max(length > gap ? length - gap : length, 0);
          const offset = travelled;
          travelled += length;
          return (
            <circle
              key={segment.key ?? segment.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              // A real draw, not a fade standing in for one: the ring knows
              // its own circumference, so it can start from empty.
              // `color` is what the hover glow is drawn in, so a lit slice
              // can never glow a different green from the arc it is.
              className={`chart-ring${onSelect ? ' chart-slice' : ''}`}
              style={{
                '--draw-from': String(circumference - offset),
                ...(onSelect ? { color: segment.color } : null),
              }}
              onClick={onSelect ? () => onSelect(segment) : undefined}
            />
          );
        })}
      </svg>
      {/* POINTER EVENTS OFF. This box is `inset-0`, so it covers the ring
          as well as the hole and swallowed every hover and click a slice
          was meant to get. Nothing in here is interactive. */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
