export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

/**
 * Zoom toward a point, so the spot under the pointer stays where it is.
 * `view` is { scale, x, y } (x, y from the centre); back at 1 it is centred.
 */
export function zoomAt(view, nextScale, point) {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextScale));
  if (scale === MIN_ZOOM) return { scale, x: 0, y: 0 };
  const k = scale / view.scale;
  return { scale, x: point.x - (point.x - view.x) * k, y: point.y - (point.y - view.y) * k };
}
