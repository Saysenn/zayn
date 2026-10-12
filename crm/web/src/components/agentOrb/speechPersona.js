// ***************************************************
// * Whose voice she speaks in
// ***************************************************
// Lawyer mode has its own voice (his call 2026-10-12: a strong woman, coral).
// The overlay sets it as the context changes; every speech request reads it.

let persona = null;

/** 'lawyer' in lawyer mode, null for her usual voice. */
export function setSpeechPersona(next) {
  persona = next === 'lawyer' ? 'lawyer' : null;
}

export function speechPersona() {
  return persona;
}
