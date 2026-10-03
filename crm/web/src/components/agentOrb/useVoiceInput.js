import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../../configs/api.config';

/**
 * Voice input that actually works: record with MediaRecorder, POST the
 * clip, get text back.
 *
 * Replaces useSpeechRecognition.js, which used the browser's own
 * SpeechRecognition — that streams audio to Google's servers and fails
 * with a bare `network` error on machines where those servers can't be
 * reached. Nothing to do with microphone permission, which is why the mic
 * could work perfectly on other sites and not here. This only needs
 * getUserMedia, which is the part that was already working.
 *
 * Exposes the same shape useSpeechRecognition did — `{ supported,
 * listening, error, start, stop }` — plus `transcribing`, so AgentOverlay
 * needed no restructuring to swap one for the other.
 */

// Ordered by preference, filtered by what the browser will actually
// record. Chrome and Firefox give webm/opus; Safari only does mp4. An
// empty string means "let the browser decide", which is the honest
// fallback rather than forcing a type it will reject.
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of PREFERRED_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

// Below this a clip is a mis-click, not speech. Sending it costs a round
// trip to come back empty.
const MIN_BYTES = 1200;

/**
 * Silence detection — the thing that makes this feel like talking rather
 * than operating a tape recorder. Stop speaking, and after a beat it sends
 * itself; no second press needed.
 *
 * Done on the raw waveform (getByteTimeDomainData -> RMS), not on the
 * frequency data the level meter uses. RMS tracks how LOUD the room is
 * right now, which is the actual question; a frequency average answers a
 * different one and is easy to trip with steady background hum.
 */
// How long a pause has to last before it counts as "done talking".
//
// 1.5 seconds, user's own figure, down from three. Three was set when a
// spoken turn meant reading a whole deal out field by field, where cutting
// someone off mid-thought would send half a row. It does not any more: a
// deal is filled in on the form now, so what gets said out loud is short —
// "add a deal", "show me Craig", "set the preset to August" — and three
// seconds of dead air after a three word instruction is most of the wait.
//
// The floor is real, not arbitrary. Below about a second normal pauses
// between words start submitting, and MIN_SPEECH_MS is the other half of
// the guard: it takes actual speech before any of this arms.
const SILENCE_HANG_MS = 1500;
// Speech has to have happened at all. Without this, background noise on a
// quiet mic would trip the "silence ended" branch and submit nothing.
const MIN_SPEECH_MS = 350;
// Pressed the mic and said nothing — give up rather than record the room
// indefinitely. Comfortably longer than the pause window, so it can never
// be the thing that fires first on someone who is simply gathering their
// thoughts before starting.
const NO_SPEECH_TIMEOUT_MS = 12000;
// A hard ceiling. Both providers cap uploads at 25MB, and a runaway
// recording is a bug, not a use case.
const MAX_RECORDING_MS = 90000;
// The noise floor is measured for this long at the start, and the speech
// threshold is set relative to it. A fixed threshold works in a quiet room
// and fails completely in a noisy one, which is exactly where auto-submit
// matters most.
const CALIBRATION_MS = 400;
const FLOOR_MULTIPLIER = 2.6;
const MIN_THRESHOLD = 0.012; // an absolute floor, for a mic so clean the measured one is ~0

