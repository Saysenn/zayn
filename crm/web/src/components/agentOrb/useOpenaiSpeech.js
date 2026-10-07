import { useEffect, useRef, useState } from 'react';
import { apiService } from '../../configs/api.config';
import { chunkForSpeech, TTS_CHUNK_CHARS, TTS_FIRST_CHARS } from './speechChunks';
import { takePrimed } from './speechCache';

// A fetch that failed, kept apart from "not asked for yet" (null) and from
// a real blob. Swallowing it as null would make a dead request look like
// the end of the answer.
const FAILED = Symbol('speech request failed');

/**
 * Voice OUTPUT, real OpenAI TTS instead of the browser's own installed
 * voices (useSpeechSynthesis.js) — user's own reason: SpeechSynthesis only
 * ever offers whatever voices happen to be on a given visitor's machine,
 * which is fine on this one dev machine but uncontrollable once this is
 * hosted for real. This always sounds the same, on every machine.
 *
 * Same `{ supported, speaking, level, speak, cancel }` shape
 * useSpeechSynthesis exports, so AgentOverlay.jsx can hold both and pick
 * whichever's actually available without changing how either is called.
 *
 * `level` here is REAL playback amplitude (Web Audio API AnalyserNode on
 * what is actually playing), not an envelope hack — the one advantage
 * server-side audio has over SpeechSynthesis, which never exposes a
 * waveform at all. Same technique useMicLevel.js already uses for the
 * microphone side.
 */
