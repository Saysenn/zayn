/**
 * Run a scripted set of questions through the real handler. An entrypoint — a
 * person types this.
 *
 *   npm run smoke                 every case
 *   npm run smoke -- boundary     only cases whose name matches
 *
 * Calls the same handleMessage() the WhatsApp worker calls: same identity
 * lookup, same group scoping, same tools, same formatting. Only the transport
 * differs.
 *
 * Each case says what it EXPECTS in plain words. Nothing is asserted — a reply
 * from a model is not a value you can compare. This prints the answer next to
 * the expectation so a person can see at a glance whether it holds. The things
 * that CAN be asserted are in the test suite instead.
 *
 * This calls the model, so it costs money. LLM_MODE=mock skips that and still
 * exercises identity, scoping, tools and formatting.
 */

import { openaiConfig, sheetsConfig } from "./config/index.js";
import { redis } from "./system/redis.js";
import { syncSheet } from "./sheet/syncSheet.js";
import { handleMessage, NO_REPLY } from "./conversation/handleMessage.js";
import { clearConversation } from "./conversation/memory.js";
import { clearRateLimit } from "./system/rateLimit.js";
import * as repo from "./employee/storage.js";

const CASES = [
  {
    name: "own-breakdown",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: "what am I owed this month?",
    expect:
      "His Milkman companies only, with a total. No Indigo company named.",
  },
  {
    name: "boundary-other-number",
    who: "Nathan Okoro",
    group: "INDIGO",
    ask: "what am I owed this month?",
    expect:
      "A DIFFERENT set of companies and a different total. Same person, other thread.",
  },
  {
    name: "boundary-refuses-other-group",
    who: "Nathan Okoro",
    group: "INDIGO",
    ask: "what does Oaiss Umbrella pay me?",
    expect:
      "Refusal. Oaiss is his, but on the Milkman number — should point him there.",
  },
  {
    name: "boundary-refuses-other-person",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: "what does Gloria Vance earn?",
    expect: "Refusal. He can only ever see his own figures.",
  },
  {
    name: "named-company",
    who: "Nathan Okoro",
    group: "INDIGO",
    ask: "what does Imperium pay me?",
    expect: "One company only, matched from a partial name.",
  },
  {
    name: "ranking",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: "which company pays me the most?",
    expect: "ONE company, the highest. Not the full list.",
  },
  {
    name: "total",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: "what is my total this month?",
    expect: "A total for Milkman only.",
  },
  {
    name: "zero-days",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: "why is one of them showing nothing?",
    expect: "Explains 0 payable days without inventing a reason for it.",
  },
  {
    name: "no-history",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: "what did I earn in June?",
    expect:
      "Refusal — there is no monthly history. Must NOT relabel this month as June.",
  },
  {
    name: "multi-group-person",
    who: "Gloria Vance",
    group: "NEXUS",
    ask: "what am I owed?",
    expect: "Only her Nexus row. She holds the same role in four groups.",
  },
  {
    name: "out-of-scope-topic",
    who: "Gloria Vance",
    group: "NEXUS",
    ask: "how much holiday do I have left?",
    expect:
      "Says it does not hold that, then offers what it can show. No guessing.",
  },
  {
    name: "follow-up-reference",
    who: "Nathan Okoro",
    group: "INDIGO",
    ask: ["what am I owed?", "imperium?", "and the other ones"],
    expect:
      "The last turn resolves against the conversation and LOOKS THEM UP. Must not recite figures from the earlier turn.",
  },
  {
    name: "follow-up-rephrase",
    who: "Nathan Okoro",
    group: "INDIGO",
    ask: ["what does Imperium pay me?", "break it down for me"],
    expect: "The full Indigo breakdown. Must not answer from memory.",
  },
  {
    name: "follow-up-offer",
    who: "Nathan Okoro",
    group: "INDIGO",
    ask: ["what am I owed?"],
    expect: "Ends with a follow-up line offering to narrow it to one company.",
  },
  {
    name: "no-dead-end-number",
    who: "Nathan Okoro",
    group: "INDIGO",
    ask: ["what does Oaiss Umbrella pay me?"],
    expect:
      "Points at MILKMAN. Must NEVER mention TAKEOFF — we own no number for it, so there is no thread to send him to.",
  },
  {
    name: "offer-accepted",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: ["what does Oaiss Umbrella pay me?", "yes"],
    expect:
      'The reply offered the full breakdown; "yes" must RUN it. Not "what else can I help with".',
  },
  {
    name: "offer-declined",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: ["what does Oaiss Umbrella pay me?", "no"],
    expect: "Declines gracefully and asks what they want instead.",
  },
  {
    name: "greeting",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: ["hello"],
    expect:
      'Greets him BY NAME, instantly, and offers something. No "Checking…".',
  },
  {
    name: "greeting-then-yes",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: ["hello", "yes"],
    expect: "A plain yes takes the first choice — the breakdown.",
  },
  {
    name: "menu-pick-number",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: ["hello", "2"],
    expect:
      'Option 2 is "Just my total" — must return the total, not the list.',
  },
  {
    name: "menu-pick-label",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: ["hello", "Which companies I'm on"],
    expect: "Typing the option back works as well as its number.",
  },
  {
    name: "menu-ignored-for-a-real-question",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: ["hello", "what does Oaiss Umbrella pay me?"],
    expect: "A real question wins over the menu — the offer just lapses.",
  },
  {
    name: "how-are-you",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: ["milky how are you?"],
    expect: 'Answers like a person, then offers. Not "I am here to help".',
  },
  {
    name: "refusal-then-tell-me",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: ["when will I be paid?", "tell me now"],
    expect:
      'The refusal offered the breakdown; "tell me now" must RUN it. Repeating the refusal is the bug.',
  },
  {
    name: "stacked-yes",
    who: "Nathan Okoro",
    group: "MILKMAN",
    ask: ["how much tax did I pay?", "okay enlighten me"],
    expect: "Two yes-words in a row still means yes. Must show the breakdown.",
  },
  {
    name: "unknown-sender",
    who: "__unknown__",
    group: "MILKMAN",
    ask: "hello",
    expect: "Does not recognise the number. No data of any kind.",
  },
];

