// ***************************************************
// * A line through points, drawn as a curve
// ***************************************************
//
// The trend was a polyline: straight segments meeting at hard corners, which
// reads as a diagram rather than the soft wave the KPI cards are drawn with.
//
// MONOTONE CUBIC, not a plain spline. A smooth curve through money must
// never bulge past the points it joins: an ordinary Catmull-Rom dips below
// the lowest point on a fall, so a month that earned 3,510 would be drawn
// crossing zero. This one is flat wherever the direction changes, so the
// curve stays inside the values on both sides. It is what d3 calls
// curveMonotoneX, written out rather than pulled in.

// Past this the tangents are scaled back. Fritsch and Carlson's condition:
// a and b are the tangents as multiples of the segment slope, and the curve
// stays monotone while they sit inside a circle of radius 3.
const MONOTONE_LIMIT = 9;

/**
 * Fritsch-Carlson tangents: the average slope at each point, pulled back
 * wherever it would make the curve overshoot.
 */
function tangents(points) {
  const last = points.length - 1;
  const slopes = [];
  for (let i = 0; i < last; i += 1) {
    const run = points[i + 1].x - points[i].x;
    slopes.push(run === 0 ? 0 : (points[i + 1].y - points[i].y) / run);
  }

  const m = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === last) return slopes[last - 1];
    // FLAT AT EVERY TURN. Averaging the two slopes across a peak or a
    // trough leaves a tangent pointing the wrong way for one of them, and
    // the curve leaves the segment before it comes back: a 190 to 188 fall
    // was drawn reaching 190.11 first.
    if (slopes[i - 1] * slopes[i] <= 0) return 0;
    return (slopes[i - 1] + slopes[i]) / 2;
  });

  for (let i = 0; i < last; i += 1) {
    if (slopes[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slopes[i];
    const b = m[i + 1] / slopes[i];
    const size = a * a + b * b;
    if (size > MONOTONE_LIMIT) {
      const scale = 3 / Math.sqrt(size);
      m[i] = scale * a * slopes[i];
      m[i + 1] = scale * b * slopes[i];
    }
  }
  return m;
}

const round = (value) => Math.round(value * 100) / 100;

/**
 * An SVG path `d` through every point, in order.
 *
 * One point draws nothing, the way a one point polyline did. Two or more
 * are joined by cubic segments whose handles are a third of the way across
 * each gap, which is the standard Hermite to Bezier conversion.
 *
 * @param {{x:number, y:number}[]} points
 */
export function smoothPath(points) {
  if (!points || points.length < 2) return '';
  const m = tangents(points);
  let d = `M${round(points[0].x)},${round(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    const third = (to.x - from.x) / 3;
    d += `C${round(from.x + third)},${round(from.y + (m[i] * third))}`
      + ` ${round(to.x - third)},${round(to.y - (m[i + 1] * third))}`
      + ` ${round(to.x)},${round(to.y)}`;
  }
  return d;
}

/**
 * The same curve, closed down to a baseline: the soft wash under a line.
 *
 * It reuses `smoothPath` rather than curving again, so the top of the fill
 * and the line over it can never disagree by a pixel.
 */
export function smoothArea(points, baseline) {
  const line = smoothPath(points);
  if (!line) return '';
  return `${line}L${round(points.at(-1).x)},${round(baseline)}L${round(points[0].x)},${round(baseline)}Z`;
}
