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
 * the actual <audio> element), not an envelope hack — the one advantage
 * server-side audio has over SpeechSynthesis, which never exposes a
 * waveform at all. Same technique useMicLevel.js already uses for the
 * microphone side.
 */
export function useOpenaiSpeech() {
  const [available, setAvailable] = useState(null); // null = still checking
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);

  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const dataRef = useRef(null);
  const rafRef = useRef(null);
  const objectUrlRef = useRef(null);
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
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
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

    objectUrlRef.current = URL.createObjectURL(blob);

    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    audio.src = objectUrlRef.current;

    // Built once, reused every utterance — a fresh AudioContext per speak()
    // call is both wasteful and hits Chrome's per-page context limit
    // eventually. createMediaElementSource can only ever be called once
    // per <audio> element, which is exactly why audioRef is a stable ref
    // and not recreated per call.
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioContext();
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      dataRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
      const source = audioCtxRef.current.createMediaElementSource(audio);
      source.connect(analyserRef.current);
      analyserRef.current.connect(audioCtxRef.current.destination);
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();

    audio.onplay = () => { setSpeaking(true); tickLevel(); };
    // EVERY exit calls done(), or the chain never advances and she stays
    // silent for the rest of the session.
    audio.onended = () => { setSpeaking(false); setLevel(0); teardownAudio(); done(); };
    audio.onerror = () => { setSpeaking(false); setLevel(0); teardownAudio(); done(); };

    audio.play().catch(() => { setSpeaking(false); setLevel(0); done(); });
  }

  function cancel() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setSpeaking(false);
    setLevel(0);
    teardownAudio();
    // THE QUEUE IS RESET TOO. Pausing the element never fires `onended`,
    // so the promise for the utterance being cancelled would never
    // resolve, and everything queued behind it would wait on it forever.
    // Muting mid-sentence has to leave her able to speak next turn.
    queueRef.current = Promise.resolve();
    // And a part still in flight must not play when it lands.
    genRef.current += 1;
  }

  useEffect(() => () => { cancel(); audioCtxRef.current?.close().catch(() => {}); }, []);

  return { supported: available === true, available, speaking, level, speak, cancel };
}
