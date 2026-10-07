/**
 * Talk to the expense bot in the terminal. Run by a person, not by anything automatic.
 *
 *   npm run chat:expenses -- +447700900001 MANBAT
 *
 * The number is the admin you pretend to be, the group is which of our
 * numbers they are messaging. It calls the exact same handleMessage() the
 * WhatsApp worker calls: the same guard, the same CRM brain, the same
 * replies. Only where the message comes from is different.
 *
 *   a line of text          sent as a message
 *   /file <path> [| words]  sends a photo or file, with words as its caption
 *   reset                   nothing; the conversation lives in the CRM
 *   Ctrl+C                  quits
 */

import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { extname, basename } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { redis } from "./system/redis.js";
import { handleMessage, NO_REPLY } from "./conversation/handleMessage.js";
import { isExpenseAdmin } from "./expenses/expenses.js";
import { arrived } from "./expenses/batch.js";

const phone = process.argv[2];
const group = process.argv[3];
if (!phone || !group) {
  process.stdout.write("usage: npm run chat:expenses -- <+phone> <GROUP>\n");
  process.exit(1);
}

const MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".csv": "text/csv", ".txt": "text/plain",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".json": "application/json",
};

const say = (s) => process.stdout.write(`${s}\n`);
say(`\n${phone} on the ${group} number: ${(await isExpenseAdmin(phone, group)) ? "a registered expense admin" : "NOT a registered expense admin (expect the old employee replies)"}`);
say('Type a message, "/file <path> | caption" to send a file, Ctrl+C to quit.\n');

const rl = readline.createInterface({ input: stdin, output: stdout });
rl.setPrompt("you > ");
rl.prompt();
let n = 0;

for await (const line of rl) {
  const text = line.trim();
  if (!text || text === "reset") {
    rl.prompt();
    continue;
  }
  let message = text;
  const attachments = [];
  const file = /^\/file\s+(.+?)(?:\s*\|\s*(.*))?$/.exec(text);
  if (file) {
    try {
      const buffer = await readFile(file[1]);
      attachments.push({ filename: basename(file[1]), mime: MIME[extname(file[1]).toLowerCase()] ?? "application/octet-stream", base64: buffer.toString("base64") });
      message = file[2] ?? "";
      say(`      [sending ${basename(file[1])}, ${Math.round(buffer.length / 1024)} KB]`);
    } catch (err) {
      say(`      [cannot read ${file[1]}: ${err.message}]`);
      rl.prompt();
      continue;
    }
  }
  n += 1;
  const started = Date.now();
  try {
    const reply = await handleMessage({
      phone, channelGroup: group, text: message, attachments, messageId: `terminal-${Date.now()}-${n}`,
      // numbered like a real arrival, so a file waits for the burst as on WhatsApp
      batchSeq: attachments.length ? await arrived(phone, group) : undefined,
      notify: (t) => say(`bot > ${t}`),
      typing: () => { say("      [typing…]"); return () => {}; },
      typingOnce: () => say("      [typing…]"),
    });
    say(reply === NO_REPLY ? "bot > (no reply)" : `bot > ${reply.text.split("\n").join("\n      ")}`);
    if (reply !== NO_REPLY && reply.image) {
      const file = `/tmp/whatbot-expense-${Date.now()}.png`;
      await writeFile(file, Buffer.from(reply.image.base64, "base64"));
      say(`      [picture sent with the text above as its caption: ${file}]`);
      if (reply.receipt) {
        const r = `/tmp/whatbot-receipt-${Date.now()}-${reply.receipt.filename ?? "receipt"}`;
        await writeFile(r, Buffer.from(reply.receipt.base64, "base64"));
        say(`      [receipt sent: ${r}]`);
      }
      for (const [i, page] of (reply.moreImages ?? []).entries()) {
        const more = `/tmp/whatbot-expense-${Date.now()}-${i + 2}.png`;
        await writeFile(more, Buffer.from(page.base64, "base64"));
        say(`      [page ${i + 2}: ${more}]`);
      }
    }
    for (const t of reply.more ?? []) say(`bot > ${t.split("\n").join("\n      ")}`);
  } catch (err) {
    say(`bot > error: ${err instanceof Error ? err.message : err}`);
  }
  say(`      (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
  rl.prompt();
}

await redis.quit();
process.exit(0);
