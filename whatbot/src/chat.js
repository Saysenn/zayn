/**
 * Chat in the terminal. Run by a person, not by anything automatic.
 *
 *   npm run chat                          list the sample people
 *   npm run chat -- +447100000901         chat as them, on their first group
 *   npm run chat -- +447100000901 INDIGO  chat as them on a specific number
 *
 * This calls the exact same handleMessage() the WhatsApp worker calls — same
 * identity lookup, same tools, same state machine. The only difference is where
 * the text comes from. No WhatsApp, no queue.
 *
 * Which is why testing here proves something real.
 *
 * "reset" clears the conversation. Ctrl+C quits.
 */

import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { sheetsConfig } from "./config/index.js";
import { redis } from "./system/redis.js";
import { syncSheet } from "./sheet/syncSheet.js";
import { handleMessage, NO_REPLY } from "./conversation/handleMessage.js";
import { clearConversation } from "./conversation/memory.js";
import * as repo from "./employee/storage.js";

/** who to pretend to be — pass their number as an argument */
const phoneArg = process.argv[2];
/**
 * Which of our numbers they are messaging.
 *
 * This is not cosmetic. The group decides which companies are in play, so
 * somebody who works across two groups gives two different answers depending on
 * which one you pass. Getting this wrong in testing hides the whole boundary.
 */
const groupArg = process.argv[3];

const { loaded, people, rejected, mismatched } = await syncSheet();
console.log(
  `\nsynced ${loaded} assignments for ${people} people from "${sheetsConfig.source}"` +
    `\n  ${rejected} rejected (missing from every total)` +
    `\n  ${mismatched} where payable disagrees with the monthly rate (kept, using the stated payable)\n`,
);

const all = await repo.findAll();
if (all.length === 0) {
  console.error("Nothing loaded — nothing to test against.");
  process.exit(1);
}

if (!phoneArg) {
  console.log("Pass a phone number to chat as. Available:\n");
  const seen = new Set();
  for (const a of all.filter((x) => x.status === "active" && x.phone)) {
    const key = `${a.phone}|${a.group}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(
      `  ${a.phone}  ${a.personName.padEnd(16)} ${a.roleLabel.padEnd(10)} ${a.group}`,
    );
  }
  console.log("\n  npm run chat -- +447100000901          (their first group)");
  console.log("  npm run chat -- +447100000901 MILKMAN  (a specific number)\n");
  await redis.quit();
  process.exit(0);
}

const mine = all.filter((a) => a.phone === phoneArg && a.status === "active");
const groups = [...new Set(mine.map((a) => a.group))].sort();
const channelGroup = groupArg ?? groups[0] ?? "UNKNOWN";

if (mine.length === 0) {
  console.log(
    `${phoneArg} is not in the sheet — expect the unknown-sender reply.`,
  );
} else {
  const here = mine.filter((a) => a.group === channelGroup);
  console.log(`You are ${mine[0].personName}, on the ${channelGroup} number.`);
  console.log(`  here:  ${here.length} assignment(s)`);
  if (groups.length > 1) {
    console.log(
      `  also in: ${groups.filter((g) => g !== channelGroup).join(", ")} — not visible on this number`,
    );
  }
  if (here.length === 0) {
    console.log(
      `  (nothing in ${channelGroup} — pass one of: ${groups.join(", ")})`,
    );
  }
}
console.log(
  'Type a message, or "reset" to clear the conversation, Ctrl+C to quit.\n',
);

await clearConversation(phoneArg);

const rl = readline.createInterface({ input: stdin, output: stdout });

/**
 * Read a line at a time, waiting for each answer before reading the next.
 *
 * `for await` rather than repeated rl.question() calls. With question(), piping
 * a file of questions in closed the interface at EOF and killed the process
 * while a reply was still in flight — so scripted runs printed nothing at all.
 * The async iterator finishes the loop body first, which is what we want either
 * way: one question, one answer, then the next.
 *
 * It also ends cleanly on Ctrl+C and on end-of-input, instead of throwing an
 * AbortError stack trace at somebody who just wanted to stop.
 */
rl.setPrompt("you > ");
rl.prompt();

for await (const line of rl) {
  const text = line.trim();

  if (!text) {
    rl.prompt();
    continue;
  }

  if (text === "reset") {
    await clearConversation(phoneArg);
    console.log("bot > (conversation cleared)\n");
    rl.prompt();
    continue;
  }

  try {
    const reply = await handleMessage({ phone: phoneArg, channelGroup, text });
    if (reply === NO_REPLY) console.log("bot > (silent — opted out)\n");
    else {
      console.log(`bot > ${reply.text}\n`);
      // the file cannot be sent to a terminal, so say what WhatsApp would have
      // attached — otherwise a file-shaped answer looks like it did nothing
      if (reply.attachment) {
        console.log(
          `bot > [attached ${reply.attachment.fileName}, ${reply.attachment.content.length} bytes]\n`,
        );
      }
    }
  } catch (err) {
    console.error(
      "bot > error:",
      err instanceof Error ? err.message : err,
      "\n",
    );
  }

  rl.prompt();
}

await redis.quit();
process.exit(0);
