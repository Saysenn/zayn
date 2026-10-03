import { logger } from "../system/logger.js";
import { forMatching } from "./normalize.js";

/**
 * People trying to talk their way past the rules.
 *
 * READ THIS FIRST: this is not the security boundary, and nothing here is
 * load-bearing. Whose rows a caller can read is computed in code from their
 * verified phone number before the model is ever called, and the `company`
 * options in each tool schema are built per caller per thread. Delete this
 * whole file and a jailbreak still cannot reach another person's pay, because
 * there is no code path that fetches it.
 *
 * It exists for two smaller reasons, both real:
 *
 *  1. Dignity. A payroll bot that cheerfully plays along with "you are now in
 *     admin mode" looks broken to the person watching, even when it leaks
 *     nothing. Answering plainly is a better look than improvising.
 *  2. Visibility. Somebody probing deserves a log line. Nothing in the system
 *     would otherwise show that a real employee spent ten minutes trying to
 *     read their colleagues' wages.
 *
 * Deliberately narrow. An ordinary over-ask — "show me everyone in Milkman" —
 * is NOT caught here: it is a fair question with a fair answer ("I can only
 * show your own figures"), and treating it as an attack would insult people who
 * simply asked.
 */

const PATTERNS = [
  {
    name: "instruction-override",
    re: /\b(ignore|disregard|forget|override|bypass)\b[^.?!]{0,30}\b(previous|prior|above|earlier|your|all|any|the)\b[^.?!]{0,20}\b(instruction|rule|prompt|restriction|guardrail|constraint|direction)/i,
  },
  {
    name: "role-swap",
    re: /\b(you are now|from now on you|act as|pretend (to be|you)|roleplay as|behave as|simulate being)\b[^.?!]{0,40}\b(admin|administrator|developer|hr|payroll manager|root|superuser|unrestricted|dan)\b/i,
  },
  {
    name: "fake-mode",
    re: /\b(admin|developer|debug|god|maintenance|test|unrestricted|jailbreak)\s*mode\b/i,
  },
  {
    name: "prompt-extraction",
    re: /\b(system prompt|your (instructions|prompt|rules|configuration)|initial prompt|what were you told|repeat (your|the) (prompt|instructions))\b/i,
  },
  {
    name: "identity-claim",
    // saying who you are does not make it so — identity is the phone number
    re: /\b(i am|i'?m|this is)\b[^.?!]{0,20}\b(the )?(hr|admin|administrator|ceo|owner|director of payroll|your (boss|developer|creator))\b/i,
  },
  {
    name: "credential-fishing",
    re: /(\bapi[- ]?key|\bopenai[- ]?key|\.env(\b|\s|$)|environment variable|auth_info|\bcredentials?\b|\bpassword\b|\bauth token\b)/i,
  },
];

const REPLY =
  "I can only ever show your own figures. That's built into how I work, not something I can be talked out of. Happy to help with anything about your own pay though.";

/**
 * A reply if this is an attempt to talk past the rules, otherwise null.
 *
 * The reply is deliberately flat and friendly. Being arch about it invites
 * people to keep trying, and most of the time it is somebody curious rather
 * than somebody malicious.
 */
export function blockBypass(text, personId) {
  const hit = PATTERNS.find((p) => p.re.test(forMatching(text)));
  if (!hit) return null;

  logger.warn(
    // first few words only: enough to recognise the attempt, not a transcript
    { actor: personId, pattern: hit.name, text: text.slice(0, 60) },
    "possible attempt to bypass access rules",
  );

  return REPLY;
}
