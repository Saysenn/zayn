// ***************************************************
// * COMMAND CENTER V2 SOUNDS (his call 2026-10-10: "proper sound effects")
// ***************************************************
//
// Synthesised live with Web Audio: no files to fetch, nothing to install,
// each one a few lines of oscillators and noise. Quiet on purpose: they
// confirm, they never compete with her voice. Mute (Voice / Muted) silences
// them too. The browser only allows audio after a first click or key, so
// anything before that is dropped silently.

let ctx = null;
let master = null;
let muted = false;
let lastHover = 0;

function audio() {
  if (muted || typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      // a little room, so the sounds sit in the same space as the orb
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    }
    // resume() settles a moment later; sounds scheduled now play once it
    // does (before his first press it stays suspended and they are silent)
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx.state === 'closed' ? null : ctx;
  } catch { return null; }
}

function tone(c, { type = 'sine', from, to = from, at = 0, dur = 0.12, vol = 0.5, attack = 0.005 }) {
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(c, { at = 0, dur = 0.3, vol = 0.2, from = 400, to = 4000, q = 1.2 }) {
  const t = c.currentTime + at;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

const SOUNDS = {
  // the command center powers up
  boot(c) {
    noise(c, { dur: 0.9, vol: 0.18, from: 200, to: 6000 });
    tone(c, { type: 'sawtooth', from: 55, to: 110, dur: 0.9, vol: 0.08, attack: 0.3 });
    [523, 659, 784, 1047].forEach((f, i) => tone(c, { from: f, at: 0.35 + i * 0.07, dur: 0.5, vol: 0.12 }));
  },
  // a button, a chip
  tick(c) { tone(c, { type: 'triangle', from: 2200, to: 1400, dur: 0.05, vol: 0.18 }); },
  // the pointer passing over something it can press
  hover(c) { tone(c, { from: 3200, dur: 0.025, vol: 0.04 }); },
  // a mode or orb style changes
  switch(c) {
    tone(c, { type: 'triangle', from: 660, to: 990, dur: 0.12, vol: 0.2 });
    tone(c, { from: 1320, at: 0.08, dur: 0.18, vol: 0.12 });
  },
  // his message leaves
  send(c) {
    noise(c, { dur: 0.22, vol: 0.12, from: 1200, to: 7000, q: 2 });
    tone(c, { type: 'sine', from: 600, to: 1800, dur: 0.18, vol: 0.18 });
  },
  // her answer lands
  answer(c) {
    [880, 1318, 1760].forEach((f, i) => tone(c, { from: f, at: i * 0.06, dur: 0.6, vol: 0.12 - i * 0.025 }));
    noise(c, { dur: 0.5, vol: 0.05, from: 5000, to: 9000, q: 4 });
  },
  // she starts listening / stops
  listenOn(c) { tone(c, { from: 520, to: 1040, dur: 0.16, vol: 0.2 }); tone(c, { from: 1560, at: 0.1, dur: 0.12, vol: 0.1 }); },
  listenOff(c) { tone(c, { from: 1040, to: 480, dur: 0.18, vol: 0.18 }); },
  // something went wrong
  error(c) {
    tone(c, { type: 'square', from: 220, dur: 0.12, vol: 0.08 });
    tone(c, { type: 'square', from: 165, at: 0.14, dur: 0.2, vol: 0.08 });
  },
};

/**
 * HER AMBIENCE: the sound of the orb turning (his call 2026-10-10: "as it
 * rotates there should be a subtle sound"). Always on while V2 is open,
 * barely there:
 *   - a warm low hum, two voices a few cents apart so it slowly beats;
 *   - air through a filter swept round once per turn of the orb: a whoosh
 *     that comes and goes with the rotation;
 *   - now and then a soft high chime from a pentatonic, like light catching.
 * Her energy (thinking, speaking, listening) lifts the hum and opens the air.
 */
const PENTA = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093];
const ambient = {
  nodes: null,
  energy: 0.25,
  chimeTimer: 0,
  start() {
    const c = audio();
    if (!c || this.nodes) return;
    const out = c.createGain();
    out.gain.value = 0.0001;
    out.connect(master);
    out.gain.exponentialRampToValueAtTime(1, c.currentTime + 2.5);

    // the hum
    const hum = c.createGain();
    hum.gain.value = 0.11;
    const humFilter = c.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 320;
    hum.connect(humFilter).connect(out);
    const voices = [[65.4, 0], [65.4, 7], [98.0, -5], [130.8, 3]].map(([f, cents], i) => {
      const o = c.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = cents;
      const g = c.createGain();
      g.gain.value = [0.5, 0.45, 0.18, 0.08][i];
      o.connect(g).connect(hum);
      o.start();
      return o;
    });

    // the air, swept by the rotation
    const len = c.sampleRate * 4;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i += 1) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } // brown-ish
    const air = c.createBufferSource();
    air.buffer = buf;
    air.loop = true;
    const airFilter = c.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.Q.value = 2.2;
    airFilter.frequency.value = 600;
    const airGain = c.createGain();
    airGain.gain.value = 0.05;
    air.connect(airFilter).connect(airGain).connect(out);
    air.start();
    // one sweep per turn: the LFO moves the filter and the loudness together
    const lfo = c.createOscillator();
    lfo.frequency.value = 1 / 9;
    const lfoToFreq = c.createGain();
    lfoToFreq.gain.value = 420;
    const lfoToGain = c.createGain();
    lfoToGain.gain.value = 0.035;
    lfo.connect(lfoToFreq).connect(airFilter.frequency);
    lfo.connect(lfoToGain).connect(airGain.gain);
    lfo.start();

    this.nodes = { out, hum, humFilter, airFilter, airGain, lfo, voices, air };
    this.apply();
    this.scheduleChime();
  },
  scheduleChime() {
    clearTimeout(this.chimeTimer);
    this.chimeTimer = setTimeout(() => {
      const c = audio();
      if (c && this.nodes) {
        const f = PENTA[Math.floor(Math.random() * PENTA.length)];
        const t = c.currentTime;
        const o = c.createOscillator();
        const g = c.createGain();
        const pan = c.createStereoPanner ? c.createStereoPanner() : null;
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.022 + this.energy * 0.02, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        if (pan) { pan.pan.value = Math.random() * 1.4 - 0.7; o.connect(g).connect(pan).connect(this.nodes.out); } else o.connect(g).connect(this.nodes.out);
        o.start(t);
        o.stop(t + 2.7);
      }
      this.scheduleChime();
    }, 4500 + Math.random() * 6500 * (1.2 - this.energy));
  },
  setEnergy(e) { this.energy = e; this.apply(); },
  apply() {
    const n = this.nodes;
    if (!n || !ctx) return;
    const t = ctx.currentTime;
    const e = this.energy;
    n.hum.gain.setTargetAtTime(0.09 + e * 0.08, t, 0.6);
    n.humFilter.frequency.setTargetAtTime(260 + e * 700, t, 0.6);
    n.airGain.gain.setTargetAtTime(0.04 + e * 0.05, t, 0.6);
    n.lfo.frequency.setTargetAtTime((1 / 9) * (0.7 + e * 1.8), t, 0.8); // spins faster when she thinks
  },
  stop() {
    const n = this.nodes;
    clearTimeout(this.chimeTimer);
    if (!n || !ctx) { this.nodes = null; return; }
    const t = ctx.currentTime;
    n.out.gain.cancelScheduledValues(t);
    n.out.gain.setTargetAtTime(0.0001, t, 0.3);
    setTimeout(() => {
      try { n.voices.forEach((o) => o.stop()); n.air.stop(); n.lfo.stop(); n.out.disconnect(); } catch { /* already gone */ }
    }, 1500);
    this.nodes = null;
  },
};

export const sfx = {
  ambient,
  play(name) {
    if (name === 'hover') {
      const now = performance.now();
      if (now - lastHover < 70) return;
      lastHover = now;
    }
    const c = audio();
    if (c && SOUNDS[name]) { try { SOUNDS[name](c); } catch { /* a sound never breaks the page */ } }
  },
  setMuted(on) { muted = Boolean(on); if (muted) ambient.stop(); },
};