export function useVoiceInput({ onResult } = {}) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState(null);
  const [available, setAvailable] = useState(null); // null = still checking
  // Live amplitude, 0-1 — the orb reacts to this. Comes from the SAME
  // stream the recorder uses. It used to be a separate hook opening a
  // second concurrent getUserMedia purely to visualise the level, which
  // meant two live mic captures for one act of speaking; the analyser is
  // already here for silence detection, so the meter is free.
  const [level, setLevel] = useState(0);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const vadRafRef = useRef(null);
  // Held in a ref so a changing callback doesn't have to re-run the effect
  // that owns the recorder.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  // Whether the server can transcribe at all. Checked once, so the mic
  // button can be hidden rather than failing on first press.
  useEffect(() => {
    let cancelled = false;
    apiService.masterSheet
      .transcribeStatus()
      .then((res) => { if (!cancelled) setAvailable(res.available); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  // Releasing the tracks is what turns off the browser's recording
  // indicator. Leaving them open means the tab shows as recording forever,
  // which is both alarming and untrue.
  const releaseStream = useCallback(() => {
    if (vadRafRef.current) cancelAnimationFrame(vadRafRef.current);
    vadRafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    setError(null);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Whisper handles noisy audio well, but these are free and make
          // a laptop mic in an office noticeably more accurate.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      // The two cases worth telling apart: refused, or no microphone at
      // all. Everything else is reported as-is rather than guessed at.
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser, then try again.'
          : err?.name === 'NotFoundError'
            ? 'No microphone found.'
            : 'Could not start recording.',
      );
      return;
    }

    const mimeType = pickMimeType();
    if (mimeType === null) {
      releaseStream();
      setError('This browser cannot record audio.');
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      releaseStream();
      recorderRef.current = null;
      setListening(false);

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      chunksRef.current = [];
      if (blob.size < MIN_BYTES) return; // tapped the mic, said nothing

      setTranscribing(true);
      try {
        const { text } = await apiService.masterSheet.transcribe(blob);
        const trimmed = text?.trim();
        // Silence transcribes to an empty string. That's not an error and
        // shouldn't post an empty message — just nothing happens.
        if (trimmed) onResultRef.current?.(trimmed);
      } catch (err) {
        setError(err?.message || "Couldn't make out what you said.");
      } finally {
        setTranscribing(false);
      }
    };

    recorder.onerror = () => {
      releaseStream();
      recorderRef.current = null;
      setListening(false);
      setError('Recording stopped unexpectedly.');
    };

    recorderRef.current = recorder;
    recorder.start();
    setListening(true);

    // ---- silence detection -------------------------------------------
    let audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      // No Web Audio. Recording still works, you just have to press the
      // mic again to send — degraded, not broken.
      return;
    }
    audioCtxRef.current = audioCtx;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

    const startedAt = performance.now();
    let floorSum = 0;
    let floorCount = 0;
    let threshold = MIN_THRESHOLD;
    let speechStartedAt = null;
    let lastSoundAt = null;
    let lastEmittedLevel = 0;

    function tick() {
      vadRafRef.current = requestAnimationFrame(tick);
      analyser.getByteTimeDomainData(samples);

      // RMS deviation from the 128 midpoint — how far the waveform is
      // actually moving, i.e. how loud it is right now.
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const v = (samples[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / samples.length);
      const elapsed = performance.now() - startedAt;

      // Only push a re-render when it moves meaningfully. This value feeds
      // the orb through React state, and updating it 60 times a second for
      // sub-perceptual changes would re-render the whole overlay for
      // nothing.
      const shown = Math.min(1, rms * 6);
      if (Math.abs(shown - lastEmittedLevel) > 0.04) {
        lastEmittedLevel = shown;
        setLevel(shown);
      }

      // Measure the room before judging anything against it.
      if (elapsed < CALIBRATION_MS) {
        floorSum += rms;
        floorCount += 1;
        return;
      }
      if (floorCount > 0) {
        threshold = Math.max(MIN_THRESHOLD, (floorSum / floorCount) * FLOOR_MULTIPLIER);
        floorCount = 0; // computed once, then frozen
      }

      const now = performance.now();
      if (rms > threshold) {
        if (speechStartedAt === null) speechStartedAt = now;
        lastSoundAt = now;
      }

      // Nothing said at all — stop and discard rather than sit on an open
      // microphone.
      if (speechStartedAt === null) {
        if (elapsed > NO_SPEECH_TIMEOUT_MS) stopRef.current?.();
        return;
      }

      // Said something, then went quiet long enough to mean it. This is
      // the auto-submit.
      const spokeFor = lastSoundAt - speechStartedAt;
      const quietFor = now - lastSoundAt;
      if (spokeFor >= MIN_SPEECH_MS && quietFor >= SILENCE_HANG_MS) {
        stopRef.current?.();
        return;
      }

      if (elapsed > MAX_RECORDING_MS) stopRef.current?.();
    }
    tick();
  }, [releaseStream]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop(); // onstop above does the rest
  }, []);

  /**
   * Stop recording and throw the clip away.
   *
   * Different from stop(), which transcribes and sends. This exists for
   * the case where the recording has been CONTAMINATED and must not reach
   * Diane: she started speaking while the mic was open, so the clip now
   * contains her voice as well as (or instead of) the admin's.
   *
   * That really happened — a reply of hers came back as the admin's next
   * message, verbatim. `echoCancellation` is on, but it can only remove
   * audio the browser itself is playing, and without the OpenAI TTS key
   * she speaks through the OS's speech service, outside the page. The
   * canceller has nothing to reference, so the only reliable answer is to
   * never have both live at once.
   */
  const abort = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null; // the handler is what would transcribe it
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
    setListening(false);
  }, [releaseStream]);

  // The detection loop lives inside start() and has to be able to call
  // stop(), which is declared after it. A ref breaks that cycle without
  // reordering the two into something less readable.
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // Leaving the page mid-recording must not leave the mic live.
  useEffect(() => () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    releaseStream();
  }, [releaseStream]);

  return {
    // Needs both halves: a browser that can record, and a server that can
    // transcribe. `available === null` while the check is in flight, so the
    // button doesn't flicker in and then out on load.
    supported: available === true && typeof MediaRecorder !== 'undefined',
    listening,
    transcribing,
    error,
    level,
    start,
    stop,
    abort,
  };
}