export function useOpenaiSpeech() {
  const [available, setAvailable] = useState(null); // null = still checking
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);

  // the clip playing now (an AudioBufferSourceNode), so cancel can stop it
  const sourceRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const dataRef = useRef(null);
  const rafRef = useRef(null);
  // The tail of the utterance queue. See speak().
  const queueRef = useRef(Promise.resolve());
  // Bumped by cancel(). A chain built before the bump stops at its next
  // step rather than playing into a muted session. See speak().
  const genRef = useRef(0);

  /**
   * ONE FAILED CHECK IS NOT "NO VOICE". It asked once at load, and a blip
   * then (a restart, a dropped connection) left her on the browser's robot
   * voice until a reload. 2026-09-30. A failed REQUEST retries a few times
   * and again when the window comes back; a real "no key" answer stands.
   */
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let timer = null;
    const ask = () => apiService.masterSheet
      .speechStatus()
      .then((res) => { if (!cancelled) setAvailable(res.available); })
      .catch(() => {
        if (cancelled) return;
        setAvailable(false);
        tries += 1;
        if (tries < 5) timer = setTimeout(ask, 5000);
      });
    ask();
    const onFocus = () => { if (!cancelled) { tries = 0; ask(); } };
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener('focus', onFocus); };
  }, []);

  function teardownAudio() {
    cancelAnimationFrame(rafRef.current);
    sourceRef.current = null;
  }

  function tickLevel() {
    const analyser = analyserRef.current;
    const data = dataRef.current;
    if (!analyser || !data) return;
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
    setLevel(Math.min(1, avg / 90));
    rafRef.current = requestAnimationFrame(tickLevel);
  }

  /**
   * QUEUED, not interrupted.
   *
   * Diane can speak twice in one turn now — a line before she starts, then
   * the answer — and they arrive a second or two apart. Calling speak()
   * again used to tear the first one down mid-word, so the remark that
   * exists to fill the wait was the thing the wait cut off.
   *
   * A promise chain rather than an array: each utterance waits on the one
   * before it, and a failure resolves rather than rejects so one dead
   * request cannot wedge the queue for the rest of the session.
   *
   * ===============================
   * * AND SHE FETCHES THE NEXT PART WHILE THIS ONE IS PLAYING
   * ===============================
   * It asked for part N+1 only once part N had finished PLAYING, so every
   * seam was a round trip of silence, and the FIRST part was the whole
   * answer: the review queue is 1,696 characters, one request, and not a
   * word was heard until all of it had been synthesised. The text was on
   * screen throughout. Reported 2026-09-21.
   *
   * Two halves, and neither works alone. A small first part with no fetch
   * ahead just moves the wait to the first seam; fetching ahead with one
   * 3,500 character part has nothing to fetch.
   *
   * ONE REQUEST IN FLIGHT AHEAD, never all of them. A thirty part answer
   * would otherwise open thirty connections at once for audio most of
   * which is minutes away from being wanted.
   */
  async function speak(text) {
    if (!available || !text) return;
    // SPLIT, NEVER TRIMMED. The provider takes 4096 characters per request
    // and the server used to slice at 2000, which is a cut nobody can see:
    // the whole reply is on screen, so there is nothing to tell you the ear
    // got less than the eye.
    const parts = chunkForSpeech(text, TTS_CHUNK_CHARS, TTS_FIRST_CHARS);

    // Started once and remembered, so asking again while it is in flight
    // joins the same request rather than making a second one.
    const pending = [];
    const fetchPart = (i) => {
      if (i >= parts.length) return null;
      // A part made ahead (her greeting, on the loading screen) is used, not asked for again.
      if (!pending[i]) pending[i] = (takePrimed(parts[i]) ?? apiService.masterSheet.speech(parts[i])).catch(() => FAILED);
      return pending[i];
    };
    // IMMEDIATELY, not when its turn comes. If a line is already playing,
    // this one synthesises behind it and is ready the moment it is wanted.
    fetchPart(0);

    // MUTING HAS TO MUTE, and a part in flight is the case it missed.
    // Pausing the element stops what is AUDIBLE; a request that lands
    // afterwards would start playing into a muted session. Resetting the
    // queue never covered it, because the chain was already built.
    const gen = genRef.current;

    let turn = queueRef.current;
    parts.forEach((_, i) => {
      // CAUGHT PER PART, so one failed chunk does not abandon the rest of
      // the answer. It is still a hole in what she said, so it is logged
      // rather than swallowed: silence in the middle of a sentence looks
      // like she stopped talking, and nothing else records why.
      turn = turn.then(async () => {
        if (gen !== genRef.current) return;
        const blob = await fetchPart(i);
        if (gen !== genRef.current) return;
        // The next one is asked for HERE, before this one plays, so its
        // round trip happens inside this one's playback.
        fetchPart(i + 1);
        await playOne(blob);
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('diane: a spoken chunk failed and was skipped', err);
      });
    });
    queueRef.current = turn;
    return turn;
  }

  function playOne(blob) {
    return new Promise((resolve) => { void speakNow(blob, resolve); });
  }

  async function speakNow(blob, done) {
    if (!available || !blob) return done();
    if (blob === FAILED) {
      // A mid-session failure (key revoked, quota, network) — don't get
      // stuck "unavailable" forever, but this utterance is lost. The
      // caller (AgentOverlay) doesn't retry via SpeechSynthesis
      // automatically; `available` flipping false is what steers future
      // calls there instead.
      setAvailable(false);
      return done();
    }
    teardownAudio();

    /**
     * ===============================
     * * PLAYED THROUGH THE AUDIO ENGINE, NOT AN <audio> ELEMENT
     * ===============================
     * His report 2026-10-07: "she stopped reading when I closed the command
     * center". Each sentence is its own clip, and Chrome holds a NEW clip
     * on an <audio> element while the page is not on screen (another tab,
     * the window behind another app): the clip sat "loading" at 0:00 and
     * the answer stopped at the end of the sentence playing. Decoded and
     * played by the AudioContext, a clip plays to its end hidden or not
     * (tested in a hidden tab: 11.4 seconds of 11.4).
     */
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioContext();
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      dataRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.connect(audioCtxRef.current.destination);
    }
    const ctx = audioCtxRef.current;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyserRef.current);
      sourceRef.current = source;
      // EVERY exit calls done(), or the chain never advances and she stays
      // silent for the rest of the session.
      source.onended = () => {
        if (sourceRef.current === source) { setSpeaking(false); setLevel(0); teardownAudio(); }
        done();
      };
      setSpeaking(true);
      source.start();
      tickLevel();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('diane: a spoken clip could not be played', err);
      setSpeaking(false);
      setLevel(0);
      teardownAudio();
      done();
    }
  }

  function cancel() {
    const playing = sourceRef.current;
    sourceRef.current = null;
    try { playing?.stop(); } catch { /* already finished */ }
    setSpeaking(false);
    setLevel(0);
    teardownAudio();
    // THE QUEUE IS RESET TOO, so nothing queued behind the stopped clip
    // waits on it.
    // Muting mid-sentence has to leave her able to speak next turn.
    queueRef.current = Promise.resolve();
    // And a part still in flight must not play when it lands.
    genRef.current += 1;
  }

  useEffect(() => () => { cancel(); audioCtxRef.current?.close().catch(() => {}); }, []);

  return { supported: available === true, available, speaking, level, speak, cancel };
}
