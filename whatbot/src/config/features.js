import { env } from "./env.js";

/**
 * Optional behaviour that can be switched off without deleting the code.
 *
 * A feature here is one a person would recognise as a feature — "can it send
 * me a file?" — not an internal setting. Thresholds and limits live with the
 * concern they belong to; this file is only ever a set of on/off answers.
 *
 * The rule for anything listed here: OFF must mean the model never learns the
 * feature exists. It is not enough to drop the file at the last moment — a
 * model that knows about a tool will offer it in prose, and then we have
 * promised something we do not do. So each flag is enforced where the menu is
 * built (`tools/index.ts`, `agent/prompt.ts`), and again at the point of no
 * return in `worker.ts`.
 */
export const features = {
  /**
   * Sending files. Currently the CSV breakdown, `get_my_breakdown_file`.
   *
   * A document is the one reply that outlives the conversation — it sits in
   * the phone's media folder and in its backups long after a message would
   * have been scrolled past. Off unless somebody decided otherwise.
   */
  documents: env.FEATURE_DOCUMENTS,

  /**
   * Listening to voice notes. Inbound only — we transcribe what they said and
   * answer in text.
   *
   * We never reply with audio. Every figure in a reply is formatted in code so
   * it reads exactly as written; spoken aloud it becomes whatever a
   * text-to-speech engine makes of it, unreadable back, and impossible to
   * check. A wage is something people re-read.
   */
  voice: env.FEATURE_VOICE,

  /**
   * The expense bot's previews and "saved" notes as a picture, with the
   * reply line in its caption. The one picture sent without being asked for,
   * his call 2026-10-07: it reads better than text, and he accepted that it
   * lands in the phone's gallery. Off: the same preview as text.
   */
  expenseImages: env.FEATURE_EXPENSE_IMAGES,
};

/** settings that only matter when `voice` is on */
export const voiceConfig = {
  model: env.TRANSCRIBE_MODEL,
  maxSeconds: env.VOICE_MAX_SECONDS,
};

/** the name a tool uses to say "I need this switched on" */

export const featureEnabled = (name) => features[name];
