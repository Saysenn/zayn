// ***************************************************
// * A long reply is SPLIT for speech, never trimmed
// ***************************************************
//
// A cap on speech is invisible by definition: the whole reply renders in
// the transcript, so nothing shows that the ear got less than the eye. The
// server used to slice at 2000 characters and say nothing about it.
//
// Its own file, with no imports, because useOpenaiSpeech.js reaches for the
// api config and cannot be loaded outside Vite.

// Under the provider's own 4096 limit, with room for the request to differ
// slightly from what is counted here.
export const CHUNK_CHARS = 3500;

// ===============================
// * TIME TO FIRST WORD IS THE WAIT NOBODY MEASURED
// ===============================
// Fitting under the provider's limit is not the same question as starting
// quickly. The review queue is 1,696 characters, which fits in ONE request,
// so not a word was heard until the whole block had been synthesised. The
// text was on screen the entire time. Reported 2026-09-21.
//
// SO THE FIRST PART IS SMALL AND THE REST ARE NOT. Only the first request
// is a wait anybody sits through; every later one synthesises while the
// part before it is playing. Making them all small would just multiply the
// requests for no gain.
//
//   180   about one sentence. The headline of an answer, on its way back
//         before she has finished thinking about the rest.
//   900   roughly six seconds of speech, which is far longer than the
//         request that fetches the next one behind it.
export const TTS_FIRST_CHARS = 180;
export const TTS_CHUNK_CHARS = 900;

// ===============================
// * THE BROWSER VOICE CUTS OUT, AND SAYS NOTHING WHEN IT DOES
// ===============================
// The SpeechSynthesis fallback stops part way through a long utterance:
// Chrome's own long standing bug, and it fires no error, so the reply is on
// screen in full and the ear gets the first few sentences. Same invisible
// cut the server's 2000 character slice used to make.
//
// So that path chunks too, at a sentence or two per utterance, and queues
// them. Small enough that no engine gives up part way through one.
export const SPEECH_API_CHUNK_CHARS = 200;

/**
 * One long reply into speakable parts, SPLIT ON SENTENCE ENDS.
 *
 * Splitting mid-word is audible and splitting mid-sentence loses the
 * cadence, so this breaks at a full stop wherever it can and only falls
 * back to a hard cut for a single sentence longer than the whole budget.
 *
 * @param {string} text
 * @param {number} max  characters per part
 * @param {number} [firstMax]  a smaller budget for the FIRST part only.
 *   Defaults to `max`, so every existing caller is unchanged. It exists
 *   because only the first request is a wait anybody sits through: the
 *   rest are fetched while the part before them plays.
 * @returns {string[]}  in order; the caller queues them
 */
export function chunkForSpeech(text, max = CHUNK_CHARS, firstMax = max) {
  const whole = String(text ?? '').trim();
  if (whole.length <= firstMax) return whole ? [whole] : [];

  // Keep the punctuation on the sentence it belongs to.
  const sentences = whole.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? [whole];
  const parts = [];
  let current = '';
  // The budget for the part being filled: the small one until the first
  // part is out, the ordinary one after it.
  const budget = () => (parts.length === 0 ? firstMax : max);

  for (const sentence of sentences) {
    if (sentence.length > budget()) {
      if (current.trim()) { parts.push(current.trim()); current = ''; }
      // One sentence past the budget: cut it, because the alternative is
      // dropping it. Rare enough that a seam mid-clause is the lesser evil.
      // Re-read per slice, so a long opener does not keep the small budget
      // for the whole of the rest of the answer.
      for (let i = 0; i < sentence.length;) {
        const size = budget();
        parts.push(sentence.slice(i, i + size).trim());
        i += size;
      }
      continue;
    }
    if (current.length + sentence.length > budget()) {
      if (current.trim()) parts.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}
