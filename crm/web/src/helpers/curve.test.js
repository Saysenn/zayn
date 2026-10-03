import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothPath, smoothArea } from './curve.js';

// Walk the cubic the path describes, so the assertions are about the CURVE
// that gets drawn rather than about the string it is written as.
function cubicAt(from, c1, c2, to, t) {
  const u = 1 - t;
  return (u * u * u * from) + (3 * u * u * t * c1) + (3 * u * t * t * c2) + (t * t * t * to);
}

function segments(d) {
  const [start, ...rest] = d.split('C');
  const first = start.slice(1).split(',').map(Number);
  let cursor = { x: first[0], y: first[1] };
  return rest.map((chunk) => {
    const [c1, c2, end] = chunk.trim().split(' ').map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
    const segment = { from: cursor, c1, c2, to: end };
    cursor = end;
    return segment;
  });
}

test('a single point draws nothing, the way a one point polyline did', () => {
  assert.equal(smoothPath([{ x: 1, y: 2 }]), '');
  assert.equal(smoothPath([]), '');
  assert.equal(smoothPath(null), '');
  assert.equal(smoothArea([{ x: 1, y: 2 }], 100), '');
});

test('the curve passes through every point it is given', () => {
  const points = [{ x: 0, y: 90 }, { x: 50, y: 20 }, { x: 100, y: 60 }, { x: 150, y: 10 }];
  const drawn = segments(smoothPath(points));

  assert.equal(drawn.length, 3);
  drawn.forEach((segment, index) => {
    assert.deepEqual(segment.from, points[index]);
    assert.deepEqual(segment.to, points[index + 1]);
  });
});

// ===============================
// * A CURVE THROUGH MONEY NEVER BULGES PAST ITS POINTS
// ===============================
// An ordinary spline dips below the lowest point on a fall. On this chart
// that draws a month crossing zero it never went near.
test('the curve stays inside the two values it joins', () => {
  const points = [{ x: 0, y: 10 }, { x: 50, y: 10 }, { x: 100, y: 190 }, { x: 150, y: 188 }];

  for (const { from, c1, c2, to } of segments(smoothPath(points))) {
    const low = Math.min(from.y, to.y);
    const high = Math.max(from.y, to.y);
    for (let t = 0; t <= 1; t += 0.02) {
      const y = cubicAt(from.y, c1.y, c2.y, to.y, t);
      assert.ok(y >= low - 0.01 && y <= high + 0.01, `y ${y} escaped ${low}..${high}`);
    }
  }
});

// The three currency lines share an axis, and the smallest sits near zero.
// A curve that undershoots there would be drawn below the baseline.
test('a flat line near the bottom stays flat', () => {
  const flat = [{ x: 0, y: 180 }, { x: 60, y: 180 }, { x: 120, y: 180 }];
  for (const { from, c1, c2, to } of segments(smoothPath(flat))) {
    for (let t = 0; t <= 1; t += 0.1) {
      assert.equal(Math.round(cubicAt(from.y, c1.y, c2.y, to.y, t)), 180);
    }
  }
});

test('the area is the same curve, closed to the baseline', () => {
  const points = [{ x: 0, y: 90 }, { x: 50, y: 20 }, { x: 100, y: 60 }];
  const line = smoothPath(points);
  const area = smoothArea(points, 200);

  assert.ok(area.startsWith(line), 'the fill and the line must not disagree by a pixel');
  assert.equal(area.slice(line.length), 'L100,200L0,200Z');
});
