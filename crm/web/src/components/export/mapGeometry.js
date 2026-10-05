// ***************************************************
// * The run regions, as shapes rather than squares
// ***************************************************

/**
 * EVERY BIT OF LAND TAKES THE RUN OF ITS NEAREST LOCATION, so the map reads
 * as areas. That is a Voronoi diagram, and this builds it the plain way:
 * each location's cell starts as the whole map and is cut down by the
 * half-plane nearer to it than to every other location. A few dozen
 * locations makes that a few thousand cheap cuts.
 *
 * It replaced a grid of 3px squares, which is where the stair-step edges
 * came from. A polygon is smooth at every zoom.
 *
 * Each edge remembers which neighbour cut it, so the borders BETWEEN two
 * runs can be drawn and the ones inside a run left out.
 */

/** Cut a polygon to the side of a line nearer `a` than `b`. */
function cut(poly, a, b, by) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const nx = b.x - a.x;
  const ny = b.y - a.y;
  // Positive is on b's side.
  const side = (p) => (p.x - mx) * nx + (p.y - my) * ny;
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp <= 0) !== (sq <= 0)) {
      const t = sp / (sp - sq);
      // The new point starts the edge along the cut, so it carries `by`;
      // a point where the cut LEAVES carries on the edge it was on.
      out.push({
        x: p.x + (q.x - p.x) * t,
        y: p.y + (q.y - p.y) * t,
        edge: sp <= 0 ? by : p.edge,
      });
    }
  }
  return out;
}

/**
 * @param sites  [{ x, y, run }]
 * @returns cells: [{ run, points: [[x,y]...] }], borders: [[x1,y1,x2,y2]...]
 *          where a border separates two different runs.
 */
export function runRegions(sites, width, height) {
  // Two locations on the same spot have no line between them: the first keeps it.
  const seen = new Set();
  const live = sites.filter((s) => {
    const key = `${s.x.toFixed(2)},${s.y.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const frame = [
    { x: -1, y: -1, edge: -1 }, { x: width + 1, y: -1, edge: -1 },
    { x: width + 1, y: height + 1, edge: -1 }, { x: -1, y: height + 1, edge: -1 },
  ];
  const polys = live.map((a, i) => {
    let poly = frame;
    for (let j = 0; j < live.length && poly.length; j += 1) {
      if (j !== i) poly = cut(poly, a, live[j], j);
    }
    return poly;
  });

  const cells = polys
    .map((poly, i) => ({ run: live[i].run, points: poly.map((p) => [p.x, p.y]) }))
    .filter((c) => c.points.length > 2);

  const borders = [];
  polys.forEach((poly, i) => {
    for (let n = 0; n < poly.length; n += 1) {
      const p = poly[n];
      const j = p.edge;
      if (j < 0 || j < i) continue; // each shared edge once, from the lower index
      if (live[j].run === live[i].run) continue;
      const q = poly[(n + 1) % poly.length];
      borders.push([p.x, p.y, q.x, q.y]);
    }
  });
  return { cells, borders };
}
