import { useCallback, useEffect, useRef, useState } from 'react';
// Shared with useOpenaiSpeech, so both voices break at the same sentence
// ends. See its banner: a cap on speech is a cut nobody can see.
import { chunkForSpeech, SPEECH_API_CHUNK_CHARS } from './speechChunks';

/**
 * Voice OUTPUT — the agent speaking its reply aloud, browser-native
 * (SpeechSynthesis), no TTS backend.
 *
 * Worth being explicit about: whatbot's own CLAUDE.md has a deliberate
 * rule against this exact thing — "a reply is never audio, because a
 * spoken figure cannot be re-read or checked." That rule is about a wage
 * arriving on someone's WhatsApp with nothing to check it against. This is
 * a different situation: the full text reply sits in the transcript on
 * screen at the same moment it's spoken, so nothing here is check-once,
 * unread. Muteable (the overlay's own toggle) rather than forced either way.
 *
 * `level` is NOT real audio analysis — SpeechSynthesis never exposes the
 * actual waveform to the Web Audio API, so there is nothing to analyze.
 * It's an honest envelope instead: 1 for the ~150ms right after each
 * onboundary (word) event, decaying to 0 between words. Real playback
 * timing driving the pulse, not a canned loop — just not spectral.
 *
 * Voice selection is genuinely per-visitor: SpeechSynthesis only ever
 * offers whatever voices are already installed on THAT machine's OS/
 * browser, which this code has zero control over. This picks the best
 * available match from a preference list of known warm/feminine-sounding
 * voices across platforms, but on a machine with none of these installed,
 * it silently falls back to the browser's own default voice — there's no
 * way to guarantee a specific voice for a random visitor without a real
 * server-side TTS API (see useOpenaiSpeech.js), which is the actual fix
 * once hosted publicly. See docs/run-it.md for how to check/add voices
 * on this machine in the meantime.
 */
// Ordered by how consistently warm/expressive they read, most platforms
// covered — Windows' newer Edge/neural voices first (nova/aria read as
// notably more natural than the older Zira), then Mac/Safari, then
// Chrome's own cross-platform Google voices, then a generic "female"
// substring match as a last resort.
const VOICE_PREFERENCE = [
  'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Sonia', // Windows/Edge neural
  'Samantha', 'Victoria', 'Karen', 'Moira', 'Tessa', // macOS/Safari
  'Google UK English Female', 'Google US English', // Chrome
  'Microsoft Zira', 'Microsoft Susan', // older Windows
];

// Explicitly never these, even if nothing above matched — Diane is
// female, and a silent fallback to the system default is exactly how she
// ended up male on this machine (Windows ships David first, Zira second,
// and the default is David).
const MALE_VOICES = /\b(david|mark|george|daniel|james|guy|ryan|thomas|alex|fred|rishi|liam|william|christopher|eric|roger|steffan|brandon|andrew|brian|adam|arthur|oliver|male)\b/i;

function pickVoice(voices) {
  const english = voices.filter((v) => v.lang?.startsWith('en'));
  const base = english.length > 0 ? english : voices;

  // Male voices are removed from the pool BEFORE any matching, not just
  // checked at the last resort. That ordering was the bug: a preference
  // entry matched by substring could still land on a male voice (Windows
  // exposes several under names that contain a preferred one), and every
  // branch below it was then unreachable. Diane is female — no path
  // through this function should be able to return a male voice while a
  // usable alternative exists.
  const filtered = base.filter((v) => !MALE_VOICES.test(v.name));
  const pool = filtered.length > 0 ? filtered : base;

  for (const name of VOICE_PREFERENCE) {
    const exact = pool.find((v) => v.name === name);
    if (exact) return exact;
  }
  // Substring fallback — a locale variant like "Microsoft Aria Online
  // (Natural) - English (United States)" won't match the exact names
  // above but does contain "Aria". This is what actually matches on
  // Windows, where the real name is "Microsoft Zira Desktop - English
  // (United States)", not the bare "Microsoft Zira" listed above.
  for (const name of VOICE_PREFERENCE) {
    const partial = pool.find((v) => v.name.includes(name));
    if (partial) return partial;
  }
  return (
    pool.find((v) => /female|woman/i.test(v.name)) ??
    // Last resort: anything at all that isn't a known male voice, rather
    // than returning null and letting the browser pick its own default
    // (which is male on Windows).
    pool.find((v) => !MALE_VOICES.test(v.name)) ??
    null
  );
}

