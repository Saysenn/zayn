import "dotenv/config";
import { z } from "zod";

/**
 * Turns "milkman:+447700900123,sprite:+447700900124" into a lookup map.
 * Whichever of our numbers a message came in on decides the group.
 */
const NumberMap = z
  .string()
  .min(1)
  .transform((raw, ctx) => {
    const map = new Map();
    for (const pair of raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)) {
      const [groupId, number] = pair.split(":").map((p) => p.trim());
      if (!groupId || !number?.startsWith("+")) {
        ctx.addIssue({
          code: "custom",
          message: `bad entry "${pair}", expected "groupId:+E164"`,
        });
        return z.NEVER;
      }
      map.set(number, groupId);
    }
    return map;
  });

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    /**
     * Overrides the default (debug in development, info in production).
     *
     * `LOG_LEVEL=error npm run smoke` is the usual reason: the scripted run
     * prints answers a person has to read, and debug logging buries them.
     */
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
      .optional(),
    PORT: z.coerce.number().int().positive().default(3000),

    REDIS_URL: z.string().min(1),

    /**
     * One entry per group: "groupId:+E164". The numbers on the five phones.
     * There's no API key here — the login is the saved session below, not a
     * credential you paste in.
     */
    WHATSAPP_NUMBERS: NumberMap,
    /**
     * Where the WhatsApp logins get saved. This folder IS the link to each
     * account — back it up, never commit it, treat it like a password.
     */
    WHATSAPP_AUTH_DIR: z.string().default("auth_info"),

    OPENAI_API_KEY: z.string().min(1),
    OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
    /**
     * Point this at any OpenAI-compatible API. Gemini and Groq both offer one,
     * so switching provider is just this line plus the model name — none of the
     * agent code changes. Leave empty for OpenAI itself.
     */
    OPENAI_BASE_URL: z.url().optional(),
    /**
     * `mock` picks tools by keyword instead of calling the LLM. Everything else
     * still runs for real, so you can test the whole thing when a free tier
     * runs out. Never use it in production.
     */
    LLM_MODE: z.enum(["live", "mock"]).default("live"),

    /**
     * Where the roster comes from.
     *   fake   built-in sample data, so everything runs before the real file exists
     *   excel  a local .xlsx — the master sheet as payroll keeps it
     *   sheets Google Sheets, for when it lives in a browser instead
     */
    DATA_SOURCE: z.enum(["fake", "excel", "sheets"]).default("fake"),
    /** path to the .xlsx, when DATA_SOURCE=excel. Read-only — we never write to it. */
    EXCEL_PATH: z.string().optional(),
    GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
    GOOGLE_SHEET_ID: z.string().optional(),
    /**
     * Tabs to skip — summaries, notes, scratch pads.
     * Everything else gets read and merged together.
     */
    /** Tabs to skip in either source — summaries, notes, scratch pads. */
    SHEET_SKIP_TABS: z
      .string()
      .default("")
      .transform((s) =>
        s
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      ),

    SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),

    /**
     * How often to pull the CRM's master sheet. The user's own figure.
     *
     * The pull is the ONLY roster source in the worker now. There is no
     * flag to turn it on and no local-xlsx schedule beside it: two sources
     * writing the same Redis keys meant whichever ran last silently won,
     * and the switch that picked between them was one more thing to get
     * wrong. Ingestion belongs to the CRM, where a human imports the messy
     * sheet and cleans it up.
     *
     * syncSheet() still exists for the offline entry points (chat.js,
     * payday.js, smoke.js, evals), which is why EXCEL_PATH and
     * SYNC_INTERVAL_MINUTES are still here.
     */
    MASTER_SHEET_PULL_MINUTES: z.coerce.number().int().positive().default(5),

    /** limits per person. every message costs two OpenAI calls, so cap it. */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(8),
    RATE_LIMIT_PER_DAY: z.coerce.number().int().positive().default(200),

    /**
     * Sending files — the CSV breakdown. Off by default.
     *
     * Off means the tool is never offered to the model and never named in the
     * prompt, so the model cannot ask for a file it will not get. See
     * `config/features.ts`.
     *
     * Default off rather than on because a file is the one reply that outlives
     * the conversation: it lands in WhatsApp's media folder and in whatever
     * backs the phone up. Turning it on should be a decision.
     */
    FEATURE_DOCUMENTS: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),

    /**
     * Answering voice notes. Off by default.
     *
     * On means an inbound voice note is transcribed and answered like any other
     * question. Replies are always text — we never speak a figure.
     */
    FEATURE_VOICE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    /**
     * The speech-to-text model, on the same OpenAI-compatible endpoint as the
     * chat model. Groq and OpenAI both serve Whisper here; Gemini's
     * compatibility layer does not, so `FEATURE_VOICE` needs one of the other
     * two.
     */
    TRANSCRIBE_MODEL: z.string().default("whisper-large-v3"),
    /**
     * Longest voice note we will transcribe, in seconds.
     *
     * A cap rather than a courtesy: transcription is billed by audio length, so
     * without one a single long recording is an unbounded charge.
     */
    VOICE_MAX_SECONDS: z.coerce.number().int().positive().default(120),

    /**
     * The monthly payday check. DRY_RUN is on by default on purpose — this is
     * the one feature that could message the whole company by accident.
     */
    PAYDAY_DRY_RUN: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    /**
     * When the check runs. `off` = no schedule at all, which is the default.
     *
     * `last-friday` is payday: the money lands that day, so that is when it is
     * worth asking. Not expressible as a cron day-of-month, so the schedule
     * fires every Friday and payday/schedule.ts drops the ones that are not the
     * last of the month.
     */
    PAYDAY_SCHEDULE: z.enum(["off", "last-friday"]).default("off"),
    /**
     * Minutes between sends, for EACH number.
     *
     * Messaging people who didn't message us first is what gets a WhatsApp
     * account banned, and going slowly is the main thing that prevents it.
     * All five numbers send at the same time, so 15 minutes gets through
     * ~100 people each in about a day.
     */
    PAYDAY_SEND_GAP_MINUTES: z.coerce.number().int().positive().default(15),
    /** how long to wait for a reply before writing them down as no_response */
    PAYDAY_RESPONSE_DAYS: z.coerce.number().int().positive().default(3),

    /** Redis is a cache, not an audit log. switch to postgres before go-live. */
    AUDIT_STORE: z.enum(["redis", "postgres"]).default("redis"),
    DATABASE_URL: z.string().optional(),

    /**
     * The CRM's own API — never a direct Postgres connection to its database.
     *
     * Both optional: unset means `system/crmClient.js` refuses to call
     * rather than silently no-op. What crosses this boundary is now small
     * and one-directional — whatbot PULLS the master sheet to answer from,
     * and pushes back only a payday outcome, escalations and chat messages.
     * It no longer syncs any roster data INTO the CRM.
     */
    CRM_API_URL: z.string().optional(),
    CRM_AGENT_API_KEY: z.string().optional(),

    /**
     * The other direction: the CRM's chatbox calling INTO the worker to
     * deliver an admin's reply over WhatsApp. Unset means the webhook
     * refuses every request rather than accepting one with no real check.
     * Separate port from PORT (the web process) — worker.js runs this, and
     * both processes can run on the same box.
     */
    ADMIN_REPLY_WEBHOOK_KEY: z.string().optional(),
    // Distinct from PORT (server.js) on purpose — both processes can run on
    // the same box at once, and 3002 keeps that true. Must match crm/api's
    // WHATBOT_WEBHOOK_URL; keep the two .env.example files in step.
    WORKER_PORT: z.coerce.number().int().positive().default(3002),
  })
  .superRefine((v, ctx) => {
    if (v.AUDIT_STORE === "postgres" && !v.DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "required when AUDIT_STORE=postgres",
      });
    }
  })
  .superRefine((v, ctx) => {
    // The worker answers from the CRM's copy and nothing else, so without
    // the CRM's address it would serve whatever happened to be left in
    // Redis, forever. Refusing to start is better than answering a real
    // person a stale figure.
    //
    // Required for every entry point, not just the worker. The offline
    // ones (chat.js, smoke.js, evals) load a local sheet and never call
    // the CRM, so any value satisfies them; gating this on which script
    // is running would be a second code path to keep true.
    if (!v.CRM_API_URL || !v.CRM_AGENT_API_KEY) {
      for (const key of ["CRM_API_URL", "CRM_AGENT_API_KEY"]) {
        if (!v[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message:
              "required: the worker's roster comes from the CRM master sheet",
          });
        }
      }
    }
  })
  .superRefine((v, ctx) => {
    if (v.DATA_SOURCE === "excel" && !v.EXCEL_PATH) {
      ctx.addIssue({
        code: "custom",
        path: ["EXCEL_PATH"],
        message: "required when DATA_SOURCE=excel",
      });
    }
  })
  .superRefine((v, ctx) => {
    if (v.DATA_SOURCE === "sheets") {
      if (!v.GOOGLE_SERVICE_ACCOUNT_JSON) {
        ctx.addIssue({
          code: "custom",
          path: ["GOOGLE_SERVICE_ACCOUNT_JSON"],
          message: "required when DATA_SOURCE=sheets",
        });
      }
      if (!v.GOOGLE_SHEET_ID) {
        ctx.addIssue({
          code: "custom",
          path: ["GOOGLE_SHEET_ID"],
          message: "required when DATA_SOURCE=sheets",
        });
      }
    }
  });

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