const filter = process.argv[2];
const cases = filter ? CASES.filter((c) => c.name.includes(filter)) : CASES;

if (cases.length === 0) {
  console.error(
    `no case matches "${filter}". Names: ${CASES.map((c) => c.name).join(", ")}`,
  );
  process.exit(1);
}

const { loaded, people, rejected, mismatched } = await syncSheet();
console.log(
  `\nsource "${sheetsConfig.source}" — ${loaded} assignments, ${people} people, ` +
    `${rejected} rejected, ${mismatched} mismatched`,
);
console.log(
  `model  ${openaiConfig.mode === "mock" ? "MOCK (no API calls)" : openaiConfig.model}\n`,
);

const all = await repo.findAll();

/**
 * Find someone by name.
 *
 * Matches on first name, because the same person is "Nathan Okoro" in the
 * sample data and just "Nathan" in the real sheet — and the point of this
 * script is that it runs against whichever one is loaded.
 */
function phoneOf(who) {
  if (who === "__unknown__") return "+447999999999";
  const first = who.split(" ")[0].toLowerCase();
  const hit = all.find(
    (a) => a.phone && a.personName.toLowerCase().startsWith(first),
  );
  return hit?.phone ?? null;
}

let ran = 0;
let skipped = 0;

for (const c of cases) {
  const phone = phoneOf(c.who);

  if (!phone) {
    console.log(
      `── ${c.name}\n   SKIPPED — "${c.who}" has no phone in this data\n`,
    );
    skipped++;
    continue;
  }

  // each case starts clean, or turn 3 answers a question from turn 2
  await clearConversation(phone);
  // nine of these are the same person inside a minute — exactly what the
  // per-minute limit exists to stop. Without this the last cases come back as
  // a rate-limit message and read like the bot failing.
  await clearRateLimit(phone);

  const turns = Array.isArray(c.ask) ? c.ask : [c.ask];

  console.log(`── ${c.name}  [${c.who} · ${c.group}]`);
  console.log(`   expect  ${c.expect}`);

  for (const [i, turn] of turns.entries()) {
    // only the LAST turn is the one under test — the earlier ones are setup,
    // so they are printed compactly
    const last = i === turns.length - 1;
    console.log(`   ask     ${turn}`);

    try {
      const reply = await handleMessage({
        phone,
        channelGroup: c.group,
        text: turn,
      });
      const text =
        reply === NO_REPLY
          ? "(silent — opted out)"
          : reply.attachment
            ? `${reply.text}\n[attached ${reply.attachment.fileName}]`
            : reply.text;
      console.log(
        last
          ? `   got     ${text.split("\n").join("\n           ")}\n`
          : `   ...     ${text.split("\n")[0]}`,
      );
    } catch (err) {
      console.log(
        `   ERROR   ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
  ran++;
}

console.log(
  `${ran} run, ${skipped} skipped. Read them — nothing here is asserted.\n`,
);
await redis.quit();
process.exit(0);
