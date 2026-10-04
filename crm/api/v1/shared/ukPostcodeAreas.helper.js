/**
 * WHERE A UK POSTCODE IS, to the nearest postcode area.
 *
 * The driver sheet's map places each location by the postcodes on its rows
 * ("B69 1TR" is Birmingham, "NE12 8HY" Newcastle), because the location
 * itself is the boss's own code name ("Chip county", "Geordie") and says
 * nothing about where it is. Area level is all a map of Great Britain
 * needs, so this is a fixed table and never a lookup: no network, no key.
 *
 * Centres are approximate (the area's main town), in decimal degrees.
 */
const AREAS = Object.freeze({
  AB: [57.15, -2.2], AL: [51.75, -0.33], B: [52.48, -1.9], BA: [51.38, -2.36], BB: [53.75, -2.48],
  BD: [53.8, -1.76], BH: [50.72, -1.88], BL: [53.58, -2.43], BN: [50.83, -0.14], BR: [51.4, 0.02],
  BS: [51.45, -2.59], BT: [54.6, -5.93], CA: [54.89, -2.93], CB: [52.2, 0.12], CF: [51.48, -3.18],
  CH: [53.19, -2.89], CM: [51.73, 0.47], CO: [51.89, 0.9], CR: [51.37, -0.1], CT: [51.28, 1.08],
  CV: [52.41, -1.51], CW: [53.1, -2.44], DA: [51.45, 0.21], DD: [56.46, -2.97], DE: [52.92, -1.48],
  DG: [55.07, -3.61], DH: [54.78, -1.57], DL: [54.52, -1.55], DN: [53.52, -1.13], DT: [50.71, -2.44],
  DY: [52.51, -2.09], E: [51.53, -0.05], EC: [51.52, -0.09], EH: [55.95, -3.19], EN: [51.65, -0.08],
  EX: [50.72, -3.53], FK: [56.0, -3.78], FY: [53.82, -3.05], G: [55.86, -4.25], GL: [51.86, -2.24],
  GU: [51.24, -0.57], GY: [49.45, -2.54], HA: [51.58, -0.34], HD: [53.65, -1.78], HG: [54.0, -1.54],
  HP: [51.75, -0.66], HR: [52.06, -2.72], HS: [58.21, -6.39], HU: [53.74, -0.33], HX: [53.72, -1.86],
  IG: [51.56, 0.08], IM: [54.15, -4.48], IP: [52.06, 1.16], IV: [57.48, -4.22], JE: [49.21, -2.13],
  KA: [55.61, -4.5], KT: [51.41, -0.3], KW: [58.44, -3.09], KY: [56.11, -3.16], L: [53.41, -2.98],
  LA: [54.05, -2.8], LD: [52.24, -3.38], LE: [52.64, -1.13], LL: [53.12, -3.8], LN: [53.23, -0.54],
  LS: [53.8, -1.55], LU: [51.88, -0.42], M: [53.48, -2.24], ME: [51.37, 0.52], MK: [52.04, -0.76],
  ML: [55.78, -3.98], N: [51.57, -0.11], NE: [54.97, -1.61], NG: [52.95, -1.15], NN: [52.24, -0.9],
  NP: [51.59, -2.99], NR: [52.63, 1.3], NW: [51.55, -0.18], OL: [53.54, -2.12], OX: [51.75, -1.26],
  PA: [55.85, -4.42], PE: [52.57, -0.24], PH: [56.4, -3.43], PL: [50.38, -4.14], PO: [50.8, -1.09],
  PR: [53.76, -2.7], RG: [51.45, -0.97], RH: [51.23, -0.2], RM: [51.57, 0.18], S: [53.38, -1.47],
  SA: [51.62, -3.94], SE: [51.47, -0.06], SG: [51.9, -0.2], SK: [53.41, -2.15], SL: [51.51, -0.59],
  SM: [51.36, -0.19], SN: [51.56, -1.78], SO: [50.9, -1.4], SP: [51.07, -1.79], SR: [54.91, -1.38],
  SS: [51.54, 0.71], ST: [53.0, -2.18], SW: [51.46, -0.17], SY: [52.71, -2.75], TA: [51.02, -3.1],
  TD: [55.6, -2.43], TF: [52.68, -2.45], TN: [51.13, 0.26], TQ: [50.46, -3.53], TR: [50.26, -5.05],
  TS: [54.57, -1.23], TW: [51.45, -0.34], UB: [51.53, -0.45], W: [51.51, -0.2], WA: [53.39, -2.59],
  WC: [51.52, -0.12], WD: [51.66, -0.4], WF: [53.68, -1.5], WN: [53.55, -2.63], WR: [52.19, -2.22],
  WS: [52.58, -1.98], WV: [52.59, -2.13], YO: [53.96, -1.08], ZE: [60.15, -1.15],
});

// The outward code at the front of a postcode: one or two letters, then a
// digit. "In person meet", "Brum" and "Handled internally" are not one.
const OUTWARD = /^\s*([A-Z]{1,2})\d[A-Z\d]?\b/i;

/** "B69 1TR" -> { area: 'B', lat, lon }, or null when it is not a UK postcode. */
function areaOf(postcode) {
  const m = OUTWARD.exec(String(postcode ?? ''));
  if (!m) return null;
  const area = m[1].toUpperCase();
  const at = AREAS[area];
  return at ? { area, lat: at[0], lon: at[1] } : null;
}

/** Straight-line distance in km, for "this postcode is nowhere near its location". */
function kmBetween(a, b) {
  const R = 6371;
  const t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t;
  const dLon = (b.lon - a.lon) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = { AREAS, areaOf, kmBetween };
