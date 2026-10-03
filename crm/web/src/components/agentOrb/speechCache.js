// ***************************************************
// * Speech made before it is said
// ***************************************************
// The loading screen starts her greeting's audio so the welcome page opens on
// her voice, not on seconds of silence: the voice service takes 3 to 9 seconds
// a request. 2026-09-28. Taken once, so a later line never replays it.

const primed = new Map();

/** Leaves a pending audio request for `text`, for the next speak() of it. */
export function primeSpeech(text, request) {
  primed.set(text, request);
}

/** The pending request for `text`, once, or undefined. */
export function takePrimed(text) {
  const request = primed.get(text);
  primed.delete(text);
  return request;
}
