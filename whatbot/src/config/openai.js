import { env } from "./env.js";

export const openaiConfig = {
  apiKey: env.OPENAI_API_KEY,
  model: env.OPENAI_MODEL,
  baseURL: env.OPENAI_BASE_URL,
  mode: env.LLM_MODE,

  /** hard stop on the agent loop, in case the LLM never stops asking for tools */
  maxToolRounds: 4,

  /** how much of the conversation it remembers. more = better answers, bigger bill. */
  historyTurns: 6,

  /** give up on a hung request so the job fails and gets retried */
  requestTimeoutMs: 30_000,

  temperature: 0.2,

  /** the payments agent v2, see agent/v2/askModel.js */
  v2: {
    on: env.PAYMENTS_V2 === "1",
    model: env.PAYMENTS_V2_MODEL,
    effort: env.PAYMENTS_V2_EFFORT,
  },
};
