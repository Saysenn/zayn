export const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

/**
 * ===============================
 * * ONE LINE ACROSS THE WHOLE RANGE
 * ===============================
 *
 * The chart drew a polyline per SOURCE, and a month carries exactly one:
 * saved, live, or forecast. With a one month horizon every series was a
 * single point, and a polyline of one point draws nothing, so the chart was
 * five dots and no lines at all.
 *
 * There is really one series, and the only thing that changes is whether a
 * stretch of it is forecast. A run of adjacent months of the same kind is
 * one polyline; where the kind changes the new run is SEEDED with the last
 * point of the old one, so solid and dashed meet instead of leaving a gap.
 * A missing month breaks the line, which is the one gap that means
 * something.
 *
 * @param {{index:number, forecast:boolean}[]} points in month order, finite only
 */
export function lineRuns(points) {
  const runs = [];
  let previous = null;
  for (const point of points) {
    const adjacent = previous !== null && point.index === previous.index + 1;
    if (!adjacent) {
      runs.push({ forecast: point.forecast, points: [point] });
    } else if (previous.forecast === point.forecast) {
      runs.at(-1).points.push(point);
    } else {
      runs.push({ forecast: point.forecast, points: [previous, point] });
    }
    previous = point;
  }
  return runs.filter((run) => run.points.length > 1);
}

/**
 * Drop months with nothing in them from BOTH ENDS of the range.
 *
 * "Past 3 months" asks for three whether or not a snapshot was ever saved
 * for them, so the chart opened with two full height grey blocks and no
 * data. A gap in the MIDDLE stays: between two real months it is a fact
 * about the history, and the line is meant to break there.
 */
export function trimEdges(rows) {
  let start = 0;
  let end = rows.length - 1;
  while (start <= end && rows[start].unavailable) start += 1;
  while (end >= start && rows[end].unavailable) end -= 1;
  return rows.slice(start, end + 1);
}

export function scaleFor(values) {
  const finiteValues = values.filter(finite).map(Number);
  if (finiteValues.length === 0) return { min: 0, max: 1 };
  let min = Math.min(...finiteValues, 0);
  let max = Math.max(...finiteValues, 0);
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.1, 1);
    min -= padding;
    max += padding;
  }
  return { min, max };
}