export function useSpeechSynthesis() {
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const decayRef = useRef(null);
  const voiceRef = useRef(null);

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Resolved ONCE here, not inside speak(). getVoices() returns [] on the
  // first call in Chrome (the list loads async, 'voiceschanged' fires when
  // ready) — the earlier version tried to patch the voice in from that
  // event, but by then speechSynthesis.speak() had already been called and
  // setting .voice on a speaking utterance does nothing. That's the actual
  // reason Diane came out male: every first utterance used the system
  // default (David on Windows), silently.
  useEffect(() => {
    if (!supported) return;
    const resolve = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) return;
      voiceRef.current = pickVoice(voices);
      // Logged because "she sounds male again" is otherwise impossible to
      // diagnose from the outside — this machine's installed voices are
      // the input to a decision made entirely in the browser, and this is
      // the only way to see which one won.
      console.info(
        '[diane] voice:', voiceRef.current?.name ?? '(browser default)',
        '| available:', voices.map((v) => v.name).join(', '),
      );
    };
    resolve();
    window.speechSynthesis.addEventListener('voiceschanged', resolve);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', resolve);
  }, [supported]);

  const pulse = useCallback(() => {
    setLevel(1);
    clearTimeout(decayRef.current);
    decayRef.current = setTimeout(() => setLevel(0.15), 150);
  }, []);

  const speak = useCallback(
    (text) => {
      if (!supported || !text) return;
      window.speechSynthesis.cancel(); // one utterance at a time

      // If the voice list still isn't ready (very first speak on a cold
      // page), force it once more — getVoices() is what triggers the async
      // load in the first place, so calling it here often fills it
      // synchronously on a warm page.
      if (!voiceRef.current) {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) voiceRef.current = pickVoice(voices);
      }

      /**
       * SPLIT, NEVER TRIMMED, exactly as the OpenAI path does it.
       *
       * One long utterance is the cut nobody can see: this engine gives up
       * part way through and fires no error, so the whole reply is on
       * screen and the ear gets the first few sentences. `chunkForSpeech`
       * is shared with useOpenaiSpeech so both paths break at the same
       * sentence ends and one rule covers both.
       */
      const parts = chunkForSpeech(text, SPEECH_API_CHUNK_CHARS);
      if (parts.length === 0) return;

      // The engine has its own queue, so every part is handed over at once
      // and read in order. Only the LAST one ending means she has finished.
      let left = parts.length;

      for (const part of parts) {
        const utterance = new SpeechSynthesisUtterance(part);
        utterance.rate = 1.02;
        // Slightly above neutral: reads warmer and more feminine on the
        // older Windows voices (Zira in particular), which are otherwise
        // flat.
        utterance.pitch = 1.15;
        if (voiceRef.current) utterance.voice = voiceRef.current;

        utterance.onstart = () => setSpeaking(true);
        utterance.onboundary = pulse;
        // A part that fails is one part lost, never the rest of the queue:
        // the count has to fall the same way whichever end it reaches.
        const finish = () => {
          left -= 1;
          if (left > 0) return;
          setSpeaking(false);
          setLevel(0);
        };
        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
      }
    },
    [supported, pulse],
  );

  const cancel = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
    setLevel(0);
  }, [supported]);

  return { supported, speaking, level, speak, cancel };
}
