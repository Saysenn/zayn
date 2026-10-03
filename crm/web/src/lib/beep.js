// A short, generated tone — no audio file to bundle or fetch. Browsers block
// audio before any user gesture has happened on the page; by the time this
// ever fires, the admin has already clicked to log in, so the AudioContext
// is allowed to run.
export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => ctx.close();
  } catch {
    // audio isn't available/allowed — a missed sound is not worth erroring over
  }
}
