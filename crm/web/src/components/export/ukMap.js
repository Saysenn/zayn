/**
 * A simplified map of Great Britain for the Drivers tab: its coast as one
 * SVG path, a few cities for bearings, and the projection that places a
 * latitude and longitude on it. Accurate enough to tell Birmingham from
 * Newcastle, which is all the tab needs.
 */
export const MAP_W = 460;
export const MAP_H = 560;
const PAD = 18;
const LON0 = -6.4;
const LON1 = 1.9;
const LAT0 = 49.8;
const LAT1 = 58.8;
const K = Math.cos((54.3 * Math.PI) / 180);
const S = Math.min((MAP_W - PAD * 2) / ((LON1 - LON0) * K), (MAP_H - PAD * 2) / (LAT1 - LAT0));

/** [lat, lon] -> [x, y] on the map. */
export function projectUk(lat, lon) {
  return [PAD + (lon - LON0) * K * S, PAD + (LAT1 - lat) * S];
}

// [lon, lat], clockwise from Dover.
const COAST = [[1.40,51.15],[1.45,51.38],[0.70,51.50],[0.95,51.62],[1.30,51.95],[1.75,52.47],[1.70,52.75],[1.20,52.96],[0.40,52.90],[0.25,53.10],[0.35,53.45],[0.10,53.62],[-0.10,54.10],[-0.60,54.48],[-1.15,54.62],[-1.35,54.95],[-1.50,55.20],[-1.62,55.58],[-2.00,55.80],[-2.55,56.00],[-3.00,56.05],[-2.60,56.30],[-2.50,56.60],[-2.05,57.15],[-1.80,57.50],[-2.40,57.67],[-3.40,57.70],[-4.20,57.50],[-3.80,57.85],[-3.10,58.30],[-3.05,58.62],[-4.00,58.58],[-5.00,58.62],[-5.30,58.20],[-5.70,57.85],[-5.60,57.30],[-5.80,56.90],[-6.20,56.70],[-5.50,56.35],[-5.70,55.80],[-5.60,55.30],[-4.90,55.70],[-4.65,55.45],[-5.00,55.00],[-5.10,54.65],[-4.40,54.75],[-3.60,54.90],[-3.40,54.60],[-3.20,54.10],[-2.90,53.75],[-3.05,53.42],[-3.40,53.35],[-4.10,53.30],[-4.65,53.30],[-4.60,52.90],[-4.10,52.60],[-4.10,52.30],[-4.70,52.10],[-5.25,51.85],[-5.00,51.65],[-4.30,51.65],[-3.80,51.55],[-3.20,51.40],[-2.70,51.55],[-3.00,51.25],[-3.60,51.22],[-4.25,51.18],[-4.55,50.95],[-5.10,50.55],[-5.70,50.05],[-5.20,49.96],[-4.60,50.30],[-4.10,50.35],[-3.50,50.20],[-3.40,50.62],[-2.95,50.70],[-2.45,50.58],[-1.95,50.70],[-1.30,50.78],[-0.80,50.75],[-0.10,50.80],[0.30,50.75],[0.95,50.95],[1.40,51.15]];

const COAST_XY = COAST.slice(0, -1).map(([lon, lat]) => projectUk(lat, lon));

/**
 * THE COAST AS CURVES, not straight lines between the points. A closed
 * Catmull-Rom spline through the very same points, written as cubic
 * Beziers: the outline keeps its shape and loses its corners.
 */
function smoothClosed(pts, tension = 0.5) {
  const n = pts.length;
  const at = (i) => pts[(i + n) % n];
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + ((p2[0] - p0[0]) * tension) / 3, p1[1] + ((p2[1] - p0[1]) * tension) / 3];
    const c2 = [p2[0] - ((p3[0] - p1[0]) * tension) / 3, p2[1] - ((p3[1] - p1[1]) * tension) / 3];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

export const UK_COAST = smoothClosed(COAST_XY);

export const UK_CITIES = [
  { name: 'London', lat: 51.51, lon: -0.12 }, { name: 'Birmingham', lat: 52.48, lon: -1.89 },
  { name: 'Manchester', lat: 53.48, lon: -2.24 }, { name: 'Leeds', lat: 53.8, lon: -1.55 },
  { name: 'Liverpool', lat: 53.41, lon: -2.98 }, { name: 'Newcastle', lat: 54.97, lon: -1.61 },
  { name: 'Glasgow', lat: 55.86, lon: -4.25 }, { name: 'Edinburgh', lat: 55.95, lon: -3.19 },
  { name: 'Cardiff', lat: 51.48, lon: -3.18 },
  { name: 'Norwich', lat: 52.63, lon: 1.3 },
];
